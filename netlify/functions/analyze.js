const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

import { getSessionAccount, db, publicAccount } from './_common.js';

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}


function errorBody({ title, error, reason, solution, code, status, detail = '', account = null }) {
  return {
    title,
    error: error || title,
    reason,
    solution: Array.isArray(solution) ? solution : [solution].filter(Boolean),
    code,
    status,
    detail,
    account: publicAccount(account)
  };
}

function getOutputText(data) {
  return (data?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
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
    message: { type: 'string' },
    expression: { type: 'string' }
  },
  required: ['number', 'verdict', 'message', 'expression']
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

const systemPrompt = String.raw`너는 수학학원 선생님의 풀이 검토 보조 AI다.

사진 속 문제의 조건과 질문을 먼저 정확히 분석한 뒤, 학생이 작성한 풀이를 문제 번호별로 나누어 각각 독립적으로 검토한다.
필요한 계산과 정답은 내부적으로 확인하되, 사용자에게 정답이나 모범풀이는 출력하지 않는다.
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

반환 규칙:
1. 문제가 없으면 verdict="맞음", message="맞음", expression=""으로 한다.
2. 문제가 있으면 verdict="틀림"으로 하고 최초 오류 한 곳만 반환한다.
3. message에는 해당 식이 왜 틀렸는지만 한국어 한 문장으로 간단히 쓴다.
4. message에 "오류가 난 식", "문제점", "오류 유형", "계산 오류입니다", "부호 오류입니다" 같은 제목이나 유형명은 넣지 않는다.
5. expression에는 학생이 처음 잘못 쓴 식 또는 오류가 발생한 핵심 식만 LaTeX로 작성한다.
6. expression에는 \( \), \[ \], $, $$ 같은 수식 구분자를 넣지 않는다.
7. 분수는 \frac{a}{b}, 제곱은 x^2, 근호는 \sqrt{x}, 곱셈은 \times, 나눗셈은 \div로 작성한다.
8. 부등호와 기호는 \le, \ge, \ne, \pm, \therefore처럼 올바른 LaTeX 명령을 사용한다.
9. 유니코드 위첨자(², ³), 특수 분수(½), 일반 슬래시 분수(a/b)를 수학식 대신 사용하지 않는다.
10. message 안의 숫자·변수·연산식은 예외 없이 해당 수식만 반드시 \( ... \)로 감싼다.
10-1. sqrt{x}, frac{a}{b}처럼 백슬래시 없는 명령은 작성하지 말고 반드시 \sqrt{x}, \frac{a}{b}로 작성한다.
11. 첫 오류 식을 정확히 읽을 수 없으면 expression=""으로 둔다.
12. JSON 문자열 안의 모든 LaTeX 백슬래시는 반드시 이중 백슬래시로 이스케이프한다. 예: "2\\times5", "\\frac{1}{2}".
13. 괄호는 가능하면 일반 괄호를 사용하고 \left, \right는 사용하지 않는다.

예시 반환 내용:
- expression: "3x^2-5x+2=0"
- message: "항을 이항하면서 부호를 바꾸지 않았습니다."

올바른 식, 정답, 모범풀이, 첫 오류 이후의 연쇄 오류, 긴 설명은 작성하지 않는다.
불확실하면 verdict="확인 필요", 읽을 수 없으면 verdict="판독 불가"로 하고 expression=""으로 한다.
사진에 풀이가 있는 모든 문제를 빠짐없이 반환한다.`;


const LATEX_COMMANDS = [
  'operatorname', 'therefore', 'triangle', 'begin', 'binom', 'beta', 'theta',
  'times', 'text', 'frac', 'sqrt', 'right', 'left', 'nabla', 'neq', 'not',
  'forall', 'alpha', 'gamma', 'delta', 'lambda', 'sigma', 'omega', 'cdot',
  'div', 'pm', 'le', 'ge', 'ne', 'to', 'tan', 'sin', 'cos', 'log', 'ln'
];

function repairBrokenLatex(value) {
  let text = String(value || '');
  if (!text) return '';

  // 모델이 JSON 문자열에 LaTeX 백슬래시를 한 번만 써서
  // \times -> 탭+imes, \frac -> 폼피드+rac 등으로 변한 경우 복원한다.
  text = text
    .replace(/\u0009herefore/g, String.raw`\therefore`)
    .replace(/\u0009riangle/g, String.raw`\triangle`)
    .replace(/\u0009imes/g, String.raw`\times`)
    .replace(/\u0009heta/g, String.raw`\theta`)
    .replace(/\u0009ext/g, String.raw`\text`)
    .replace(/\u0009an/g, String.raw`\tan`)
    .replace(/\u0009o/g, String.raw`\to`)
    .replace(/\u000Corall/g, String.raw`\forall`)
    .replace(/\u000Crac/g, String.raw`\frac`)
    .replace(/\u000Dight/g, String.raw`\right`)
    .replace(/\u000Dho/g, String.raw`\rho`)
    .replace(/\u0008egin/g, String.raw`\begin`)
    .replace(/\u0008inom/g, String.raw`\binom`)
    .replace(/\u0008eta/g, String.raw`\beta`)
    .replace(/\u000Aabla/g, String.raw`\nabla`)
    .replace(/\u000Aeq/g, String.raw`\neq`)
    .replace(/\u000Aot/g, String.raw`\not`)
    .replace(/\u000Au/g, String.raw`\nu`)
    .replace(/\u000Ae(?=[^A-Za-z]|$)/g, String.raw`\ne`);

  text = text
    .replace(/(?<!\\)([0-9A-Za-z}\)])imes(?=[0-9A-Za-z{(])/g, (_, left) => `${left}${String.raw`\times `}`)
    .replace(/(^|[^A-Za-z\\])rac(?=\s*\{)/g, (_, prefix) => `${prefix}${String.raw`\frac`}`)
    .replace(/(^|[^A-Za-z\\])ext(?=\s*\{)/g, (_, prefix) => `${prefix}${String.raw`\text`}`)
    .replace(/(^|[^A-Za-z\\])heta(?=[^A-Za-z]|$)/g, (_, prefix) => `${prefix}${String.raw`\theta`}`)
    .replace(/(^|[^A-Za-z\\])herefore(?=[^A-Za-z]|$)/g, (_, prefix) => `${prefix}${String.raw`\therefore`}`);

  text = text.replace(/(^|[^A-Za-z\\])(sqrt|frac)(?=\s*\{)/g,
    (_, prefix, command) => `${prefix}\\${command}`);

  const commandPattern = LATEX_COMMANDS.join('|');
  const doubledCommand = new RegExp(String.raw`\\\\(?=(?:${commandPattern})(?:\\b|\\s*\\{))`, 'g');
  while (doubledCommand.test(text)) {
    doubledCommand.lastIndex = 0;
    text = text.replace(doubledCommand, '\\');
  }

  return text;
}

function balanceLatex(value) {
  const text = repairBrokenLatex(value);
  if (!text) return '';

  let depth = 0;
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const escaped = index > 0 && text[index - 1] === '\\';
    if (!escaped && char === '{') depth += 1;
    if (!escaped && char === '}') {
      if (depth === 0) continue;
      depth -= 1;
    }
    output += char;
  }
  if (depth > 0) output += '}'.repeat(depth);

  const leftCount = (output.match(/\\left\b/g) || []).length;
  const rightCount = (output.match(/\\right\b/g) || []).length;
  if (leftCount > rightCount) output += String.raw`\right.`.repeat(leftCount - rightCount);
  if (rightCount > leftCount) output = String.raw`\left.`.repeat(rightCount - leftCount) + output;

  return output.trim();
}

function normalizeLatexExpression(value) {
  let expression = repairBrokenLatex(value).trim();
  if (!expression) return '';

  expression = expression
    .replace(/^\s*\\\((.*)\\\)\s*$/s, '$1')
    .replace(/^\s*\\\[(.*)\\\]\s*$/s, '$1')
    .replace(/^\s*\$\$(.*)\$\$\s*$/s, '$1')
    .replace(/^\s*\$(.*)\$\s*$/s, '$1')
    .trim();

  expression = expression
    .replace(/−/g, '-')
    .replace(/×/g, String.raw`\times `)
    .replace(/÷/g, String.raw`\div `)
    .replace(/≤/g, String.raw`\le `)
    .replace(/≥/g, String.raw`\ge `)
    .replace(/≠/g, String.raw`\ne `)
    .replace(/±/g, String.raw`\pm `)
    .replace(/²/g, '^2')
    .replace(/³/g, '^3');

  return balanceLatex(expression);
}

function normalizeMathMessage(value) {
  let message = repairBrokenLatex(value).trim();
  if (!message) return '';

  message = message
    .split(String.raw`\\(`).join(String.raw`\(`)
    .split(String.raw`\\)`).join(String.raw`\)`)
    .split(String.raw`\\[`).join(String.raw`\[`)
    .split(String.raw`\\]`).join(String.raw`\]`);

  message = message.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => String.raw`\[${balanceLatex(math.trim())}\]`);
  message = message.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_, prefix, math) => `${prefix}${String.raw`\(${balanceLatex(math.trim())}\)`}`);
  message = message.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => String.raw`\(${balanceLatex(math)}\)`);
  message = message.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => String.raw`\[${balanceLatex(math)}\]`);

  return message;
}


function getResponseTokenUsage(data) {
  const usage = data?.usageMetadata || {};
  const inputTokens = Math.max(0, Math.floor(Number(
    usage.promptTokenCount ?? 0
  ) || 0));
  const answerTokens = Math.max(0, Math.floor(Number(usage.candidatesTokenCount ?? 0) || 0));
  const thinkingTokens = Math.max(0, Math.floor(Number(usage.thoughtsTokenCount ?? 0) || 0));
  const reportedTotal = Math.max(0, Math.floor(Number(
    usage.totalTokenCount ?? 0
  ) || 0));
  const outputTokens = Math.max(answerTokens + thinkingTokens, reportedTotal - inputTokens, 0);
  const totalTokens = reportedTotal || (inputTokens + outputTokens);

  return { inputTokens, answerTokens, thinkingTokens, outputTokens, totalTokens };
}

const MODEL_PRICING = {
  'gemini-3.5-flash': { input: 1.5, output: 9 },
  'gemini-3.1-pro-preview': { input: 2, output: 12, largeInput: 4, largeOutput: 18 }
};

function usageCost(model, usage) {
  const price = MODEL_PRICING[model] || MODEL_PRICING['gemini-3.5-flash'];
  const large = model === 'gemini-3.1-pro-preview' && usage.inputTokens > 200000;
  const inputRate = large ? price.largeInput : price.input;
  const outputRate = large ? price.largeOutput : price.output;
  return (usage.inputTokens / 1000000) * inputRate + (usage.outputTokens / 1000000) * outputRate;
}

async function recordUsage(accountId, model, usage) {
  if (!accountId || !usage?.totalTokens) return;
  await db('analysis_usage', { method: 'POST', body: {
    account_id: accountId,
    model,
    input_tokens: usage.inputTokens,
    answer_tokens: usage.answerTokens,
    thinking_tokens: usage.thinkingTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    estimated_cost_usd: usageCost(model, usage)
  }});
}

async function addTokenUsageToAccount(accountId, usage) {
  const inputAmount = Math.max(0, Math.floor(Number(usage?.inputTokens) || 0));
  const outputAmount = Math.max(0, Math.floor(Number(usage?.outputTokens) || 0));
  const totalAmount = Math.max(0, Math.floor(Number(usage?.totalTokens) || (inputAmount + outputAmount)));
  if (!accountId || !totalAmount) return null;

  // 같은 아이디로 여러 분석이 동시에 완료되어도 토큰이 빠지지 않도록
  // 세 누적값을 한 번에 조건부 갱신하고 최대 8회 재시도한다.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rows = await db(`accounts?id=eq.${encodeURIComponent(accountId)}&select=total_input_tokens,total_output_tokens,total_tokens`);
    const currentInput = Math.max(0, Number(rows?.[0]?.total_input_tokens || 0));
    const currentOutput = Math.max(0, Number(rows?.[0]?.total_output_tokens || 0));
    const currentTotal = Math.max(0, Number(rows?.[0]?.total_tokens || 0));
    const nextInput = currentInput + inputAmount;
    const nextOutput = currentOutput + outputAmount;
    const nextTotal = currentTotal + totalAmount;

    const updated = await db(
      `accounts?id=eq.${encodeURIComponent(accountId)}&total_input_tokens=eq.${currentInput}&total_output_tokens=eq.${currentOutput}&total_tokens=eq.${currentTotal}`,
      {
        method: 'PATCH',
        body: {
          total_input_tokens: nextInput,
          total_output_tokens: nextOutput,
          total_tokens: nextTotal
        }
      }
    ).catch(() => []);

    if (updated?.length) {
      return {
        total_input_tokens: nextInput,
        total_output_tokens: nextOutput,
        total_tokens: nextTotal
      };
    }
  }

  throw new Error('입력·출력·누적 토큰을 갱신하지 못했습니다.');
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, errorBody({ title: '요청 방식 오류', reason: '이 기능은 POST 요청만 지원합니다.', solution: ['페이지를 새로고침한 뒤 다시 시도해 주세요.'], code: 'METHOD_NOT_ALLOWED', status: 405 }));
  }

  const auth = await getSessionAccount(event).catch(() => null);
  if (!auth?.account?.id) {
    return json(401, errorBody({ title: '로그인이 필요합니다', reason: '로그인 정보가 없거나 세션이 만료되었습니다.', solution: ['다시 로그인한 뒤 분석해 주세요.'], code: 'AUTH_REQUIRED', status: 401 }));
  }
  if (!auth.account.active) {
    return json(403, errorBody({ title: '사용 중지 계정', reason: '관리자가 사용을 중지한 계정입니다.', solution: ['관리자에게 문의해 주세요.'], code: 'ACCOUNT_INACTIVE', status: 403, account: auth.account }));
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return json(500, errorBody({ title: 'API 키 설정 오류', reason: 'Netlify에 GEMINI_API_KEY가 등록되어 있지 않습니다.', solution: ['Netlify 환경변수에 GEMINI_API_KEY를 등록하세요.', '등록 후 사이트를 다시 배포하세요.'], code: 'MISSING_API_KEY', status: 500 }));
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
  const imageMatch = String(imageDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!imageMatch) {
    return json(400, errorBody({ title: '이미지 형식 오류', reason: 'Gemini에 전달할 이미지 데이터를 읽지 못했습니다.', solution: ['JPG 또는 PNG 사진을 다시 선택해 주세요.'], code: 'INVALID_IMAGE_DATA', status: 400, account: auth.account }));
  }
  const [, imageMimeType, imageBase64] = imageMatch;

  const schoolLevel = payload.schoolLevel === 'high' ? 'high' : 'elementary-middle';
  const model = schoolLevel === 'high' ? 'gemini-3.1-pro-preview' : 'gemini-3.5-flash';

  let account = auth.account;

  // 사진 분석을 시작할 때 1장을 차감합니다.
  if (Number(auth.account.used_count) >= Number(auth.account.limit_count)) {
    return json(403, errorBody({ title: '분석 한도 소진', reason: '사용 가능한 분석 장수를 모두 사용했습니다.', solution: ['관리자에게 분석 장수 추가를 요청해 주세요.'], code: 'QUOTA_EXCEEDED', status: 403, account: auth.account }));
  }

  const nextUsed = Number(auth.account.used_count) + 1;
  const updatedRows = await db(`accounts?id=eq.${encodeURIComponent(auth.account.id)}&used_count=eq.${Number(auth.account.used_count)}`, {
    method: 'PATCH',
    body: { used_count: nextUsed }
  }).catch(() => []);

  if (!updatedRows?.length) {
    return json(409, errorBody({ title: '사용량 갱신 충돌', reason: '동시에 여러 분석이 시작되어 사용량을 갱신하지 못했습니다.', solution: ['잠시 후 다시 시도해 주세요.'], code: 'QUOTA_CONFLICT', status: 409, account: auth.account }));
  }

  account = { ...auth.account, used_count: nextUsed };

  const controller = new AbortController();
  const timeoutMs = 30000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const instruction = systemPrompt;
    const userText = '사진 속 풀이가 있는 문제를 번호별로 모두 분리해 각각 검산하고 최종 JSON만 반환하세요.';

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{
          role: 'user',
          parts: [
            { text: userText },
            { inlineData: { mimeType: imageMimeType, data: imageBase64 } }
          ]
        }],
        generationConfig: {
          maxOutputTokens: 1500,
          responseMimeType: 'application/json',
          responseJsonSchema: resultSchema,
          thinkingConfig: { thinkingLevel: 'LOW' }
        }
      })
    });

    clearTimeout(timeoutId);
    const data = await response.json().catch(() => ({}));

    // 실제 API 입력·출력·추론 토큰을 현재 로그인 아이디에 누적합니다.
    const responseUsage = getResponseTokenUsage(data);
    if (responseUsage.totalTokens > 0) {
      try {
        const tokenTotals = await addTokenUsageToAccount(auth.account.id, responseUsage);
        if (tokenTotals) account = { ...account, ...tokenTotals };
        await recordUsage(auth.account.id, model, responseUsage);
      } catch (tokenError) {
        console.error('TOKEN_TRACKING_FAILED', tokenError);
      }
    }

    if (!response.ok) {
      const message = data?.error?.message || 'Gemini API 오류';
      const code = data?.error?.status || data?.error?.code || 'GEMINI_ERROR';
      const lower = message.toLowerCase();
      let title = 'AI 서비스 호출 실패';
      let reason = message;
      let solution = ['잠시 후 다시 분석해 주세요.'];

      if (response.status === 401 || response.status === 403 || lower.includes('api key')) {
        title = 'API 인증 실패';
        reason = 'Gemini API 키가 없거나 올바르지 않습니다.';
        solution = ['Netlify의 GEMINI_API_KEY 값을 확인하세요.', '환경변수 수정 후 다시 배포하세요.'];
      } else if (code === 'RESOURCE_EXHAUSTED' || lower.includes('quota') || lower.includes('billing')) {
        title = 'API 사용 한도 초과';
        reason = 'Gemini API 크레딧 또는 사용 한도를 초과했습니다.';
        solution = ['Google AI Studio의 Billing과 사용 한도를 확인하세요.', '결제 설정 후 다시 시도하세요.'];
      } else if (response.status === 429) {
        title = '요청이 너무 많습니다';
        reason = '짧은 시간에 요청이 몰려 분석이 제한되었습니다.';
        solution = ['잠시 기다린 뒤 다시 분석해 주세요.', '한 번에 올리는 사진 수를 줄여 다시 시도하세요.'];
      } else if (response.status === 404 || lower.includes('model')) {
        title = 'AI 모델 설정 오류';
        reason = '설정된 모델을 찾을 수 없거나 사용할 권한이 없습니다.';
        solution = ['Netlify의 GEMINI_MODEL 값을 확인하세요.', '사용 가능한 모델명으로 수정한 뒤 다시 배포하세요.'];
      }

      return json(response.status, errorBody({ title, error: message, reason, solution, code, status: response.status, account }));
    }

    const finishReason = data?.candidates?.[0]?.finishReason || '';
    if (finishReason === 'MAX_TOKENS') {
      const reasonCode = 'MAX_TOKENS';
      return json(502, errorBody({
        title: 'AI 응답 미완료',
        reason: '분석 결과가 길이 제한에 도달해 중간에 종료되었습니다.',
        solution: [
          '📷 사진을 위·아래 또는 좌·우로 반씩 나누어 다시 업로드해 보세요.',
          '같은 사진으로 다시 한 번 분석해 보세요.'
        ],
        code: reasonCode,
        status: 502,
        account
      }));
    }

    const outputText = getOutputText(data);
    const parsed = extractJson(outputText);
    const rawProblems = Array.isArray(parsed?.problems) ? parsed.problems : [];

    if (!rawProblems.length) {
      const blockReason = data?.promptFeedback?.blockReason;

      return json(502, errorBody({
        title: '분석 결과 해석 실패',
        reason: blockReason ? `Gemini가 요청을 처리하지 못했습니다: ${blockReason}` : 'AI는 응답했지만 문제별 결과 형식으로 변환하지 못했습니다.',
        solution: ['같은 사진을 다시 분석해 주세요.', '사진이 선명한지 확인해 주세요.', '반복되면 사진을 나누어 올려 주세요.'],
        code: 'INVALID_AI_RESPONSE',
        status: 502,
        detail: outputText.slice(0, 300),
        account
      }));
    }

    const problems = rawProblems.map((problem, index) => {
      const number = String(problem?.number || index + 1).trim();
      const verdict = problem?.verdict || '확인 필요';
      let message = normalizeMathMessage(problem?.message);
      let expression = normalizeLatexExpression(problem?.expression);

      if (verdict === '맞음') {
        message = '맞음';
        expression = '';
      }
      if (verdict === '판독 불가') {
        message = '판독 불가';
        expression = '';
      }
      if (verdict === '확인 필요') expression = '';
      if (!message) message = verdict;

      return { number, verdict, message, expression };
    });

    return json(200, { problems, account: publicAccount(account) });
  } catch (error) {
    clearTimeout(timeoutId);

    if (error?.name === 'AbortError') {
      return json(504, errorBody({
        title: '분석 시간 초과',
        reason: '사진에 문제나 풀이가 많거나 이미지가 복잡해 제한 시간 안에 분석이 끝나지 않았습니다.',
        solution: ['같은 사진을 다시 분석해 주세요.', '한 페이지를 나누어 촬영해 주세요.', '풀이가 선명하게 보이도록 다시 촬영해 주세요.'],
        code: 'ANALYSIS_TIMEOUT',
        status: 504,
        account
      }));
    }

    return json(500, errorBody({
      title: '서버 처리 오류',
      error: error?.message || '서버 오류가 발생했습니다.',
      reason: error?.cause?.message || '서버에서 요청을 처리하는 중 예기치 않은 오류가 발생했습니다.',
      solution: ['잠시 후 다시 시도해 주세요.', '계속 실패하면 표시된 오류 코드와 함께 문의해 주세요.'],
      code: error?.code || 'SERVER_ERROR',
      status: 500,
      detail: error?.stack || '',
      account
    }));

  }
}
