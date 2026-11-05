import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const dir=process.argv[2]||'docs/verification/evaluation-2026-11-05';
const protocol=JSON.parse(readFileSync(join(dir,'protocol.json'),'utf8'));
const jobs=JSON.parse(readFileSync(join(dir,'jobs.json'),'utf8'));
const complete=jobs.filter(j=>j.status==='complete'),failed=jobs.filter(j=>j.status==='failed');
const quantile=(values,p)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]};
const sum=(values,key)=>values.reduce((n,value)=>n+(key(value)||0),0);
const planned=protocol.case_count*protocol.repeats;
const expectedDecisions=protocol.cases.reduce((n,c)=>n+c.decisions.length*protocol.repeats,0);
const matchedDecisions=sum(complete,j=>j.score.decisions.matched),predictedDecisions=sum(complete,j=>j.score.decisions.predicted);
const successfulExpectedDecisions=sum(complete,j=>j.score.decisions.expected);
const quoteTotal=sum(complete,j=>j.score.quotes.total),quoteMatched=sum(complete,j=>j.score.quotes.matched);
const expectedOpenQuestions=protocol.cases.reduce((n,c)=>n+c.openQuestions.length*protocol.repeats,0);
const matchedOpenQuestions=sum(complete,j=>j.score.open_questions.matched);
const boundaryRuns=complete.filter(j=>j.case_id==='topic_switch');
const boundaryTP=sum(boundaryRuns,j=>j.score.boundaries.true_positive),predictedBoundaries=sum(boundaryRuns,j=>j.score.boundaries.predicted.length),expectedBoundaries=protocol.cases.filter(c=>c.id==='topic_switch').reduce((n,c)=>n+c.boundaries.length*protocol.repeats,0);
const summary={protocol,planned,observed:jobs.length,complete:complete.length,failed:failed.length,pending:jobs.filter(j=>!['complete','failed','timeout'].includes(j.status)).length,completion_rate:complete.length/planned,core_decisions:{matched:matchedDecisions,predicted:predictedDecisions,expected_all_runs:expectedDecisions,expected_successful_runs:successfulExpectedDecisions,precision:predictedDecisions?matchedDecisions/predictedDecisions:null,recall_all_runs:matchedDecisions/expectedDecisions,recall_successful_runs:successfulExpectedDecisions?matchedDecisions/successfulExpectedDecisions:null},open_questions:{matched:matchedOpenQuestions,expected:expectedOpenQuestions,recall:matchedOpenQuestions/expectedOpenQuestions},boundary:{scope:'topic_switch only; other segmentation counts are descriptive, not uniquely labeled gold',matched:boundaryTP,predicted:predictedBoundaries,expected:expectedBoundaries,precision:predictedBoundaries?boundaryTP/predictedBoundaries:null,recall:expectedBoundaries?boundaryTP/expectedBoundaries:null},accepted_quote_matches:{matched:quoteMatched,total:quoteTotal,rate:quoteTotal?quoteMatched/quoteTotal:null},latency_ms:{definition:'Server timestamps. Processing includes model and database round trips. Queue wait reported separately; single shared worker.',successful_processing_median:quantile(complete.map(j=>j.processing_ms),.5),successful_processing_p95:quantile(complete.map(j=>j.processing_ms),.95),successful_processing_min:complete.length?Math.min(...complete.map(j=>j.processing_ms)):null,successful_processing_max:complete.length?Math.max(...complete.map(j=>j.processing_ms)):null,queue_median:quantile(jobs.filter(j=>Number.isFinite(j.queue_ms)).map(j=>j.queue_ms),.5)},recorded_usage:{input_tokens:sum(jobs,j=>j.usage?.input_tokens),output_tokens:sum(jobs,j=>j.usage?.output_tokens),total_tokens:sum(jobs,j=>j.usage?.total_tokens),limitation:'Completed checkpoint usage only. Failed model output rejected before checkpoint is not included.'},cases:protocol.cases.map(c=>({id:c.id,name:c.name,runs:jobs.filter(j=>j.case_id===c.id).map(j=>({repeat:j.repeat,status:j.status,error:j.error,processing_ms:j.processing_ms,score:j.score,session_id:j.session_id,run_id:j.run_id}))}))};
writeFileSync(join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const pct=n=>n===null?'계산 불가':(n*100).toFixed(1)+'%';
const seconds=n=>n===null?'—':(n/1000).toFixed(1)+'초';
const lines=[
'# 분할과 사고 요소 추출의 반복 시험',
'',`- 프로젝트: 검증용 · 본문과 사고 요소 추출 (${protocol.project_id})`,
`- 조건: 합성 시나리오 ${protocol.case_count}종 × ${protocol.repeats}회, ${protocol.model}, 기존 프롬프트 고정`,
`- 파이프라인 해시: ${protocol.pipeline_hash}`,
'- 시험 문구와 정답 앵커는 API 실행 전에 protocol.json에 저장했다. 별도 LLM 채점기는 사용하지 않았다.',
'- 같은 8개 입력을 반복한 탐색 시험이며 실제 사용자 모집 평가나 독립된 16개 과제 평가가 아니다.',
'',
'| 지표 | 측정값 |', '|---|---|',
`| 분석 완료 | ${complete.length}/${planned} (${pct(summary.completion_rate)}) |`,
`| 핵심 사용자 결정 정밀도 | ${matchedDecisions}/${predictedDecisions} (${pct(summary.core_decisions.precision)}) |`,
`| 핵심 사용자 결정 재현율 — 실패 포함 | ${matchedDecisions}/${expectedDecisions} (${pct(summary.core_decisions.recall_all_runs)}) |`,
`| 핵심 사용자 결정 재현율 — 완료 실행만 | ${matchedDecisions}/${successfulExpectedDecisions} (${pct(summary.core_decisions.recall_successful_runs)}) |`,
`| 미해결 질문 회수 — 실패 포함 | ${matchedOpenQuestions}/${expectedOpenQuestions} (${pct(summary.open_questions.recall)}) |`,
`| 명시적 주제 경계 정밀도 | ${boundaryTP}/${predictedBoundaries} (${pct(summary.boundary.precision)}) |`,
`| 명시적 주제 경계 재현율 — 실패 포함 | ${boundaryTP}/${expectedBoundaries} (${pct(summary.boundary.recall)}) |`,
`| 저장 허용된 인용의 원문 일치 | ${quoteMatched}/${quoteTotal} (${pct(summary.accepted_quote_matches.rate)}) |`,
`| 완료 실행 처리 시간 중앙값 / p95 | ${seconds(summary.latency_ms.successful_processing_median)} / ${seconds(summary.latency_ms.successful_processing_p95)} |`,
`| 완료 실행 최소 / 최대 처리 시간 | ${seconds(summary.latency_ms.successful_processing_min)} / ${seconds(summary.latency_ms.successful_processing_max)} |`,
`| 대기열 시간 중앙값 | ${seconds(summary.latency_ms.queue_median)} |`,
'',
'## 사례별 결과','',
'| 사례 | 반복 | 상태 | 핵심 결정 회수 | 추가 결정 | 시간 |', '|---|---:|---|---|---:|---|'
];
for(const c of summary.cases)for(const run of c.runs){const d=run.score?.decisions;lines.push(`| ${c.name} | ${run.repeat} | ${run.status}${run.error?' — '+run.error:''} | ${d?d.matched+'/'+d.expected:'결과 없음'} | ${d?d.predicted-d.matched:'—'} | ${seconds(run.processing_ms)} |`)}
lines.push('', '## 해석 범위','',
'- 정밀도/재현율은 미리 지정한 핵심 사용자 결정의 유형·주체·이벤트·필드·인용 앵커 일치 기준이다. 전체 사고 요소의 의미 정확도를 뜻하지 않는다.',
'- 객체 하나는 정답 하나에만 대응시킨다. 여러 결정을 한 객체로 합치면 각각을 회수한 것으로 세지 않는다.',
'- 인용 일치 100%는 검증기가 허용한 결과의 저장 조건이다. 모델의 첫 응답이 항상 올바르거나 해석이 사실이라는 뜻이 아니다.',
'- 실패 실행도 전체 완료율과 전체 결정 재현율 분모에 포함한다. 완료 실행만의 수치도 별도로 기록했다.',
'- 경계 지표는 명시적 전환 두 곳을 넣은 topic_switch 사례만 채점한다. 다른 사례는 정답 분할이 유일하지 않아 객체 회수와 분할 개수의 변화만 확인한다. 실사용자 로그의 자연스러운 경계 정확도로 일반화할 수 없다.',
'- 대기열 시간은 한 워커에 16개 시험을 넣은 영향이다. 처리 시간과 분리해 해석한다.',
'- 토큰 합계는 저장된 체크포인트 기준이다. 검증 거부된 응답의 사용량은 누락될 수 있어 실제 청구량 추정에 사용하지 않는다.',
'- 원본과 출력은 각 사례 JSON에 보존했다. 실제 개인 기록이 아닌 합성 자료다.',
'');
if(existsSync(join(dir,'review-notes.md')))lines.push(readFileSync(join(dir,'review-notes.md'),'utf8'));
writeFileSync(join(dir,'report.md'),lines.join('\n'));
console.log(JSON.stringify({complete:summary.complete,failed:summary.failed,pending:summary.pending,core_decisions:summary.core_decisions,latency_ms:summary.latency_ms},null,2));
