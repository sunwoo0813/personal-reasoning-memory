// Very short adjacent fragments can result from duplicate navigation signals.
// Group only for display; preserve both original records for inspection.
export function groupPageFragments(events) {
 const sorted=events.filter(event=>{
  if(event.event_type!=='page_view')return true;
  try {const u=new URL(event.source_ref?.url);return !(u.hostname==='www.google.com'&&u.pathname==='/search');}catch{return true;}
 }).sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at)||(a.client_seq??0)-(b.client_seq??0));
 const result=[];
 for(const event of sorted){
  const previous=result.at(-1), first=previous?.event;
  const elapsed=first?Date.parse(first.ended_at)-Date.parse(first.started_at):NaN;
  const gap=first?Date.parse(event.started_at)-Date.parse(first.ended_at):NaN;
  if(first&&first.event_type==='page_view'&&event.event_type==='page_view'&&first.source_ref?.url&&first.source_ref.url===event.source_ref?.url&&first.source_ref?.tab_id!=null&&first.source_ref.tab_id===event.source_ref?.tab_id&&elapsed>=0&&elapsed<=250&&gap>=0&&gap<=5000&&!previous.fragments){
   result[result.length-1]={event:{...event,started_at:first.started_at,metadata:{...event.metadata,active_seconds:(first.metadata?.active_seconds||0)+(event.metadata?.active_seconds||0)}},fragments:[first,event]};
  }else result.push({event,fragments:null});
 }
 return result;
}

export function buildActivityGroups(events) {
 const groups=[];
 for(const entry of groupPageFragments(events)){
  const e=entry.event;
  const target=['llm_exchange','copy_highlight'].includes(e.event_type)&&e.source_ref?.url&&e.source_ref?.tab_id!=null
   ? [...groups].reverse().find(group=>{
    const p=group.event;
    return p.event_type==='page_view'&&p.source_ref?.url===e.source_ref.url&&p.source_ref?.tab_id===e.source_ref.tab_id&&Date.parse(e.started_at)>=Date.parse(p.started_at)&&Date.parse(e.started_at)<Date.parse(p.ended_at);
   }):null;
  if(target)target.children.push(e);
  else groups.push({...entry,children:[]});
 }
 return groups;
}
