const SYSTEM_PROMPT = `
너는 20년 경력의 고등학교 수학 교사이자 풀이 검토 보조 AI다.
목표는 학생 풀이를 채점하는 것이 아니라 선생님이 다시 봐야 할 부분만 빠르게 찾는 것이다.
반드시 다음 두 가지만 검사한다.
1. 계산 실수
2. 논리 비약

계산 실수 검사 대상:
사칙연산, 부호, 분수 계산, 지수 계산, 근호 계산, 약분 계산, 인수분해 계산, 전개 계산.

논리 비약 기준:
단순히 중간 과정이 없다고 무조건 표시하지 않는다.
암산 가능한 계산, 단순 사칙연산, 숫자 계산, 식 정리는 논리 비약으로 보지 않는다.
단, 개념이 바뀌는 단계에서 근거 없이 식이 바뀐 경우만 논리 비약으로 표시한다.
검사 대상: 인수분해, 완전제곱식, 유리화, 약분, 치환, 삼각함수 변형, 로그 변형, 지수법칙, 미분, 적분, 극한 변형.

출력은 반드시 JSON만 반환한다. 설명 문장이나 마크다운 금지.
형식:
{
  "verdict": "맞음" | "틀림" | "확인 필요",
  "calculation_errors": [
    {"line":"3번째 줄", "student":"49-32=11", "correct":"49-32=17"}
  ],
  "logic_leaps": [
    {"line":"4번째 줄", "reason":"완전제곱식으로 변형되는 과정이 확인되지 않습니다."}
  ],
  "note":"짧은 한 줄. 없으면 빈 문자열"
}

규칙:
- 오류가 명확할 때만 지적한다.
- 불확실하면 verdict를 "확인 필요"로 한다.
- 정상 풀이면 calculation_errors와 logic_leaps는 빈 배열로 둔다.
- verdict는 계산 실수로 최종 결과가 틀리면 "틀림", 풀이가 맞고 논리 비약만 있으면 "맞음", 판독이 애매하면 "확인 필요".
`;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch (_) {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'POST 요청만 가능합니다.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.5';

  if (!apiKey) {
    return json(500, { error: 'OPENAI_API_KEY 환경변수가 없습니다.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_) {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' });
  }

  const images = Array.isArray(payload.images) ? payload.images : [];
  if (!images.length) return json(400, { error: '분석할 이미지가 없습니다.' });
  if (images.length > 8) return json(400, { error: '한 번에 최대 8장까지 가능합니다.' });

  try {
    const results = [];

    for (const image of images) {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
            },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: '이 학생 풀이 사진을 검사해줘. 계산 실수와 빨간색 수준의 논리 비약만 JSON으로 반환해.' },
                { type: 'input_image', image_url: image },
              ],
            },
          ],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        const message = data?.error?.message || 'OpenAI API 오류';
        throw new Error(message);
      }

      const text = data.output_text || data.output?.flatMap((o) => o.content || []).map((c) => c.text || '').join('\n') || '';
      const parsed = extractJson(text);

      results.push(parsed || {
        verdict: '확인 필요',
        calculation_errors: [],
        logic_leaps: [],
        note: 'AI 응답을 해석하지 못했습니다.',
      });
    }

    return json(200, { results });
  } catch (error) {
    return json(500, { error: error.message || '분석 중 오류가 발생했습니다.' });
  }
};
