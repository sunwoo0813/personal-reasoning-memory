import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {modelAnswer} from './helpers/summary-model.mjs';
import {processSummaryJob,publicSummary} from '../lib/summary-worker.js';
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/summary-session.json','utf8'));
const entry={text:'주소와 주요 본문부터 저장하기',object_ids:[fixture.episodes[0].reasoning_objects[2].id]};
const result={overview:[entry],topics:[entry],decisions:[entry],open_questions:[],suggestions:[]};
function database(){
 const job={run_id:fixture.id,status:'processing',worker_id:'original',checkpoint:{},usage:{}};
 return {job,from(table){
  let values,filters=[];
  const query={
   update(next){values=next;return query},eq(key,value){filters.push([key,value]);return query},select(){return query},order(){return query},async range(){return {data:[],error:null}},
   async single(){return {data:{...fixture,status:'complete'},error:null}},
   then(resolve,reject){
    return Promise.resolve().then(()=>{
     assert.equal(table,'analysis_summary_jobs');
     if(!filters.every(([key,value])=>job[key]===value))return {data:[],error:null};
     Object.assign(job,structuredClone(values));return {data:[{run_id:job.run_id}],error:null};
    }).then(resolve,reject);
   }
  };return query;
 }};
}
test('worker saves summary independently and exposes no internal checkpoints through public view',async()=>{
 const db=database();
 const status=await processSummaryJob(db,structuredClone(db.job),'original',{call:async options=>{const answer=modelAnswer(options);return {...answer,usage:{total_tokens:4}}}});
 assert.equal(status.status,'complete');assert.equal(db.job.status,'complete');assert.ok(db.job.result.decisions.length);assert.equal(db.job.usage.total_tokens,12);
 const view=publicSummary(db.job);assert.equal(view.checkpoint,undefined);assert.equal(view.worker_id,undefined);assert.equal(view.usage,undefined);
});
test('failed model output preserves diagnostic checkpoint and never creates a successful summary',async()=>{
 const db=database();
 const status=await processSummaryJob(db,structuredClone(db.job),'original',{call:async options=>({...modelAnswer(options),result:options.stage==='summarize_session'?{invalid:true}:modelAnswer(options).result,usage:{total_tokens:2}})});
 assert.equal(status.status,'failed');assert.equal(db.job.status,'failed');assert.equal(db.job.result,undefined);assert.equal(db.job.checkpoint.generation_attempts.length,2);assert.equal(db.job.usage.total_tokens,6);
});
test('a worker that loses ownership cannot overwrite the new owner with result or failure',async()=>{
 const db=database();let calls=0;
 await processSummaryJob(db,structuredClone(db.job),'original',{call:async()=>{calls++;db.job.worker_id='replacement';return {result,usage:{total_tokens:2}}}});
 assert.equal(calls,1);assert.equal(db.job.worker_id,'replacement');assert.equal(db.job.status,'processing');assert.equal(db.job.result,undefined);
});

test('public progress exposes only a known stage and strips internal details',()=>{
 const view=publicSummary({status:'processing',checkpoint:{progress:{stage:'review_session_summary_items',candidate:'private'}}});
 assert.deepEqual(view.progress,{stage:'review_session_summary_items'});assert.equal(view.checkpoint,undefined);
 assert.equal(publicSummary({progress:{stage:'unknown',candidate:'private'}}).progress,null);
});
