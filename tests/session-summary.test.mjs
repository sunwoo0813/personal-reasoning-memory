import test from 'node:test';
import assert from 'node:assert/strict';
import {summaryInput,validateSummary,summarizeRun,validateQuestionStates,validateItemReview,SUMMARY_POLICY_VERSION} from '../lib/session-summary.js';
import {modelAnswer} from './helpers/summary-model.mjs';
const obj=(id,type,speaker,field=speaker==='user'?'question':'response')=>({id,type,speaker,text:'발언 '+id,object_evidence_links:[{id:'e'+id,event_id:'e'+id,field,quote:'원문 '+id}]});
const run={id:'run',model:'test',event_order:[{event_id:'eq',position:1},{event_id:'eu',position:2}],episodes:[{sequence:1,title:'수집 설계',goal:'보존 범위 결정',reasoning_objects:[obj('u','decision','user'),obj('a','hypothesis','assistant'),obj('q','open_question','user'),obj('search','open_question','user','query')]}]};
const entry=(text,...object_ids)=>({text,object_ids});
const good=()=>({overview:[entry('범위를 결정하고 표시 방식은 보류했다.','u','q')],topics:[entry('보존 범위','u')],decisions:[entry('원본부터 보존하기','u')],open_questions:[entry('표시 방식 보류','q')],suggestions:[entry('표시 방식 확인하기','q')]});
test('search-only questions cannot become current open questions and item attribution stays strict',()=>{
 const input=summaryInput(run);validateSummary(good(),input);
 for(const [key,id] of [['open_questions','search'],['open_questions','a'],['decisions','a'],['topics','foreign']]){const bad=good();bad[key]=[entry('잘못된 귀속',id)];assert.throws(()=>validateSummary(bad,input));}
 const duplicate=good();duplicate.topics[0].object_ids=['u','u'];assert.throws(()=>validateSummary(duplicate,input));
});
test('question-state review covers every direct user question and resolution needs later user evidence',()=>{
 const input=summaryInput(run);
 assert.throws(()=>validateQuestionStates({items:[]},input),/누락/);
 validateQuestionStates({items:[{object_id:'q',status:'resolved',reason:'후속 결정',supporting_object_ids:['q','u']}]},input);
 assert.throws(()=>validateQuestionStates({items:[{object_id:'q',status:'resolved',reason:'AI 답변으로 해결',supporting_object_ids:['q','a']}]},input),/사용자/);
 const reversed=summaryInput({...run,event_order:[{event_id:'eq',position:3},{event_id:'eu',position:2}]});
 assert.throws(()=>validateQuestionStates({items:[{object_id:'q',status:'resolved',reason:'이전 결정을 잘못 연결',supporting_object_ids:['q','u']}]},reversed),/이전 발언/);
});
test('per-item rejection repairs only that slot, freezes passing items and replays without new calls',async()=>{
 let saved;const calls=[];
 const answer=await summarizeRun(run,{onCheckpoint:async state=>{saved=state},call:async options=>{
  calls.push(options.stage);const answer=modelAnswer(options);
  if(options.stage==='review_summary_question_states')assert.equal(options.inputData.candidates.length,1);
  if(options.stage==='review_session_summary_items'&&calls.filter(stage=>stage===options.stage).length===1)answer.result.items.find(item=>item.slot==='overview:0').verdict='unsupported';
  if(options.stage==='repair_session_summary_items')assert.deepEqual(options.inputData.issues.map(item=>item.slot),['overview:0']);
  return answer;
 }});
 assert.equal(calls.filter(stage=>stage==='summarize_session').length,1);
 assert.equal(calls.filter(stage=>stage==='repair_session_summary_items').length,1);
 assert.equal(answer.result.overview[0].text,'교정된 내용');
 for(const key of ['topics','decisions','open_questions','suggestions'])assert.deepEqual(answer.result[key],saved.attempts[0].candidate[key]);
 assert.equal(saved.attempts[1].review.result.items.length,1);
 const replay=await summarizeRun(run,{checkpoint:saved,call:async()=>{throw Error('no calls')}});assert.deepEqual(replay.result,answer.result);
});
test('malformed item coverage and uncertain reviews fail closed',async()=>{
 assert.throws(()=>validateItemReview({items:[{slot:'overview:0',verdict:'supported',reason:'한 항목만'}]},['overview:0','decisions:0']),/누락/);
 let repairs=0;
 await assert.rejects(()=>summarizeRun(run,{call:async options=>{const answer=modelAnswer(options);if(options.stage==='review_session_summary_items')answer.result.items.forEach(item=>{item.verdict='uncertain'});if(options.stage==='repair_session_summary_items')repairs++;return answer}}),/요약 항목 검증 실패/);
 assert.equal(repairs,1);
});
test('repair cannot change a passing slot or silently drop a rejected item',async()=>{
 await assert.rejects(()=>summarizeRun(run,{call:async options=>{
  const answer=modelAnswer(options);
  if(options.stage==='review_session_summary_items')answer.result.items.find(item=>item.slot==='overview:0').verdict='unsupported';
  if(options.stage==='repair_session_summary_items')answer.result.items.push({slot:'decisions:0',item:entry('통과 항목 변경','u')});
  return answer;
 }}),/실패한 항목만/);
});
test('most recent explicit open question must drive the first suggestion even when old advice exists',async()=>{
 const extended=structuredClone(run);extended.episodes[0].reasoning_objects.push(obj('latest','open_question','user'));extended.event_order.push({event_id:'elatest',position:9});
 const answer=await summarizeRun(extended,{call:async options=>{
  const answer=modelAnswer(options);
  if(options.stage==='summarize_session'){
   const required=options.inputData.required_open_ids;assert.equal(required.length,2);
   answer.result.open_questions=required.map(id=>entry('명시적 보류 질문',id));
   answer.result.suggestions=[entry('과거 개발 권고 반복',required[1])];
  }
  if(options.stage==='repair_session_summary_items')answer.result.items=options.inputData.issues.map(issue=>({slot:issue.slot,item:entry('최신 질문 판단을 위한 사용자 테스트',options.inputData.required_open_ids[0])}));
  return answer;
 }});
 assert.deepEqual(answer.result.suggestions[0].object_ids,['latest']);
});
test('generation checkpoints resume after interruption and changed reviewed candidates are rejected',async()=>{
 let checkpoint;
 await assert.rejects(()=>summarizeRun(run,{call:modelAnswer,onCheckpoint:async state=>{checkpoint=state;if(state.attempts.length&&!state.attempts[0].review)throw Error('interrupted')}}),/interrupted/);
 const stages=[];
 const completed=await summarizeRun(run,{checkpoint,call:async options=>{stages.push(options.stage);return modelAnswer(options)}});
 assert.deepEqual(stages,['review_session_summary_items']);
 const modified=structuredClone(completed.checkpoint);modified.attempts[0].candidate.overview[0].text='검토 후 변경';
 await assert.rejects(()=>summarizeRun(run,{checkpoint:modified,call:modelAnswer}),/검토 이후/);
 await assert.rejects(()=>summarizeRun({...run,id:'different'},{checkpoint:completed.checkpoint}),/일치하지/);
 assert.equal(completed.checkpoint.policy_version,SUMMARY_POLICY_VERSION);assert.ok(completed.checkpoint.calls.every(call=>call.duration_ms>=0));
});
test('short IDs round-trip while original quote text is untouched, and old in-flight checkpoints keep their original policy',async()=>{
 const literal=structuredClone(run);literal.episodes[0].reasoning_objects.find(obj=>obj.id==='q').object_evidence_links[0].quote='u';
 await summarizeRun(literal,{call:async options=>{
  if(options.stage==='review_summary_question_states'){assert.match(options.inputData.candidates[0].id,/^O\d+$/);assert.equal(options.inputData.candidates[0].evidence[0].quote,'u')}
  return modelAnswer(options);
 }});
 const legacy=await import('../lib/session-summary-legacy.js');let checkpoint;
 await legacy.summarizeRun(run,{onCheckpoint:async state=>{checkpoint=state},call:async options=>({result:options.stage==='summarize_session'?good():{supported:true,reason:'legacy support'}})});
 const replay=await summarizeRun(run,{checkpoint,call:async()=>{throw Error('legacy replay has no calls')}});
 assert.deepEqual(replay.result,good());assert.equal(replay.checkpoint.policy_version,undefined);
});
test('empty inputs bypass the model and oversized inputs are never truncated',async()=>{
 const empty={...run,episodes:[]};const answer=await summarizeRun(empty,{call:async()=>{throw Error('no call')}});assert.ok(Object.values(answer.result).every(items=>items.length===0));
 const oversized=structuredClone(run);oversized.episodes[0].reasoning_objects[0].text='x'.repeat(240000);
 await assert.rejects(()=>summarizeRun(oversized,{call:modelAnswer}),/한도/);
});

test('oversized state-review enums fail explicitly before any model request',async()=>{
 const many={id:'many',model:'test',episodes:[{sequence:1,title:'많은 질문',goal:'검토 한도',reasoning_objects:Array.from({length:426},(_,index)=>obj('question-'+index,'question','user'))}]};
 await assert.rejects(()=>summarizeRun(many,{call:async()=>{throw Error('must not call model')}}),/근거 ID 합계 850개/);
});
