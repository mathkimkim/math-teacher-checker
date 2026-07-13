const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function getOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data?.output || []) {
    if (typeof item?.text === 'string') parts.push(item.text);

    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text);
      if (typeof content?.output_text === 'string') parts.push(content.output_text);
      if (typeof content?.text?.value === 'string') parts.push(content.text.value);
      if (content?.parsed && typeof content.parsed === 'object') {
        parts.push(JSON.stringify(content.parsed));
      }
    }
  }

  return parts.filter(Boolean).join('\n').trim();
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

const systemPrompt = `너는 수학학원 선생님의 풀이 검토 보조 AI다.

학생이 작성한 풀이를 문제 번호별로 나누어 각각 독립적으로 검토한다.
학생 풀이를 위에서 아래로 따라가며 각 단계가 이전 단계에서 올바르게 이어지는지 확인한다.

다음만 확인한다.
- 계산 실수
- 식 전개 오류
- 부호, 약분, 인수분해, 유리화 오류
- 공식 적용 오류
- 등호 사용 오류
- 조건 누락
- 논리 비약

학생이 적지 않은 과정은 추측하지 않는다.
정상적인 암산이나 자연스러운 계산 생략은 오류로 판단하지 않는다.

문제가 없으면 verdict="맞음", message="맞음"으로 한다.
문제가 있으면 verdict="틀림"으로 하고 최초로 잘못된 부분과 이유만 짧게 쓴다.
예: "3번째 줄 부호 오류", "약분 오류", "조건 누락", "논리 비약"

첫 오류 이후의 연쇄 오류, 정답, 모범풀이, 긴 설명은 작성하지 않는다.
불확실하면 verdict="확인 필요", 읽을 수 없으면 verdict="판독 불가"로 한다.
사진에 풀이가 있는 모든 문제를 빠짐없이 반환한다.`;

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'POST만 지원합니다.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_FAST_MODEL || 'gpt-5.5';

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

  const controller = new AbortController();
  const timeoutMs = 24000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'low' },
        // 추론 토큰까지 포함되는 한도라 420은 결과 JSON이 나오기 전에 끝날 수 있습니다.
        max_output_tokens: 1200,
        input: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: '사진 속 풀이가 있는 문제를 번호별로 모두 분리해 각각 검산하고 최종 JSON만 반환하세요.'
              },
              { type: 'input_image', image_url: imageDataUrl, detail: 'high' }
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

    clearTimeout(timeoutId);
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

    if (data?.status === 'incomplete') {
      const reason = data?.incomplete_details?.reason || 'unknown';
      return json(502, {
        error: reason === 'max_output_tokens'
          ? 'AI 응답이 길이 제한 때문에 중간에 종료됐습니다. 다시 시도해 주세요.'
          : 'AI 응답이 완성되지 않았습니다.',
        reason
      });
    }

    const outputText = getOutputText(data);
    const parsed = extractJson(outputText);
    const rawProblems = Array.isArray(parsed?.problems) ? parsed.problems : [];

    if (!rawProblems.length) {
      const refusal = (data?.output || [])
        .flatMap((item) => item?.content || [])
        .find((content) => typeof content?.refusal === 'string')?.refusal;

      return json(502, {
        error: refusal || '문제별 AI 응답을 해석하지 못했습니다.',
        status: data?.status || '',
        preview: outputText.slice(0, 300)
      });
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
    clearTimeout(timeoutId);

    if (error?.name === 'AbortError') {
      return json(504, {
        error: 'AI 분석 시간이 24초를 초과해 요청을 중단했습니다.',
        code: 'ANALYSIS_TIMEOUT',
        reason: '사진에 문제나 풀이가 많거나 이미지가 복잡해 제한 시간 안에 분석이 끝나지 않았습니다.',
        help: '같은 사진을 다시 시도하거나, 한 페이지의 문제 수를 줄여 촬영해 주세요.'
      });
    }

    return json(500, {
      error: error?.message || '서버 오류가 발생했습니다.',
      code: error?.code || 'SERVER_ERROR',
      reason: error?.cause?.message || '',
      help: '표시된 오류 문구와 Netlify 함수 로그를 확인해 주세요.'
    });
  }
}
