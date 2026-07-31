import { db, getStudentSession, json, newToken, tokenHash, SUPABASE_URL, SERVICE_KEY } from './_common.js';

function storageHeaders(extra={}) { return { apikey:SERVICE_KEY, Authorization:`Bearer ${SERVICE_KEY}`, ...extra }; }

export async function handler(event) {
  if (event.httpMethod === 'POST' && !event.headers?.authorization) {
    const { code } = JSON.parse(event.body || '{}');
    const key = tokenHash(String(code || '').replace(/\D/g, ''));
    const rows = await db(`students?access_code_hash=eq.${encodeURIComponent(key)}&active=eq.true&select=id,account_id,student_name`);
    const student = rows?.[0];
    if (!student) return json(401, { error: '접속코드가 올바르지 않거나 사용이 중지됐습니다.' });
    const token = newToken();
    await db('student_sessions', { method:'POST', body:{ student_id:student.id, account_id:student.account_id, token_hash:tokenHash(token), expires_at:new Date(Date.now()+30*86400000).toISOString() } });
    return json(200, { token, student:{ id:student.id, name:student.student_name } });
  }

  const auth = await getStudentSession(event).catch(() => null);
  if (!auth) return json(401, { error: '학생 인증이 필요합니다.' });

  if (event.httpMethod === 'GET') return json(200, { student:{ id:auth.student.id, name:auth.student.student_name } });

  if (event.httpMethod === 'POST') {
    const payload = JSON.parse(event.body || '{}');
    const match = String(payload.imageDataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
    if (!match || !Array.isArray(payload.problems)) return json(400, { error: '사진과 분석 결과가 필요합니다.' });
    const recordId = String(payload.recordId || crypto.randomUUID());
    const ext = match[1].includes('png') ? 'png' : 'jpg';
    const path = `${auth.account.id}/${auth.student.id}/${recordId}.${ext}`;
    const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/student-submissions/${path}`, { method:'POST', headers:storageHeaders({'Content-Type':match[1], 'x-upsert':'true'}), body:Buffer.from(match[2], 'base64') });
    if (!upload.ok) return json(500, { error:'사진을 저장하지 못했습니다.' });
    const problems = payload.problems;
    const summary = {
      total:problems.length,
      correct:problems.filter(p=>p?.verdict==='맞음').length,
      incorrect:problems.filter(p=>p?.verdict==='틀림').length,
      review:problems.filter(p=>p?.verdict==='확인 필요'||p?.verdict==='판독 불가').length,
      calculation:problems.filter(p=>p?.verdict==='틀림'&&p?.errorType==='계산오류').length,
      concept:problems.filter(p=>p?.verdict==='틀림'&&p?.errorType==='개념오류').length
    };
    await db('student_submissions', { method:'POST', body:{ account_id:auth.account.id, student_id:auth.student.id, record_id:recordId, image_path:path, file_name:String(payload.fileName||'풀이 사진').slice(0,150), analysis_result:{problems}, expires_at:new Date(Date.now()+3*86400000).toISOString() } });
    await db('student_analysis_records?on_conflict=account_id,record_id', { method:'POST', prefer:'resolution=merge-duplicates,return=minimal', body:{ account_id:auth.account.id, record_id:recordId, student_name:auth.student.student_name, student_name_key:auth.student.student_name.replace(/\s+/g,''), total_count:summary.total, correct_count:summary.correct, incorrect_count:summary.incorrect, review_count:summary.review, calculation_errors:summary.calculation, concept_errors:summary.concept } });
    return json(200, { saved:true, summary });
  }
  return json(405, { error:'지원하지 않는 요청입니다.' });
}
