import { json, db, getSessionAccount } from './_common.js';

function cleanText(value, fallback, maxLength = 120) {
  const text = String(value || '').trim();
  return (text || fallback).slice(0, maxLength);
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: '허용되지 않은 요청입니다.' });
    const auth = await getSessionAccount(event);
    if (!auth) return json(401, { error: '로그인이 필요합니다.' });

    const body = JSON.parse(event.body || '{}');
    const httpStatus = Math.min(599, Math.max(100, Number(body.httpStatus) || 500));
    await db('analysis_errors', {
      method: 'POST',
      body: {
        account_id: auth.account.id,
        http_status: httpStatus,
        error_code: cleanText(body.errorCode, 'UNKNOWN_ERROR', 80),
        error_type: cleanText(body.errorType, '분석 실패', 120)
      }
    });

    return json(200, { ok: true });
  } catch (error) {
    return json(500, { error: error.message });
  }
}
