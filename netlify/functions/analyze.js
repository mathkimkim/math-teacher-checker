const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function getOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text);
      if (typeof content?.output_text === 'string') parts.push(content.output_text);
    }
  }
  return parts.join('\n');
}

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }

  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject !== -1 && lastObject > firstObject) {
    try { return JSON.parse(text.slice(firstObject, lastObject + 1)); } catch {}
  }

  return null;
}

const problemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    number: { type: 'string' },
    verdict: {
      type: 'string',
      enum: ['맞음', '틀림', '확인 필요', '판독 불가']
    },
    message: { type: 'string' }
  },
  required: ['number', 'verdict', 'message']
};

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    problems: {
      type: 'array',
      minItems: 1,
      items: problemSchema
    }
  },
  required: ['problems']
};

const systemPrompt = `수학 문제와 학생 풀이가 함께 있는 사진을 검사한다.

문제 분리:
- 사진에 여러 문제가 있으면 반드시 문제 번호별로 나누어 각각 독립적으로 검토한다.
- 17, 17번, 17), 17.처럼 표시된 번호를 모두 문제 번호로 인식한다.
- 서로 다른 문제의 풀이를 합쳐서 판단하지 않는다.
- 문제 번호가 안 보이지만 풀이 영역이 여러 개면 위에서 아래 순서대로 "1", "2", "3"으로 구분한다.
- 문제만 있고 학생 풀이가 없는 항목은 결과에서 제외한다.

판독:
- 각 문제의 문제 조건과 학생 풀이를 함께 읽는다.
- 식을 위에서 아래로 읽고 +/-, 지수, 분수선, 괄호, 루트, 절댓값을 구분한다.
- 불확실한 글자는 추측하지 않는다.

문제별 판정:
- 풀이가 맞으면 verdict="맞음", message="맞음".
- 틀리면 verdict="틀림"으로 하고, 그 문제에서 최초로 틀린 위치와 이유만 message에 한 문장으로 쓴다.
- 정답, 모범풀이, 긴 해설, 이후 연쇄 오류는 쓰지 않는다.
- 정상적인 암산과 단순한 계산 생략은 오류가 아니다.
- 확정할 수 없으면 "확인 필요", 읽을 수 없으면 "판독 불가"로 한다.
- 반드시 사진에 보이는 모든 풀이 문제를 빠짐없이 problems 배열에 넣는다.
- JSON 스키마만 반환한다.`;

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'POST만 지원합니다.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_FAST_MODEL || 'gpt-5-mini';

  if (!apiKey) {
    return json(500, {
      error: 'Netlify 환경변수 OPENAI_API_KEY가 없습니다. Netlify Site configuration → Environment variables에서 추가하세요.'
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' });
  }

  const imageDataUrl = payload.imageDataUrl;
  if (!imageDataUrl || !String(imageDataUrl).startsWith('data:image/')) {
    return json(400, { error: '이미지 파일이 필요합니다.' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'low' },
        max_output_tokens: 420,
        input: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: '사진 속 풀이가 있는 문제를 번호별로 모두 분리해 각각 검산하고 최종 JSON만 반환하세요.'
              },
              { type: 'input_image', image_url: imageDataUrl, detail: 'auto' }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'math_checker_problem_results',
            strict: true,
            schema: resultSchema
          }
        }
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error?.message || 'OpenAI API 오류';
      const code = data?.error?.code || data?.error?.type || '';
      return json(response.status, {
        error: message,
        code,
        help: code === 'insufficient_quota' || message.toLowerCase().includes('quota')
          ? 'OpenAI Platform Billing에서 크레딧/결제 한도를 확인하세요.'
          : ''
      });
    }

    const parsed = extractJson(getOutputText(data));
    const rawProblems = Array.isArray(parsed?.problems) ? parsed.problems : [];

    if (!rawProblems.length) {
      return json(502, { error: '문제별 AI 응답을 해석하지 못했습니다.' });
    }

    const problems = rawProblems.map((problem, index) => {
      const number = String(problem?.number || index + 1).trim();
      const verdict = problem?.verdict || '확인 필요';
      let message = String(problem?.message || '').trim();

      if (verdict === '맞음') message = '맞음';
      if (verdict === '판독 불가') message = '판독 불가';
      if (!message) message = verdict;

      return { number, verdict, message };
    });

    return json(200, { problems });
  } catch (error) {
    return json(500, { error: error.message || '서버 오류가 발생했습니다.' });
  }
}
