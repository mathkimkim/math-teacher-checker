import { json, db, newToken, tokenHash } from './_common.js';
export async function handler(event){
 if(event.httpMethod!=='POST')return json(405,{error:'POST 요청만 지원합니다.'});
 try{const {adminId,password}=JSON.parse(event.body||'{}');if(adminId!==process.env.ADMIN_ID||password!==process.env.ADMIN_PASSWORD)return json(401,{error:'관리자 정보가 올바르지 않습니다.'});
 const token=newToken();await db('account_sessions',{method:'POST',body:{account_id:null,token_hash:tokenHash(token),is_admin:true,expires_at:new Date(Date.now()+86400000).toISOString()}});return json(200,{token});}catch(e){return json(500,{error:e.message});}
}