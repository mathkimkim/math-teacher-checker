import { db, json, SUPABASE_URL, SERVICE_KEY } from './_common.js';

export const config = { schedule: '@daily' };

export async function handler() {
  const now = new Date().toISOString();
  const expired = await db(`student_submissions?expires_at=lt.${encodeURIComponent(now)}&select=id,image_path`) || [];
  for (const row of expired) await fetch(`${SUPABASE_URL}/storage/v1/object/student-submissions/${row.image_path}`, { method:'DELETE', headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`} }).catch(()=>null);
  await db(`student_submissions?expires_at=lt.${encodeURIComponent(now)}`, { method:'DELETE', prefer:'return=minimal' });
  const cutoff = new Date(Date.now() - (21 * 24 * 60 * 60 * 1000)).toISOString();
  await db(`student_analysis_records?analyzed_at=lt.${encodeURIComponent(cutoff)}`, { method:'DELETE', prefer:'return=minimal' });
  return json(200, { cleaned: true });
}
