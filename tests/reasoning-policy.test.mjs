import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groundEpisode,buildEvidenceCatalog,validateGroundingCheckpoint,groundingSchema} from '../lib/evidence-grounding.js';
import {analyzeEvents,EXTRACT_SCHEMA,validateObjects,inputHash} from '../lib/analysis.js';
import {REASONING_VERSION,REASONING_POLICY,restrictReasoningSchema} from '../lib/reasoning-policy.js';
const fixtures=JSON.parse(readFileSync('evals/reasoning-v2/independent-cases.json','utf8'));
const makeEvents=fixture=>fixture.turns.map((turn,index)=>({id:`${fixture.id}-${index}`,event_type:'llm_exchange',event_contents:{content_jsonb:turn}}));
const source=makeEvents(fixtures[1]),catalog=buildEvidenceCatalog(source);
const candidate=(type,text,position=0,field='question',speaker='user')=>({type,speaker,text,evidence:[{evidence_id:catalog.units.find(unit=>unit.event_id===source[position].id&&unit.field===field).evidence_id}]});
const review=(options,verdict='supported')=>({result:{items:options.inputData.items.map(item=>({object_index:item.object_index,verdict,reason:'테스트 검토 판단; 실제 의미 정확도 검증과 구분'}))}});
async function run({user=[candidate('open_question','등록을 보류하고 샘플 강의 후 재검토',1)],support=[],handler=async()=>null,onAudit=async()=>{}}={}){
 return groundEpisode({events:source,reasoningVersion:REASONING_VERSION,legacySchema:EXTRACT_SCHEMA,validateObjects,snapshotHash:inputHash(source),instructions:'',onAudit,call:async options=>await handler(options)||(['extract_user_reasoning','review_user_reasoning'].includes(options.stage)?{result:{objects:user}}:options.stage==='extract_episode'?{result:{objects:support}}:review(options))});
}

test('user pass sees only user question evidence before assistant/source supplementation',async()=>{
 const stages=[];
 const result=await run({handler:async options=>{
  stages.push(options.stage);
  if(options.stage==='extract_user_reasoning'){
   assert.ok(options.inputData.evidence_catalog.every(unit=>unit.field==='question'));
   assert.ok(!JSON.stringify(options.inputData).includes('지금 바로 등록'));
   assert.match(options.instructions,/hypothesis/);assert.match(options.instructions,/open_question/);
  }
  if(options.stage==='extract_episode'){
   assert.equal(options.inputData.prior_user_objects.length,1);
   assert.ok(options.inputData.evidence_catalog.every(unit=>unit.source_speaker==='assistant'));
  }
 }});
 assert.deepEqual(stages,['extract_user_reasoning','review_user_reasoning','extract_episode','review_evidence_grounding']);
 assert.equal(result.result.objects[0].type,'open_question');
 assert.equal(result.result.reasoning_version,REASONING_VERSION);
 assert.equal(result.result.objects[0].semantic_verification,'not_verified');
});

test('support schema excludes user ownership, decisions and unsolicited questions, including large catalogs',()=>{
 for(const count of [catalog.units.length,431]){
  const c=count===431?{units:Array.from({length:count},(_,i)=>({evidence_id:`G${i}`,source_speaker:i%2?'user':'assistant',field:i%2?'question':'response'}))}:catalog;
  const schema=restrictReasoningSchema(groundingSchema(EXTRACT_SCHEMA,c),'support',c);
  for(const variant of schema.properties.objects.items.anyOf||[schema.properties.objects.items]){
   assert.ok(!variant.properties.speaker.enum.includes('user'));
   for(const type of ['question','decision','open_question'])assert.ok(!variant.properties.type.enum.includes(type));
  }
 }
});

test('independent-domain user hypotheses cannot be replaced by AI restatements',async()=>{
 const result=await run({user:[candidate('hypothesis','등록을 검토하는 잠정 방안')],support:[candidate('hypothesis','지금 등록하라는 AI 제안',0,'response','assistant')]});
 assert.deepEqual(result.result.objects.map(item=>item.speaker),['user','assistant']);
 assert.notEqual(result.result.objects[0].evidence[0].field,result.result.objects[1].evidence[0].field);
});

test('a literally matched deferral tagged decision is reviewed and locally retagged without changing siblings',async()=>{
 const question=candidate('question','통계 수업을 들을까?'),bad=candidate('decision','등록을 미루고 샘플 강의 후 판단',1),fixed={...bad,type:'open_question'};
 const requests=[];let first=true;
 const result=await run({user:[question,bad],handler:async options=>{
  if(options.stage==='review_evidence_grounding'){
   requests.push(options.inputData.items.map(item=>item.object_index));assert.match(options.instructions,/Reject a wrong type/);
   assert.equal(options.inputData.episode_user_context.length,2);
   if(first){first=false;return {result:{items:[{object_index:1,verdict:'supported',reason:'직접 질문'},{object_index:2,verdict:'unsupported',reason:'채택/기각이 아니라 보류'}]}};}
  }
  if(options.stage==='repair_evidence_objects'){
   assert.deepEqual(options.inputData.invalid_objects.map(item=>item.object_index),[2]);return {result:{repairs:[{object_index:2,object:fixed}]}};
  }
 }});
 assert.deepEqual(requests,[[1,2],[2]]);assert.deepEqual(result.result.objects.map(item=>item.type),['question','open_question']);
 assert.equal(result.result.objects[0].text,question.text);
});

test('local repair cannot hide a rejected user hypothesis by changing ownership to assistant',async()=>{
 const bad=candidate('hypothesis','검토 중인 사용자 가설');let last;
 await assert.rejects(()=>run({user:[bad],onAudit:async audit=>{last=audit},handler:async options=>{
  if(options.stage==='review_evidence_grounding')return review(options,'unsupported');
  if(options.stage==='repair_evidence_objects')return {result:{repairs:[{object_index:1,object:candidate('hypothesis','AI 제안으로 바꿔치기',0,'response','assistant')}]}};
 }}),{code:'unresolved_objects'});
 assert.equal(last.error_counts.pass_ownership,2);assert.equal(last.accepted_count,0);
});

test('search-only events do not enter user reasoning pass and metadata cannot invent thought',async()=>{
 const events=[{id:'search',event_type:'search',event_contents:{content_jsonb:{query:'bike rainfall statistics'}}},{id:'meta',event_type:'page_view',metadata:{title:'decide to buy'}}];
 const stages=[];
 const answer=await groundEpisode({events,reasoningVersion:REASONING_VERSION,legacySchema:EXTRACT_SCHEMA,validateObjects,snapshotHash:inputHash(events),instructions:'',call:async options=>{stages.push(options.stage);return {result:{objects:[]}};}});
 assert.deepEqual(stages,[]);assert.deepEqual(answer.result.objects,[]);
});

test('unrelated exact source text remains rejected despite source existence and type review',async()=>{
 let last;
 await assert.rejects(()=>run({onAudit:async audit=>{last=audit},handler:async options=>{
  if(options.stage==='review_evidence_grounding')return review(options,'unsupported');
  if(options.stage==='repair_evidence_objects')return {result:{repairs:[{object_index:1,object:candidate('open_question','근거와 무관한 좌석 문제',1)}]}};
 }}),{code:'unresolved_objects'});
 assert.equal(last.repair_rounds,2);assert.equal(last.accepted_count,0);
});

test('v2 checkpoint binds classification review and replays without calls; old results retain old version',async()=>{
 const checkpoint={result:{episodes:[{title:'수강 검토',goal:'수강 결정',boundary_reason:'한 목적',event_ids:source.map(event=>event.id)}]}};
 const step=await run();
 const replay=await analyzeEvents(source,{checkpoint,extractionCheckpoints:[{sequence:0,result:step.result}],call:async()=>{throw Error('must not call')}});
 assert.equal(replay.reasoning_version,REASONING_VERSION);
 const tampered=structuredClone(step.result);tampered.objects[0].grounding_review.policy='reasoning-v1';
 // A changed review is rejected even before policy checking by the object digest.
 assert.throws(()=>validateGroundingCheckpoint(tampered,source,validateObjects,inputHash(source)),{code:'checkpoint_review'});
 const old=await analyzeEvents(source,{checkpoint,extractionCheckpoints:[{sequence:0,result:{objects:[]}}],call:async()=>{throw Error('must not call')}});
 assert.equal(old.reasoning_version,'reasoning-v1');
});

test('independent cases cover reversal, unresolved, resolved and non-adoption outside memo-app terminology',()=>{
 assert.equal(fixtures.length,4);
 for(const fixture of fixtures){assert.ok(fixture.expected.length>=3);assert.ok(!JSON.stringify(fixture).includes('IndexedDB'));}
 for(const word of ['hypothesis','insight','contradiction','decision','open_question','search','deferral','adoption'])assert.ok(REASONING_POLICY.includes(word));
});

test('coverage revision preserves distinct hypotheses and explicit changes before support extraction',async()=>{
 const question=candidate('question','수강 검토 질문'),hypothesis=candidate('hypothesis','검토 중인 잠정 방안'),open=candidate('open_question','샘플 강의 후 판단',1);
 let supportSaw;
 const result=await run({user:[question],handler:async options=>{
  if(options.stage==='review_user_reasoning'){
   assert.equal(options.inputData.draft_user_objects.length,1);assert.match(options.instructions,/For EACH user turn/);assert.match(options.instructions,/settled by a later explicit decision/);
   return {result:{objects:[question,hypothesis,open]}};
  }
  if(options.stage==='extract_episode')supportSaw=options.inputData.prior_user_objects;
 }});
 assert.equal(supportSaw.length,3);assert.equal(result.result.grounding.user_coverage_review,'model_revision_not_verified');
 assert.deepEqual(result.result.objects.map(item=>item.type),['question','hypothesis','open_question']);
});

test('malformed coverage revision fails closed after a bounded format retry',async()=>{
 let revisions=0,last;
 await assert.rejects(()=>run({onAudit:async audit=>{last=audit},handler:async options=>{
  if(options.stage==='review_user_reasoning'){revisions++;return {result:{objects:[{speaker:'assistant'}]}};}
 }}),{code:'user_revision_schema'});
 assert.equal(revisions,2);assert.equal(last.accepted_count,0);
});
