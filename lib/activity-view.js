import {buildActivityGroups} from './activity-timeline.js';
export const activityLabels={search:'검색',page_view:'페이지',llm_exchange:'AI 대화',copy_highlight:'복사·하이라이트'};
export function eventText(event){
 const content=event.event_contents?.content_jsonb;
 return [event.metadata?.title,event.source_ref?.url,typeof content==='string'?content:Object.values(content||{}).filter(value=>typeof value==='string').join('\n')].filter(Boolean).join('\n');
}
export function eventTitle(event){
 const content=event.event_contents?.content_jsonb;
 return (event.event_type==='search'?content?.query||(typeof content==='string'?content:''):event.event_type==='llm_exchange'?content?.question:event.event_type==='copy_highlight'?content?.text||(typeof content==='string'?content:''):event.metadata?.title||event.source_ref?.url)||'제목 없는 기록';
}
export function captureNotice(e){
 const content=e.event_contents?.content_jsonb;
 if(e.capture_status==='error')return {label:'수집 오류',detail:'활동 수집 중 오류가 발생했습니다.',tone:'error'};
 if(e.metadata?.truncated)return {label:'일부 저장됨',detail:'내용이 길어 일부만 저장되었습니다.',tone:'partial'};
 if(e.event_type==='page_view'&&!(typeof content==='string'?content:content?.text))return {label:'방문 정보만 저장됨',detail:e.metadata?.extraction_status==='failed'?'본문을 추출하지 못했습니다.':'이 기록에는 저장된 본문이 없습니다.',tone:'partial'};
 if(e.event_type==='llm_exchange'){
  if(!content?.question||!content?.response)return {label:'일부 저장됨',detail:'질문 또는 답변이 누락되었습니다.',tone:'partial'};
  if(e.metadata?.completion_observed===false)return {label:'대화 저장됨',detail:'질문과 답변은 저장했지만 답변이 끝났는지는 확인하지 못했습니다.',tone:'partial'};
 }
 if(e.capture_status==='partial')return {label:'일부 저장됨',detail:e.event_type==='search'?'검색 제출 여부를 확인하지 못했습니다.':e.event_type==='copy_highlight'?'원문 내 위치 정보가 없습니다.':'일부 수집 정보를 확인하지 못했습니다.',tone:'partial'};
 return {label:e.event_type==='page_view'?'본문 저장됨':e.event_type==='llm_exchange'?'대화 저장됨':'저장됨',detail:'',tone:'ok'};
}
export function activitySearchSnippet(event,query){
 if(!query.trim())return '';
 const text=eventText(event),index=text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
 if(index<0)return '';
 return (index>50?'…':'')+text.slice(Math.max(0,index-50),index+query.trim().length+90)+(index+query.trim().length+90<text.length?'…':'');
}
export function filterActivityGroups(events,{type='all',query=''}={}){
 const needle=query.trim().toLocaleLowerCase();
 const matches=e=>(type==='all'||e.event_type===type)&&(!needle||eventText(e).toLocaleLowerCase().includes(needle));
 let count=0;
 const groups=buildActivityGroups(events).flatMap(group=>{
  const parentMatch=matches(group.event)||group.fragments?.some(matches);
  const children=group.children.filter(matches);
  if(parentMatch)count+=group.fragments?group.fragments.filter(matches).length:1;
  count+=children.length;
  return parentMatch||children.length?[{...group,children,contextOnly:!parentMatch}]:[];
 });
 return {groups,count};
}
