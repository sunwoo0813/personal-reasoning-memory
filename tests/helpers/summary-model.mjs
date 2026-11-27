export function modelAnswer(options){
 const entry=(text,...object_ids)=>({text,object_ids});
 if(options.stage==='review_summary_question_states')return {result:{items:options.inputData.candidates.map(obj=>({object_id:obj.id,status:obj.type==='open_question'?'open':'historical',reason:'명시적인 사용자 발언을 확인함',supporting_object_ids:[obj.id]}))},usage:{total_tokens:3}};
 if(options.stage==='summarize_session'){
  const all=options.inputData.source.episodes.flatMap(ep=>ep.objects),decision=all.find(obj=>obj.type==='decision'&&obj.speaker==='user'),open=options.inputData.required_open_ids[0];
  const ref=decision?.id||all[0].id;
  return {result:{overview:[entry('원본 보존 범위를 정하고 남은 표시 문제를 보류했다.',ref,...(open?[open]:[]))],topics:[entry('원본 기록 보존',ref)],decisions:decision?[entry('원본 기록부터 보존하기',decision.id)]:[],open_questions:open?[entry('본문 없는 기록의 표시 방식은 보류 중이다.',open)]:[],suggestions:open?[entry('표시 방식을 비교할 사용자 테스트를 설계해보세요.',open)]:[]},usage:{total_tokens:7}};
 }
 if(options.stage==='review_session_summary_items')return {result:{items:options.inputData.items.map(item=>({slot:item.slot,verdict:'supported',reason:'선택된 근거와 일치함'}))},usage:{total_tokens:5}};
 if(options.stage==='repair_session_summary_items')return {result:{items:options.inputData.issues.map(issue=>({slot:issue.slot,item:{...issue.previous_item,text:'교정된 내용'}}))},usage:{total_tokens:4}};
 throw Error('Unexpected stage: '+options.stage);
}
