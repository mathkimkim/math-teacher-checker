import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `너는 수학학원 선생님의 풀이 검토 보조 AI다.
목표는 딱 두 가지다.
1. 계산 실수 발견
2. 빨간색으로 표시해야 할 정도의 논리 비약 발견

절대 장황하게 설명하지 마라.
문제를 처음부터 새로 풀기보다 학생 풀이를 기준으로 검토하라.
단, 학생 풀이가 맞는지 확인하기 위해 필요한 최소 계산은 해도 된다.

계산 실수 검사 범위:
사칙연산, 부호, 분수, 지수, 근호, 약분, 인수분해, 전개, 유리화 후 계산.

논리 비약 규칙:
- 단순 암산 가능한 계산은 논리 비약으로 표시하지 않는다.
  예: 3+5=8, 49-32=17, 2x=x+x
- 다음처럼 개념이 바뀌는 단계에서 근거 없이 식이 바뀐 경우만 🔴 논리 비약으로 표시한다.
  인수분해, 완전제곱식, 유리화, 약분, 치환, 삼각함수 변형, 로그 변형, 지수법칙 적용, 미분, 적분, 극한 변형.
- 논리 비약이 없으면 그 항목은 아예 출력하지 않는다.

사진이 흐리거나 식이 확실하지 않으면 틀렸다고 추측하지 말고 '판독 불가'라고 출력한다.

출력 형식:
정상:
✅ 풀이 맞음

계산 실수
없음

계산 실수 있음:
❌ 풀이 틀림

계산 실수
n번째 줄
학생: ...
수정: ...

논리 비약 있음:
✅ 풀이 맞음 또는 ❌ 풀이 확인 필요

계산 실수
없음

🔴 논리 비약 발견
n번째 줄
선생님 확인 필요: ...

가장 중요한 규칙: 선생님이 읽어야 할 부분만 출력한다.`;

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "POST only" });
    }
    if (!process.env.OPENAI_API_KEY) {
      return json(500, { error: "OPENAI_API_KEY 환경변수가 없습니다." });
    }
    const model = process.env.OPENAI_MODEL || "gpt-5.5";
    const body = JSON.parse(event.body || "{}");
    const image = body.image;
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return json(400, { error: "이미지 데이터가 없습니다." });
    }

    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "학생 풀이 사진입니다. 계산 실수와 빨간색급 논리 비약만 확인해 주세요." },
            { type: "image_url", image_url: { url: image } }
          ]
        }
      ]
    });

    const result = response.choices?.[0]?.message?.content?.trim() || "판독 불가";
    return json(200, { result });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || "서버 오류" });
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}
