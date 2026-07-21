import { json, db, hashPassword, verifyPassword, newToken, tokenHash, publicAccount } from './_common.js';
export async function handler(event){
  if(event.httpMethod!=='POST') return json(405,{error:'POST 요청만 지원합니다.'});
  try{
    const {loginId,password}=JSON.parse(event.body||'{}'); if(!loginId||!password) return json(400,{error:'아이디와 비밀번호를 입력하세요.'});
    const rows=await db(`accounts?login_id=eq.${encodeURIComponent(String(loginId).trim())}&select=*`);
    const account=rows?.[0]; if(!account||!verifyPassword(password,account.password_hash)) return json(401,{error:'아이디 또는 비밀번호가 올바르지 않습니다.'});
    if(!account.active) return json(403,{error:'사용이 중지된 계정입니다. 관리자에게 문의하세요.'});
    const token=newToken(); await db('account_sessions',{method:'POST',body:{account_id:account.id,token_hash:tokenHash(token),is_admin:false,expires_at:new Date(Date.now()+30*86400000).toISOString()}});
    return json(200,{token,account:publicAccount(account)});
  }catch(e){return json(500,{error:e.message});}
}