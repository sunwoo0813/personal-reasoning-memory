// Evaluation harness only: no DB writes, no changes to production extraction.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {database} from '../lib/db.js';
import {analyzeEvents,structuredCall,validateSegments,validateObjects,inputHash,eventFields} from '../lib/analysis.js';
import {scoreCase} from '../evals/score.mjs';

try{process.loadEnvFile('.env.local')}catch(error){if(error.code!=='ENOENT')throw error}
const output=process.argv[2];
if(!output||process.argv.length!==3)throw Error('사용법: node scripts/evaluate-e2e-test-01.mjs <새 출력 디렉터리>');
const sourceRunId='c4bbd6f5-77d4-4a55-a5b3-7d3f1c410061';
const checkpointPath='output/segmentation/purpose-v2-comparison-2026-11-19-4.json';
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const write=(name,value)=>writeFile(join(output,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const db=database(),check=result=>{if(result.error)throw Error(result.error.message);return result.data};
const codePaths=['lib/analysis.js','lib/segmentation.js','scripts/analyze.mjs','db/analysis.sql','evals/score.mjs'];
async function codeHashes(){return Object.fromEntries(await Promise.all(codePaths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])))}
async function readSource(){
 const run=check(await db.from('analysis_runs').select('*').eq('id',sourceRunId).single());
 assert.equal(run.status,'complete');assert.equal(run.model,'gpt-5-mini');
 const session=check(await db.from('sessions').select('*').eq('id',run.session_id).single());
 const project=check(await db.from('projects').select('*').eq('id',session.project_id).single());
 const inputs=[],events=[];
 for(const [name,target,filter,order] of [['analysis_inputs',inputs,['run_id',run.id],'position'],['events',events,['session_id',session.id],'client_seq']]){
  for(let offset=0;;offset+=500){const page=check(await db.from(name).select(name==='events'?'*,event_contents(*)':'*').eq(...filter).order(order).range(offset,offset+499));target.push(...page);if(page.length<500)break;}
 }
 const episodes=check(await db.from('episodes').select('*,episode_event_links(*),reasoning_objects(*,object_evidence_links(*))').eq('run_id',run.id).order('sequence'));
 const steps=check(await db.from('analysis_steps').select('*').eq('run_id',run.id).order('stage').order('sequence'));
 for(const ep of episodes){ep.episode_event_links.sort((a,b)=>a.position-b.position);ep.reasoning_objects.sort((a,b)=>a.id.localeCompare(b.id));for(const obj of ep.reasoning_objects)obj.object_evidence_links.sort((a,b)=>a.id.localeCompare(b.id));}
 return {run,session,project,inputs,events,episodes,steps};
}
await mkdir(output,{recursive:false});
const before=await readSource(),events=before.inputs.map(input=>input.snapshot),codeBefore=await codeHashes();
assert.equal(events.length,22);assert.equal(before.episodes.reduce((sum,ep)=>sum+ep.reasoning_objects.length,0),35);
const prior=JSON.parse(await readFile(checkpointPath,'utf8'));
assert.equal(prior.run.source_run_id,sourceRunId);assert.equal(prior.run.status,'complete');
const checkpoint=prior.run.segmentation;
assert.equal(checkpoint.result.segmentation_policy.version,'purpose-v2');
assert.equal(checkpoint.result.segmentation_policy.input_hash,inputHash(events));
const position=new Map(events.map((event,index)=>[event.id,index+1]));
assert.deepEqual(checkpoint.result.episodes.map(ep=>ep.event_ids.map(id=>position.get(id))),[Array.from({length:19},(_,i)=>i+1),[20,21,22]]);
const baseline={pipeline_version:before.run.pipeline_version,episodes:before.episodes.map(ep=>({...ep,event_ids:ep.episode_event_links.map(link=>link.event_id),objects:ep.reasoning_objects.map(obj=>({...obj,evidence:obj.object_evidence_links}))}))};
const groundTruth=[
 ['EP01-01','초기 질문: 어떤 데이터 저장 방식을 선택할 것인가?',[9]],
 ['EP01-02','초기 선호: Offline-first 및 서버 없는 로컬 저장 선호',[9]],
 ['EP01-03','사용자 가설: IndexedDB 단독 저장으로 MVP 구현 가능',[16]],
 ['EP01-04','근거: IndexedDB의 로컬 데이터 저장 기능',[5,7,8,11,12,16]],
 ['EP01-05','반론: 데이터 보존 위험 및 기기 간 동기화 한계',[9,15,16,17]],
 ['EP01-06','생각 변화: IndexedDB 단독 방식 재검토',[17]],
 ['EP01-07','검토 대안: Cloud-first 및 Supabase',[18]],
 ['EP01-08','최종 사용자 결정: Supabase 메인 + IndexedDB 보조',[19]],
 ['EP01-09','기각된 대안: IndexedDB 단독 저장',[19]],
 ['EP02-01','새로운 질문: MVP 회원가입 기능 필요 여부',[20]],
 ['EP02-02','평가 기준: 사용자 경험과 개발 복잡도',[20]],
 ['EP02-03','사용자 판단: 아직 결정하지 않음',[20,22]],
 ['EP02-04','미해결 질문: 회원가입 도입 여부',[20,22]],
 ['EP02-05','후속 조건: 실제 사용자 테스트 후 재검토',[22]],
].map(([id,meaning,event_indices])=>({id,meaning,event_indices}));
const protocol={test:'PRM E2E TEST 01',created_at:new Date().toISOString(),source_run_id:sourceRunId,model:'gpt-5-mini',extraction_policy:'extraction-v1',segmentation_policy:'purpose-v2',segmentation_mode:'reuse validated fixed checkpoint; no segmentation model rerun',checkpoint_source:checkpointPath,source_state_hash:hash(before),source_input_hash:before.run.input_hash,local_input_hash:inputHash(events),code_hashes:codeBefore,ground_truth:groundTruth,
 method:{structural:'existing validateSegments/validateObjects and scoreCase quote/boundary diagnostics',semantic:'manual evidence-based review by the assistant after execution; no extra LLM judge call; not blinded and not an independent human annotation',ground_truth_matching:'semantic many-to-many; one object may cover several facts; user hypothesis additionally requires user/hypothesis with direct E16.question evidence',open_question:'separate final unresolved user questions, mere search actions, and assistant questions later answered; temporal ambiguity is reported rather than forced into a correct/incorrect label',duplicates:'document object-level redundant clusters and secondary technical detail separately; no fixed ideal object count',attribution:'one source session and one new execution; no causal claim that segmentation alone produced differences; extraction instructions/schema/retries are unchanged'},
 deterministic_definition:{boundaries:[19],decisions:[{event:19,field:'question',anchor:'Supabase를 메인 데이터 저장소로 사용하고'}],openQuestions:[{event:22,field:'question',anchor:'미해결 상태로 남겨두자'}]}};
await write('protocol.json',protocol);await write('source-snapshot.json',before);await write('baseline-analysis.json',baseline);await write('ground-truth.json',groundTruth);
const run={id:randomUUID(),kind:'local_full_analysis_evaluation',source_run_id:sourceRunId,status:'processing',model:protocol.model,created_at:new Date().toISOString(),checkpoint_source:checkpointPath,policy:'purpose-v2 + unchanged extraction-v1'};
const attempts=[],checkpoints=[];let result=null,failure=null;
console.log('PRM E2E TEST 01: 22개 스냅샷, 고정 Episode 2개, 기존 Extraction 실행. DB 쓰기 없음.');
try{
 result=await analyzeEvents(events,{model:run.model,checkpoint,groundingVersion:'legacy-v1',call:async options=>{
  assert.equal(options.stage,'extract_episode','Fixed segmentation must not trigger another segmentation call');
  const episode=checkpoint.result.episodes.findIndex(ep=>options.events.every(event=>ep.event_ids.includes(event.id)))+1;
  const reason=options.instructions.match(/previous candidate failed validation: (.*)/)?.[1];
  console.log(`EP${episode} Extraction${reason?' 교정: '+reason:''}`);
  const response=await structuredCall(options);attempts.push({episode,stage:options.stage,requested_at:new Date().toISOString(),correction_reason:reason||null,...response});
  await write(`model-attempt-${String(attempts.length).padStart(2,'0')}.json`,attempts.at(-1));return response;
 },onCheckpoint:async step=>{
  assert.equal(step.stage,'extraction');checkpoints.push(step);await write(`extraction-checkpoint-${step.sequence+1}.json`,step);
  console.log(`EP${step.sequence+1}: 검증 통과 ${step.result.objects.length}개 객체`);
 }});
 validateSegments(result,events);for(const ep of result.episodes)validateObjects({objects:ep.objects},events.filter(event=>ep.event_ids.includes(event.id)));
 run.status='complete';
}catch(error){failure=error;run.status='failed';run.error=error.message}
run.completed_at=new Date().toISOString();
const after=await readSource(),codeAfter=await codeHashes();
run.source_unchanged=hash(before)===hash(after);run.extraction_code_unchanged=hash(codeBefore)===hash(codeAfter);
if(!run.source_unchanged||!run.extraction_code_unchanged){run.status='failed';run.error='원본 또는 분석 코드의 전후 해시가 달라졌습니다.';failure=Error(run.error)}
const outputResult={run,protocol_hash:hash(protocol),segmentation_checkpoint:checkpoint,inputs:events,result,checkpoints,model_attempts:attempts};
await write('new-analysis.json',outputResult);
function inventory(analysis,prefix){
 return analysis.episodes.flatMap((ep,e)=>ep.objects.map((obj,i)=>({evaluation_id:`${prefix}-EP${String(e+1).padStart(2,'0')}-O${String(i+1).padStart(2,'0')}`,original_id:obj.id||null,episode:e+1,type:obj.type,speaker:obj.speaker,text:obj.text,
  verification_status:'quote_matched; structural/speaker-field checks passed; semantics not automatically verified',evidence:obj.evidence.map(ref=>({...ref,event_index:position.get(ref.event_id),event_label:`E${String(position.get(ref.event_id)).padStart(2,'0')}`,source_field:eventFields(events[position.get(ref.event_id)-1])[ref.field],verification_status:'quote_matched'}))})));
}
for(const ep of baseline.episodes)validateObjects({objects:ep.objects},events.filter(event=>ep.event_ids.includes(event.id)));
await write('baseline-object-inventory.json',inventory(baseline,'B'));
if(result){await write('new-object-inventory.json',inventory(result,'N'));await write('deterministic-scores.json',{scope:'quote matches and anchor diagnostics, NOT semantic precision/recall; maximum-one-to-one core-anchor matching from existing scorer',baseline:scoreCase(protocol.deterministic_definition,events,baseline),new:scoreCase(protocol.deterministic_definition,events,result)});}
console.log(JSON.stringify({status:run.status,source_unchanged:run.source_unchanged,extraction_code_unchanged:run.extraction_code_unchanged,episodes:result?.episodes.length,objects:result?.episodes.reduce((sum,ep)=>sum+ep.objects.length,0),calls:attempts.length,output,error:run.error}));
if(failure)process.exitCode=1;
