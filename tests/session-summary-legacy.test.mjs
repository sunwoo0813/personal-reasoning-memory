import test from 'node:test';
import assert from 'node:assert/strict';
import {summaryInput,validateSummary,summarizeRun} from '../lib/session-summary-legacy.js';
const object=(id,type,speaker)=>({id,type,speaker,text:id,object_evidence_links:[{id:'e'+id,event_id:'event',field:speaker==='user'?'question':'response',quote:id}]});
const run={id:'run',model:'test',episodes:[{sequence:1,title:'수집 설계',goal:'수집 범위 결정',reasoning_objects:[object('u','decision','user'),object('a','hypothesis','assistant'),object('q','open_question','user')]}]};
const entry=(text,...object_ids)=>({text,object_ids});
const good=()=>({overview:[entry('수집 범위를 검토했다.','u','q')],topics:[entry('수집 설계','u')],decisions:[entry('수집 범위를 결정했다.','u')],open_questions:[entry('추가 확인이 필요하다.','q')],suggestions:[entry('남은 질문을 확인해보세요.','q')]});
test('summary accepts linked user decisions and rejects cross-run, AI decisions and fabricated open questions',()=>{
 const input=summaryInput(run);validateSummary(good(),input);
 for(const [key,id] of [['topics','other-run'],['decisions','a'],['open_questions','a'],['open_questions','u']]){
  const bad=good();bad[key]=[entry('잘못된 귀속',id)];assert.throws(()=>validateSummary(bad,input));
 }
 const bad=good();bad.topics=Array(6).fill(entry('많음','u'));assert.throws(()=>validateSummary(bad,input));
 const noRefs=good();noRefs.overview[0].object_ids=[];assert.throws(()=>validateSummary(noRefs,input));
});
test('review rejects semantic overstatement, repairs once, and reuses completed checkpoints without model calls',async()=>{
 let generations=0,reviews=0,saved;
 const answer=await summarizeRun(run,{onCheckpoint:async state=>{saved=state},call:async options=>{
  if(options.stage==='summarize_session'){generations++;return {result:good(),usage:{input_tokens:10,total_tokens:12}}}
  reviews++;return {result:{supported:reviews>1,reason:reviews>1?'사용자 발언에 근거함':'결정 표현이 과장됨'},usage:{total_tokens:8}};
 }});
 assert.equal(generations,2);assert.equal(reviews,2);assert.equal(answer.usage.total_tokens,40);
 assert.equal(saved.attempts[0].error,'결정 표현이 과장됨');
 const replay=await summarizeRun(run,{checkpoint:saved,call:async()=>{throw Error('must not regenerate')}});
 assert.deepEqual(replay.result,answer.result);assert.deepEqual(replay.usage,answer.usage);
});
test('interrupted review resumes saved generation and input mismatch is rejected',async()=>{
 let checkpoint;
 await assert.rejects(()=>summarizeRun(run,{onCheckpoint:async state=>{checkpoint=state;throw Error('interrupted')},call:async()=>({result:good(),usage:{total_tokens:3}})}),/interrupted/);
 let calls=0;
 const result=await summarizeRun(run,{checkpoint,call:async options=>{calls++;assert.equal(options.stage,'review_session_summary');return {result:{supported:true,reason:'근거 있음'},usage:{total_tokens:2}}}});
 assert.equal(calls,1);assert.equal(result.usage.total_tokens,5);
 await assert.rejects(()=>summarizeRun({...run,id:'another-run'},{checkpoint}),/일치하지/);
});
test('empty extraction needs no model call and does not invent a recap',async()=>{
 const empty={...run,episodes:[{...run.episodes[0],reasoning_objects:[]}]};
 const answer=await summarizeRun(empty,{call:async()=>{throw Error('no call')}});
 assert.ok(Object.values(answer.result).every(items=>items.length===0));
});
test('summary fails after one repair and does not truncate oversized input',async()=>{
 let calls=0;
 await assert.rejects(()=>summarizeRun(run,{call:async()=>{calls++;const invalid=good();invalid.decisions[0].object_ids=['a'];return {result:invalid}}}),/요약 검증 실패/);
 assert.equal(calls,2);
 const oversized=structuredClone(run);oversized.episodes[0].reasoning_objects[0].text='x'.repeat(240000);
 await assert.rejects(()=>summarizeRun(oversized,{call:async()=>{throw Error('not called')}}),/한도/);
});
