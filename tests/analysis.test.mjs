import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyzeEvents as analyzeWithPurposeReview,validateSegments,segmentsFromBoundaries,validateObjects,restoreQuoteWhitespace,structuredCall,inputHash} from '../lib/analysis.js';
// These existing tests isolate extraction/retry behavior; purpose-policy tests
// exercise the independent review and boundary failures in segmentation.test.mjs.
function analyzeEvents(source,options){
 return analyzeWithPurposeReview(source,{...options,groundingVersion:'legacy-v1',call:async request=>{
  if(request.stage!=='review_session_purposes')return options.call(request);
  const questions=source.flatMap((e,index)=>e.event_type==='llm_exchange'&&e.event_contents?.content_jsonb?.question?[{event_index:index+1,relation:'continuation',purpose:'기존 테스트의 조사 목적',quote:e.event_contents.content_jsonb.question,context_start_event_index:index+1}]:[]);
  if(questions.length)questions[0].relation='initial';
  return {result:{questions},usage:{}};
 }});
}
const events=JSON.parse(fs.readFileSync('tests/fixtures/research-session.json','utf8'));
const segment={episodes:[{title:'본문 저장 결정',goal:'당시 자료 보존',boundary_reason:'수집 대상 논의',event_ids:events.map(e=>e.id)}]};
const boundary=(end)=>({title:'구간',goal:'목적',boundary_reason:'주제 변경',end_event_index:end});
const item={type:'decision',speaker:'user',text:'본문과 수집 시각을 저장하기로 결정',evidence:[{event_id:events[3].id,field:'question',quote:'주요 본문과 수집 시각을 먼저 저장하는 방식으로 결정할게.'}]};
test('rejects missing, duplicate, reordered and foreign episode assignments',()=>{
 for(const ids of [events.slice(1).map(e=>e.id),[events[0].id,...events.map(e=>e.id)],[...events.map(e=>e.id)].reverse(),['other']])assert.throws(()=>validateSegments({episodes:[{...segment.episodes[0],event_ids:ids}]},events));
 assert.equal(validateSegments(segment,events).length,1);
});
test('assigns every original event once using inclusive model boundaries',()=>{
 const result=segmentsFromBoundaries({episodes:[boundary(2),boundary(events.length)]},events);
 assert.deepEqual(result.episodes.map(ep=>ep.event_ids),[events.slice(0,2).map(e=>e.id),events.slice(2).map(e=>e.id)]);
 assert.equal(validateSegments(result,events).length,2);
});
test('rejects missing, repeated, reversed, fractional and out-of-range boundaries',()=>{
 for(const ends of [[],[0,events.length],[2,2,events.length],[3,2,events.length],[1.5,events.length],['2',events.length],[events.length+1],[events.length-1]]){
  assert.throws(()=>segmentsFromBoundaries({episodes:ends.map(boundary)},events));
 }
});
test('rejects fabricated quotes, wrong field, cross-episode sources and assistant decisions',()=>{
 assert.equal(validateObjects({objects:[item]},events).length,1);
 assert.throws(()=>validateObjects({objects:[{...item,evidence:[{...item.evidence[0],quote:'없는 문장'}]}]},events));
 assert.throws(()=>validateObjects({objects:[item]},events.slice(0,3)));
 assert.throws(()=>validateObjects({objects:[{...item,speaker:'assistant'}]},events));
 assert.throws(()=>validateObjects({objects:[{...item,evidence:[{event_id:events[4].id,field:'response',quote:'제안합니다.'}]}]},events));
});
test('runs segmentation and extraction with verifiable evidence and resumes saved steps',async()=>{
 let calls=0;const checkpoints=[];
 const call=async()=>({result:++calls===1?{episodes:[{...boundary(events.length),title:segment.episodes[0].title}]}:{objects:[item]},usage:{input_tokens:1}});
 const result=await analyzeEvents(events,{call,onCheckpoint:async step=>checkpoints.push(step)});
 assert.equal(calls,2);assert.equal(result.episodes[0].objects[0].speaker,'user');
 assert.deepEqual(checkpoints[0].result.episodes[0].event_ids,events.map(event=>event.id));
 const replay=await analyzeEvents(events,{call:async()=>{throw Error('should resume')},checkpoint:checkpoints[0],extractionCheckpoints:[checkpoints[1]]});
 assert.deepEqual(replay,result);
 assert.notEqual(inputHash(events),inputHash(events.slice(1)));
});
test('uses strict structured outputs, excludes external tools, and rejects incomplete or refused responses',async()=>{
 let payload;
 const fetchImpl=async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(segment)}]}]})}};
 const options={stage:'segment_session',schema:{type:'object'},instructions:'test',events,apiKey:'test',fetchImpl};
 assert.deepEqual((await structuredCall(options)).result,segment);
 assert.equal(payload.store,false);assert.equal(payload.text.format.strict,true);assert.equal(payload.tools,undefined);
 assert.deepEqual(JSON.parse(payload.input).map(event=>event.event_index),events.map((_,index)=>index+1));
 await assert.rejects(()=>structuredCall({...options,fetchImpl:async()=>({ok:true,json:async()=>({status:'incomplete'})})}),/완료되지/);
 await assert.rejects(()=>structuredCall({...options,fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'refusal'}]}]})})}),/거절/);
});
test('retries invalid model outputs with feedback and checkpoints only validated results',async()=>{
 const checkpoints=[];let segments=0,extractions=0;
 const result=await analyzeEvents(events,{onCheckpoint:async step=>checkpoints.push(step),call:async options=>{
  if(options.stage==='segment_session'){
   segments++;
   if(segments>1)assert.match(options.instructions,/previous candidate failed validation/);
   return {result:{episodes:[boundary(segments===1?events.length-1:events.length)]},usage:{input_tokens:2}};
  }
  extractions++;
  assert.deepEqual(options.schema.properties.objects.items.properties.evidence.items.properties.event_id.enum,events.map(event=>event.id));
  assert.deepEqual(options.schema.properties.objects.items.properties.evidence.items.properties.quote,{type:'string'});
  assert.deepEqual(options.schema.properties.objects.items.properties.text,{type:'string'});
  if(extractions>1)assert.match(options.instructions,/previous candidate failed validation/);
  return {result:{objects:[extractions===1?{...item,evidence:[{...item.evidence[0],quote:'fabricated quote'}]}:item]},usage:{input_tokens:3}};
 }});
 assert.equal(segments,2);assert.equal(extractions,2);
 assert.equal(checkpoints.length,2);
 assert.equal(checkpoints[0].usage.input_tokens,4);assert.equal(checkpoints[1].usage.input_tokens,6);
 assert.deepEqual(result.episodes[0].objects,[item]);
});
test('stops after three invalid candidates without saving a false success',async()=>{
 let calls=0;const checkpoints=[];
 await assert.rejects(()=>analyzeEvents(events,{onCheckpoint:async step=>checkpoints.push(step),call:async()=>{
  calls++;return {result:{episodes:[boundary(events.length-1)]}};
 }}),/전체 이벤트/);
 assert.equal(calls,3);assert.equal(checkpoints.length,0);
});
test('persistent invalid evidence remains a failure after bounded correction attempts',async()=>{
 let calls=0;const checkpoints=[];
 await assert.rejects(()=>analyzeEvents(events,{onCheckpoint:async step=>checkpoints.push(step),call:async options=>{
  if(options.stage==='segment_session')return {result:{episodes:[boundary(events.length)]}};
  calls++;return {result:{objects:[{...item,speaker:'assistant'}]}};
 }}),/발화 주체/);
 assert.equal(calls,3);assert.equal(checkpoints.length,1);assert.equal(checkpoints[0].stage,'segmentation');
});
test('keeps metadata-only visits assigned without inventing reasoning from their titles',async()=>{
 const source=[{...events[0],event_type:'page_view',event_contents:{content_jsonb:{title:'metadata only'}}},{...events[1],event_contents:null},events[3]];
 const checkpoints=[];let calls=0;
 const result=await analyzeEvents(source,{onCheckpoint:async step=>checkpoints.push(step),call:async options=>{
  calls++;
  if(options.stage==='segment_session')return {result:{episodes:[boundary(3)]}};
  assert.deepEqual(options.events,[events[3]]);
  return {result:{objects:[item]}};
 }});
 assert.equal(calls,2);
 assert.deepEqual(result.episodes[0].event_ids,source.map(e=>e.id));
 assert.deepEqual(result.episodes[0].objects,[item]);
 assert.equal(checkpoints.length,2);
});
test('restores source whitespace before strict quote validation without changing words',()=>{
 const original='자료의\n\n원문을\t  저장합니다. 😀';
 const source=[{id:'a',event_type:'page_view',event_contents:{content_jsonb:{text:original}}}];
 const candidate={objects:[{type:'evidence',speaker:'source',text:'본문 보존',evidence:[{event_id:'a',field:'text',quote:'자료의 원문을 저장합니다. 😀'}]}]};
 const restored=restoreQuoteWhitespace(candidate,source);
 assert.equal(restored.objects[0].evidence[0].quote,original);
 assert.equal(candidate.objects[0].evidence[0].quote,'자료의 원문을 저장합니다. 😀');
 assert.equal(validateObjects(restored,source).length,1);
 for(const quote of ['자료의 원문을 보존합니다. 😀','자료의 원문을 저장합니다! 😀']){
  const invalid=structuredClone(candidate);invalid.objects[0].evidence[0].quote=quote;
  assert.throws(()=>validateObjects(restoreQuoteWhitespace(invalid,source),source));
 }
});
test('does not guess a whitespace match when multiple source spans qualify',()=>{
 const source=[{id:'a',event_type:'page_view',event_contents:{content_jsonb:{text:'원문\n보존 / 원문\t보존'}}}];
 const candidate={objects:[{type:'evidence',speaker:'source',text:'보존',evidence:[{event_id:'a',field:'text',quote:'원문 보존'}]}]};
 assert.throws(()=>validateObjects(restoreQuoteWhitespace(candidate,source),source));
});
