// Shared, browser-safe presentation rules. Never relabel AI text as user intent.
export const objectLabels = {question:'질문',evidence:'근거',hypothesis:'가설',insight:'발견',contradiction:'반론',decision:'결정',open_question:'미해결 질문'};
export const speakerLabels = {user:'내 발언',assistant:'AI 응답',source:'웹 자료',unknown:'주체 미확인'};
export const runStatusLabels = {queued:'분석 대기 중',processing:'생각의 흐름 정리 중',complete:'분석 완료',failed:'분석 실패'};
export const recordingLabels = {recording:'기록 중',closing:'종료 중',closed:'종료됨'};
export const syncLabels = {pending:'전송 대기',synced:'저장 완료',error:'전송 오류'};
export const summaryStatusLabels = {queued:'요약 대기 중',processing:'회고와 다음 작업 제안을 정리하고 있어요',complete:'요약 완료',failed:'요약을 만들지 못했어요'};
export const summaryProgressLabels={review_summary_question_states:'남은 질문과 후속 결정을 확인하고 있어요',summarize_session:'작업 회고와 다음 작업을 작성하고 있어요',review_session_summary_items:'각 문장과 원문 근거를 대조하고 있어요',repair_session_summary_items:'확인이 필요한 요약 항목을 다듬고 있어요'};
export function sortAnalysisRuns(runs) {
 return runs.map(run=>({...run,episodes:[...(run.episodes||[])].sort((a,b)=>a.sequence-b.sequence).map(ep=>({...ep,reasoning_objects:[...(ep.reasoning_objects||[])].sort((a,b)=>a.id.localeCompare(b.id)).map(obj=>({...obj,object_evidence_links:[...(obj.object_evidence_links||[])].sort((a,b)=>a.id.localeCompare(b.id))}))}))}));
}
export function objectGroup(item) {
 if(item.speaker!=='user')return 'other';
 return ({question:'questions',decision:'decisions',open_question:'open_questions'})[item.type]||'other';
}
export function quoteParts(text,quote) {
 if(!quote)return [{text,matched:false}];
 const parts=[];let cursor=0,index;
 while((index=text.indexOf(quote,cursor))!==-1){
  if(index>cursor)parts.push({text:text.slice(cursor,index),matched:false});
  parts.push({text:quote,matched:true});cursor=index+quote.length;
 }
 if(cursor<text.length)parts.push({text:text.slice(cursor),matched:false});
 return parts.length?parts:[{text,matched:false}];
}
