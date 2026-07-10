const OPENAI_URL = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 55000;

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
- 논리 비약은 위치와 문제점만 기록하고 필요한 과정이나 보충 풀이는 출력하지 않는다.
- 반드시 아래 JSON 구조로만 답한다. 코드블록은 쓰지 않는다.
{
  "verdict": "맞음|틀림|확인 필요|판독 불가",
  "display_verdict": "화면에 보여줄 짧은 판정",
  "calculation_mistakes": [
    {"line":"위치", "student_expression":"학생 식", "correct_expression":"올바른 식", "reason":"짧은 이유"}
  ],
  "logical_gaps": [
    {"line":"위치", "issue":"문제점"}
  ],
  "teacher_note": "짧은 교사용 메모",
  "confidence": 0,
  "readability": "좋음|보통|나쁨"
}`;

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

  if (status === 401 || status === 403) return { title: "API 인증 실패", cause: "OpenAI API 키가 없거나 유효하지 않습니다.", suggestions: ["Netlify 환경변수 OPENAI_API_KEY를 확인하세요.", "키를 교체했다면 새 배포를 실행하세요."], code };
  if (status === 429 && (lower.includes("quota") || lower.includes("billing") || lower.includes("credit"))) return { title: "API 크레딧 또는 결제 한도 부족", cause: "OpenAI API 잔액이 없거나 사용 한도에 도달했습니다.", suggestions: ["OpenAI Platform의 Billing과 Limits를 확인하세요.", "충전 후 몇 분 뒤 다시 시도하세요."], code };
  if (status === 429) return { title: "요청이 너무 많습니다", cause: "짧은 시간에 요청이 몰려 일시적으로 제한되었습니다.", suggestions: ["10~30초 후 다시 시도하세요.", "여러 장이면 한 장씩 분석하세요."], code };
  if (status === 413) return { title: "이미지 용량이 너무 큽니다", cause: "요청 크기가 서버 한도를 초과했습니다.", suggestions: ["풀이 부분만 잘라 올리세요.", "한 번에 올리는 사진 수를 줄이세요."], code };
  if (status >= 500) return { title: "분석 서버 오류", cause: message, suggestions: ["잠시 후 다시 분석하세요.", "계속되면 Netlify Functions 로그를 확인하세요."], code };
  return { title: "분석 요청 실패", cause: message, suggestions: ["사진을 다시 선택해 재시도하세요."], code };
}

function extractText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  if (typeof data?.choices?.[0]?.message?.content === "string") return data.choices[0].message.content.trim();

  const parts = [];
  for (const item of data?.output || []) {
    if (typeof item?.text === "string") parts.push(item.text);
    for (const part of item?.content || []) {
      if (typeof part === "string") parts.push(part);
      if (typeof part?.text === "string") parts.push(part.text);
      if (typeof part?.output_text === "string") parts.push(part.output_text);
      if (typeof part?.content === "string") parts.push(part.content);
    }
  }
  return parts.join("\n").trim();
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
    const candidate = cleaned.slice(start, end + 1)
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

function normalizeResult(value) {
  if (!value || typeof value !== "object") return null;
  const allowedVerdicts = new Set(["맞음", "틀림", "확인 필요", "판독 불가"]);
  const allowedReadability = new Set(["좋음", "보통", "나쁨"]);
  const calculation = Array.isArray(value.calculation_mistakes)
    ? value.calculation_mistakes.map(x => ({
        line: String(x?.line || "위치 확인 필요"),
        student_expression: String(x?.student_expression || ""),
        correct_expression: String(x?.correct_expression || ""),
        reason: String(x?.reason || "")
      }))
    : [];
  const gaps = Array.isArray(value.logical_gaps)
    ? value.logical_gaps.map(x => ({
        line: String(x?.line || "위치 확인 필요"),
        issue: String(x?.issue || "핵심 단계의 근거가 확인되지 않습니다.")
      }))
    : [];

  let verdict = allowedVerdicts.has(value.verdict) ? value.verdict : null;
  if (!verdict) verdict = calculation.length ? "틀림" : gaps.length ? "확인 필요" : "맞음";

  return {
    verdict,
    display_verdict: String(value.display_verdict || (verdict === "맞음" ? "✅ 풀이 맞음" : verdict === "틀림" ? "❌ 풀이 틀림" : verdict)),
    calculation_mistakes: calculation,
    logical_gaps: gaps,
    teacher_note: String(value.teacher_note || ""),
    confidence: Math.max(0, Math.min(100, Number(value.confidence) || 0)),
    readability: allowedReadability.has(value.readability) ? value.readability : "보통",
    has_calculation_mistakes: calculation.length > 0,
    has_logical_gaps: gaps.length > 0
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405);

  const apiKey = Netlify.env.get("OPENAI_API_KEY");
  const model = Netlify.env.get("OPENAI_MODEL") || "gpt-5-mini";
  if (!apiKey) return json({
    error: "OPENAI_API_KEY가 없습니다.",
    error_info: { title: "API 설정 없음", cause: "Netlify 환경변수에 OPENAI_API_KEY가 등록되지 않았습니다.", suggestions: ["Project configuration → Environment variables에서 키를 추가하세요."], code: "NO_API_KEY" }
  }, 500);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400); }

  const imageDataUrl = body?.imageDataUrl;
  if (!imageDataUrl?.startsWith("data:image/")) return json({
    error: "이미지가 없습니다.",
    error_info: { title: "이미지 없음", cause: "분석할 사진이 전달되지 않았습니다.", suggestions: ["사진을 다시 선택하세요."], code: "NO_IMAGE" }
  }, 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_output_tokens: 1200,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [
            { type: "input_text", text: "사진 속 문제와 학생 풀이를 확인해 계산 실수와 빨간색급 논리 비약만 검사하세요. 반드시 JSON만 반환하세요." },
            { type: "input_image", image_url: imageDataUrl, detail: "high" }
          ] }
        ]
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return json({ error: data?.error?.message || "OpenAI API 오류", error_info: mapError(upstream.status, data) }, upstream.status);

    const text = extractText(data);
    const parsed = normalizeResult(parseJson(text));
    if (!parsed) {
      const status = String(data?.status || "unknown");
      const incomplete = data?.incomplete_details?.reason ? ` / ${data.incomplete_details.reason}` : "";
      const outputTypes = Array.isArray(data?.output) ? data.output.map(x => x?.type).filter(Boolean).join(", ") : "없음";
      return json({
        error: "AI 응답 형식을 해석하지 못했습니다.",
        error_info: {
          title: "AI 응답 형식 오류",
          cause: `AI 응답은 도착했지만 JSON 결과를 읽지 못했습니다. 응답 상태: ${status}${incomplete}`,
          suggestions: ["같은 사진을 다시 분석하세요.", "계속되면 OPENAI_MODEL을 gpt-5-mini로 설정해 보세요."],
          code: "INVALID_RESPONSE"
        },
        debug: { response_status: status, output_types: outputTypes, text_length: text.length }
      }, 502);
    }

    return json(parsed);
  } catch (error) {
    if (error?.name === "AbortError") return json({
      error: "분석 시간이 초과되었습니다.",
      error_info: { title: "분석 시간 초과", cause: "OpenAI 응답이 55초 안에 끝나지 않았습니다.", suggestions: ["풀이 부분만 잘라 올리세요.", "한 장씩 분석하세요.", "잠시 후 다시 시도하세요."], code: "TIMEOUT" }
    }, 504);
    return json({
      error: error?.message || "서버 오류",
      error_info: { title: "서버 오류", cause: error?.message || "알 수 없는 오류가 발생했습니다.", suggestions: ["잠시 후 다시 분석하세요."], code: "SERVER_ERROR" }
    }, 500);
  } finally {
    clearTimeout(timer);
  }
};
