import crypto from 'node:crypto';

export const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nkoooncnmxabzoajsdpa.supabase.co';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function json(statusCode, body) { return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) }; }
export function tokenHash(token){ return crypto.createHash('sha256').update(token).digest('hex'); }
export function newToken(){ return crypto.randomBytes(32).toString('base64url'); }
export function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')){
  const hash=crypto.scryptSync(String(password),salt,64).toString('hex'); return `${salt}:${hash}`;
}
export function verifyPassword(password, stored){
  const [salt,hex]=String(stored||'').split(':'); if(!salt||!hex) return false;
  const actual=crypto.scryptSync(String(password),salt,64); const expected=Buffer.from(hex,'hex');
  return expected.length===actual.length && crypto.timingSafeEqual(actual,expected);
}
export async function db(path,{method='GET',body,prefer='return=representation'}={}){
  if(!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
  const res=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json',Prefer:prefer},body:body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>null); if(!res.ok) throw new Error(data?.message||data?.hint||`DB 오류 (${res.status})`); return data;
}
export function publicAccount(account){
  if(!account) return null;
  const { password_hash, total_input_tokens, total_output_tokens, total_tokens, ...safeAccount } = account;
  return safeAccount;
}
export function bearer(event){ const h=event.headers?.authorization||event.headers?.Authorization||''; return h.startsWith('Bearer ')?h.slice(7).trim():''; }
export async function getSessionAccount(event){
  const token=bearer(event); if(!token) return null; const h=tokenHash(token);
  const rows=await db(`account_sessions?token_hash=eq.${encodeURIComponent(h)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,account_id,is_admin`);
  const session=rows?.[0]; if(!session||session.is_admin||!session.account_id) return null;
  const acc=await db(`accounts?id=eq.${encodeURIComponent(session.account_id)}&select=*`);
  if (!acc?.[0]) return null;
  const { password_hash, ...account } = acc[0];
  return { token, session, account };
}
export async function getStudentSession(event){
  const token=bearer(event); if(!token) return null; const h=tokenHash(token);
  const rows=await db(`student_sessions?token_hash=eq.${encodeURIComponent(h)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,student_id,account_id`);
  const session=rows?.[0]; if(!session) return null;
  const students=await db(`students?id=eq.${encodeURIComponent(session.student_id)}&active=eq.true&select=id,account_id,student_name,active`);
  const student=students?.[0]; if(!student) return null;
  const accounts=await db(`accounts?id=eq.${encodeURIComponent(session.account_id)}&active=eq.true&select=*`);
  if(!accounts?.[0]) return null;
  return { token, session, student, account:accounts[0] };
}
export async function getAdminSession(event){
  const token=bearer(event); if(!token) return null; const h=tokenHash(token);
  const rows=await db(`account_sessions?token_hash=eq.${encodeURIComponent(h)}&is_admin=eq.true&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,is_admin`);
  return rows?.[0]||null;
}
