import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/research-session.json','utf8'));
test('summary queue is atomic, private, idempotent and reclaimable without modifying historical analysis',async()=>{
 const db=new PGlite();
 const worker='30000000-0000-4000-8000-000000000001',replacement='30000000-0000-4000-8000-000000000002',device='20000000-0000-4000-8000-000000000001';
 try{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(fs.readFileSync('db/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
  await db.exec(fs.readFileSync('db/analysis.sql','utf8'));
  const project=(await db.query("insert into projects(title) values('Summary test') returning id")).rows[0].id;
  const session=(await db.query('insert into sessions(project_id,device_id) values($1,$2) returning id',[project,device])).rows[0].id;
  for(const event of fixtures)await db.query('select prm_store_event($1,$2::jsonb)',[session,JSON.stringify({...event,client_event_id:event.id,device_id:device,content:event.event_contents.content_jsonb})]);
  await db.query("update sessions set recording_status='closing' where id=$1",[session]);
  await db.query('select prm_close_session($1,$2::uuid[],$3)',[session,fixtures.map(e=>e.id),fixtures.length]);
  const result={pipeline_version:'extraction-v1',episodes:[{title:'조사',goal:'범위 정하기',boundary_reason:'같은 목적',event_ids:(await db.query('select id from events order by client_seq')).rows.map(e=>e.id),objects:[]}]};
  async function create(){const id=(await db.query('select prm_create_analysis_run($1,$2) as id',[session,'test'])).rows[0].id;await db.query('select * from prm_claim_analysis_run($1)',[worker]);return id;}
  async function finish(id,value=result){await db.query('select prm_finish_analysis_run($1,$2,$3::jsonb)',[id,worker,JSON.stringify(value)]);}
  const oldRun=await create();await finish(oldRun);
  const before=(await db.query('select * from analysis_runs where id=$1',[oldRun])).rows;
  const eventsBefore=(await db.query('select * from events order by client_seq')).rows;
  await db.exec(fs.readFileSync('db/summary.sql','utf8'));
  await db.exec(fs.readFileSync('db/summary.sql','utf8')); // Repeatable setup.
  assert.equal((await db.query('select * from analysis_summary_jobs')).rows.length,0);
  const current=await create();
  await assert.rejects(()=>db.query('select * from prm_request_summary($1)',[current]),/completed/);
  const invalid=structuredClone(result);invalid.episodes[0].event_ids=invalid.episodes[0].event_ids.slice(1);
  await assert.rejects(()=>finish(current,invalid));
  assert.equal((await db.query('select * from analysis_summary_jobs')).rows.length,0);
  await finish(current);
  assert.equal((await db.query('select * from analysis_summary_jobs')).rows.length,1);
  for(let i=0;i<2;i++)assert.equal((await db.query('select * from prm_request_summary($1)',[current])).rows[0].status,'queued');
  const claimed=(await db.query('select * from prm_claim_summary($1)',[worker])).rows;
  assert.equal(claimed[0].run_id,current);
  assert.equal((await db.query('select * from prm_claim_summary($1)',[replacement])).rows.length,0);
  assert.equal((await db.query('select * from prm_request_summary($1)',[current])).rows[0].status,'processing');
  const checkpoint={input_hash:'hash',attempts:[{candidate:{}}],usage:{total_tokens:9}};
  await db.query("update analysis_summary_jobs set checkpoint=$2::jsonb,usage=$3::jsonb,heartbeat_at=now()-interval '11 minutes' where run_id=$1",[current,JSON.stringify(checkpoint),JSON.stringify(checkpoint.usage)]);
  const reclaimed=(await db.query('select * from prm_claim_summary($1)',[replacement])).rows[0];
  assert.equal(reclaimed.worker_id,replacement);assert.deepEqual(reclaimed.checkpoint,checkpoint);
  assert.equal((await db.query("update analysis_summary_jobs set status='failed' where run_id=$1 and worker_id=$2 returning run_id",[current,worker])).rows.length,0);
  await db.query("update analysis_summary_jobs set status='failed',error='review failed' where run_id=$1",[current]);
  const retry=(await db.query('select * from prm_request_summary($1)',[current])).rows[0];
  assert.equal(retry.status,'queued');assert.equal(retry.error,null);assert.deepEqual(retry.checkpoint,{usage:{total_tokens:9}});
  await db.query("update analysis_summary_jobs set status='complete',result='{}'::jsonb where run_id=$1",[current]);
  assert.equal((await db.query('select * from prm_request_summary($1)',[current])).rows[0].status,'complete');
  assert.equal((await db.query('select * from analysis_runs where id=$1',[current])).rows[0].status,'complete');
  assert.deepEqual((await db.query('select * from analysis_runs where id=$1',[oldRun])).rows,before);
  assert.deepEqual((await db.query('select * from events order by client_seq')).rows,eventsBefore);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.analysis_summary_jobs'::regclass")).rows[0].relrowsecurity,true);
  for(const role of ['anon','authenticated']){
   assert.equal((await db.query("select has_table_privilege($1,'public.analysis_summary_jobs','select') as allowed",[role])).rows[0].allowed,false);
   assert.equal((await db.query("select has_function_privilege($1,'public.prm_request_summary(uuid)','execute') as allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await db.query('select * from prm_request_summary($1)',[oldRun])).rows[0].status,'queued');
 }finally{await db.close()}
});

test('new summary checkpoints survive PostgreSQL jsonb key reordering without regeneration',async()=>{
 const {summarizeRun}=await import('../lib/session-summary.js');
 const {modelAnswer}=await import('./helpers/summary-model.mjs');
 const run=JSON.parse(fs.readFileSync('tests/fixtures/summary-session.json','utf8'));
 const answer=await summarizeRun(run,{call:modelAnswer});
 const db=new PGlite();
 try{
  await db.exec('create table saved_checkpoint (payload jsonb not null)');
  await db.query('insert into saved_checkpoint values($1::jsonb)',[JSON.stringify(answer.checkpoint)]);
  const checkpoint=(await db.query('select payload from saved_checkpoint')).rows[0].payload;
  const resumed=await summarizeRun(run,{checkpoint,call:async()=>{throw Error('must not regenerate after JSONB round trip')}});
  assert.deepEqual(resumed.result,answer.result);assert.deepEqual(resumed.usage,answer.usage);
 }finally{await db.close()}
});
