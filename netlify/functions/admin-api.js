import { json, db, getAdminSession, hashPassword } from './_common.js';
async function list(){return db('accounts?select=id,login_id,limit_count,used_count,active,created_at&order=created_at.desc');}
export async function handler(event){
 try{if(!await getAdminSession(event))return json(401,{error:'관리자 로그인이 필요합니다.'});
 if(event.httpMethod==='GET')return json(200,{accounts:await list()});
 const b=JSON.parse(event.body||'{}'); const id=encodeURIComponent(b.accountId||'');
 switch(b.action){
  case'create': if(!b.loginId||!b.password)return json(400,{error:'아이디와 비밀번호를 입력하세요.'}); await db('accounts',{method:'POST',body:{login_id:String(b.loginId).trim(),password_hash:hashPassword(b.password),limit_count:Math.max(0,Number(b.limitCount)||0),used_count:0,active:true}});break;
  case'add_limit':await db(`accounts?id=eq.${id}`,{method:'PATCH',body:{limit_count:Math.max(0,Number((await db(`accounts?id=eq.${id}&select=limit_count`))?.[0]?.limit_count||0)+Number(b.amount||0))}});break;
  case'set_limit':await db(`accounts?id=eq.${id}`,{method:'PATCH',body:{limit_count:Math.max(0,Number(b.limitCount)||0)}});break;
  case'reset_used':await db(`accounts?id=eq.${id}`,{method:'PATCH',body:{used_count:0}});break;
  case'change_password':if(!b.password)return json(400,{error:'새 비밀번호를 입력하세요.'});await db(`accounts?id=eq.${id}`,{method:'PATCH',body:{password_hash:hashPassword(b.password)}});break;
  case'toggle_active':await db(`accounts?id=eq.${id}`,{method:'PATCH',body:{active:!!b.active}});break;
  case'delete':await db(`accounts?id=eq.${id}`,{method:'DELETE',prefer:'return=minimal'});break;
  default:return json(400,{error:'알 수 없는 작업입니다.'});
 }
 return json(200,{message:'처리되었습니다.',accounts:await list()});
 }catch(e){return json(500,{error:e.message});}
}