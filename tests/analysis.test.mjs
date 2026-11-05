import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyzeEvents,validateSegments,validateObjects,structuredCall,inputHash} from '../lib/analysis.js';
const events=JSON.parse(fs.readFileSync('tests/fixtures/research-session.json','utf8'));
const segment={episodes:[{title:'본문 저장 결정',goal:'당시 자료 보존',boundary_reason:'수집 대상 논의',event_ids:events.map(e=>e.id)}]};
const item={type:'decision',speaker:'user',text:'본문과 수집 시각을 저장하기로 결정',evidence:[{event_id:events[3].id,field:'question',quote:'주요 본문과 수집 시각을 먼저 저장하는 방식으로 결정할게.'}]};
test('rejects missing, duplicate, reordered and foreign episode assignments',()=>{
 for(const ids of [events.slice(1).map(e=>e.id),[events[0].id,...events.map(e=>e.id)],[...events.map(e=>e.id)].reverse(),['other']])assert.throws(()=>validateSegments({episodes:[{...segment.episodes[0],event_ids:ids}]},events));
 assert.equal(validateSegments(segment,events).length,1);
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
 const call=async()=>({result:++calls===1?segment:{objects:[item]},usage:{input_tokens:1}});
 const result=await analyzeEvents(events,{call,onCheckpoint:async step=>checkpoints.push(step)});
 assert.equal(calls,2);assert.equal(result.episodes[0].objects[0].speaker,'user');
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
 await assert.rejects(()=>structuredCall({...options,fetchImpl:async()=>({ok:true,json:async()=>({status:'incomplete'})})}),/완료되지/);
 await assert.rejects(()=>structuredCall({...options,fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'refusal'}]}]})})}),/거절/);
});
