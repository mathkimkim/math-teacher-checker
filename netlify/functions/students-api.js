import { db, getSessionAccount, json, tokenHash, SUPABASE_URL, SERVICE_KEY } from './_common.js';

function sixDigits(){ return String(Math.floor(100000 + Math.random()*900000)); }
async function createUniqueCode(){ for(let i=0;i<20;i++){ const code=sixDigits(); const hash=tokenHash(code); const rows=await db(`students?access_code_hash=eq.${encodeURIComponent(hash)}&select=id`); if(!rows?.length) return {code,hash}; } throw new Error('접속코드를 생성하지 못했습니다.'); }
async function signedUrl(path){ const res=await fetch(`${SUPABASE_URL}/storage/v1/object/sign/student-submissions/${path}`,{method:'POST',headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:3600})}); const data=await res.json().catch(()=>({})); return data.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : ''; }

export async function handler(event){
  const auth=await getSessionAccount(event).catch(()=>null); if(!auth) return json(401,{error:'로그인이 필요합니다.'});
  if(event.httpMethod==='GET'){
    const students=await db(`students?account_id=eq.${encodeURIComponent(auth.account.id)}&select=id,student_name,active,created_at&order=student_name.asc`)||[];
    const submissions=await db(`student_submissions?account_id=eq.${encodeURIComponent(auth.account.id)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,student_id,record_id,file_name,image_path,analysis_result,created_at,expires_at&order=created_at.desc`)||[];
    const detailed=await Promise.all(submissions.slice(0,200).map(async row=>({...row,image_url:await signedUrl(row.image_path)})));
    return json(200,{students,submissions:detailed});
  }
  if(event.httpMethod==='POST'){
    const p=JSON.parse(event.body||'{}');
    if(p.action==='create') { const name=String(p.studentName||'').trim().slice(0,30); if(!name)return json(400,{error:'학생 이름을 입력해 주세요.'}); const c=await createUniqueCode(); const rows=await db('students',{method:'POST',body:{account_id:auth.account.id,student_name:name,access_code_hash:c.hash}}); return json(200,{student:rows?.[0],accessCode:c.code}); }
    if(p.action==='update_submission'){
      const submissionId=String(p.submissionId||''); const problems=Array.isArray(p.problems)?p.problems:null;
      if(!submissionId||!problems)return json(400,{error:'수정할 분석 결과가 필요합니다.'});
      const found=await db(`student_submissions?id=eq.${encodeURIComponent(submissionId)}&account_id=eq.${encodeURIComponent(auth.account.id)}&select=id,student_id,record_id`); const submission=found?.[0]; if(!submission)return json(404,{error:'제출 기록을 찾을 수 없습니다.'});
      await db(`student_submissions?id=eq.${encodeURIComponent(submissionId)}`,{method:'PATCH',body:{analysis_result:{problems}}});
      const studentRows=await db(`students?id=eq.${encodeURIComponent(submission.student_id)}&select=student_name`); const studentName=studentRows?.[0]?.student_name||'';
      const summary={total:problems.length,correct:problems.filter(x=>x?.verdict==='맞음').length,incorrect:problems.filter(x=>x?.verdict==='틀림').length,review:problems.filter(x=>x?.verdict==='확인 필요'||x?.verdict==='판독 불가').length,calculation:problems.filter(x=>x?.verdict==='틀림'&&x?.errorType==='계산오류').length,concept:problems.filter(x=>x?.verdict==='틀림'&&x?.errorType==='개념오류').length};
      await db(`student_analysis_records?account_id=eq.${encodeURIComponent(auth.account.id)}&record_id=eq.${encodeURIComponent(submission.record_id)}`,{method:'PATCH',body:{student_name:studentName,student_name_key:studentName.replace(/\s+/g,''),total_count:summary.total,correct_count:summary.correct,incorrect_count:summary.incorrect,review_count:summary.review,calculation_errors:summary.calculation,concept_errors:summary.concept,updated_at:new Date().toISOString()}});
      return json(200,{updated:true,summary});
    }
    const id=String(p.studentId||''); const own=await db(`students?id=eq.${encodeURIComponent(id)}&account_id=eq.${encodeURIComponent(auth.account.id)}&select=id`); if(!own?.[0])return json(404,{error:'학생을 찾을 수 없습니다.'});
    if(p.action==='regenerate'){ const c=await createUniqueCode(); await db(`students?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{access_code_hash:c.hash}}); await db(`student_sessions?student_id=eq.${encodeURIComponent(id)}`,{method:'DELETE',prefer:'return=minimal'}); return json(200,{accessCode:c.code}); }
    if(p.action==='toggle'){ await db(`students?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{active:Boolean(p.active)}}); return json(200,{ok:true}); }
    return json(400,{error:'알 수 없는 작업입니다.'});
  }
  if(event.httpMethod==='DELETE'){
    const submissionId=String(event.queryStringParameters?.submissionId||'');
    const rows=await db(`student_submissions?id=eq.${encodeURIComponent(submissionId)}&account_id=eq.${encodeURIComponent(auth.account.id)}&select=id,image_path`); const row=rows?.[0]; if(!row)return json(404,{error:'제출 기록을 찾을 수 없습니다.'});
    await fetch(`${SUPABASE_URL}/storage/v1/object/student-submissions/${row.image_path}`,{method:'DELETE',headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`}});
    await db(`student_submissions?id=eq.${encodeURIComponent(submissionId)}`,{method:'DELETE',prefer:'return=minimal'}); return json(200,{deleted:true});
  }
  return json(405,{error:'지원하지 않는 요청입니다.'});
}
