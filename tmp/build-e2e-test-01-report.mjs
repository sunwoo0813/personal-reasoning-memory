import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {eventFields,validateObjects,restoreQuoteWhitespace,validateSegments} from '../lib/analysis.js';
import {scoreCase} from '../evals/score.mjs';

const dir='output/e2e-test-01-2026-11-19';
const read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const write=(name,data)=>writeFile(join(dir,name),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const source=await read('source-snapshot.json'),protocol=await read('protocol.json'),full=await read('new-analysis.json'),ep02=await read('ep02-diagnostic-analysis.json'),baseline=await read('baseline-analysis.json');
const review=JSON.parse(await readFile('tmp/e2e-test-01-review.json','utf8'));
const events=source.inputs.map(row=>row.snapshot),byId=new Map(events.map((e,i)=>[e.id,{event:e,index:i+1}]));
assert.equal(full.run.status,'failed');assert.equal(full.run.source_unchanged,true);assert.equal(full.run.extraction_code_unchanged,true);assert.equal(ep02.run.status,'complete');
assert.equal(full.result,null);assert.equal(full.model_attempts.length,3);assert.equal(ep02.result.episodes[0].objects.length,6);
const hashes={};for(const path of Object.keys(protocol.code_hashes)){hashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');assert.equal(hashes[path],protocol.code_hashes[path]);}
validateSegments(baseline,events);

function objectsFor(result,prefix,{accepted,episodeOverride=null,attempt=null}={}){
 return result.episodes.flatMap((ep,index)=>ep.objects.map((item,i)=>{
  const episode=episodeOverride||index+1;
  const label=attempt?`${prefix}-EP${String(episode).padStart(2,'0')}-A${String(attempt).padStart(2,'0')}-O${String(i+1).padStart(2,'0')}`:`${prefix}-EP${String(episode).padStart(2,'0')}-O${String(i+1).padStart(2,'0')}`;
  const sourceEvents=events.filter(e=>ep.event_ids.includes(e.id));let validationError=null;
  try{validateObjects({objects:[item]},sourceEvents)}catch(error){validationError=error.message}
  return {evaluation_id:label,original_id:item.id||null,episode,type:item.type,speaker:item.speaker,text:item.text,accepted_in_run:accepted,
   verification_status:validationError?'validation_failed':'quote_matched',semantic_status:'manual_review_required',validation_error:validationError,
   evidence:item.evidence.map(ref=>({...ref,event_index:byId.get(ref.event_id)?.index,event_label:`E${String(byId.get(ref.event_id)?.index).padStart(2,'0')}`,
    verification_status:typeof eventFields(byId.get(ref.event_id)?.event||{})[ref.field]==='string'&&eventFields(byId.get(ref.event_id).event)[ref.field].includes(ref.quote)?'quote_matched':'quote_mismatch'}))};
 }));
}
const B=objectsFor(baseline,'B',{accepted:true});
const N=objectsFor(ep02.result,'N',{accepted:true,episodeOverride:2});
const attempts=full.model_attempts.map((attempt,index)=>{
 const original=attempt.result,canonical=restoreQuoteWhitespace(original,events.slice(0,19));
 const episode={...full.segmentation_checkpoint.result.episodes[0],objects:canonical.objects};
 const items=objectsFor({episodes:[episode]},'D',{accepted:false,attempt:index+1});
 const refs=items.flatMap(item=>item.evidence);
 return {attempt:index+1,candidate_objects:items.length,individually_valid_objects:items.filter(item=>!item.validation_error).length,
  accepted_objects:0,empty_evidence_objects:items.filter(item=>!item.evidence.length).map(item=>item.evaluation_id),
  quotes:{matched:refs.filter(ref=>ref.verification_status==='quote_matched').length,total:refs.length},
  invalid_objects:items.filter(item=>item.validation_error).map(item=>({id:item.evaluation_id,error:item.validation_error,mismatches:item.evidence.filter(ref=>ref.verification_status!=='quote_matched')})),
  items};
});
assert.deepEqual(attempts.map(a=>[a.candidate_objects,a.quotes.matched,a.quotes.total]),[[11,8,9],[15,15,16],[13,13,15]]);
const D=attempts.at(-1).items;
const all=[...B,...D,...N],objects=new Map(all.map(item=>[item.evaluation_id,item]));
for(const entry of review.ground_truth_reviews)for(const key of ['baseline_objects','new_objects','diagnostic_objects'])for(const id of entry[key]||[])assert.ok(objects.has(id),id);
const deterministic={baseline:scoreCase(protocol.deterministic_definition,events,baseline),new_full:null,
 isolated_ep02:scoreCase({boundaries:[],decisions:[],openQuestions:protocol.deterministic_definition.openQuestions},events,ep02.result)};
assert.deepEqual(deterministic.baseline.quotes,{matched:36,total:36});
assert.deepEqual(deterministic.isolated_ep02.quotes,{matched:6,total:6});

const gt=protocol.ground_truth.map(fact=>{
 const evaluation=review.ground_truth_reviews.find(row=>row.id===fact.id);
 return {...fact,...evaluation,new_full_status:'not_evaluable_full_pipeline_failed',new_isolated_status:evaluation.new_status||'not_available',diagnostic_status:evaluation.diagnostic_meaning?'unvalidated_final_ep01_candidate_only':null};
});
const metrics={
 full_pipeline_status:'failed',fixed_input_episodes:2,new_complete_full_result:null,
 baseline:{episodes:4,objects:35,user_hypothesis_E16_typed_recall:{matched:0,expected:1,note:'User hypothesis survives inside a question object; the hypothesis object is assistant-sourced.'},core_storage_decision_recall:{matched:1,expected:1},quotes:deterministic.baseline.quotes,
  user_open_questions:{correct:1,total:3,confirmed_search_false_positives:2},all_open_questions:{total:4,current_unresolved_confirmed:1,confirmed_search_false_positives:2,historical_assistant_question_ambiguous:1},confirmed_misclassified_objects:2,
  redundancy_review:{extra_objects:3,secondary_detail_candidates:8,scope:'nonblind reviewer judgement, not a uniquely labelled optimal object count'},ground_truth:{full:13,partial:1,total:14}},
 new_full:{episodes:2,objects:null,user_hypothesis_recall:null,core_storage_decision_recall:null,open_question_precision:null,confirmed_misclassifications:null,redundancy:null,quotes:null,reason:'EP01 failed validation on all 3 attempts; EP02 was not reached by the full runner'},
 rejected_ep01:{attempts:3,last_candidate_objects:13,last_candidate_individually_valid:11,accepted_objects:0,last_candidate_quotes:{matched:13,total:15},all_candidate_quotes:{matched:36,total:40},user_hypothesis_typed_objects:0,
  caution:'These are diagnostic rejected candidates, not accepted objects or valid pipeline quality scores.'},
 isolated_ep02:{objects:6,quotes:{matched:6,total:6},confirmed_wrong_signup_adoption_or_rejection:0,ground_truth:{full:5,total:5},
  user_open_question_objects:0,assistant_open_question_objects:1,user_deferral_decision_objects:1,primary_user_open_question_typed_recall:{matched:0,expected:1},semantic_unresolved_state_recall:{matched:1,expected:1},
  confirmed_misclassifications:0,ambiguous_classifications:2,secondary_out_of_purpose_candidates:1,scope:'Independent diagnostic; not evidence that the full pipeline completed.'}
};

const errorRows=[
 ['A','기존 정상 결과','분류 커버리지 누락','1','B-EP03-O12; B-EP03-O06','사용자의 가설은 question 전문에 남지만 user/hypothesis가 없고 assistant/hypothesis만 별도 존재'],
 ['A','새 전체 실행','최종 품질 채점 불가','','','EP01 검증 실패로 정상 완료 결과 없음'],
 ['A','EP01 거부된 마지막 후보','동일 누락 징후','1','D-EP01-A03-O02','사용자 가설을 question으로만 표현; 받아들여진 객체가 아님'],
 ['B','기존 정상 결과','확정 오분류','2','B-EP03-O04; B-EP03-O13','같은 검색 문자열을 각각 user/open_question으로 분류'],
 ['B','EP01 거부된 마지막 후보','검색 오분류 미관찰','0','D-EP01-A03-O13','검색 문자열 객체는 없지만 E18의 과거 미결정 상태를 open_question으로 남김; 이후 E19에서 결정됨'],
 ['B','기존 정상 결과','시점 해석 유보','1','B-EP03-O09','E09 AI 질문은 E17에서 답변됨. 역사적 질문 기록과 최종 미해결 상태를 구분해야 함'],
 ['C','기존 정상 결과','통과','0','B-EP04-O05','저장소 채택 결정은 E19.question에 연결됨'],
 ['C','EP01 거부된 마지막 후보','조기 확정 미관찰','0','D-EP01-A03-O12','결정 의미와 시점은 E19지만 정확한 인용에는 실패. 정상 회수 점수에 넣지 않음'],
 ['C','EP02 독립 진단','통과','0','N-EP02-O06','회원가입 도입/배제가 아니라 판단 보류를 결정한 발언임'],
 ['D','기존 정상 결과','의미 회수','1','B-EP04-O09','E17 사용자 질문 전문에 초기 판단에서 재검토로 변화한 내용이 직접 남음'],
 ['D','EP01 거부된 마지막 후보','사용자 변화 누락 징후','1','D-EP01-A03-O11','AI 권고 간 차이만 contradiction으로 생성; E17.question 근거의 사용자 변화 객체 없음. 그래프 부재를 실패로 센 것이 아님'],
 ['E','기존 정상 결과','통과','1','B-EP04-O07','사용자 미해결 상태와 사용자 테스트 후 재검토 조건 회수'],
 ['E','EP02 독립 진단','의미 통과·유형 커버리지 빈틈','1','N-EP02-O01; N-EP02-O05; N-EP02-O06','5개 의미 기준 회수. 사용자 보류 발언은 decision, open_question은 assistant여서 user/open_question은 없음'],
 ['F','기존 정상 결과','중복 검토 후보','3','B-EP03-O01; B-EP04-O06; B-EP04-O12','동일 자료 반복·제목형 혼합 구조·AI 미해결 재확인의 추가 핵심 정보가 적음. 주관적 유용성 검토'],
 ['F','기존 정상 결과','부차적 세부 설명 후보','8',review.baseline_secondary_detail_candidates.map(row=>row.id).join('; '),'백업·추상화·Service Worker·동기화 등. 모두 거짓 또는 불필요하다고 확정하지 않음'],
 ['F','EP02 독립 진단','목적 외 세부 객체 후보','1','N-EP02-O04','회원가입 구간에서 이전 저장소 결정을 AI 요약으로 재추출'],
 ['인용/구조','EP01 1차 응답','객체 근거 배열 누락','2','D-EP01-A01-O01; D-EP01-A01-O02','사용자 질문 두 객체의 evidence 배열이 비어 전체 구간 거부'],
 ['인용/구조','EP01 전체 후보 3개','원문 불일치 참조','4','D-EP01-A01-O09; D-EP01-A02-O10; D-EP01-A03-O09; D-EP01-A03-O12','전체 참조 40개 중 36개 일치. 이 수치는 거부된 응답의 진단치이며 정상 결과 인용 정밀도와 혼합하지 않음'],
 ['인용/구조','EP02 독립 진단','통과','6','N-EP02-O01 ~ N-EP02-O06','6개 객체·6개 참조 원문 일치, 현재 검증기 통과']
].map(([category,scope,status,count,object_ids,reason])=>({category,scope,status,count,object_ids,reason}));

const evaluation={test:protocol.test,review_method:review.reviewer,metrics,ground_truth:gt,error_rows:errorRows,manual_annotations:review,attempt_diagnostics:attempts.map(({items,...rest})=>rest),deterministic_diagnostics:deterministic,
 provenance:{source_run_id:protocol.source_run_id,full_local_run_id:full.run.id,isolated_ep02_run_id:ep02.run.id,source_state_unchanged:full.run.source_unchanged,production_code_hashes_unchanged:true,code_hashes:hashes,
  timing_note:'Full runner verified DB source state before/after. Isolated EP02 reads only the frozen local snapshot and performs no DB calls.',causal_limitation:'Single observed session; no blinded review, no repeatability estimate and no causal attribution to segmentation alone. Historical baseline request payload was not archived.'}};
await write('semantic-evaluation.json',evaluation);
await write('ep01-attempt-object-inventories.json',attempts.map(attempt=>({attempt:attempt.attempt,accepted_objects:0,items:attempt.items})));
await write('full-evaluation-results.json',{overall_status:'failed_full_pipeline_with_successful_isolated_ep02_diagnostic',baseline,full_pipeline:full,isolated_ep02:ep02,evaluation});
await write('object-inventories.json',{baseline:B,rejected_final_ep01_candidate:D,isolated_ep02:N});
await write('deterministic-diagnostics.json',deterministic);

const mdEscape=s=>String(s).replace(/\|/g,'\\|').replace(/\n/g,' ');
const quote=s=>String(s).split('\n').map(line=>'> '+line).join('\n');
const objLink=id=>`[${id}](key-objects-and-evidence.md#${id.toLowerCase()})`;
const refs=ids=>(ids||[]).map(objLink).join(', ')||'없음';
let sourceMD='# 분석에 사용한 22개 원본 이벤트\n\n분석 당시 고정 스냅샷을 그대로 사용한다. 빈 본문은 복원하지 않았다.\n\n';
for(const [index,event] of events.entries()){
 const code=`E${String(index+1).padStart(2,'0')}`;
 sourceMD+=`## ${code} · ${event.event_type}\n\n- Event ID: ${event.id}\n- client_seq: ${event.client_seq}\n- started_at: ${event.started_at}\n- ended_at: ${event.ended_at}\n- 수집 상태: ${event.capture_status}\n\n`;
 const fields=eventFields(event);
 if(!Object.keys(fields).length)sourceMD+='저장된 질문·답변·본문·검색어 없음.\n\n';
 for(const [field,value] of Object.entries(fields)){
  const longest=Math.max(2,...(value.match(/`+/g)||[]).map(run=>run.length)),fence='`'.repeat(longest+1);
  sourceMD+=`<a id="${code.toLowerCase()}-${field}"></a>\n\n### ${field}\n\n${fence}text\n${value}\n${fence}\n\n`;
 }
}
await write('source-evidence.md',sourceMD);
let inventoryMD='# 주요 사고 요소와 Evidence 대조 목록\n\n';
inventoryMD+='B는 기존 정상 결과, D는 거부된 EP01 마지막 후보, N은 EP02 독립 진단의 검증 완료 결과다. D의 개별 참조가 일치하더라도 해당 구간 전체는 실패했으며 정식 결과로 승격하지 않았다. 모든 Event ID·필드·인용을 보존한다. 전체 모델 응답 3개는 full-evaluation-results.json에 있다.\n\n';
inventoryMD+='## Ground Truth별 주요 객체\n\n| 기준 | 기존 | EP01 거부 후보 / EP02 독립 진단 |\n|---|---|---|\n';
for(const row of gt)inventoryMD+=`| ${row.id} ${mdEscape(row.meaning)} | ${refs(row.baseline_objects)} | ${refs(row.new_objects||row.diagnostic_objects)} |\n`;
for(const [heading,items] of [['기존 정상 결과 전체 35개',B],['EP01 마지막 거부 후보 13개 — 정상 결과 아님',D],['EP02 독립 진단 전체 6개 — 검증 통과',N]]){
 inventoryMD+=`\n## ${heading}\n\n`;
 for(const item of items){
  inventoryMD+=`<a id="${item.evaluation_id.toLowerCase()}"></a>\n\n### ${item.evaluation_id} · ${item.type} · ${item.speaker}\n\n${item.text}\n\n- 기존 DB Object ID: ${item.original_id||'로컬 평가 객체; DB 등록 없음'}\n- 실행 수락 여부: ${item.accepted_in_run}\n- 원문 검증: ${item.verification_status}${item.validation_error?' — '+item.validation_error:''}\n- 의미 검증: 자동 확인 아님; 비교 보고서의 수동 평가 참조\n\n`;
  if(!item.evidence.length)inventoryMD+='Evidence 없음.\n\n';
  for(const ref of item.evidence)inventoryMD+=`[${ref.event_label}.${ref.field} 원문](source-evidence.md#${ref.event_label.toLowerCase()}-${ref.field}) · Event ID: ${ref.event_id} · ${ref.verification_status}\n\n${quote(ref.quote)}\n\n`;
 }
}
await write('key-objects-and-evidence.md',inventoryMD);
let errorMD='# 오류 유형별 평가표\n\n확정 오분류, 커버리지 누락, 시점 해석 유보, 유용성 검토 후보를 구분한다. 거부된 후보와 독립 진단을 전체 정상 결과에 합산하지 않는다. 중복/부차적 객체 수는 비맹검 검토자의 운영적 판단이며 유일한 최적 개수의 정답이 아니다.\n\n| 유형 | 평가 범위 | 판정 | 개수 | 객체 | 이유 |\n|---|---|---|---:|---|---|\n';
for(const row of errorRows)errorMD+=`| ${row.category} | ${row.scope} | ${row.status} | ${row.count||'산출 불가'} | ${row.object_ids} | ${mdEscape(row.reason)} |\n`;
errorMD+='\n## 직접 확인한 인용 실패\n\n- E16.response 원문 끝: `결정하는 것이 합리적이야.` 모델은 세 번 모두 `결정하는 것이 합리적이다.`로 반환했다. 요약으로는 비슷하지만 실제 부분 문자열이 아니므로 검증 거부가 맞다.\n- E19.question 원문: `Supabase를 메인 데이터 저장소로 사용하고` 마지막 후보 인용: `Supabase를 메인데이터 저장소로 사용하고`. 공백 삭제는 현재 허용하는 줄바꿈/공백열 복원 대상이 아니므로 거부됐다.\n- 첫 응답은 두 사용자 질문 객체의 Evidence를 비웠다. 이후 전체 재생성을 두 번 수행했지만 최종 원문 검증은 실패했다.\n\n| EP01 응답 | 후보 객체 | 개별 검증 통과 객체 | 인용 일치 | 전체 구간 판정 |\n|---|---:|---:|---:|---|\n';
for(const a of attempts)errorMD+=`| ${a.attempt} | ${a.candidate_objects} | ${a.individually_valid_objects} | ${a.quotes.matched}/${a.quotes.total} | 실패 |\n`;
await write('error-evaluation.md',errorMD);
const csvCell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
await write('error-evaluation.csv','\ufeff'+['category,scope,status,count,object_ids,reason',...errorRows.map(row=>['category','scope','status','count','object_ids','reason'].map(key=>csvCell(row[key])).join(','))].join('\n')+'\n');

let report=`# PRM E2E TEST 01 — 전체 분석 파이프라인 재검증\n\n작성일: 2026-11-19 (Asia/Seoul)\n\n**전체 파이프라인은 실패했다.** EP01이 원문 인용 검증을 3회 모두 통과하지 못해 EP02에 도달하지 않았다. 이후 동일한 Extraction을 EP02에 독립 적용한 진단은 성공했고 6개 객체·6개 참조를 검증했다. **EP01 마지막 후보 13개와 EP02 진단 6개를 합쳐 정상 결과 19개로 보고하지 않는다.**\n\n`;
report+=`## 1. 실행 조건과 보존 확인\n\n- 기존 Run: \`${protocol.source_run_id}\`\n- 새 전체 로컬 평가 Run: \`${full.run.id}\` — failed\n- 독립 EP02 진단 Run: \`${ep02.run.id}\` — complete\n- 동일 원본 스냅샷 22개, gpt-5-mini, 기존 extraction-v1 코드·프롬프트·검증·최대 두 번 교정 유지\n- 이전에 검증된 purpose-v2 체크포인트의 EP01=E01–E19, EP02=E20–E22를 재사용. 이번에는 Segmentation 모델을 다시 호출하지 않음\n- Ground Truth 14개와 평가 방식을 모델 호출 전에 protocol.json / ground-truth.json에 고정\n- DB 쓰기 없음. 전체 실행 전후 기존 프로젝트·세션·이벤트·본문·Run·스냅샷·체크포인트 상태 해시 일치\n- 독립 EP02 진단은 고정된 로컬 스냅샷만 읽고 DB를 호출하지 않음\n- 분석 관련 파일 5개의 시작·종료·보고서 생성 시 SHA-256 일치. 생산 Extraction 코드는 이번 작업에서 수정하지 않음\n- 기존 npm test 64개 통과. 검증기가 실패 출력을 정상 완료로 처리하지 않은 것은 정상 동작\n\n`;
report+='## 2. 기존 결과와 비교\n\n| 평가 항목 | 기존 정상 Run | 새 전체 실행 | EP02 독립 진단 |\n|---|---|---|---|\n';
for(const row of [
 ['Episode 개수','4','입력 2개 고정; 전체 추출 실패','고정 EP02 1개'],
 ['Reasoning Object 개수','35','정상 완료 결과 없음. EP01 최종 후보 13개 전부 미수락','검증 완료 6개'],
 ['주요 사용자 가설 회수','user/hypothesis 0/1. 사용자 question에 발언 자체는 존재','최종 품질 채점 불가. 거부 후보에서도 user/hypothesis 0개','EP01 대상이므로 평가 범위 아님'],
 ['주요 사용자 저장소 결정 회수','1/1. 같은 객체에 채택·기각 사실 모두 존재','검증된 회수 0/1: EP01 실행 실패. 의미 인식 능력의 0점으로 단정하지 않음','회원가입 판단 보류 객체 1개; 저장소 결정 회수와 합산하지 않음'],
 ['Open Question 정확성','사용자 객체 1/3 적절, 검색 오분류 2개. 별도 AI 질문 1개는 시점 해석 유보','최종 채점 불가. 거부 후보에 E18 과거 미결정 상태가 남음','회원가입 미해결 의미 회수. user/open_question 0, assistant/open_question 1'],
 ['확정된 잘못된 분류 개수','2개(검색→미해결 질문). 별도 사용자 가설 유형 누락 1건','정상 결과가 없어 산출 불가','확정 오분류 0; 분류 해석 유보 2건·user/open_question 커버리지 빈틈 별도'],
 ['중복 또는 불필요 객체','중복 검토 후보 3개·부차적 세부 후보 8개','전체 정상 결과가 없어 산출 불가','목적 외 저장소 요약 객체 후보 1개'],
 ['근거 인용 일치','정상 결과 36/36','EP01 거부 후보: 8/9 → 15/16 → 13/15. 정상 결과 점수와 혼합 금지','정상 진단 6/6']
])report+=`| ${row.map(mdEscape).join(' | ')} |\n`;
report+='\n인용 일치는 의미적 타당성의 증명이 아니다. 확정 오분류 수는 분명한 사례의 하한이며 모호한 분류와 단순 누락을 억지로 같은 분류 오류에 포함하지 않았다. 중복·부차적 세부 설명 수는 명시한 객체별 기준에 따른 검토 후보 수다.\n\n';
report+='## 3. 새 Episode와 객체 목록\n\n### EP01 — 저장 방식 조사·가설·반론·최종 결정\n\n전체 구간 실패. 아래 13개는 마지막 모델 응답의 진단용 후보일 뿐이며 정식 결과가 아니다. 개별 참조가 맞는 11개도 구간 전체 실패를 우회해 저장하지 않았다.\n\n| ID | Type | Speaker | Text | 개별 원문 검증 |\n|---|---|---|---|---|\n';
for(const item of D)report+=`| ${objLink(item.evaluation_id)} | ${item.type} | ${item.speaker} | ${mdEscape(item.text)} | ${item.verification_status} |\n`;
report+='\n### EP02 — 회원가입 검토·미해결 유지\n\n독립 진단만 완료했다. 각 요청은 기존 전체 분석이 EP02에 도달했을 때와 동일한 제목·해당 원본·모델·Extraction 프롬프트를 사용한다. 전역 목적 검토를 새로 수행하거나 앞선 실패를 덮어쓰지 않았다.\n\n| ID | Type | Speaker | Text |\n|---|---|---|---|\n';
for(const item of N)report+=`| ${objLink(item.evaluation_id)} | ${item.type} | ${item.speaker} | ${mdEscape(item.text)} |\n`;
report+='\n## 4. 사전 정의 Ground Truth 대조\n\n동일한 객체가 여러 의미 기준을 충족할 수 있다. 단, 사용자 가설 항목은 요청에 따라 user/hypothesis 유형과 E16.question 직접 근거까지 별도 확인했다. 기존 결과의 의미 기준은 13개 회수·1개 부분 회수로 보지만, 이는 전체 객체 의미 정확도 13/14라는 뜻이 아니다.\n\n| 기준 | 기존 | 새 검증 결과 | 근거/진단 |\n|---|---|---|---|\n';
for(const row of gt)report+=`| ${row.id} ${mdEscape(row.meaning)} | ${row.baseline==='full'?'의미 회수':'부분 회수: 사용자 가설 유형 누락'} | ${row.new_status?'EP02 독립 진단 의미 회수':'EP01 실패로 정식 채점 불가'} | ${mdEscape(row.note||row.diagnostic_meaning)} (${refs(row.new_objects||row.diagnostic_objects)}) |\n`;
report+='\n## 5. 개선 확인과 남은 오류\n\n- 분할 입력에서는 최초 질문과 관련 조사 맥락이 E01–E19로 유지되고, E20–E22가 별도 질문으로 보존됐다. 이번 평가에서는 이 분할을 고정했으므로 분할 정확도를 새로 측정한 것은 아니다.\n- EP02 독립 진단은 미해결 회원가입 질문, UX·개발 복잡도, 사용자 테스트 이후 재검토를 의미적으로 회수했다. 회원가입 도입·배제를 확정했다는 오류는 관찰되지 않았다. 보류하기로 한 사용자 결정을 decision으로 분류하는 해석 자체는 가능하다.\n- 전체 Extraction 품질이 기존보다 개선됐다고 결론 내릴 수 없다. EP01 검증 실패로 비교 가능한 새 전체 정상 결과가 없다.\n- EP01에서 반복된 인용 변형이 전체 실패를 유발했다. E16의 `합리적이야.`를 `합리적이다.`로 바꾸고 E19의 `메인 데이터`에서 공백을 삭제했다. 의미가 비슷하다는 이유로 통과시키지 않은 것은 올바르다.\n- 사용자 IndexedDB 가설은 거부 후보에서도 question에만 담겼다. 사용자 가설 객체를 독립적으로 회수하는 문제는 해결됐다고 볼 수 없다.\n- EP01 마지막 후보는 사용자 E17의 생각 변화 대신 AI 권고 간 차이를 contradiction으로 표현했다. 사용자와 AI의 사고 변화는 구분해야 한다. 관계 그래프가 없다는 이유로 실패를 매기지 않았다.\n- EP01 마지막 후보에 E18의 과거 미결정 상태가 open_question으로 남았다. E19의 이후 확정과 함께 해석할 시간 범위가 필요하다. 이는 거부 후보에 대한 진단이며 새 정상 결과의 오분류 점수로 보고하지 않았다.\n- EP02는 미해결 질문을 assistant/open_question으로만 만들고 직접 사용자 보류 발언을 decision으로 표현했다. 의미는 남았지만 user/open_question 검색·집계의 커버리지는 빈다.\n- EP02에서 저장소 결정의 AI 재요약을 독립 evidence로 다시 추출했다. 같은 문장이 존재하더라도 해당 Episode 목적에서 중요한 객체인지 따로 평가해야 한다.\n\n';
report+='## 6. 다음 개발 우선순위 — 이번에는 구현하지 않음\n\n1. **최우선: 인용 생성·교정 안정성.** 원문 범위를 선택해 참조하게 하거나 실패한 Evidence만 좁혀 교정하는 방안을 검토한다. 원문 검증을 완화하는 것이 목표는 아니다. 현재 전체 재생성은 같은 인용 오류를 반복하고 새 오류도 추가했다.\n2. **사용자 명시 가설·생각 변화의 역할 보존.** 복합 질문 안의 가설과 판단 변화를 user 근거의 객체로 회수하는 기준을 정의한다. AI 재서술로 대체되지 않게 해야 한다.\n3. **미해결 상태와 판단 보류의 유형·시간 범위 정의.** 검색 행동, 역사적 미결정, 현재 미해결, 보류하기로 한 결정이 어떻게 함께 표현돼야 하는지 정한다. 이번에는 관계 그래프 부재를 감점하지 않았다.\n4. **목적별 중요도·중복 검토.** 같은 자료의 반복과 AI 확인 문구를 핵심 사용자 사고와 구분하되, 출처·발화 주체·판단 시점 차이를 무조건 합치지 않는다.\n\n';
report+='## 7. 재현과 해석 한계\n\n```sh\nnode scripts/evaluate-e2e-test-01.mjs output/e2e-test-01-new-run\n# 전체 실행이 EP01에서 실패한 경우에만 EP02 독립 진단을 추가\nnode scripts/evaluate-e2e-test-01-ep02.mjs output/e2e-test-01-new-run\n```\n\n출력 디렉터리는 새 경로여야 하며 기존 Run·모델 응답·체크포인트 파일을 덮어쓰지 않는다. API Key는 .env.local에서 읽고 출력/보고서에 포함하지 않는다. 호출 비용은 발생한다. 이번 실행의 요청·응답과 모델 사용량은 원본 JSON에 보존했다.\n\n한 실제 세션과 한 새 전체 실행, 실패 후 한 독립 EP02 진단에 대한 탐색 평가다. 같은 모델도 실행마다 달라지므로 분할 정책만의 인과 효과나 일반적인 성능 향상을 주장하지 않는다. 기존 Run 당시의 전체 요청 payload가 보존되지 않아 과거 입력 직렬화까지 동일했다고 검증할 수는 없다. 현재 코드는 시작·종료 해시로 고정했으며 Extraction 정책은 이번 작업에서 바꾸지 않았다. 수동 의미 평가는 동일 어시스턴트가 결과를 본 뒤 수행한 비맹검 평가이므로 독립 사람 평가와 구분해야 한다.\n\n## 결과물\n\n- [전체 실행·독립 진단·기존 결과 통합 JSON](full-evaluation-results.json)\n- [원래 전체 실행 결과 JSON — failed](new-analysis.json)\n- [EP02 독립 진단 JSON — complete](ep02-diagnostic-analysis.json)\n- [Ground Truth·지표·주석 JSON](semantic-evaluation.json)\n- [오류 유형별 평가표](error-evaluation.md) / [CSV](error-evaluation.csv)\n- [주요 객체와 모든 Evidence 연결](key-objects-and-evidence.md)\n- [원본 필드 전문](source-evidence.md)\n- [실행 전 고정한 프로토콜](protocol.json)\n';
await write('comparison-report.md',report);
console.log(JSON.stringify({report:join(dir,'comparison-report.md'),overall:'failed',ep02:'complete',baselineObjects:B.length,rejectedFinalEP01:D.length,acceptedIsolatedEP02:N.length,productionCodeUnchanged:true}));
