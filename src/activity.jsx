'use client';
import {useEffect,useRef,useState} from 'react';
import {FiSearch,FiGlobe,FiMessageCircle,FiCopy,FiChevronDown} from 'react-icons/fi';
import {describePage} from '../lib/page-labels';
import {activityLabels,eventTitle,captureNotice,activitySearchSnippet,filterActivityGroups} from '../lib/activity-view';
const icons={search:FiSearch,page_view:FiGlobe,llm_exchange:FiMessageCircle,copy_highlight:FiCopy};
const clock=value=>{const d=new Date(value);return Number.isNaN(d.valueOf())?'시간 정보 없음':d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});};
function safeLink(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?u.href:null}catch{return null}}
function duration(seconds){if(!Number.isFinite(seconds))return '시간 정보 없음';if(seconds<60)return `${seconds}초`;return `${Math.floor(seconds/60)}분 ${seconds%60}초`;}
function TextBlock({label,value}){return <section className="activity-content-block"><h4>{label}</h4><p className="activity-text" tabIndex={0}>{typeof value==='string'&&value?value:'내용이 기록되지 않았습니다.'}</p></section>}
function ActivityCard({group,query='',targetId}){
 const {event:e,children=[],fragments,contextOnly}=group;
 const content=e.event_contents?.content_jsonb,value=content&&typeof content==='object'?content:{};
 const notice=captureNotice(e),Icon=icons[e.event_type]||FiGlobe;
 const link=safeLink(e.source_ref?.url),root=useRef(null);
 const targeted=targetId===e.id||fragments?.some(item=>item.id===targetId);
 useEffect(()=>{
  if(!targeted)return;
  root.current.open=true;if(!fragments){root.current.scrollIntoView?.({block:'center',behavior:'smooth'});root.current.querySelector('summary')?.focus();}
 },[targeted,targetId]);
 return <article className={'activity-row'+(contextOnly?' activity-context':'')}>
  <details ref={root} id={(fragments?'activity-group-':'activity-')+e.id} className="activity-record" open={targeted||undefined}>
   <summary className="activity-row-heading"><span className="activity-marker"><Icon aria-hidden="true"/></span><span className="activity-row-copy"><span className="activity-heading"><span>{activityLabels[e.event_type]||'활동'}{contextOnly?' · 관련 페이지':''}</span><time dateTime={e.started_at}>{clock(e.started_at)}</time></span><strong className="activity-title">{e.event_type==='page_view'?describePage(e.source_ref?.url,e.metadata?.title).title:String(eventTitle(e))}</strong><span className={'capture-badge '+notice.tone}>{notice.label}</span>{fragments&&<span className="activity-muted"> · 방문 {fragments.length}건 묶음</span>}</span><FiChevronDown className="activity-chevron" aria-hidden="true"/></summary>
   <div className="activity-detail-body">
    {notice.detail&&<p className="activity-warning">{notice.detail}</p>}
    {e.event_type==='page_view'&&<><p className="activity-muted">{clock(e.started_at)} ~ {clock(e.ended_at)} · 활성 시간 {duration(e.metadata?.active_seconds)}</p><TextBlock label="저장된 본문" value={typeof content==='string'?content:value.text}/>{value.extracted_at&&<p className="activity-muted">수집 시각 {new Date(value.extracted_at).toLocaleString('ko-KR')}</p>}</>}
    {e.event_type==='llm_exchange'&&<><TextBlock label="내 질문" value={value.question}/><TextBlock label="AI 답변" value={value.response}/>{e.metadata?.completion_observed===true&&<p className="activity-muted">답변 완료 관찰 {clock(e.ended_at)}</p>}</>}
    {e.event_type==='search'&&<TextBlock label="검색어" value={value.query||content}/>}
    {e.event_type==='copy_highlight'&&<TextBlock label="복사·하이라이트 내용" value={value.text||content}/>}
    {link&&<a href={link} target="_blank" rel="noreferrer" className="text-button">원본 페이지 열기 ↗</a>}
    {fragments&&<details className="activity-fragments" open={fragments?.some(item=>item.id===targetId)||undefined}><summary>묶인 방문 {fragments.length}건 확인</summary>{fragments.map(item=><ActivityCard key={item.id} group={{event:item}} targetId={targetId}/>)}</details>}
    <details className="activity-raw"><summary>기술 정보</summary><pre className="event-content">{JSON.stringify(fragments||e,null,2)}</pre></details>
   </div>
  </details>
  {query.trim()&&<p className="activity-match">{(activitySearchSnippet(e,query)||fragments?.map(item=>activitySearchSnippet(item,query)).find(Boolean))}</p>}
  {children.length>0&&<div className="activity-children">{children.map(child=><ActivityCard key={child.id} group={{event:child}} query={query} targetId={targetId}/>)}</div>}
 </article>;
}
export default function ActivityTimeline({events,targetId,onClearTarget}){
 const [type,setType]=useState('all'),[query,setQuery]=useState('');
 useEffect(()=>{if(targetId){setType('all');setQuery('')}},[targetId]);
 const result=filterActivityGroups(events,{type:targetId?'all':type,query:targetId?'':query});
 function changeType(value){onClearTarget?.();setType(value)}
 return <div className="activity-browser">
  <label className="activity-search"><FiSearch aria-hidden="true"/><span className="sr-only">활동 내용 검색</span><input type="search" placeholder="제목, 주소, 대화 내용 검색" value={query} onChange={e=>{onClearTarget?.();setQuery(e.target.value)}}/></label>
  <div className="activity-filters" role="group" aria-label="활동 종류"><button type="button" aria-pressed={type==='all'} onClick={()=>changeType('all')}>전체</button>{Object.entries(activityLabels).map(([key,label])=><button key={key} type="button" aria-pressed={type===key} onClick={()=>changeType(key)}>{label}</button>)}</div>
  <div className="activity-result-count"><span role="status">활동 {result.count}건{type!=='all'||query?' 검색됨':''}</span>{(type!=='all'||query)&&<button className="text-button" onClick={()=>{setType('all');setQuery('');onClearTarget?.()}}>초기화</button>}</div>
  {!events.length?<div className="empty">아직 기록된 활동이 없어요.</div>:!result.groups.length?<div className="empty">조건에 맞는 활동이 없어요. 검색어나 필터를 바꿔보세요.</div>:<div className="activity-timeline">{result.groups.map(group=><ActivityCard key={group.event.id} group={group} query={query} targetId={targetId}/>)}</div>}
 </div>;
}
