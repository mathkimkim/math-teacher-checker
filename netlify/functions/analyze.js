const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}


function errorBody({ title, error, reason, solution, code, status, detail = '' }) {
  return {
    title,
    error: error || title,
    reason,
    solution: Array.isArray(solution) ? solution : [solution].filter(Boolean),
    code,
    status,
    detail
  };
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
문제가 있으면 verdict="틀림"으로 하고 최초 오류 한 곳만 1~2문장으로 쓴다.
message에는 다음만 포함한다.
- 오류가 발생한 위치
- 학생이 무엇을 잘못했는지
- 오류 유형
올바른 식, 정답, 모범풀이는 작성하지 않는다.
예: "3번째 줄에서 항을 이항하면서 부호를 바꾸지 않았습니다. 부호 오류입니다."

첫 오류 이후의 연쇄 오류, 정답, 모범풀이, 긴 설명은 작성하지 않는다.
불확실하면 verdict="확인 필요", 읽을 수 없으면 verdict="판독 불가"로 한다.
사진에 풀이가 있는 모든 문제를 빠짐없이 반환한다.`;

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, errorBody({ title: '요청 방식 오류', reason: '이 기능은 POST 요청만 지원합니다.', solution: ['페이지를 새로고침한 뒤 다시 시도해 주세요.'], code: 'METHOD_NOT_ALLOWED', status: 405 }));
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_FAST_MODEL || 'gpt-5.5';

  if (!apiKey) {
    return json(500, errorBody({ title: 'API 키 설정 오류', reason: 'Netlify에 OPENAI_API_KEY가 등록되어 있지 않습니다.', solution: ['Netlify 환경변수에 OPENAI_API_KEY를 등록하세요.', '등록 후 사이트를 다시 배포하세요.'], code: 'MISSING_API_KEY', status: 500 }));
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, errorBody({ title: '요청 데이터 오류', reason: '서버가 요청 내용을 읽지 못했습니다.', solution: ['페이지를 새로고침한 뒤 사진을 다시 올려 주세요.'], code: 'INVALID_REQUEST', status: 400 }));
  }

  const imageDataUrl = payload.imageDataUrl;
  if (!imageDataUrl || !String(imageDataUrl).startsWith('data:image/')) {
    return json(400, errorBody({ title: '이미지 없음', reason: '분석할 이미지가 전달되지 않았습니다.', solution: ['JPG 또는 PNG 사진을 다시 선택해 주세요.'], code: 'IMAGE_REQUIRED', status: 400 }));
  }

  const controller = new AbortController();
  const timeoutMs = 30000;
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
      const code = data?.error?.code || data?.error?.type || 'OPENAI_ERROR';
      const lower = message.toLowerCase();
      let title = 'AI 서비스 호출 실패';
      let reason = message;
      let solution = ['잠시 후 다시 분석해 주세요.'];

      if (response.status === 401 || lower.includes('api key')) {
        title = 'API 인증 실패';
        reason = 'OpenAI API 키가 없거나 올바르지 않습니다.';
        solution = ['Netlify의 OPENAI_API_KEY 값을 확인하세요.', '환경변수 수정 후 다시 배포하세요.'];
      } else if (code === 'insufficient_quota' || lower.includes('quota') || lower.includes('billing')) {
        title = 'API 사용 한도 초과';
        reason = 'OpenAI API 크레딧 또는 결제 한도를 초과했습니다.';
        solution = ['OpenAI Platform의 Billing과 사용 한도를 확인하세요.', '결제 설정 후 다시 시도하세요.'];
      } else if (response.status === 429) {
        title = '요청이 너무 많습니다';
        reason = '짧은 시간에 요청이 몰려 분석이 제한되었습니다.';
        solution = ['잠시 기다린 뒤 다시 분석해 주세요.', '한 번에 올리는 사진 수를 줄여 다시 시도하세요.'];
      } else if (response.status === 404 || lower.includes('model')) {
        title = 'AI 모델 설정 오류';
        reason = '설정된 모델을 찾을 수 없거나 사용할 권한이 없습니다.';
        solution = ['Netlify의 OPENAI_FAST_MODEL 값을 확인하세요.', '사용 가능한 모델명으로 수정한 뒤 다시 배포하세요.'];
      }

      return json(response.status, errorBody({ title, error: message, reason, solution, code, status: response.status }));
    }

    if (data?.status === 'incomplete') {
      const reasonCode = data?.incomplete_details?.reason || 'INCOMPLETE_RESPONSE';
      return json(502, errorBody({
        title: 'AI 응답 미완료',
        reason: reasonCode === 'max_output_tokens'
          ? '분석 결과가 길이 제한에 도달해 중간에 종료되었습니다.'
          : 'AI 응답이 완료되기 전에 종료되었습니다.',
        solution: [
          '📷 사진을 위·아래 또는 좌·우로 반씩 나누어 다시 업로드해 보세요.',
          '같은 사진으로 다시 한 번 분석해 보세요.'
        ],
        code: reasonCode,
        status: 502
      }));
    }

    const outputText = getOutputText(data);
    const parsed = extractJson(outputText);
    const rawProblems = Array.isArray(parsed?.problems) ? parsed.problems : [];

    if (!rawProblems.length) {
      const refusal = (data?.output || [])
        .flatMap((item) => item?.content || [])
        .find((content) => typeof content?.refusal === 'string')?.refusal;

      return json(502, errorBody({
        title: '분석 결과 해석 실패',
        reason: refusal || 'AI는 응답했지만 문제별 결과 형식으로 변환하지 못했습니다.',
        solution: ['같은 사진을 다시 분석해 주세요.', '사진이 선명한지 확인해 주세요.', '반복되면 사진을 나누어 올려 주세요.'],
        code: 'INVALID_AI_RESPONSE',
        status: 502,
        detail: outputText.slice(0, 300)
      }));
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
      return json(504, errorBody({
        title: '분석 시간 초과',
        reason: '사진에 문제나 풀이가 많거나 이미지가 복잡해 제한 시간 안에 분석이 끝나지 않았습니다.',
        solution: ['같은 사진을 다시 분석해 주세요.', '한 페이지를 나누어 촬영해 주세요.', '풀이가 선명하게 보이도록 다시 촬영해 주세요.'],
        code: 'ANALYSIS_TIMEOUT',
        status: 504
      }));
    }

    return json(500, errorBody({
      title: '서버 처리 오류',
      error: error?.message || '서버 오류가 발생했습니다.',
      reason: error?.cause?.message || '서버에서 요청을 처리하는 중 예기치 않은 오류가 발생했습니다.',
      solution: ['잠시 후 다시 시도해 주세요.', '계속 실패하면 표시된 오류 코드와 함께 문의해 주세요.'],
      code: error?.code || 'SERVER_ERROR',
      status: 500,
      detail: error?.stack || ''
    }));

  }
}
