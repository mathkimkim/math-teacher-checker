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

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }

  return null;
}

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: {
      type: 'string',
      enum: ['맞음', '틀림', '확인 필요', '판독 불가']
    },
    message: { type: 'string' }
  },
  required: ['verdict', 'message']
};

const systemPrompt = `학생의 수학 풀이 사진을 빠르고 정확하게 검사한다.

손글씨 판독 원칙:
- 판정 전에 모든 식을 위에서 아래로 천천히 읽는다.
- +와 -, 1과 7, 0과 6, x와 곱하기 기호, 지수와 일반 숫자를 구분한다.
- 분수선의 범위, 괄호, 루트 기호, 절댓값 기호, 첨자와 지수를 정확히 확인한다.
- 흐린 글자는 주변 식과 앞뒤 계산을 함께 보고 판단하되, 확실하지 않으면 추측하지 않는다.

출력 원칙:
- 풀이가 맞으면 verdict는 "맞음", message는 반드시 "맞음"이라고만 쓴다.
- 풀이가 틀리면 결과를 처음 틀리게 만든 지점 하나만 찾는다.
- 틀린 경우 message는 "어디에서 틀렸는지"만 한 문장으로 쓴다.
- 예: "세 번째 줄의 2x+3x=6x 계산에서 틀렸습니다."
- 틀린 식의 정답, 수정 과정, 모범 풀이, 추가 설명은 절대 쓰지 않는다.
- 여러 오류가 있어도 최초 오류 지점 하나만 쓴다.
- 중요한 식이 가려져 확정할 수 없으면 verdict는 "확인 필요"로 하고 이유만 짧게 쓴다.
- 사진이나 풀이를 읽을 수 없으면 verdict는 "판독 불가", message는 "판독 불가"라고만 쓴다.
- 정상적인 암산, 단순 계산 생략, 자연스러운 식 정리는 오류로 보지 않는다.
- 추측으로 틀렸다고 판단하지 않는다.
- 반드시 JSON 스키마에 맞춰 반환한다.`;

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
        max_output_tokens: 180,
        input: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: '풀이 전체를 검사하세요. 맞으면 맞음만, 틀리면 최초 오류 위치만 한 문장으로 반환하세요.'
              },
              { type: 'input_image', image_url: imageDataUrl, detail: 'high' }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'math_checker_simple_result',
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
    if (!parsed) {
      return json(502, { error: 'AI 응답을 해석하지 못했습니다.' });
    }

    const verdict = parsed.verdict || '확인 필요';
    let message = String(parsed.message || '').trim();

    if (verdict === '맞음') message = '맞음';
    if (verdict === '판독 불가') message = '판독 불가';
    if (!message) message = verdict;

    return json(200, { verdict, message });
  } catch (error) {
    return json(500, { error: error.message || '서버 오류가 발생했습니다.' });
  }
}
