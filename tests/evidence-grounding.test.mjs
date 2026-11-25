import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeEvents,eventFields,inputHash,validateObjects,EXTRACT_SCHEMA} from '../lib/analysis.js';
import {buildEvidenceCatalog,assertEvidenceSpan,resolveEvidenceObject,groundEpisode,validateGroundingCheckpoint,groundingSchema} from '../lib/evidence-grounding.js';

const event=(id,content,type='llm_exchange')=>({id,event_type:type,event_contents:{content_jsonb:content},metadata:{}});
const events=[event('a',{question:'Supabase를 메인 데이터 저장소로 결정할게. 😀',response:'IndexedDB만으로 시작하는 것이 합리적이야.'}),event('b',{text:'자료 원문입니다. 조건이 있을 수 있습니다.'},'page_view')];
const catalog=buildEvidenceCatalog(events);
const unit=(field,id='a')=>catalog.units.find(unit=>unit.field===field&&unit.event_id===id);
const candidate=(id=unit('question').evidence_id)=>({type:'decision',speaker:'user',text:'Supabase를 메인 저장소로 선택한다.',evidence:[{evidence_id:id}]});
const supported=options=>({result:{items:options.inputData.items.map(item=>({object_index:item.object_index,verdict:'supported',reason:'선택된 사용자 원문이 해석을 직접 뒷받침함'}))}});
async function run(objects,{handler=async()=>null,onAudit=async()=>{},source=events}={}){
 return groundEpisode({events:source,legacySchema:EXTRACT_SCHEMA,validateObjects,snapshotHash:inputHash(source),instructions:'Existing classification policy unchanged.',onAudit,
  call:async options=>await handler(options)||(options.stage==='extract_episode'?{result:{objects}}:supported(options))});
}

test('selecting evidence retrieves the original ending and rejects a model-rewritten quote',()=>{
 const item={type:'insight',speaker:'assistant',text:'로컬 저장으로 시작하는 방안',evidence:[{evidence_id:unit('response').evidence_id}]};
 const resolved=resolveEvidenceObject(item,catalog,events);
 assert.match(resolved.evidence[0].quote,/합리적이야/);
 const fabricated=structuredClone(resolved);fabricated.evidence[0].quote=fabricated.evidence[0].quote.replace('합리적이야','합리적이다');
 assert.throws(()=>validateObjects({objects:[fabricated]},events));
 assert.throws(()=>resolveEvidenceObject({...item,evidence:[{evidence_id:unit('response').evidence_id,quote:'합리적이다'}]},catalog,events),{code:'evidence_schema'});
});

test('source spaces remain literal and removed spaces are not accepted as quotations',()=>{
 const resolved=resolveEvidenceObject(candidate(),catalog,events),ref=resolved.evidence[0];
 assert.match(ref.quote,/메인 데이터/);assert.equal(ref.quote,eventFields(events[0]).question.slice(ref.start,ref.end));
 assert.throws(()=>assertEvidenceSpan({...ref,quote:ref.quote.replace('메인 데이터','메인데이터')},events),{code:'quote_mismatch'});
});

test('mixed Korean, English, emoji and combining marks use half-open UTF-16 offsets',()=>{
 const text=('한글 😀 e\u0301 / API > 0; special <>&. ').repeat(45),source=[event('unicode',{text},'page_view')];
 const chunks=buildEvidenceCatalog(source).units;
 assert.ok(chunks.length>1);assert.equal(chunks.map(unit=>unit.quote).join(''),text);
 for(const ref of chunks){assert.equal(ref.quote,text.slice(ref.start,ref.end));assert.doesNotThrow(()=>assertEvidenceSpan(ref,source));assert.equal(ref.offset_unit,'utf16_code_units');}
 const emoji=text.indexOf('😀');assert.throws(()=>assertEvidenceSpan({...chunks[0],start:emoji+1},source),{code:'invalid_span'});
 for(const span of [{start:-1,end:3},{start:0,end:99999},{start:2,end:1},{start:0.5,end:3}])assert.throws(()=>assertEvidenceSpan({...chunks[0],...span},source),{code:'invalid_span'});
});

test('identical paragraphs retain distinct evidence identities and positions',()=>{
 const source=[event('repeat',{text:'반복 문장입니다.\n\n반복 문장입니다.\n\n'},'page_view')],c=buildEvidenceCatalog(source);
 assert.equal(c.units.length,2);assert.equal(c.units[0].quote,c.units[1].quote);assert.notEqual(c.units[0].evidence_id,c.units[1].evidence_id);
 const resolved=resolveEvidenceObject({type:'evidence',speaker:'source',text:'반복된 문장',evidence:[{evidence_id:c.units[1].evidence_id}]},c,source);
 assert.equal(resolved.evidence[0].start,c.units[1].start);assert.ok(resolved.evidence[0].start>0);
});

test('unknown event, missing field, empty span and hallucinated evidence ID are rejected',()=>{
 const ref=unit('question');
 assert.throws(()=>assertEvidenceSpan({...ref,event_id:'foreign'},events),{code:'unknown_event'});
 assert.throws(()=>assertEvidenceSpan({...ref,field:'absent'},events),{code:'unknown_field'});
 assert.throws(()=>resolveEvidenceObject(candidate('invented'),catalog,events),{code:'unknown_evidence_id'});
 assert.throws(()=>assertEvidenceSpan({...ref,start:0,end:1,quote:' '},[event('a',{question:'  '})]),{code:'empty_evidence'});
 assert.throws(()=>buildEvidenceCatalog([events[0],events[0]]),{code:'catalog_source'});
});

test('multiple distinct source spans are preserved without synthesized quotations',async()=>{
 const source=[event('multi',{question:'첫 번째 근거입니다.\n\n두 번째 근거입니다.'})],c=buildEvidenceCatalog(source);
 const result=await run([{type:'hypothesis',speaker:'user',text:'두 근거를 검토하는 가설',evidence:c.units.map(ref=>({evidence_id:ref.evidence_id}))}],{source});
 assert.equal(result.result.objects[0].evidence.length,2);
 for(const ref of result.result.objects[0].evidence)assertEvidenceSpan(ref,source);
 assert.equal(result.result.objects[0].semantic_verification,'not_verified');
 assert.equal(result.result.objects[0].grounding_review.status,'model_supported');
});

test('repairs only invalid object slots while freezing successful objects and their reviews',async()=>{
 const good=candidate(),bad={type:'evidence',speaker:'source',text:'자료 원문',evidence:[{evidence_id:'invented'}]};
 const reviewed=[],audits=[];let repairs=0;
 const response=await run([good,bad],{onAudit:async audit=>audits.push(audit),handler:async options=>{
  if(options.stage==='review_evidence_grounding')reviewed.push(options.inputData.items.map(item=>item.object_index));
  if(options.stage==='repair_evidence_objects'){
   repairs++;assert.deepEqual(options.inputData.invalid_objects.map(item=>item.object_index),[2]);
   return {result:{repairs:[{object_index:2,object:{...bad,evidence:[{evidence_id:unit('text','b').evidence_id}]}}]}};
  }
 }});
 assert.equal(repairs,1);assert.deepEqual(reviewed,[[1],[2]]);
 assert.equal(response.result.objects[0].text,good.text);assert.equal(response.result.objects[1].text,bad.text);
 assert.equal(audits.at(-1).accepted_count,2);assert.equal(audits.at(-1).error_counts.unknown_evidence_id,1);
 const firstGood=audits.find(audit=>audit.validated_candidates.length)?.validated_candidates[0].object;
 assert.deepEqual(firstGood,response.result.objects[0]);
});

test('speaker errors are repaired locally using the existing authorship policy',async()=>{
 const bad={type:'insight',speaker:'user',text:'로컬 시작 제안',evidence:[{evidence_id:unit('response').evidence_id}]};
 let issue;
 const response=await run([bad],{handler:async options=>{
  if(options.stage==='repair_evidence_objects'){issue=options.inputData.invalid_objects[0].errors[0].code;return {result:{repairs:[{object_index:1,object:{...bad,speaker:'assistant'}}]}};}
 }});
 assert.equal(issue,'speaker_mismatch');assert.equal(response.result.objects[0].speaker,'assistant');
});

test('hallucinated evidence is never accepted after two bounded repairs',async()=>{
 let repairCalls=0,last;
 await assert.rejects(()=>run([candidate('does-not-exist')],{onAudit:async audit=>{last=audit},handler:async options=>{
  if(options.stage==='repair_evidence_objects'){repairCalls++;return {result:{repairs:[{object_index:1,object:candidate('still-invented')}]}};}
 }}),error=>{assert.equal(error.code,'unresolved_objects');assert.equal(error.audit.status,'failed');return true});
 assert.equal(repairCalls,2);assert.equal(last.accepted_count,0);assert.equal(last.validated_count,0);assert.equal(last.error_counts.unknown_evidence_id,3);
});

test('verbatim but unrelated or opposite interpretations require support review and can fail',async()=>{
 const source=[event('negation',{question:'아직 Supabase를 선택하지 않았어.'})],c=buildEvidenceCatalog(source);
 const item={type:'decision',speaker:'user',text:'Supabase를 사용하기로 확정했다.',evidence:[{evidence_id:c.units[0].evidence_id}]};
 const literal=resolveEvidenceObject(item,c,source);
 assert.doesNotThrow(()=>validateObjects({objects:[literal]},source));
 let last;
 await assert.rejects(()=>run([item],{source,onAudit:async audit=>{last=audit},handler:async options=>{
  if(options.stage==='review_evidence_grounding')return {result:{items:options.inputData.items.map(row=>({object_index:row.object_index,verdict:'unsupported',reason:'원문은 미선택인데 객체는 확정을 주장한다.'}))}};
  if(options.stage==='repair_evidence_objects')return {result:{repairs:[{object_index:1,object:item}]}};
 }}),{code:'unresolved_objects'});
 assert.equal(last.error_counts.unsupported_interpretation,3);assert.equal(last.accepted_count,0);
});

test('uncertain support is not silently promoted to semantic verification',async()=>{
 await assert.rejects(()=>run([candidate()],{handler:async options=>{
  if(options.stage==='review_evidence_grounding')return {result:{items:[{object_index:1,verdict:'uncertain',reason:'근거가 충분한지 확인할 수 없음'}]}};
  if(options.stage==='repair_evidence_objects')return {result:{repairs:[{object_index:1,object:candidate()}]}};
 }}),error=>{assert.equal(error.audit.error_counts.alignment_uncertain,3);return true});
});

test('empty evidence is a local error and not a reason to regenerate valid siblings',async()=>{
 let generations=0;
 const result=await run([candidate(),{...candidate(),evidence:[]}],{handler:async options=>{
  if(options.stage==='extract_episode')generations++;
  if(options.stage==='repair_evidence_objects')return {result:{repairs:[{object_index:2,object:candidate()}]}};
 }});
 assert.equal(generations,1);assert.equal(result.result.objects.length,2);
});

test('repair output cannot alter a frozen successful object or drop a failed slot',async()=>{
 const bad=candidate('bad');let last;
 await assert.rejects(()=>run([candidate(),bad],{onAudit:async audit=>{last=audit},handler:async options=>{
  if(options.stage==='repair_evidence_objects')return {result:{repairs:[{object_index:1,object:{...candidate(),text:'바뀌면 안 되는 문장'}}]}};
 }}),{code:'unresolved_objects'});
 assert.equal(last.error_counts.repair_schema,2);assert.equal(last.validated_count,1);assert.equal(last.accepted_count,0);
 assert.equal(last.validated_candidates[0].object.text,candidate().text);
});

test('malformed top-level output is retried once, distinct from object repairs',async()=>{
 let generations=0,last;
 const result=await run([candidate()],{onAudit:async audit=>{last=audit},handler:async options=>{
  if(options.stage==='extract_episode')return {result:++generations===1?{objects:'bad'}:{objects:[candidate()]}};
 }});
 assert.equal(generations,2);assert.equal(last.error_counts.output_schema,1);assert.equal(last.repair_rounds,0);assert.equal(result.result.objects.length,1);
});

test('malformed relevance reviews fail closed after a format retry',async()=>{
 let reviews=0;
 await assert.rejects(()=>run([candidate()],{handler:async options=>{
  if(options.stage==='review_evidence_grounding'){reviews++;return {result:{items:[null]}};}
 }}),{code:'review_schema'});
 assert.equal(reviews,2);
});

test('v2 checkpoints resume without model calls and reject changes after review',async()=>{
 const episode={title:'저장소',goal:'저장소 결정',boundary_reason:'동일 목적',event_ids:events.map(event=>event.id)};
 const checkpoint={result:{episodes:[episode]}},saved=[],audits=[];
 const result=await analyzeEvents(events,{reasoningVersion:'reasoning-v1',checkpoint,onCheckpoint:async step=>saved.push(step),onGroundingAudit:async trace=>audits.push(trace),call:async options=>options.stage==='extract_episode'?{result:{objects:[candidate()]}}:supported(options)});
 assert.equal(saved.length,1);assert.equal(audits.at(-1).audit.status,'complete');
 const replay=await analyzeEvents(events,{reasoningVersion:'reasoning-v1',checkpoint,extractionCheckpoints:saved,call:async()=>{throw Error('no replay call')},onCheckpoint:async()=>{throw Error('no overwrite')}});
 assert.deepEqual(replay,result);
 const tampered=structuredClone(saved);tampered[0].result.objects[0].text='검토되지 않은 해석';
 await assert.rejects(()=>analyzeEvents(events,{reasoningVersion:'reasoning-v1',checkpoint,extractionCheckpoints:tampered}),{code:'checkpoint_review'});
 const changed=structuredClone(events);changed[0].event_contents.content_jsonb.question+=' 변경';
 assert.throws(()=>validateGroundingCheckpoint(saved[0].result,changed,validateObjects,inputHash(changed)),{code:'checkpoint_input'});
});

test('an interrupted audit is not a completed checkpoint or an unlimited restart budget',async()=>{
 const checkpoint={result:{episodes:[{title:'검토',goal:'검토',boundary_reason:'검토',event_ids:events.map(event=>event.id)}]}};
 await assert.rejects(()=>analyzeEvents(events,{reasoningVersion:'reasoning-v1',checkpoint,extractionCheckpoints:[{sequence:0,result:{grounding_audit:{status:'processing'}}}],call:async()=>{throw Error('must not retry')}}),{code:'incomplete_checkpoint'});
});

test('failed candidates do not produce an extraction checkpoint or complete result',async()=>{
 const saved=[],audits=[];
 await assert.rejects(()=>analyzeEvents(events,{reasoningVersion:'reasoning-v1',checkpoint:{result:{episodes:[{title:'검토',goal:'검토',boundary_reason:'검토',event_ids:events.map(event=>event.id)}]}},onCheckpoint:async step=>saved.push(step),onGroundingAudit:async trace=>audits.push(trace),call:async options=>{
  if(options.stage==='extract_episode')return {result:{objects:[candidate(),candidate('bad')]}};
  if(options.stage==='repair_evidence_objects')return {result:{repairs:[{object_index:2,object:candidate('bad')}]}};
  return supported(options);
 }}),{code:'unresolved_objects'});
 assert.deepEqual(saved,[]);assert.equal(audits.at(-1).audit.status,'failed');assert.equal(audits.at(-1).audit.validated_count,1);assert.equal(audits.at(-1).audit.accepted_count,0);
});
test('speaker-aware output constraints encode existing rules without changing object types',()=>{
 const schema=groundingSchema(EXTRACT_SCHEMA,catalog),variants=schema.properties.objects.items.anyOf;
 for(const variant of variants){
  const speaker=variant.properties.speaker.enum[0],ids=variant.properties.evidence.items.properties.evidence_id.enum;
  for(const id of ids)assert.ok(speaker==='unknown'||catalog.units.find(unit=>unit.evidence_id===id).source_speaker===speaker);
  assert.equal(variant.properties.type.enum.includes('decision'),speaker==='user');
  assert.ok(variant.properties.type.enum.includes('hypothesis'));assert.ok(variant.properties.type.enum.includes('open_question'));
 }
 assert.throws(()=>groundingSchema(EXTRACT_SCHEMA,{units:Array.from({length:851},(_,i)=>({evidence_id:'G'+i}))}),{code:'catalog_limit'});
 const large={units:Array.from({length:431},(_,i)=>({evidence_id:'G'+i,source_speaker:'user'}))};
 assert.equal(groundingSchema(EXTRACT_SCHEMA,large).properties.objects.items.properties.evidence.items.properties.evidence_id.enum.length,431);
});
test('a recorded question or hypothesis need not be answered or proven true to be grounded',async()=>{
 const source=[event('speech',{question:'미확정 가설: 로컬만으로 충분할 수 있어. 검증 방법은 무엇일까?'})],c=buildEvidenceCatalog(source);
 const refs=[{evidence_id:c.units[0].evidence_id}];
 const response=await run([{type:'question',speaker:'user',text:'사용자가 로컬 저장 가설의 검증 방법을 질문함',evidence:refs},{type:'hypothesis',speaker:'user',text:'로컬 저장만으로 충분할 수 있다는 미확정 가설',evidence:refs}],{source});
 assert.deepEqual(response.result.objects.map(item=>item.type),['question','hypothesis']);
 for(const item of response.result.objects)assert.equal(item.semantic_verification,'not_verified');
});
