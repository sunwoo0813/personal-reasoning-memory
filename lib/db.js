import { createClient } from '@supabase/supabase-js';
export function database() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Supabase 연결 설정이 없습니다. .env.local을 확인하세요.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function requireLocal(request) {
  const host = request.headers.get('host') || '';
  const origin = request.headers.get('origin');
  if (!/^(localhost|127\.0\.0\.1):3000$/.test(host)) throw new Error('로컬 접속만 허용됩니다.');
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(origin)) throw new Error('허용되지 않은 출처입니다.');
  if (!['GET','HEAD'].includes(request.method) && (request.headers.get('content-type') || '').split(';')[0] !== 'application/json') throw new Error('JSON 요청이 필요합니다.');
}
