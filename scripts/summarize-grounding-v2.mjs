import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {assertEvidenceSpan} from '../lib/evidence-grounding.js';

const dir=process.argv[2],preliminary=process.argv[3];
if(!dir)throw Error('사용법: node scripts/summarize-grounding-v2.mjs <완료된 평가 경로> [초기 실험 경로]');
const summary=JSON.parse(await readFile(join(dir,'summary.json'),'utf8'));
const dev=preliminary?JSON.parse(await readFile(join(preliminary,'summary.json'),'utf8')):null;
const source=JSON.parse(await readFile(join(dir,'source-snapshot.json'),'utf8'));
const events=source.inputs.map(input=>input.snapshot),position=new Map(events.map((event,index)=>[event.id,index+1]));
assert.equal(summary.source_unchanged,true);assert.equal(summary.code_unchanged,true);
const old=JSON.parse(await readFile('output/e2e-test-01-2026-11-19/new-analysis.json','utf8'));
const write=(name,value)=>writeFile(join(dir,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const errorTotals={},rows=[],decisions=[];
let references=0,matched=0,accepted=0;
for(const entry of summary.runs){
 for(const episode of entry.episodes){
  for(const [code,count] of Object.entries(episode.error_counts))errorTotals[code]=(errorTotals[code]||0)+count;
  const attempts=episode.audit?.attempts||[];
  rows.push({repeat:entry.run.repeat,episode:episode.episode,status:episode.status,candidates:episode.candidate_objects,validated:episode.validated_objects,unresolved:episode.unresolved_objects,accepted_in_full_run:episode.accepted_in_full_run,repair_rounds:episode.repair_rounds,
   schema_regenerations:Math.max(0,attempts.filter(call=>call.stage==='extract_episode').length-1),model_calls:attempts.length,error_counts:episode.error_counts});
 }
 if(entry.run.status==='complete')for(const ep of entry.result.episodes)for(const [index,item] of ep.objects.entries()){
  accepted++;
  for(const ref of item.evidence){references++;assertEvidenceSpan(ref,events);matched++;assert.equal(ref.verification_status,'quote_matched');assert.equal(ref.semantic_verification,'not_verified');}
  assert.equal(item.semantic_verification,'not_verified');assert.equal(item.grounding_review.status,'model_supported');
  if(item.type==='decision'&&item.speaker==='user'&&item.evidence.some(ref=>position.get(ref.event_id)===19&&ref.field==='question'))decisions.push({repeat:entry.run.repeat,object_index:index+1,text:item.text,evidence:item.evidence.map(ref=>({...ref,event_index:position.get(ref.event_id)})),manual_interpretation_review:'필요: text와 원문을 함께 확인. 아래 보고서의 명시적 결정 목록 참조'});
 }
}
const totalUsage=summary.runs.reduce((sum,run)=>{for(const key of ['input_tokens','output_tokens','total_tokens'])sum[key]+=run.usage[key];return sum},{input_tokens:0,output_tokens:0,total_tokens:0});
const oldUsage=old.model_attempts.reduce((sum,call)=>{for(const key of ['input_tokens','output_tokens','total_tokens'])sum[key]+=call.usage?.[key]||0;return sum},{input_tokens:0,output_tokens:0,total_tokens:0});
const metrics={complete:summary.complete,total:summary.total,episodes:rows,accepted_objects:accepted,accepted_references:{matched,total:references},error_occurrences:errorTotals,usage:totalUsage,
 explicit_decision_runs:summary.runs.filter(run=>run.run.status==='complete'&&decisions.some(item=>item.repeat===run.run.repeat)).map(run=>run.run.repeat),decision_objects:decisions,
 historical_legacy:{full_complete:0,full_total:1,recorded_usage:oldUsage,wall_ms:Date.parse(old.run.completed_at)-Date.parse(old.run.created_at),candidate_reference_matches:36,candidate_reference_total:40,accepted_objects:0},
 preliminary:dev?{complete:dev.complete,total:dev.total,reason_for_revision:'화자 제약을 스키마에도 반영하고, 질문·가설의 기록과 그 내용의 진실성 검증을 구분하도록 모델 검토 지침 보완',output:preliminary}:null,
 source_unchanged:true,code_unchanged:true,limitations:['같은 실제 세션의 소수 반복; 일반적인 안정성 추정 아님','구 방식 비교는 과거 1회이며 동시 반복 대조군 아님','관련성 검토도 모델 판단. model_supported는 semantic_verified가 아님','인용 구간이 문구보다 넓을 수 있고 추가 검토·교정 비용과 지연이 있음','사용자 가설·Open Question 분류 정책은 변경하지 않음']};
await write('metrics.json',metrics);
const cell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
const columns=['repeat','episode','status','candidates','validated','unresolved','accepted_in_full_run','repair_rounds','schema_regenerations','model_calls','error_counts'];
await write('episode-metrics.csv','\ufeff'+[columns.join(','),...rows.map(row=>columns.map(key=>cell(key==='error_counts'?JSON.stringify(row[key]):row[key])).join(','))].join('\n')+'\n');
let decisionMD='# 명시적 사용자 결정과 원문\n\n자동 집계 조건은 user/decision + E19.question 직접 근거다. 이는 의미 정확도의 독립된 판정이 아니므로 text와 원문을 함께 읽는다.\n\n';
for(const item of decisions){decisionMD+=`## 반복 ${item.repeat} · 객체 ${item.object_index}\n\n${item.text}\n\n`;for(const ref of item.evidence)decisionMD+=`- E${ref.event_index}.${ref.field} / ${ref.event_id} / ${ref.evidence_id} / UTF-16 [${ref.start}, ${ref.end}) / quote_matched\n\n${ref.quote.split('\n').map(line=>'> '+line).join('\n')}\n\n`;}
await write('decision-evidence.md',decisionMD);
let report='# Evidence Grounding v2 — 구현 및 반복 E2E 검증\n\n작성일: 2026-11-20 (Asia/Seoul)\n\n';
report+=`최종 코드의 동일 조건 ${summary.total}회 반복 중 **${summary.complete}회 완료**했다. 완료 Run의 ${accepted}개 객체, ${references}개 근거는 모두 정확한 원문 구간과 일치했다. 이 결과는 의미적 진실이나 일반적인 안정성을 입증하지 않는다.\n\n`;
report+='## 1. 기존 실패의 정확한 원인\n\n구 방식은 모델이 quote를 재작성하고 오류 시 Episode 전체를 다시 생성했다. 2026-11-19 EP01은 세 응답에서 E16의 `합리적이야.`를 `합리적이다.`로 바꿨다. 마지막에는 E19의 `메인 데이터`에서 공백도 삭제했다. 첫 응답에는 근거가 빈 객체 2개가 있었다. 원문 검증 거부 자체는 옳았지만, 정상 객체까지 바꾸는 전체 재생성이 안정적으로 복구하지 못했다.\n\n';
report+='## 2. 선택한 설계와 대안\n\n직접 인용 생성 대신 코드가 원문 문단·구간을 식별하고 모델이 evidence_id를 선택한다. 숫자 offset을 모델이 추측하는 방식은 채택하지 않았다. 코드는 이벤트·필드·UTF-16 반열린 위치 [start,end)·원문 문자열을 확인한 뒤 인용을 복원한다. 공백·어미·문장부호를 수정한 문자열을 quote로 저장하지 않는다. 동일 문장도 구간별 ID와 위치로 구분한다.\n\n존재하는 ID를 잘못 선택할 수 있으므로 화자 규칙을 출력 스키마와 기존 검증기에 적용하고, 별도 모델 호출로 근거 관련성을 확인한다. 질문은 실제 질문 발화로, 가설은 실제 가설 제시로 뒷받침할 수 있다. 답이나 가설의 진실성을 필수로 요구하지 않는다. 반대·무관한 해석은 unsupported/uncertain으로 남긴다. 이 모델 판단은 model_supported이며 semantic_verification은 not_verified로 유지한다.\n\n실패 슬롯만 최대 2라운드 교정한다. 정상 객체는 고정하고 실패 객체를 삭제해 성공 처리하지 않는다. 미해결 객체가 하나라도 있으면 전체 Episode·Run을 완료하지 않는다. 완성 전 감사 JSON은 정상 객체 체크포인트와 구분한다.\n\n';
report+='## 3. 변경 파일 및 주요 로직\n\n- lib/evidence-grounding.js: 원문 ID·위치, 스키마, 관련성 검토, 객체별 오류/교정, 감사·사용량, 체크포인트 검증\n- lib/analysis.js: v2 기본 경로, 입력 카탈로그 전달, 기존 legacy-v1 경로와 구 체크포인트 호환. type·speaker·결정/가설/Open Question 정책 유지\n- scripts/analyze.mjs: 기존 analysis_steps JSON에 감사 기록. 성공한 완전한 결과만 기존 finish RPC로 최종 저장\n- tests/evidence-grounding.test.mjs, tests/analysis-db.test.mjs, tests/analysis.test.mjs: 신규 검증·기존 경로·PostgreSQL 호환성\n- scripts/evaluate-grounding-v2.mjs, scripts/summarize-grounding-v2.mjs: DB 읽기 전용 반복 평가와 집계\n- 기존 E2E 평가 스크립트는 legacy-v1을 명시해 과거 비교 정책을 보존\n- docs/evidence-grounding-v2.md, README.md: 설계·용량·재개 제한 문서화\n\nDB 스키마, 기존 세션·이벤트·분석 Run은 변경하지 않았다. 완성 체크포인트는 재검증해 재사용하고, 중단된 v2 감사는 정상 결과로 재사용하거나 교정 예산을 초기화하지 않는다. 중단된 Episode는 새 Run이 필요하다.\n\n';
report+='## 4. 자동 테스트\n\n기존 64개와 신규 20개, 총 **84개 테스트 통과**. 빌드와 git diff --check도 통과했다. 어미·공백 변형 거부, 혼합 Unicode/이모지·UTF-16, 반복 문장, 잘못된 이벤트·필드·ID, 복수 근거, 일부 실패만 교정, 환각 근거, 문자열 일치/반대 해석, 불확실 검토, 스키마 오류와 제한 재시도, 실패 결과 미저장, 신·구 체크포인트 재개를 포함한다. PostgreSQL jsonb 키 재배열 후의 해시 검증·재개와 기존 원문 일치 트랜잭션도 확인했다. 의미 검토 테스트의 모의 응답은 아래 실제 모델 실험과 구분한다.\n\n';
report+='## 5. 기존 22개 이벤트 반복 재분석\n\nE01–E19 / E20–E22의 기존 검증된 purpose-v2 분할을 고정했다. gpt-5-mini와 동일 원본을 사용하고 반복 사이 추출 결과·체크포인트를 재사용하지 않았다. 기존 DB의 전후 상태와 평가 중 분석 코드 해시가 모두 일치했다. 이번 실행은 로컬이며 DB나 앱의 기존 결과를 덮어쓰지 않았다.\n\n| 반복 | EP | 상태 | 후보 | 최종 검증 통과 | 최종 미해결 | 전체 Run 수락 | 교정 라운드 |\n|---:|---:|---|---:|---:|---:|---:|---:|\n';
for(const row of rows)report+=`| ${row.repeat} | ${row.episode} | ${row.status} | ${row.candidates??'미실행'} | ${row.validated} | ${row.unresolved??'미실행'} | ${row.accepted_in_full_run} | ${row.repair_rounds} |\n`;
report+='\n통과 수는 구조·화자 검증과 모델 관련성 검토를 통과한 현재 후보 수다. 실패 Run의 정상 후보도 전체 Run 수락 수에는 넣지 않았다. 오류 횟수는 같은 슬롯의 반복 오류를 포함하므로 최종 실패 객체 수와 다르다.\n\n| 오류 종류 | 발생 횟수 |\n|---|---:|\n';
for(const [code,count] of Object.entries(errorTotals))report+=`| ${code} | ${count} |\n`;
if(!Object.keys(errorTotals).length)report+='| 검증 오류 관찰 없음 | 0 |\n';
report+='\n| 반복 | 전체 상태 | 입력 토큰 | 출력 토큰 | 총 토큰 | 벽시계 실행 시간 | 모델 호출 |\n|---:|---|---:|---:|---:|---:|---:|\n';
for(const entry of summary.runs)report+=`| ${entry.run.repeat} | ${entry.run.status} | ${entry.usage.input_tokens} | ${entry.usage.output_tokens} | ${entry.usage.total_tokens} | ${(entry.run.duration_ms/1000).toFixed(1)}초 | ${entry.call_count} |\n`;
report+=`\n기록된 사용량 합계: 입력 ${totalUsage.input_tokens}, 출력 ${totalUsage.output_tokens}, 총 ${totalUsage.total_tokens} 토큰. 캐시 관련 원시 사용량도 호출 JSON에 남겼으며 이 합계는 청구 비용 계산이 아니다. 실행 시간은 모델·검증·로컬 감사 기록 I/O를 포함한다. 응답을 받지 못한 API 오류의 사용량은 확인할 수 없다.\n\n`;
report+=`E19 user/decision 직접 근거를 가진 완료 Run: **${metrics.explicit_decision_runs.length}/${summary.total}**. 이 자동 조건은 [결정 text·원문 목록](decision-evidence.md)과 함께 확인한다. 가설/Open Question 분류의 전체 품질 점수나 인과관계 그래프 평가는 이번 지표에 포함하지 않았다.\n\n`;
report+='## 6. 구 방식과 완료·인용 비교\n\n| 범위 | 구 방식 2026-11-19 | 최종 evidence-v2 |\n|---|---|---|\n';
report+=`| 같은 2개 Episode 전체 실행 완료 | 0/1 (과거 한 번) | ${summary.complete}/${summary.total} (최종 코드 고정 반복) |\n`;
report+=`| 전체 완료 결과의 수락 객체 | 0 | ${accepted} |\n`;
report+=`| 완료 결과의 원문 인용 | 전체 결과 없음 | ${matched}/${references} 일치 |\n`;
report+='| 거부된 구 방식 후보의 문자열 진단 | 36/40 일치, 빈 근거 2객체 별도 | 모델 생성 quote를 저장하지 않음; 의미·화자 실패는 계속 거부 |\n';
report+=`| 기록된 구 방식 입력/출력/총 토큰 | ${oldUsage.input_tokens} / ${oldUsage.output_tokens} / ${oldUsage.total_tokens} (실패한 전체 실행) | 위 반복별 표 참조; 성공 결과와 추가 검토 비용 포함 |\n`;
report+='\n구 방식의 EP02 독립 성공 6객체를 구 방식 전체 실행의 성공으로 합산하지 않았다. 과거 1회 대조와 새 반복은 표본 크기·실행 시점이 달라 통계적 안정성 개선이나 단독 인과 효과로 해석할 수 없다. 문자열 일치 100%는 원문에서 잘라내고 검증한 결과의 보장이지 해석의 정확도 100%가 아니다.\n\n';
if(dev)report+=`초기 개발 실험 ${dev.total}회는 ${dev.complete}회 완료였고, 모든 성공·실패 기록은 ${preliminary}에 보존했다. 화자 제약을 스키마에 반영하고, 질문·가설의 기록에 답변·진실성까지 요구하던 모델 검토 지침을 보완한 뒤 최종 코드를 고정해 위 ${summary.total}회를 다시 실행했다. 서로 다른 코드의 실험을 최종 완료율 분모에 섞지 않았으며 실패 이력을 숨기지 않았다.\n\n`;
report+='## 7. 남은 한계\n\n- 관련성 모델도 오판할 수 있다. not_verified 표시를 유지하며 확정적 의미 검증으로 발표하지 않는다.\n- 원문 ID가 존재해도 잘못된 구간을 고를 수 있다. 스키마는 화자·출처 범위만 제한하고 해석의 정확성을 보장하지 않는다.\n- 인용 단위가 문구보다 넓어 불필요한 주변 문장을 포함할 수 있다. 원문을 임의로 다듬지 않는다.\n- 검토와 국소 교정은 비용·지연을 추가하며 여전히 실패할 수 있다. 실패 슬롯을 삭제하거나 부분 성공을 complete로 만들지 않는다.\n- 사용자 가설 누락, 검색어/Open Question 혼동, 판단 변화의 분류는 이번에 바꾸지 않았다. 이들의 개선을 주장하지 않는다.\n- 한 세션의 작은 반복 표본이고 독립 사용자 평가가 아니다. 일반적인 안정성에는 다른 길이·문서·대화·오류 분포의 추가 평가가 필요하다.\n- 850개 구간과 기존 입력 크기 한도가 있다. 미완료 v2 감사의 자동 재개는 제한하며 새 Run이 필요하다.\n\n## 재현\n\n```sh\nnode scripts/evaluate-grounding-v2.mjs output/evidence-grounding-v2-new-check 3\nnode scripts/summarize-grounding-v2.mjs output/evidence-grounding-v2-new-check\n```\n\n새 디렉터리를 지정해야 한다. 각 Run의 analysis-result.json, call-*.json, audit-trace.jsonl, checkpoint-ep*.json에 원시 응답·오류·사용량·완료 객체를 보존한다. source-snapshot.json과 protocol.json으로 원본·정책·코드 해시를 확인할 수 있다. Secret은 출력하지 않는다.\n';
await write('report.md',report);
console.log(JSON.stringify({report:join(dir,'report.md'),complete:summary.complete,total:summary.total,accepted_objects:accepted,quote_matches:matched,references,decisions:metrics.explicit_decision_runs,error_occurrences:errorTotals}));
