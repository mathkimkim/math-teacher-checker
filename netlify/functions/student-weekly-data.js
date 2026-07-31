import { db, getSessionAccount, json } from './_common.js';

function cleanName(value) {
  return String(value || '').replace(/\s+/g, '').slice(0, 30);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export async function handler(event) {
  const auth = await getSessionAccount(event).catch(() => null);
  if (!auth) return json(401, { error: '로그인이 필요합니다.' });

  const cutoff = new Date(Date.now() - (21 * 24 * 60 * 60 * 1000)).toISOString();
  await db(`student_analysis_records?analyzed_at=lt.${encodeURIComponent(cutoff)}`, { method: 'DELETE', prefer: 'return=minimal' });

  if (event.httpMethod === 'GET' && event.queryStringParameters?.scope === 'all') {
    const rows = await db(`student_analysis_records?account_id=eq.${encodeURIComponent(auth.account.id)}&analyzed_at=gte.${encodeURIComponent(cutoff)}&select=student_name,total_count,correct_count,incorrect_count,review_count,calculation_errors,concept_errors,analyzed_at&order=analyzed_at.desc`);
    return json(200, { records: rows || [] });
  }

  if (event.httpMethod === 'GET') {
    const name = cleanName(event.queryStringParameters?.studentName);
    if (!name) return json(400, { error: '학생 이름을 입력해 주세요.' });
    const rows = await db(`student_analysis_records?account_id=eq.${encodeURIComponent(auth.account.id)}&student_name_key=eq.${encodeURIComponent(name)}&analyzed_at=gte.${encodeURIComponent(cutoff)}&select=total_count,correct_count,incorrect_count,review_count,calculation_errors,concept_errors,analyzed_at&order=analyzed_at.asc`);
    return json(200, { records: rows || [] });
  }

  if (event.httpMethod === 'POST') {
    const payload = JSON.parse(event.body || '{}');
    const studentName = cleanName(payload.studentName);
    const recordId = String(payload.recordId || '').trim();
    if (!studentName || !recordId) return json(400, { error: '학생 이름과 기록 ID가 필요합니다.' });

    const total = number(payload.total);
    if (!total) return json(400, { error: '저장할 분석 결과가 없습니다.' });

    await db('student_analysis_records?on_conflict=account_id,record_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        account_id: auth.account.id,
        record_id: recordId,
        student_name: studentName,
        student_name_key: studentName,
        total_count: total,
        correct_count: number(payload.correct),
        incorrect_count: number(payload.incorrect),
        review_count: number(payload.review),
        calculation_errors: number(payload.calculation),
        concept_errors: number(payload.concept),
        updated_at: new Date().toISOString()
      }
    });
    return json(200, { saved: true });
  }

  if (event.httpMethod === 'DELETE') {
    const name = cleanName(event.queryStringParameters?.studentName);
    if (!name) return json(400, { error: '삭제할 학생 이름을 선택해 주세요.' });
    await db(`student_analysis_records?account_id=eq.${encodeURIComponent(auth.account.id)}&student_name_key=eq.${encodeURIComponent(name)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return json(200, { deleted: true });
  }

  return json(405, { error: '지원하지 않는 요청입니다.' });
}
