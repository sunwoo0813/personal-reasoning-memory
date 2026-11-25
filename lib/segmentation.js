// The storage order is immutable. These checks constrain contiguous partitions;
// they never sort events or move a late-finalized exchange ahead of its sources.
export const SEGMENTATION_POLICY_VERSION='purpose-v2';
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const PURPOSE_SCHEMA=object({questions:{type:'array',items:object({
 event_index:{type:'integer',minimum:1},
 relation:{type:'string',enum:['initial','continuation','new_purpose','uncertain']},
 purpose:{type:'string'},quote:{type:'string'},context_start_event_index:{type:'integer',minimum:1}
})}});

export const TIMING_RULES=`Event order is capture/finalization order (client_seq), NOT necessarily action-start order. Never reorder it. started_at is a client collector observation: for chat it may be a submit notification or a later DOM observation, without persisted provenance. It is NOT a verified message timestamp. ended_at is the collector's completion/finalization or page-end observation; completion_observed=false means a chat answer's completion was not observed. received_at is server receipt, not user action time. Missing or overlapping times do not prove causality or purpose. Use timing only as supporting context, never invent an exact action time.`;

export const questionAt=event=>event.event_type==='llm_exchange'&&typeof event.event_contents?.content_jsonb?.question==='string'?event.event_contents.content_jsonb.question:'';
export const hasCapturedContent=event=>{
 const value=event.event_contents?.content_jsonb;
 return typeof value==='string'?!!value.trim():['question','response','text','query'].some(key=>typeof value?.[key]==='string'&&value[key].trim());
};
function chatPage(value){
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='chatgpt.com')return null;
  return url.pathname==='/'||url.pathname.startsWith('/c/')?url.pathname:null;
 }catch{return null}
}
function sameConversation(page,chat){
 const a=chatPage(page.source_ref?.url),b=chatPage(chat.source_ref?.url);
 // The collector explicitly handles / -> local-chatgpt -> /c/<id> navigation.
 // A different established conversation in the same tab is not an anchor.
 return a&&b&&(a===b||a==='/'||a.startsWith('/c/local-chatgpt'));
}
export function temporalContext(events){
 return events.flatMap((event,index)=>{
  if(!questionAt(event).trim())return [];
  const start=Date.parse(event.started_at),end=Date.parse(event.ended_at);
  const tab=event.source_ref?.tab_id;
  const candidates=[];
  if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start&&tab!=null){
   for(let i=0;i<index;i++){
    const page=events[i],a=Date.parse(page.started_at),b=Date.parse(page.ended_at);
    if(page.event_type==='page_view'&&page.source_ref?.tab_id===tab&&sameConversation(page,event)&&Number.isFinite(a)&&Number.isFinite(b)&&a<=start&&start<=b&&a<=b)candidates.push(i+1);
   }
  }
  return [{event_index:index+1,observed_start:event.started_at||null,finalized_at:event.ended_at||null,
   server_received_at:event.received_at||null,start_provenance:'collector_observation_not_verified_message_time',
   candidate_context_starts:candidates}];
 });
}

export function purposeReviewSchema(events){
 const contexts=temporalContext(events);
 const schema=structuredClone(PURPOSE_SCHEMA);
 schema.properties.questions.items={anyOf:contexts.flatMap((context,index)=>{
  const make=(relations,starts)=>{
   const entry=structuredClone(PURPOSE_SCHEMA.properties.questions.items);
   entry.properties.event_index.enum=[context.event_index];
   entry.properties.relation.enum=relations;
   entry.properties.context_start_event_index.enum=starts;
   return entry;
  };
  const starts=[...context.candidate_context_starts,context.event_index];
  return index===0?[make(['initial'],starts)]:[make(['continuation'],starts),make(['new_purpose','uncertain'],[context.event_index])];
 })};
 return schema;
}

export function purposeInstructions(events){
 return `Independently review the user's research purposes BEFORE proposing episode boundaries. An Episode is a meaningful activity centered on one question or research objective, not a website, technology keyword, tab, answer-completion time, or research phase.
Return exactly one entry for EVERY llm_exchange with a nonempty question, in supplied event_index order. Use ONLY the user's question as evidence of intent, not assistant suggestions or page titles. quote must be an exact nonempty substring of that question. Name the user's core decision/research objective in purpose.
The first captured user question is initial. Subsequent questions are continuation when they refine, challenge, revise a hypothesis, compare alternatives, make a decision, or defer that SAME objective. A search -> source visit -> return to ChatGPT can continue that objective. Do not split these just because a hypothesis, technology, website, time gap, or investigative phase changes.
Use new_purpose when the user starts a genuinely independent decision/question, especially explicitly closing the old issue and starting another. The same app/project/conversation does NOT make different decision objectives one Episode. Assess meaning, not a phrase/keyword list. Quoted examples, negation and a follow-up phrased as a question are not by themselves a switch. Use uncertain when the relationship or intervening activity cannot be established, rather than guessing continuation.
context_start_event_index normally equals this question's event_index. This is a local timing-context anchor, NOT the start of the whole research objective or a reference to the prior question. For initial/continuation ONLY, you may select an earlier candidate_context_starts index listed for THIS question if the captured question, searches and intervening activity semantically support the SAME objective. This prevents a delayed-finalized question from being detached from its observed page/research context. Timing overlap alone is insufficient. Never bridge an independent new-purpose question. For new_purpose or uncertain use the question's own event_index. Do not invent times or missing text.
${TIMING_RULES}
Supporting timing candidates (not facts about intent): ${JSON.stringify(temporalContext(events))}`;
}

export function validatePurposeReview(result,events){
 const expected=events.flatMap((event,index)=>questionAt(event).trim()?[index+1]:[]);
 if(!Array.isArray(result?.questions)||JSON.stringify(result.questions.map(q=>q.event_index))!==JSON.stringify(expected))throw Error('조사 목적 검토에서 사용자 질문의 누락·중복·순서 오류가 있습니다.');
 const timing=new Map(temporalContext(events).map(value=>[value.event_index,value.candidate_context_starts]));
 const switches=result.questions.filter(q=>q.relation==='new_purpose').map(q=>q.event_index);
 for(const [i,q] of result.questions.entries()){
  if(!['initial','continuation','new_purpose','uncertain'].includes(q.relation)||(i===0?q.relation!=='initial':q.relation==='initial'))throw Error(`질문 ${q.event_index}의 관계가 올바르지 않습니다. 첫 질문만 initial이고 이후 질문은 continuation/new_purpose/uncertain입니다.`);
  if(typeof q.purpose!=='string'||!q.purpose.trim()||q.purpose.length>1000)throw Error(`질문 ${q.event_index}의 조사 목적 설명이 비어 있거나 너무 깁니다.`);
  if(typeof q.quote!=='string'||!q.quote.trim()||q.quote.length>4000||!questionAt(events[q.event_index-1]).includes(q.quote))throw Error(`질문 ${q.event_index}의 사용자 원문 근거가 일치하지 않습니다. 해당 이벤트의 fields.question에서 짧은 구절을 공백·문장부호까지 그대로 복사하세요. 답변·목적 요약·이벤트 ID는 인용문이 아닙니다.`);
  const start=q.context_start_event_index;
  const allowed=['initial','continuation'].includes(q.relation)?[...(timing.get(q.event_index)||[]),q.event_index]:[q.event_index];
  if(!Number.isInteger(start)||!allowed.includes(start)||switches.some(at=>start<at&&at<=q.event_index))throw Error(`질문 ${q.event_index}의 이전 맥락 연결이 관찰된 범위를 벗어나거나 새 조사 목적과 충돌합니다. 허용된 지역 맥락 후보: ${allowed.join(', ')}. 조사 목적 전체의 시작 위치가 아닙니다.`);
 }
 return result;
}

export function validatePurposeBoundaries(result,events,review){
 validatePurposeReview(review,events);
 const positions=new Map();let position=0;
 for(const [ep,episode] of result.episodes.entries())for(const id of episode.event_ids)positions.set(++position,ep);
 for(const [index,q] of review.questions.entries()){
  if(q.relation==='new_purpose'&&positions.get(q.event_index)===positions.get(q.event_index-1))throw Error(`명시적·독립적인 새 조사 목적을 놓쳤습니다. 이벤트 ${q.event_index} 앞에 Episode 경계가 필요합니다.`);
  if(q.context_start_event_index<q.event_index&&positions.get(q.context_start_event_index)!==positions.get(q.event_index))throw Error(`뒤늦게 확정된 질문 ${q.event_index}을 관련 맥락 ${q.context_start_event_index}에서 분리했습니다. 이 범위 안의 경계를 제거하세요.`);
  if(q.relation==='continuation'&&index>0&&positions.get(review.questions[index-1].event_index)!==positions.get(q.event_index))throw Error(`동일 조사 목적의 후속 질문 ${q.event_index}을 이전 질문과 불필요하게 분리했습니다. 목적 변화가 없다면 해당 범위 안의 경계를 제거하세요.`);
 }
 const contentIds=new Set(events.filter(hasCapturedContent).map(event=>event.id));
 if(result.episodes.length>1&&result.episodes.some(episode=>!episode.event_ids.some(id=>contentIds.has(id))))throw Error('본문 없는 방문 정보만으로 독립 Episode를 만들었습니다. 관련 조사 맥락에 포함하세요.');
 return result;
}

export function boundaryConstraints(events,review){
 validatePurposeReview(review,events);
 const forbidden=new Set(),required=[];
 const protect=(start,end)=>{for(let at=start;at<end;at++)forbidden.add(at)};
 for(const [index,q] of review.questions.entries()){
  protect(q.context_start_event_index,q.event_index);
  if(q.relation==='continuation'&&index>0)protect(review.questions[index-1].event_index,q.event_index);
  if(q.relation==='new_purpose')required.push(q.event_index-1);
 }
 if(required.some(at=>forbidden.has(at)))throw Error('조사 목적 검토의 필수 경계와 연속 맥락이 충돌합니다.');
 return {allowed_end_indices:events.map((_,index)=>index+1).filter(at=>!forbidden.has(at)),required_end_indices:required};
}
