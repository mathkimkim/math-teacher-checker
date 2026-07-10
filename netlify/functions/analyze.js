const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST만 지원합니다.' });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.5';
  if (!apiKey) return json(500, { error: 'Netlify 환경변수 OPENAI_API_KEY가 없습니다.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: '요청 형식이 올바르지 않습니다.' }); }
  const imageDataUrl = payload.imageDataUrl;
  if (!imageDataUrl || !String(imageDataUrl).startsWith('data:image/')) {
    return json(400, { error: '이미지 파일이 필요합니다.' });
  }

  const systemPrompt = `너는 수학학원 선생님의 풀이 검토 보조 AI다.
목표는 학생 풀이 사진을 보고 딱 두 가지만 검사하는 것이다.
1) 계산 실수
2) 빨간색으로 표시해야 할 정도의 논리 비약

규칙:
- 문제를 처음부터 새로 길게 풀지 말고, 학생 풀이를 기준으로 검토한다.
- 정상 풀이면 간단히 맞음이라고 판단한다.
- 계산 실수는 사칙연산, 부호, 분수, 지수, 근호, 약분, 전개, 인수분해 계산 오류만 본다.
- 논리 비약은 단순 계산 생략이 아니라 개념이 바뀌는 단계에서 근거 없이 식이 바뀐 경우만 표시한다.
- 암산 가능한 계산(3+5=8, 49-32=17 등)은 논리 비약으로 보지 않는다.
- 인수분해, 완전제곱식, 유리화, 약분, 치환, 삼각함수/로그/지수 변형, 극한/미분/적분 변형에서 과정이 확인되지 않으면 논리 비약으로 본다.
- 사진이 흐리거나 식을 확실히 읽을 수 없으면 판독 불가라고 한다.
- 추측으로 틀렸다고 하지 않는다.

반드시 JSON만 출력한다.
형식:
{
  "verdict": "✅ 풀이 맞음" 또는 "❌ 풀이 틀림" 또는 "⚠️ 풀이 확인 필요" 또는 "판독 불가",
  "calculation_mistakes": "없음" 또는 "몇 번째 줄: 학생 식 → 올바른 식",
  "logic_gap": "" 또는 "몇 번째 줄: 선생님 확인이 필요한 이유 한 줄",
  "note": "짧은 한 줄 메모"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: systemPrompt },
              { type: 'input_image', image_url: imageDataUrl }
            ]
          }
        ],
        text: { format: { type: 'json_object' } }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return json(response.status, { error: data?.error?.message || 'OpenAI API 오류', raw: data?.error || data });
    }

    const text = data.output_text || data.output?.flatMap((o) => o.content || []).map((c) => c.text || '').join('\n') || '';
    const parsed = extractJson(text);
    if (!parsed) {
      return json(502, { error: 'AI 응답을 해석하지 못했습니다.', raw: text.slice(0, 1000) });
    }

    return json(200, {
      verdict: parsed.verdict || '⚠️ 풀이 확인 필요',
      calculation_mistakes: parsed.calculation_mistakes || '없음',
      logic_gap: parsed.logic_gap || '',
      note: parsed.note || ''
    });
  } catch (error) {
    return json(500, { error: error.message || '서버 오류' });
  }
}
