const OPENAI_URL = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 55000;

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
  required: ["verdict", "display_verdict", "calculation_mistakes", "logical_gaps", "teacher_note", "confidence", "readability"]
};

const systemPrompt = `너는 수학학원 선생님의 풀이 검토 보조 AI다.
학생 풀이 사진을 보고 다음 두 가지만 검사한다.
1. 계산 실수
2. 빨간색으로 표시해야 할 정도의 논리 비약

규칙:
- 풀이가 정상이라면 짧게 맞음으로 판정한다.
- 단순 암산, 자연스러운 사칙연산, 짧은 식 정리는 논리 비약으로 보지 않는다.
- 인수분해, 완전제곱식, 유리화, 약분, 치환, 삼각함수·로그·지수 변형, 극한·미분·적분처럼 개념이 바뀌는 단계에서 핵심 근거 없이 식이 변한 경우만 논리 비약으로 기록한다.
- 계산 실수와 논리 비약이 명확하지 않으면 추측하지 않는다.
- 사진이 흐리거나 문제와 풀이가 충분히 보이지 않으면 판독 불가로 처리한다.
- 긴 해설, 모범풀이, 성향 분석, 학습법 추천은 하지 않는다.
- 논리 비약은 위치와 문제점만 기록하고, 필요한 과정이나 보충 풀이를 출력하지 않는다.
- 출력은 지정된 JSON 형식만 사용한다.`;

function responseJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function mapError(status, data) {
  const message = data?.error?.message || data?.message || "알 수 없는 오류";
  const code = data?.error?.code || data?.error?.type || String(status);
  const lower = message.toLowerCase();

  if (status === 401 || status === 403) return { title: "API 인증 실패", cause: "OpenAI API 키가 없거나 유효하지 않습니다.", suggestions: ["Netlify 환경변수 OPENAI_API_KEY를 확인하세요.", "키를 교체했다면 새 배포를 실행하세요."], code };
  if (status === 429 && (lower.includes("quota") || lower.includes("billing") || lower.includes("credit"))) return { title: "API 크레딧 또는 결제 한도 부족", cause: "OpenAI API 잔액이 없거나 사용 한도에 도달했습니다.", suggestions: ["OpenAI Platform의 Billing과 Limits를 확인하세요.", "충전 후 몇 분 뒤 다시 시도하세요."], code };
  if (status === 429) return { title: "요청이 너무 많습니다", cause: "짧은 시간에 요청이 몰려 일시적으로 제한되었습니다.", suggestions: ["10~30초 후 다시 시도하세요.", "여러 장이면 한 장씩 분석하세요."], code };
  if (status === 413) return { title: "이미지 용량이 너무 큽니다", cause: "Netlify가 받을 수 있는 요청 크기를 초과했습니다.", suggestions: ["사진에서 풀이 부분만 잘라 올리세요.", "한 번에 올리는 사진 수를 줄이세요."], code };
  if (status >= 500) return { title: "분석 서버 오류", cause: message, suggestions: ["잠시 후 다시 분석하세요.", "계속되면 Netlify Functions 로그를 확인하세요."], code };
  return { title: "분석 요청 실패", cause: message, suggestions: ["사진을 다시 선택해 재시도하세요."], code };
}

function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === "string") chunks.push(part.text);
      if (typeof part?.output_text === "string") chunks.push(part.output_text);
    }
  }
  return chunks.join("\n");
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return responseJson({ error: "POST 요청만 지원합니다." }, 405);

  const apiKey = Netlify.env.get("OPENAI_API_KEY");
  const model = Netlify.env.get("OPENAI_MODEL") || "gpt-5-mini";
  if (!apiKey) return responseJson({ error: "OPENAI_API_KEY가 없습니다.", error_info: { title: "API 설정 없음", cause: "Netlify 환경변수에 OPENAI_API_KEY가 등록되지 않았습니다.", suggestions: ["Project configuration → Environment variables에서 키를 추가하세요."], code: "NO_API_KEY" } }, 500);

  let body;
  try { body = await req.json(); } catch { return responseJson({ error: "요청 형식이 올바르지 않습니다." }, 400); }
  const imageDataUrl = body?.imageDataUrl;
  if (!imageDataUrl?.startsWith("data:image/")) return responseJson({ error: "이미지가 없습니다.", error_info: { title: "이미지 없음", cause: "분석할 사진이 전달되지 않았습니다.", suggestions: ["사진을 다시 선택하세요."], code: "NO_IMAGE" } }, 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_output_tokens: 900,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "input_text", text: "사진 속 문제와 학생 풀이를 확인해 계산 실수와 빨간색급 논리 비약만 검사하세요." },
            { type: "input_image", image_url: imageDataUrl, detail: "low" }
          ]}
        ],
        text: { format: { type: "json_schema", name: "math_checker_result", strict: true, schema } }
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return responseJson({ error: data?.error?.message || "OpenAI API 오류", error_info: mapError(upstream.status, data) }, upstream.status);

    const parsed = parseJson(outputText(data));
    if (!parsed) return responseJson({ error: "AI 응답 형식을 해석하지 못했습니다.", error_info: { title: "AI 응답 형식 오류", cause: "분석 결과가 예상한 형식과 다릅니다.", suggestions: ["같은 사진을 다시 분석하세요."], code: "INVALID_RESPONSE" } }, 502);

    const calculationMistakes = Array.isArray(parsed.calculation_mistakes) ? parsed.calculation_mistakes : [];
    const logicalGaps = Array.isArray(parsed.logical_gaps) ? parsed.logical_gaps : [];
    return responseJson({
      ...parsed,
      calculation_mistakes: calculationMistakes,
      logical_gaps: logicalGaps,
      has_calculation_mistakes: calculationMistakes.length > 0,
      has_logical_gaps: logicalGaps.length > 0
    });
  } catch (error) {
    if (error?.name === "AbortError") return responseJson({ error: "분석 시간이 초과되었습니다.", error_info: { title: "분석 시간 초과", cause: "OpenAI 응답이 55초 안에 끝나지 않았습니다.", suggestions: ["사진에서 풀이 부분만 잘라 올리세요.", "한 장씩 분석하세요.", "잠시 후 다시 시도하세요."], code: "TIMEOUT" } }, 504);
    return responseJson({ error: error?.message || "서버 오류", error_info: { title: "서버 오류", cause: error?.message || "알 수 없는 오류가 발생했습니다.", suggestions: ["잠시 후 다시 분석하세요."], code: "SERVER_ERROR" } }, 500);
  } finally {
    clearTimeout(timer);
  }
};
