const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const texts = [];

  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") texts.push(content.text);
      if (typeof content?.output_text === "string") texts.push(content.output_text);
    }
  }

  return texts.join("\n").trim();
}

function parseJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // Continue with recovery attempts.
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Continue.
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeResult(parsed) {
  const allowedResults = new Set(["맞음", "틀림", "확인 필요"]);
  const result = allowedResults.has(parsed?.result)
    ? parsed.result
    : "확인 필요";

  const errors = Array.isArray(parsed?.errors)
    ? parsed.errors
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          line: String(item.line || "위치 확인 필요").trim(),
          reason: String(item.reason || "풀이 과정 오류").trim(),
          correction: String(item.correction || "").trim(),
        }))
    : [];

  return { result, errors };
}

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    result: {
      type: "string",
      enum: ["맞음", "틀림", "확인 필요"],
    },
    errors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line: { type: "string" },
          reason: { type: "string" },
          correction: { type: "string" },
        },
        required: ["line", "reason", "correction"],
      },
    },
  },
  required: ["result", "errors"],
};

const SYSTEM_PROMPT = `
너는 수학 풀이 검사기다.

사진 속 문제와 학생 풀이를 확인하여 다음만 판단한다.

1. 풀이가 맞는지 틀렸는지
2. 계산 실수가 있는지
3. 식 전개가 잘못된 곳이 있는지
4. 약분, 인수분해, 부호, 유리화, 치환, 공식 대입 등에서 오류가 있는지
5. 앞뒤 식이 논리적으로 연결되지 않는 명확한 부분이 있는지

규칙:
- 개념 이해도, 학생 성향, 학습법, 칭찬, 긴 해설은 작성하지 않는다.
- 명확한 오류만 기록한다.
- 단순한 암산이나 자연스러운 중간 과정 생략은 오류로 보지 않는다.
- 사진이 흐리거나 문제 또는 풀이가 잘려 정확히 판단하기 어렵다면 "확인 필요"로 판단한다.
- 오류가 없고 풀이가 맞으면 result는 "맞음", errors는 빈 배열이다.
- 오류가 있으면 result는 "틀림"이다.
- 각 오류는 위치, 짧은 이유, 올바른 식만 기록한다.
- correction에는 올바른 식을 확인할 수 있을 때만 적고, 확인할 수 없으면 빈 문자열로 둔다.
- JSON 이외의 문장은 절대 출력하지 않는다.
`.trim();

async function callOpenAI({ apiKey, model, imageDataUrl, signal }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 1200,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: SYSTEM_PROMPT,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "사진 속 학생 풀이를 검사해 JSON으로만 반환하세요.",
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "math_solution_check",
          strict: true,
          schema: RESULT_SCHEMA,
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return respond(204, {});
  }

  if (event.httpMethod !== "POST") {
    return respond(405, {
      error: "POST 요청만 지원합니다.",
      code: "METHOD_NOT_ALLOWED",
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.5";

  if (!apiKey) {
    return respond(500, {
      error: "OPENAI_API_KEY 환경변수가 설정되지 않았습니다.",
      code: "MISSING_API_KEY",
    });
  }

  let payload;

  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, {
      error: "요청 데이터를 읽을 수 없습니다.",
      code: "INVALID_REQUEST",
    });
  }

  const imageDataUrl = payload?.imageDataUrl;

  if (
    typeof imageDataUrl !== "string" ||
    !imageDataUrl.startsWith("data:image/")
  ) {
    return respond(400, {
      error: "분석할 이미지가 필요합니다.",
      code: "IMAGE_REQUIRED",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);

  try {
    const { response, data } = await callOpenAI({
      apiKey,
      model,
      imageDataUrl,
      signal: controller.signal,
    });

    if (!response.ok) {
      const apiMessage =
        data?.error?.message || `OpenAI API 요청 실패 (${response.status})`;
      const apiCode = data?.error?.code || data?.error?.type || "OPENAI_ERROR";

      let help = "잠시 후 다시 분석해 주세요.";

      if (
        apiCode === "insufficient_quota" ||
        apiMessage.toLowerCase().includes("quota")
      ) {
        help = "OpenAI API 크레딧과 결제 한도를 확인해 주세요.";
      } else if (response.status === 401) {
        help = "Netlify의 OPENAI_API_KEY 값을 확인해 주세요.";
      } else if (response.status === 429) {
        help = "요청이 많습니다. 잠시 기다린 뒤 다시 분석해 주세요.";
      }

      return respond(response.status, {
        error: apiMessage,
        code: apiCode,
        help,
      });
    }

    if (data?.status === "incomplete") {
      return respond(502, {
        error: "AI 응답이 중간에 종료되었습니다.",
        code: data?.incomplete_details?.reason || "INCOMPLETE_RESPONSE",
        help: "같은 사진으로 다시 분석해 주세요.",
      });
    }

    const outputText = extractOutputText(data);
    const parsed = parseJson(outputText);

    if (!parsed) {
      return respond(502, {
        error: "AI 분석 결과를 읽지 못했습니다.",
        code: "INVALID_RESPONSE",
        help: "같은 사진으로 다시 분석해 주세요.",
      });
    }

    const normalized = normalizeResult(parsed);

    // New, simplified response.
    // Legacy fields are also returned so the existing Day 3 UI does not break.
    const calculationMistakes = normalized.errors.map((error) => ({
      line: error.line,
      student_expression: "",
      correct_expression: error.correction,
      reason: error.reason,
    }));

    return respond(200, {
      result: normalized.result,
      errors: normalized.errors,

      verdict: normalized.result,
      display_verdict:
        normalized.result === "맞음"
          ? "✅ 풀이 맞음"
          : normalized.result === "틀림"
            ? "❌ 풀이 틀림"
            : "⚠️ 확인 필요",
      calculation_mistakes: calculationMistakes,
      logical_gaps: [],
      teacher_note: "",
      confidence: 0,
      readability: "보통",
      has_calculation_mistakes: normalized.errors.length > 0,
      has_logical_gaps: false,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return respond(504, {
        error: "분석 시간이 초과되었습니다.",
        code: "TIMEOUT",
        help: "잠시 후 다시 분석하거나 사진 크기를 줄여 주세요.",
      });
    }

    return respond(500, {
      error: error?.message || "서버 오류가 발생했습니다.",
      code: "SERVER_ERROR",
      help: "잠시 후 다시 분석해 주세요.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
