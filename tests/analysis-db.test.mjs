import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {segmentEvents,analyzeEvents} from '../lib/analysis.js';
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
  const previousRun=(await db.query('select * from analysis_runs where id=$1',[run])).rows[0];
  const originalEvents=(await db.query('select * from events order by client_seq')).rows;
  const nextInputs=(await db.query('select * from analysis_inputs where run_id=$1 order by position',[next])).rows;
  const snapshots=nextInputs.map(input=>input.snapshot);
  const segmentation=await segmentEvents(snapshots,{call:async options=>{
   if(options.stage==='review_session_purposes'){
    const questions=snapshots.flatMap((event,index)=>event.event_type==='llm_exchange'?[{event_index:index+1,relation:'continuation',purpose:'자료 저장과 분석의 운영 방식 결정',quote:event.event_contents.content_jsonb.question,context_start_event_index:index+1}]:[]);
    questions[0].relation='initial';return {result:{questions}};
   }
   return {result:{episodes:[{title:'자료 수집·분석 운영',goal:'자료 보존과 세션 분석의 운영 방식 검토',boundary_reason:'같은 운영 목적의 연속 조사',end_event_index:snapshots.length}]}};
  }});
  await db.query("insert into analysis_steps(run_id,stage,result) values($1,'segmentation',$2::jsonb)",[next,JSON.stringify(segmentation.result)]);
  const saved=(await db.query("select result from analysis_steps where run_id=$1 and stage='segmentation'",[next])).rows[0].result;
  assert.equal(saved.segmentation_policy.version,'purpose-v2');
  assert.equal((await db.query('select * from prm_claim_analysis_run($1)',[worker])).rows[0].id,next);
  const nextResult={pipeline_version:'extraction-v1',episodes:saved.episodes.map(episode=>({...episode,objects:[]}))};
  for(const ids of [nextResult.episodes[0].event_ids.slice(1),[...nextResult.episodes[0].event_ids].reverse(),[...nextResult.episodes[0].event_ids,nextResult.episodes[0].event_ids[0]]]){
   const invalid={...nextResult,episodes:[{...nextResult.episodes[0],event_ids:ids}]};
   await assert.rejects(()=>db.query('select prm_finish_analysis_run($1,$2,$3::jsonb)',[next,worker,JSON.stringify(invalid)]));
   assert.equal(Number((await db.query('select count(*) from episodes where run_id=$1',[next])).rows[0].count),0);
  }
  assert.equal((await db.query('select prm_finish_analysis_run($1,$2,$3::jsonb) as ok',[next,worker,JSON.stringify(nextResult)])).rows[0].ok,true);
  assert.deepEqual((await db.query('select * from analysis_runs where id=$1',[run])).rows[0],previousRun);
  assert.deepEqual((await db.query('select * from events order by client_seq')).rows,originalEvents);
  // Evidence v2 remains compatible with the existing JSON checkpoint and SQL
  // transaction. PostgreSQL jsonb can reorder keys, so hashes must be canonical.
  const groundedRun=(await db.query('select prm_create_analysis_run($1,$2) as id',[session,'gpt-5-mini'])).rows[0].id;
  await db.query('select * from prm_claim_analysis_run($1)',[worker]);
  const save=async step=>db.query("insert into analysis_steps(run_id,stage,sequence,result,usage) values($1,'extraction',$2,$3::jsonb,$4::jsonb) on conflict(run_id,stage,sequence) do update set result=excluded.result,usage=excluded.usage",[groundedRun,step.sequence,JSON.stringify(step.result),JSON.stringify(step.usage||{})]);
  const grounded=await analyzeEvents(snapshots,{checkpoint:{result:saved},onGroundingAudit:async({sequence,audit})=>save({sequence,result:{grounding_audit:audit},usage:audit.usage}),onCheckpoint:save,call:async options=>{
   if(options.stage==='extract_episode')return {result:{objects:[]}};
   if(['extract_user_reasoning','review_user_reasoning'].includes(options.stage)){
    const evidence=options.inputData.evidence_catalog.find(ref=>ref.event_id===snapshots[3].id&&ref.field==='question');
    return {result:{objects:[{type:'decision',speaker:'user',text:'본문 저장 결정',evidence:[{evidence_id:evidence.evidence_id}]}]}};
   }
   assert.equal(options.stage,'review_evidence_grounding');
   return {result:{items:options.inputData.items.map(item=>({object_index:item.object_index,verdict:'supported',reason:'선택된 사용자 원문에 명시적 결정이 있음'}))}};
  }});
  const groundedSteps=(await db.query("select * from analysis_steps where run_id=$1 and stage='extraction' order by sequence",[groundedRun])).rows;
  assert.equal(groundedSteps[0].result.grounding.version,'evidence-v2');
  assert.equal(groundedSteps[0].result.reasoning_version,'reasoning-v2');
  assert.equal(groundedSteps[0].result.objects[0].semantic_verification,'not_verified');
  const replay=await analyzeEvents(snapshots,{checkpoint:{result:saved},extractionCheckpoints:groundedSteps,call:async()=>{throw Error('no replay request')}});
  assert.deepEqual(replay,grounded);
  assert.equal((await db.query('select prm_finish_analysis_run($1,$2,$3::jsonb) as ok',[groundedRun,worker,JSON.stringify(grounded)])).rows[0].ok,true);
  assert.equal((await db.query('select verification_status from reasoning_objects where run_id=$1',[groundedRun])).rows[0].verification_status,'quote_matched');
  assert.deepEqual((await db.query('select * from analysis_runs where id=$1',[run])).rows[0],previousRun);
  assert.deepEqual((await db.query('select * from events order by client_seq')).rows,originalEvents);
  const policies=(await db.query("select relname,relrowsecurity from pg_class where relname in ('analysis_runs','analysis_inputs','analysis_steps','episodes','episode_event_links','reasoning_objects','object_evidence_links')")).rows;
  assert.ok(policies.every(row=>row.relrowsecurity));
 }finally{await db.close()}
});
