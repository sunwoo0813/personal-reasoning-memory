import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/research-session.json','utf8'));
test('database snapshots closed input and atomically rejects invalid analysis results',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(fs.readFileSync('db/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
  await db.exec(fs.readFileSync('db/analysis.sql','utf8'));
  const project=(await db.query("insert into projects(title) values('Test') returning id")).rows[0].id;
  const device='20000000-0000-4000-8000-000000000001',worker='30000000-0000-4000-8000-000000000001';
  const session=(await db.query('insert into sessions(project_id,device_id) values($1,$2) returning id',[project,device])).rows[0].id;
  await assert.rejects(()=>db.query('select prm_create_analysis_run($1,$2)',[session,'gpt-5-mini']));
  for(const e of fixtures){const event={...e,client_event_id:e.id,device_id:device,content:e.event_contents.content_jsonb};await db.query('select prm_store_event($1,$2::jsonb)',[session,JSON.stringify(event)]);await db.query('select prm_store_event($1,$2::jsonb)',[session,JSON.stringify(event)])}
  assert.equal(Number((await db.query('select count(*) from events')).rows[0].count),fixtures.length);
  await db.query("update sessions set recording_status='closing' where id=$1",[session]);
  assert.equal((await db.query('select prm_close_session($1,$2::uuid[],$3) as ok',[session,fixtures.map(e=>e.id),fixtures.length])).rows[0].ok,true);
  const run=(await db.query('select prm_create_analysis_run($1,$2) as id',[session,'gpt-5-mini'])).rows[0].id;
  await assert.rejects(()=>db.query('select prm_create_analysis_run($1,$2)',[session,'gpt-5-mini']));
  const inputs=(await db.query('select * from analysis_inputs where run_id=$1 order by position',[run])).rows;
  assert.equal(inputs.length,fixtures.length);assert.equal(inputs[1].snapshot.event_contents.content_jsonb.text,fixtures[1].event_contents.content_jsonb.text);
  assert.equal((await db.query('select * from prm_claim_analysis_run($1)',[worker])).rows.length,1);
  assert.equal((await db.query('select * from prm_claim_analysis_run($1)',[worker])).rows.length,0);
  const result={pipeline_version:'extraction-v1',episodes:[{title:'본문 저장',goal:'근거 보존',boundary_reason:'수집 범위 결정',event_ids:inputs.map(x=>x.event_id),objects:[{type:'decision',speaker:'user',text:'본문 저장',evidence:[{event_id:inputs[3].event_id,field:'question',quote:'없는 인용문'}]}]}]};
  await assert.rejects(()=>db.query('select prm_finish_analysis_run($1,$2,$3::jsonb)',[run,worker,JSON.stringify(result)]));
  assert.equal(Number((await db.query('select count(*) from episodes')).rows[0].count),0);
  result.episodes[0].objects[0].evidence[0].quote='주요 본문과 수집 시각을 먼저 저장하는 방식으로 결정할게.';
  assert.equal((await db.query('select prm_finish_analysis_run($1,$2,$3::jsonb) as ok',[run,worker,JSON.stringify(result)])).rows[0].ok,true);
  assert.equal((await db.query('select analysis_status from sessions where id=$1',[session])).rows[0].analysis_status,'needs_review');
  const next=(await db.query('select prm_create_analysis_run($1,$2) as id',[session,'gpt-5-mini'])).rows[0].id;
  assert.notEqual(next,run);assert.equal(Number((await db.query('select count(*) from reasoning_objects')).rows[0].count),1);
  const policies=(await db.query("select relname,relrowsecurity from pg_class where relname in ('analysis_runs','analysis_inputs','analysis_steps','episodes','episode_event_links','reasoning_objects','object_evidence_links')")).rows;
  assert.ok(policies.every(row=>row.relrowsecurity));
 }finally{await db.close()}
});
