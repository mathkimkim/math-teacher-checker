const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === 'string') parts.push(c.text);
      if (typeof c?.output_text === 'string') parts.push(c.output_text);
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
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['맞음', '틀림', '확인 필요', '판독 불가'] },
    display_verdict: { type: 'string' },
    calculation_mistakes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          line: { type: 'string' },
          student_expression: { type: 'string' },
          correct_expression: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['line', 'student_expression', 'correct_expression', 'reason']
      }
    },
    logical_gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          line: { type: 'string' },
          issue: { type: 'string' },
          needed_step: { type: 'string' }
        },
        required: ['line', 'issue', 'needed_step']
      }
    },
    teacher_note: { type: 'string' },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    readability: { type: 'string', enum: ['좋음', '보통', '나쁨'] }
  },
  required: ['verdict', 'display_verdict', 'calculation_mistakes', 'logical_gaps', 'teacher_note', 'confidence', 'readability']
};

const systemPrompt = `너는 수학학원 선생님의 풀이 검토 보조 AI다.

목표는 학생 풀이 사진을 보고 선생님이 다시 봐야 할 부분만 빠르게 골라주는 것이다.
검사 대상은 오직 두 가지다.
1. 계산 실수
2. 빨간색으로 표시해야 할 정도의 논리 비약

절대 하지 말 것:
- 장황한 해설
- 학생 성향 분석
- 개념 이해도 점수화
- 새로운 모범풀이 생성
- 추측으로 틀렸다고 판단

검토 원칙:
- 학생 풀이를 기준으로 확인한다.
- 풀이가 정상이고 계산 실수도 없으면 "맞음"으로 판단한다.
- 사진이 흐리거나 문제/풀이를 확실히 읽을 수 없으면 "판독 불가"로 판단한다.
- 불확실하면 틀림이 아니라 "확인 필요" 또는 "판독 불가"로 처리한다.

계산 실수 기준:
- 사칙연산, 부호, 분수, 지수, 근호 계산
- 약분 계산
- 전개 계산
- 인수분해 계산
- 공식 대입 후 숫자 계산
명확한 계산 오류만 기록한다.
예: 49-32=11 이면 계산 실수. 올바른 식은 49-32=17.

논리 비약 기준:
논리 비약은 단순히 줄이 생략됐다는 이유로 표시하지 않는다.
빨간색으로 표시해야 할 정도만 기록한다.

표시하지 말 것:
- 암산 가능한 계산 생략
- 단순 사칙연산 생략
- 3+5=8, 49-32=17 같은 숫자 계산 생략
- 충분히 자연스러운 식 정리

반드시 표시할 것:
- 개념이 바뀌는 단계에서 근거 없이 식이 바뀐 경우
- 인수분해, 완전제곱식, 유리화, 약분, 치환
- 삼각함수/로그/지수 변형
- 극한/미분/적분 변형
- 방정식 변형에서 등가성이 깨질 수 있는 단계

출력은 반드시 JSON만 한다.
calculation_mistakes와 logical_gaps는 배열로 작성한다.
없으면 빈 배열 []로 둔다.

판정 규칙:
- 계산 실수 없음, 논리 비약 없음, 풀이가 맞음 → verdict="맞음", display_verdict="✅ 풀이 맞음"
- 명확한 계산 실수로 결과가 틀림 → verdict="틀림", display_verdict="❌ 풀이 틀림"
- 논리 비약 때문에 선생님 확인이 필요함 → verdict="확인 필요", display_verdict="⚠️ 풀이 확인 필요"
- 읽기 어려움 → verdict="판독 불가", display_verdict="판독 불가"

teacher_note는 한 줄만 작성한다.`;

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'POST만 지원합니다.', code: 'METHOD_NOT_ALLOWED' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.5';

  if (!apiKey) {
    return json(500, {
      error: 'Netlify 환경변수 OPENAI_API_KEY가 없습니다.',
      code: 'MISSING_API_KEY',
      help: 'Netlify 환경변수에서 OPENAI_API_KEY를 등록하세요.'
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, {
      error: '요청 형식이 올바르지 않습니다.',
      code: 'INVALID_REQUEST'
    });
  }

  const imageDataUrl = payload.imageDataUrl;
  if (!imageDataUrl || !String(imageDataUrl).startsWith('data:image/')) {
    return json(400, {
      error: '이미지 파일이 필요합니다.',
      code: 'IMAGE_REQUIRED'
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

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
        max_output_tokens: 3000,
        input: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: '사진 속 학생 풀이를 검사하세요. 계산 실수와 빨간색급 논리 비약만 JSON으로 반환하세요.'
              },
              { type: 'input_image', image_url: imageDataUrl }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'math_checker_result',
            strict: true,
            schema: resultSchema
          }
        }
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error?.message || `OpenAI API 오류 (${response.status})`;
      const code = data?.error?.code || data?.error?.type || 'OPENAI_ERROR';

      let help = '잠시 후 다시 분석하세요.';
      if (code === 'insufficient_quota' || message.toLowerCase().includes('quota')) {
        help = 'OpenAI Platform Billing에서 크레딧과 결제 한도를 확인하세요.';
      } else if (response.status === 401) {
        help = 'Netlify의 OPENAI_API_KEY 값을 확인하세요.';
      } else if (response.status === 429) {
        help = '요청이 많습니다. 잠시 기다린 뒤 다시 분석하세요.';
      }

      return json(response.status, { error: message, code, help });
    }

    if (data?.status === 'incomplete') {
      const reason = data?.incomplete_details?.reason || 'INCOMPLETE_RESPONSE';
      return json(502, {
        error: 'AI 응답이 중간에 종료되었습니다.',
        code: reason,
        help: '같은 사진으로 다시 분석하세요.'
      });
    }

    const outputText = getOutputText(data);
    const parsed = extractJson(outputText);

    if (!parsed) {
      return json(502, {
        error: 'AI 응답을 해석하지 못했습니다.',
        code: 'INVALID_RESPONSE',
        help: '같은 사진으로 다시 분석하세요.',
        raw: outputText.slice(0, 500)
      });
    }

    const calculationMistakes = normalizeArray(parsed.calculation_mistakes);
    const logicalGaps = normalizeArray(parsed.logical_gaps);

    return json(200, {
      verdict: parsed.verdict || '확인 필요',
      display_verdict: parsed.display_verdict || '⚠️ 풀이 확인 필요',
      calculation_mistakes: calculationMistakes,
      logical_gaps: logicalGaps,
      teacher_note: parsed.teacher_note || '',
      confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0,
      readability: parsed.readability || '보통',
      has_calculation_mistakes: calculationMistakes.length > 0,
      has_logical_gaps: logicalGaps.length > 0
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return json(504, {
        error: '분석 시간이 초과되었습니다.',
        code: 'TIMEOUT',
        help: '잠시 후 다시 분석하세요.'
      });
    }

    return json(500, {
      error: error?.message || '서버 오류가 발생했습니다.',
      code: 'SERVER_ERROR',
      help: '잠시 후 다시 분석하세요.'
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
