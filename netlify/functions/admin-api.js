import { json, db, getAdminSession, hashPassword } from './_common.js';

const PRICING = {
  'gemini-3.1-pro-preview': { inputPerMillion: 2, outputPerMillion: 12 },
  'gemini-3.5-flash': { inputPerMillion: 1.5, outputPerMillion: 9 },
  'gemini-3.6-flash': { inputPerMillion: 1.5, outputPerMillion: 7.5 },
  'gemini-3.6-flash-pro': { inputPerMillion: 1.5, outputPerMillion: 7.5 },
  'gemini-3.6-flash-light': { inputPerMillion: 1.5, outputPerMillion: 7.5 },
  'gemini-3.6-flash-middle': { inputPerMillion: 1.5, outputPerMillion: 7.5 },
  'gemini-3.6-flash-high': { inputPerMillion: 1.5, outputPerMillion: 7.5 },
  'gemini-3.6-flash-medium': { inputPerMillion: 1.5, outputPerMillion: 7.5 },
  'gemini-3.6-flash-low': { inputPerMillion: 1.5, outputPerMillion: 7.5 }
};

async function listAccounts() {
  const rows = await db('accounts?select=*&order=created_at.desc');
  return (rows || []).map(({ password_hash, ...account }) => account);
}

async function listUsage() {
  const all = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    let rows;
    try {
      rows = await db(`analysis_usage?select=id,account_id,model,input_tokens,answer_tokens,thinking_tokens,output_tokens,total_tokens,estimated_cost_usd,created_at&order=created_at.desc&limit=1000&offset=${offset}`) || [];
    } catch (error) {
      const legacyRows = await db(`analysis_usage?select=id,account_id,model,input_tokens,output_tokens,total_tokens,estimated_cost_usd,created_at&order=created_at.desc&limit=1000&offset=${offset}`) || [];
      rows = legacyRows.map((row) => ({ ...row, answer_tokens: Number(row.output_tokens || 0), thinking_tokens: 0 }));
    }
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

async function listAnalysisErrors() {
  try {
    return await db('analysis_errors?select=id,account_id,http_status,error_code,error_type,error_source,response_content_type,response_body,request_id,elapsed_ms,created_at&order=created_at.desc&limit=1000') || [];
  } catch (error) {
    try {
      return await db('analysis_errors?select=id,account_id,http_status,error_code,error_type,created_at&order=created_at.desc&limit=1000') || [];
    } catch (fallbackError) {
      console.error('ANALYSIS_ERROR_LIST_FAILED', fallbackError);
      return [];
    }
  }
}

async function payload() {
  return {
    accounts: await listAccounts(),
    usage: await listUsage(),
    analysisErrors: await listAnalysisErrors(),
    pricing: PRICING
  };
}

export async function handler(event) {
  try {
    if (!await getAdminSession(event)) return json(401, { error: '관리자 로그인이 필요합니다.' });
    if (event.httpMethod === 'GET') return json(200, await payload());

    const b = JSON.parse(event.body || '{}');
    const id = encodeURIComponent(b.accountId || '');
    switch (b.action) {
      case 'create':
        if (!b.loginId || !b.password) return json(400, { error: '아이디와 비밀번호를 입력하세요.' });
        await db('accounts', { method: 'POST', body: { login_id: String(b.loginId).trim(), password_hash: hashPassword(b.password), limit_count: Math.max(0, Number(b.limitCount) || 0), used_count: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0, active: true } });
        break;
      case 'add_limit': {
        const current = Number((await db(`accounts?id=eq.${id}&select=limit_count`))?.[0]?.limit_count || 0);
        await db(`accounts?id=eq.${id}`, { method: 'PATCH', body: { limit_count: Math.max(0, current + Number(b.amount || 0)) } });
        break;
      }
      case 'set_limit':
        await db(`accounts?id=eq.${id}`, { method: 'PATCH', body: { limit_count: Math.max(0, Number(b.limitCount) || 0) } });
        break;
      case 'reset_all':
        await db(`accounts?id=eq.${id}`, { method: 'PATCH', body: { used_count: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0 } });
        await db(`analysis_usage?account_id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
        break;
      case 'change_password':
        if (!b.password) return json(400, { error: '새 비밀번호를 입력하세요.' });
        await db(`accounts?id=eq.${id}`, { method: 'PATCH', body: { password_hash: hashPassword(b.password) } });
        break;
      case 'toggle_active':
        await db(`accounts?id=eq.${id}`, { method: 'PATCH', body: { active: !!b.active } });
        break;
      case 'delete':
        await db(`accounts?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
        break;
      default:
        return json(400, { error: '알 수 없는 작업입니다.' });
    }

    return json(200, { message: b.action === 'reset_all' ? '사용 장수·토큰·비용을 모두 초기화했습니다.' : '처리되었습니다.', ...(await payload()) });
  } catch (error) {
    return json(500, { error: error.message });
  }
}
