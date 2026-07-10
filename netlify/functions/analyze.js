const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const OPENAI_TIMEOUT_MS = 23000;

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function errorInfo(type, title, cause, suggestions, code, retryable = true) {
  return { type, title, cause, suggestions, code: code || type, retryable };
}

function mappedOpenAIError(status, data) {
  const message = data?.error?.message || 'OpenAI API 오류';
  const code = data?.error?.code || data?.error?.type || String(status);
  const lower = message.toLowerCase();

  if (status === 401 || status === 403) return errorInfo('auth', 'API 인증 실패', 'OpenAI API 키가 없거나 유효하지 않습니다.', ['Netlify 환경변수 OPENAI_API_KEY를 확인하세요.', '새 키로 교체했다면 다시 배포하세요.'], code, false);
  if (status === 429 && (lower.includes('quota') || lower.includes('billing') || lower.includes('credit'))) return errorInfo('billing', 'API 크레딧 또는 결제 한도 부족', 'OpenAI API 잔액이 없거나 사용 한도에 도달했습니다.', ['OpenAI Platform의 Billing과 Limits를 확인하세요.', '충전 후 3~5분 뒤 다시 시도하세요.'], code, true);
  if (status === 429) return errorInfo('rate_limit', '요청이 너무 많습니다', '짧은 시간에 요청이 몰려 일시적으로 제한되었습니다.', ['10~30초 후 다시 분석하세요.', '사진을 한 장씩 분석해보세요.'], code, true);
  if (status === 400 && lower.includes('image')) return errorInfo('image', '이미지를 읽을 수 없습니다', message, ['JPG 또는 PNG 파일로 다시 올리세요.', '풀이가 선명하게 보이도록 다시 촬영하세요.'], code, true);
  if (status >= 500) return errorInfo('upstream', 'OpenAI 서버 오류', message, ['잠시 후 다시 분석하세요.', '문제가 계속되면 Netlify Functions 로그를 확인하세요.'], code, true);
  return errorInfo('api', '분석 요청에 실패했습니다', message, ['잠시 후 다시 분석하세요.'], code, true);
}

function normalizeArray(value) { return Array.isArray(value) ? value : []; }
function getOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of data?.output || []) for (const c of item?.content || []) {
    if (typeof c?.text === 'string') parts.push(c.text);
    if (typeof c?.output_text === 'string') parts.push(c.output_text);
  }
  return parts.join('\n');
}
function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) try { return JSON.parse(fenced[1]); } catch {}
  const first = text.indexOf('{'); const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  return null;
}

const resultSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['맞음', '틀림', '확인 필요', '판독 불가'] },
    display_verdict: { type: 'string' },
    calculation_mistakes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      line: { type: 'string' }, student_expression: { type: 'string' }, correct_expression: { type: 'string' }, reason: { type: 'string' }
    }, required: ['line', 'student_expression', 'correct_expression', 'reason'] } },
    logical_gaps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      line: { type: 'string' }, issue: { type: 'string' }, needed_step: { type: 'string' }
    }, required: ['line', 'issue', 'needed_step'] } },
    teacher_note: { type: 'string' }, confidence: { type: 'integer', minimum: 0, maximum: 100 },
    readability: { type: 'string', enum: ['좋음', '보통', '나쁨'] }
  },
  required: ['verdict', 'display_verdict', 'calculation_mistakes', 'logical_gaps', 'teacher_note', 'confidence', 'readability']
};

const systemPrompt = `너는 수학학원 선생님의 풀이 검토 보조 AI다. 학생 풀이 사진을 보고 오직 계산 실수와 빨간색으로 표시해야 할 정도의 논리 비약만 찾는다. 장황한 설명, 성향 분석, 점수화, 새로운 모범풀이, 추측은 하지 않는다. 사진이 불명확하면 판독 불가로 처리한다. 단순 암산이나 자연스러운 식 정리는 논리 비약으로 표시하지 않는다. 인수분해, 완전제곱식, 유리화, 약분, 치환, 삼각함수·로그·지수 변형, 극한·미분·적분 등 개념이 바뀌는 단계에서 근거 없이 식이 바뀐 경우만 논리 비약으로 기록한다. 출력은 반드시 JSON만 한다.`;

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST만 지원합니다.' });
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.5';
  if (!apiKey) return json(500, { error: 'OPENAI_API_KEY가 없습니다.', error_info: errorInfo('config', 'API 설정이 없습니다', 'Netlify 환경변수 OPENAI_API_KEY가 등록되지 않았습니다.', ['Netlify Project configuration → Environment variables에서 키를 추가하세요.'], 'NO_API_KEY', false) });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: '요청 형식이 올바르지 않습니다.' }); }
  const imageDataUrl = payload.imageDataUrl;
  if (!imageDataUrl || !String(imageDataUrl).startsWith('data:image/')) return json(400, { error: '이미지 파일이 필요합니다.', error_info: errorInfo('image', '이미지가 없습니다', '분석할 이미지가 전달되지 않았습니다.', ['사진을 다시 선택하세요.'], 'NO_IMAGE', true) });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'none' },
        max_output_tokens: 1400,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
            { type: 'input_text', text: '사진 속 학생 풀이를 검사하세요. 계산 실수와 빨간색급 논리 비약만 반환하세요.' },
            { type: 'input_image', image_url: imageDataUrl, detail: 'high' }
          ] }
        ],
        text: { format: { type: 'json_schema', name: 'math_checker_result', strict: true, schema: resultSchema } }
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json(response.status, { error: data?.error?.message || 'OpenAI API 오류', code: data?.error?.code || data?.error?.type || '', error_info: mappedOpenAIError(response.status, data) });

    const outputText = getOutputText(data);
    const parsed = extractJson(outputText);
    if (!parsed) return json(502, { error: 'AI 응답을 해석하지 못했습니다.', error_info: errorInfo('parse', 'AI 응답 형식 오류', 'AI가 예상한 형식으로 결과를 보내지 않았습니다.', ['다시 분석하세요.', '같은 문제가 반복되면 Netlify Functions 로그를 확인하세요.'], 'INVALID_RESPONSE', true) });

    const calculationMistakes = normalizeArray(parsed.calculation_mistakes);
    const logicalGaps = normalizeArray(parsed.logical_gaps);
    return json(200, {
      verdict: parsed.verdict || '확인 필요', display_verdict: parsed.display_verdict || '⚠️ 풀이 확인 필요',
      calculation_mistakes: calculationMistakes, logical_gaps: logicalGaps,
      teacher_note: parsed.teacher_note || '', confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0,
      readability: parsed.readability || '보통', has_calculation_mistakes: calculationMistakes.length > 0,
      has_logical_gaps: logicalGaps.length > 0
    });
  } catch (error) {
    if (error?.name === 'AbortError') return json(504, { error: 'OpenAI 응답 시간이 초과되었습니다.', error_info: errorInfo('timeout', '분석 시간이 초과되었습니다', 'OpenAI 응답이 Netlify 처리 제한 시간 안에 끝나지 않았습니다.', ['잠시 후 다시 분석하세요.', '사진을 한 장씩 분석하세요.', '풀이 부분만 잘라 올리면 처리 시간이 줄어듭니다.'], 'OPENAI_TIMEOUT', true) });
    return json(500, { error: error.message || '서버 오류가 발생했습니다.', error_info: errorInfo('server', '서버 오류', error.message || '알 수 없는 서버 오류가 발생했습니다.', ['잠시 후 다시 분석하세요.', 'Netlify Functions 로그를 확인하세요.'], 'SERVER_ERROR', true) });
  } finally { clearTimeout(timer); }
}
