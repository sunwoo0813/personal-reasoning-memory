import { database, requireLocal } from '../../../lib/db';
import { NextResponse } from 'next/server';
import { normalizeEvent } from '../../../lib/events';
export const dynamic = 'force-dynamic';
const result = data => NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
function check(error) { if (error) throw new Error(error.message); }
async function handler(request, { params }) {
 try {
  requireLocal(request);
  const { path } = await params, db = database(), method = request.method;
  const body = ['POST','DELETE'].includes(method) ? await request.json() : {};
  if (path[0] === 'projects' && path.length === 1 && method === 'GET') {
   const { data, error } = await db.from('projects').select('*,sessions(*)').order('created_at', { ascending: false }); check(error); return result(data);
  }
  if (path[0] === 'projects' && path.length === 1 && method === 'POST') {
   if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 100) throw new Error('프로젝트 이름을 확인하세요.');
   const { data, error } = await db.from('projects').insert({ title: body.title.trim(), objective: String(body.objective || '').slice(0,1000) }).select().single(); check(error); return result(data);
  }
  if (path[0] === 'projects' && path.length === 2 && method === 'DELETE') {
   const { error } = await db.from('projects').delete().eq('id',path[1]); check(error); return result({ ok: true });
  }
  if (path[0] === 'projects' && path[2] === 'sessions' && method === 'POST') {
   const { data, error } = await db.from('sessions').insert({ project_id:path[1], device_id:body.device_id }).select().single(); check(error); return result(data);
  }
  if (path[0] === 'sessions' && path.length === 2 && method === 'DELETE') {
   const { error } = await db.from('sessions').delete().eq('id',path[1]).eq('recording_status','closed'); check(error); return result({ ok:true });
  }
  if (path[0] === 'sessions' && path[2] === 'events' && method === 'GET') {
   const { data,error } = await db.from('events').select('*,event_contents(*)').eq('session_id',path[1]).order('client_seq'); check(error); return result(data);
  }
  if (path[0] === 'sessions' && path[2] === 'events' && method === 'POST') {
   const { data: session,error: se } = await db.from('sessions').select('*').eq('id',path[1]).single(); check(se);
   if (session.recording_status === 'closed') throw new Error('종료된 세션입니다.');
   if (!Array.isArray(body.events) || body.events.length > 50) throw new Error('이벤트 배치를 확인하세요.');
   const items = [];
   for (const event of body.events) {
    try {
     if (event.device_id !== session.device_id || !['search','page_view','llm_exchange','copy_highlight'].includes(event.event_type)) throw new Error('장치 또는 이벤트 유형이 올바르지 않습니다.');
     const normalized = normalizeEvent(event);
     if (JSON.stringify(normalized.content ?? null).length > 250000) throw new Error('본문 크기 한도를 초과했습니다.');
     const { data, error } = await db.rpc('prm_store_event', { p_session:path[1], p_event:normalized }); check(error);
     items.push({client_event_id:event.client_event_id,status:data});
    } catch(e) { items.push({client_event_id:event.client_event_id,status:'error',message:e.message}); }
   }
   return result({items});
  }
  if (path[0] === 'sessions' && path[2] === 'closing' && method === 'POST') {
   const {data:existing,error:lookupError} = await db.from('sessions').select('*').eq('id',path[1]).single(); check(lookupError); if(existing.recording_status==='closing'||existing.recording_status==='closed') return result(existing); const {data,error} = await db.from('sessions').update({recording_status:'closing',sync_status:'pending'}).eq('id',path[1]).eq('recording_status','recording').select().single(); check(error); return result(data);
  }
  if (path[0] === 'sessions' && path[2] === 'close' && method === 'POST') {
   const ids=body.event_ids;
   if (!Array.isArray(ids) || new Set(ids).size !== ids.length || body.last_seq !== ids.length) throw new Error('전송 목록 또는 순번이 올바르지 않습니다.');
   const { data:ok,error } = await db.rpc('prm_close_session',{p_session:path[1],p_ids:ids,p_last_seq:body.last_seq}); check(error);
   return result({ok});

  }
  return NextResponse.json({error:'찾을 수 없습니다.'},{status:404});
 } catch(error) { return NextResponse.json({error:error.message},{status:400,headers:{'Cache-Control':'no-store'}}); }
}
export { handler as GET, handler as POST, handler as DELETE };
