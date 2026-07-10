const OPENAI_URL = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 58000;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["맞음", "틀림", "확인 필요", "판독 불가"] },
    display_verdict: { type: "string" },
    calculation_mistakes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line: { type: "string" },
          student_expression: { type: "string" },
          correct_expression: { type: "string" },
          reason: { type: "string" }
        },
        required: ["line", "student_expression", "correct_expression", "reason"]
      }
    },
    logical_gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line: { type: "string" },
          issue: { type: "string" }
        },
        required: ["line", "issue"]
      }
    },
    teacher_note: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    readability: { type: "string", enum: ["좋음", "보통", "나쁨"] }
  },
  required: [
    "verdict",
    "display_verdict",
    "calculation_mistakes",
    "logical_gaps",
    "teacher_note",
    "confidence",
    "readability"
  ]
};

const systemPrompt = `너는 수학학원 선생님의 풀이 검토 보조 AI다.
학생 풀이 사진에서 다음 두 가지만 검사한다.
1. 명확한 계산 실수
2. 빨간색으로 표시할 정도의 명확한 논리 비약

규칙:
- 문제와 학생 풀이를 사진에서 직접 읽어 검토한다.
- 단순 암산, 자연스러운 사칙연산, 짧은 식 정리는 논리 비약이 아니다.
- 인수분해, 완전제곱식, 유리화, 약분, 치환, 삼각함수·로그·지수 변형, 극한·미분·적분 등 핵심 개념 전환에서 근거 없이 식이 바뀐 경우만 논리 비약으로 기록한다.
- 논리 비약에는 위치와 문제점만 적고 필요한 과정이나 보충 풀이는 적지 않는다.
- 명확하지 않으면 추측하지 않는다.
- 사진이 흐리거나 문제와 풀이를 읽기 어렵다면 판독 불가로 처리한다.
- 긴 설명, 모범풀이, 학습법 추천은 하지 않는다.
- 결과는 매우 짧게 작성한다.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function mapError(status, data) {
  const message = data?.error?.message || data?.message || "알 수 없는 오류";
  const code = data?.error?.code || data?.error?.type || String(status);
  const lower = String(message).toLowerCase();

  if (status === 401 || status === 403) {
    return { title: "API 인증 실패", cause: "OpenAI API 키가 없거나 유효하지 않습니다.", suggestions: ["Netlify 환경변수 OPENAI_API_KEY를 확인하세요.", "키를 교체했다면 다시 배포하세요."], code };
  }
  if (status === 429 && (lower.includes("quota") || lower.includes("billing") || lower.includes("credit"))) {
    return { title: "API 크레딧 또는 결제 한도 부족", cause: "OpenAI API 잔액이 없거나 사용 한도에 도달했습니다.", suggestions: ["OpenAI Platform의 Billing과 Limits를 확인하세요.", "충전 후 몇 분 뒤 다시 시도하세요."], code };
  }
  if (status === 429) {
    return { title: "요청이 너무 많습니다", cause: "짧은 시간에 요청이 몰려 일시적으로 제한되었습니다.", suggestions: ["10~30초 후 다시 시도하세요.", "여러 장이면 한 장씩 분석하세요."], code };
  }
  if (status === 413) {
    return { title: "이미지 용량이 너무 큽니다", cause: "요청 크기가 서버 한도를 초과했습니다.", suggestions: ["풀이 부분만 잘라 올리세요.", "한 번에 올리는 사진 수를 줄이세요."], code };
  }
  if (status >= 500) {
    return { title: "분석 서버 오류", cause: message, suggestions: ["잠시 후 다시 분석하세요.", "계속되면 Netlify Functions 로그를 확인하세요."], code };
  }
  return { title: "분석 요청 실패", cause: message, suggestions: ["사진을 다시 선택해 재시도하세요."], code };
}

function outputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data?.output || []) {
    if (typeof item?.text === "string") chunks.push(item.text);
    for (const part of item?.content || []) {
      if (typeof part === "string") chunks.push(part);
      if (typeof part?.text === "string") chunks.push(part.text);
      if (typeof part?.output_text === "string") chunks.push(part.output_text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJson(text) {
  if (!text) return null;
  const cleaned = String(text).trim().replace(/^\uFEFF/, "");
  try { return JSON.parse(cleaned); } catch {}
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  return null;
}

function normalize(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const calculation = Array.isArray(parsed.calculation_mistakes) ? parsed.calculation_mistakes : [];
  const gaps = Array.isArray(parsed.logical_gaps) ? parsed.logical_gaps : [];
  return {
    verdict: parsed.verdict || (calculation.length ? "틀림" : gaps.length ? "확인 필요" : "맞음"),
    display_verdict: parsed.display_verdict || (calculation.length ? "❌ 풀이 틀림" : gaps.length ? "🔴 확인 필요" : "✅ 풀이 맞음"),
    calculation_mistakes: calculation,
    logical_gaps: gaps,
    teacher_note: parsed.teacher_note || "",
    confidence: Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(100, Number(parsed.confidence))) : 0,
    readability: ["좋음", "보통", "나쁨"].includes(parsed.readability) ? parsed.readability : "보통",
    has_calculation_mistakes: calculation.length > 0,
    has_logical_gaps: gaps.length > 0
  };
}

async function callOpenAI({ apiKey, model, imageDataUrl, signal }) {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 3200,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "사진 속 학생 풀이를 검토하세요. 계산 실수와 빨간색급 논리 비약만 매우 짧게 반환하세요." },
            { type: "input_image", image_url: imageDataUrl, detail: "low" }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "math_checker_result",
          strict: true,
          schema
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405);

  const apiKey = Netlify.env.get("OPENAI_API_KEY");
  const model = Netlify.env.get("OPENAI_MODEL") || "gpt-5-mini";
  if (!apiKey) {
    return json({
      error: "OPENAI_API_KEY가 없습니다.",
      error_info: {
        title: "API 설정 없음",
        cause: "Netlify 환경변수에 OPENAI_API_KEY가 등록되지 않았습니다.",
        suggestions: ["Project configuration → Environment variables에서 키를 추가하세요."],
        code: "NO_API_KEY"
      }
    }, 500);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400); }

  const imageDataUrl = body?.imageDataUrl;
  if (!imageDataUrl?.startsWith("data:image/")) {
    return json({
      error: "이미지가 없습니다.",
      error_info: {
        title: "이미지 없음",
        cause: "분석할 사진이 전달되지 않았습니다.",
        suggestions: ["사진을 다시 선택하세요."],
        code: "NO_IMAGE"
      }
    }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const { response, data } = await callOpenAI({ apiKey, model, imageDataUrl, signal: controller.signal });

    if (!response.ok) {
      return json({
        error: data?.error?.message || "OpenAI API 오류",
        error_info: mapError(response.status, data)
      }, response.status);
    }

    const parsed = normalize(parseJson(outputText(data)));
    if (!parsed) {
      const status = String(data?.status || "unknown");
      const reason = String(data?.incomplete_details?.reason || "");
      const incompleteByTokens = status === "incomplete" && reason === "max_output_tokens";

      return json({
        error: "AI 응답 형식을 해석하지 못했습니다.",
        error_info: {
          title: incompleteByTokens ? "AI 분석 결과가 중간에 끊겼습니다" : "AI 응답 형식 오류",
          cause: incompleteByTokens
            ? "AI가 결과를 끝까지 작성하기 전에 출력 한도에 도달했습니다."
            : `AI 응답은 도착했지만 결과를 읽지 못했습니다. 응답 상태: ${status}${reason ? ` / ${reason}` : ""}`,
          suggestions: incompleteByTokens
            ? ["같은 사진을 다시 분석하세요.", "계속되면 Netlify 환경변수 OPENAI_MODEL을 gpt-5-mini로 설정하세요."]
            : ["같은 사진을 다시 분석하세요."],
          code: incompleteByTokens ? "OUTPUT_LIMIT" : "INVALID_RESPONSE"
        },
        debug: {
          response_status: status,
          incomplete_reason: reason,
          text_length: outputText(data).length
        }
      }, 502);
    }

    return json(parsed);
  } catch (error) {
    if (error?.name === "AbortError") {
      return json({
        error: "분석 시간이 초과되었습니다.",
        error_info: {
          title: "분석 시간 초과",
          cause: "OpenAI 응답이 제한 시간 안에 끝나지 않았습니다.",
          suggestions: ["같은 사진을 다시 분석하세요.", "계속되면 풀이 부분만 잘라 올리세요."],
          code: "TIMEOUT"
        }
      }, 504);
    }
    return json({
      error: error?.message || "서버 오류",
      error_info: {
        title: "서버 오류",
        cause: error?.message || "알 수 없는 오류가 발생했습니다.",
        suggestions: ["잠시 후 다시 분석하세요."],
        code: "SERVER_ERROR"
      }
    }, 500);
  } finally {
    clearTimeout(timer);
  }
};
