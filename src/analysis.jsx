'use client';
import {useEffect,useRef,useState} from 'react';
import {FiBookOpen,FiCheckCircle,FiHelpCircle,FiLayers,FiArrowUpRight,FiChevronRight,FiExternalLink,FiX} from 'react-icons/fi';
import {objectLabels,speakerLabels,objectGroup,quoteParts,summaryStatusLabels,summaryProgressLabels} from '../lib/analysis-view';

export async function analysisRequest(url,method='GET',signal){
 const response=await fetch(url,{method,signal,cache:'no-store',headers:{'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'분석 결과를 불러오지 못했습니다.');return data;
}
const date=value=>new Date(value).toLocaleString('ko-KR');
const fields={question:'내 질문',response:'AI 답변',text:'웹 본문·기록',query:'검색어'};
function EvidenceList({item,onSource}){
 return <details className="analysis-evidence-list"><summary>근거 {item.object_evidence_links.length}개</summary>{item.object_evidence_links.map(ref=><div className="analysis-evidence" key={ref.id}><blockquote>{ref.quote}</blockquote><button className="text-button" onClick={event=>onSource(ref,event.currentTarget)}>저장된 원문 확인 <FiExternalLink aria-hidden="true"/></button></div>)}</details>;
}
export function SourceDrawer({runId,source,onClose,onActivity}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const dialog=useRef(null),firstMatch=useRef(null);
 useEffect(()=>{const node=dialog.current;if(!node.open)node.showModal();return()=>{if(node.open)node.close()}},[]);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
  analysisRequest(`/api/analysis/${runId}/source/${source.ref.event_id}`,'GET',controller.signal).then(next=>{if(!controller.signal.aborted)setData(next)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
  return()=>controller.abort();
 },[runId,source.ref.event_id,reload]);
 useEffect(()=>{firstMatch.current?.scrollIntoView?.({block:'center'})},[data,source.ref]);
 const content=data?.event_contents?.content_jsonb;
 const value=typeof content==='string'&&source.ref.field==='text'?content:content?.[source.ref.field];
 function close(){dialog.current?.close();onClose()}
 function openActivity(){dialog.current?.close();onActivity(source.ref.event_id)}
 let marked=false;
 return <dialog ref={dialog} className="analysis-source source-drawer" aria-labelledby="source-title" onCancel={event=>{event.preventDefault();close()}}>
  <header className="panel-head"><div><p className="eyebrow">분석 당시 저장된 기록</p><h3 id="source-title">근거 원문</h3></div><button className="icon-button" aria-label="원문 닫기" onClick={close}><FiX/></button></header>
  {data&&<><p className="source-metadata">{data.metadata?.title||data.source||'저장된 활동'}<br/>{date(data.started_at)} · {fields[source.ref.field]||'원문'}</p><p className="analysis-note">강조된 문장과 앞뒤 맥락을 함께 확인하세요.</p></>}
  <div className="source-scroll" aria-busy={!data&&!error}>
   {error?<div role="alert"><p>{error}</p><button className="text-button" onClick={()=>setReload(value=>value+1)}>원문 다시 불러오기</button></div>:!data?<p role="status">원문을 불러오고 있어요…</p>:typeof value!=='string'?<p>이 필드의 원문이 없습니다.</p>:<><div className="source-text">{quoteParts(value,source.ref.quote).map((part,index)=>{
    if(!part.matched)return <span key={index}>{part.text}</span>;
    const ref=marked?undefined:firstMatch;marked=true;return <mark key={index} ref={ref}>{part.text}</mark>;
   })}</div>{!value.includes(source.ref.quote)&&<p className="analysis-error">저장된 인용 위치를 찾지 못했습니다. 원문을 확인해주세요.</p>}</>}
  </div>
  <footer className="source-footer"><button className="button secondary" onClick={openActivity}>활동 기록에서 보기 <FiChevronRight aria-hidden="true"/></button></footer>
 </dialog>;
}
function SummaryEntries({items,empty,numbered=false}){
 if(!items?.length)return <p className="summary-empty">{empty}</p>;
 const List=numbered?'ol':'ul';
 return <List className={'summary-entries'+(numbered?' summary-entries-numbered':'')}>{items.map((item,index)=><li key={index}>{numbered&&<span className="summary-step" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>}<p>{item.text}</p></li>)}</List>;
}
function RecapSection({name,title,Icon,badge,children}){
 return <section className={'recap-card recap-card-'+name} aria-labelledby={'recap-'+name+'-title'}><header className="recap-card-heading"><span className="recap-card-symbol" aria-hidden="true"><Icon/></span><h3 id={'recap-'+name+'-title'}>{title}</h3>{badge&&<span className="recap-badge">{badge}</span>}</header>{children}</section>;
}
export function SummaryCard({run,available,configured,busy,onRequest}){
 const job=run.summary,result=job?.status==='complete'?job.result:null;
 return <section className="session-recap apple-recap" aria-labelledby="recap-title"><header className="recap-header"><div><p className="eyebrow">이번 작업에서 남은 것</p><h2 id="recap-title">작업 회고</h2><p className="recap-subtitle">결정한 것과 이어서 생각할 것을 한눈에.</p></div><span className="recap-header-symbol" aria-hidden="true"><FiBookOpen/></span></header>
  {!available?<div className="recap-state-card"><p className="analysis-note">요약 기능 설정이 필요합니다. 기존 분석 결과는 아래에서 확인할 수 있어요.</p></div>:!job?<div className="recap-state-card"><p>주제와 결정, 이어서 확인할 질문을 한눈에 정리해보세요.</p><button className="button secondary" disabled={busy||!configured} onClick={onRequest}>요약 만들기</button></div>:job.status!=='complete'?<div className="recap-state-card summary-state"><p role="status">{job.status==='processing'?(summaryProgressLabels[job.progress?.stage]||summaryStatusLabels.processing):summaryStatusLabels[job.status]}</p>{job.status==='failed'?<><p className="analysis-note">분석 결과는 아래에서 계속 확인할 수 있어요.</p><details className="analysis-boundary"><summary>실패 이유</summary><p>{job.error}</p></details><button className="button secondary" disabled={busy||!configured} onClick={onRequest}>요약만 다시 시도</button></>:<p className="analysis-note">기다리는 동안 주제별 분석 결과를 읽을 수 있어요.</p>}</div>:null}
  {result&&<div className="recap-card-grid">
   <RecapSection name="decisions" title="내가 정한 것" Icon={FiCheckCircle}><SummaryEntries items={result.decisions} empty="기록에서 확인되는 내 결정이 없어요."/></RecapSection>
   <RecapSection name="questions" title="남은 질문" Icon={FiHelpCircle}><SummaryEntries items={result.open_questions} empty="기록에서 확인되는 미해결 질문이 없어요."/></RecapSection>
   <RecapSection name="overview" title="한눈에 돌아보기" Icon={FiBookOpen}><SummaryEntries items={result.overview} empty="원문으로 뒷받침되는 사고 요소가 없어 회고를 작성하지 않았어요."/></RecapSection>
   <RecapSection name="topics" title="살펴본 주제" Icon={FiLayers}><SummaryEntries items={result.topics} empty="추출된 주제가 없어요."/></RecapSection>
   <RecapSection name="suggestions" title="이어서 해볼 일" Icon={FiArrowUpRight} badge="AI 제안"><p className="recap-card-description">이번 기록을 바탕으로 제안한 다음 작업이에요.</p><SummaryEntries items={result.suggestions} numbered empty="추가로 제안할 작업이 없어요."/></RecapSection>
  </div>}
 </section>;
}
function EpisodeCard({episode,index,onSource}){
 const groups=[['questions','내 질문'],['decisions','내 결정'],['open_questions','남은 질문'],['other','그 밖의 생각과 자료']];
 return <details className="analysis-episode episode-card" open={index===0||undefined}><summary className="episode-heading"><span className="episode-number">{String(episode.sequence).padStart(2,'0')}</span><span><h3>{episode.title}</h3><p>{episode.goal}</p><span className="activity-muted">사고 요소 {episode.reasoning_objects.length}개</span></span><FiChevronRight className="episode-chevron" aria-hidden="true"/></summary><div className="episode-body"><details className="analysis-boundary"><summary>주제를 나눈 이유</summary><p>{episode.boundary_reason}</p></details>
  {!episode.reasoning_objects.length?<p className="analysis-note">이 구간에서 원문으로 뒷받침되는 사고 요소를 찾지 못했어요.</p>:groups.map(([key,title])=>{
   const items=episode.reasoning_objects.filter(item=>objectGroup(item)===key);
   return items.length?<section className="reasoning-group" key={key}><h4>{title}</h4>{items.map(item=><article className="analysis-object" id={'reasoning-'+item.id} key={item.id} tabIndex={-1}><div className="analysis-object-meta"><strong>{objectLabels[item.type]}</strong><span className={'speaker-tag '+item.speaker}>{speakerLabels[item.speaker]}</span></div><p>{item.text}</p><EvidenceList item={item} onSource={onSource}/></article>)}</section>:null;
  })}
 </div></details>;
}
export default function AnalysisPanel({run,summaryAvailable,configured,busy,onSummary,onActivity}){
 const [source,setSource]=useState(null);
 function closeSource(){const button=source?.trigger;setSource(null);button?.focus()}
 return <div className="analysis-content">
  {run.status==='failed'&&<div className="analysis-error" role="alert"><strong>분석을 완료하지 못했어요.</strong><p>{run.error}</p><p>상단의 다시 분석으로 새 분석을 요청할 수 있어요.</p></div>}
  {run.status==='complete'&&<><SummaryCard run={run} available={summaryAvailable} configured={configured} busy={busy} onRequest={onSummary}/><p className="analysis-disclaimer">자동으로 정리한 결과예요. 원문 인용과 내용의 타당성은 구분되며, AI 제안은 내 결정으로 간주하지 않아요.</p><div className="section-head"><div><h2>주제별 생각의 흐름</h2><p>주제를 펼쳐 질문과 결정, 근거를 확인하세요.</p></div><span className="activity-muted">{run.episodes.length}개 주제</span></div>{run.episodes.map((episode,index)=><EpisodeCard key={episode.id} episode={episode} index={index} onSource={(ref,trigger)=>setSource({ref,trigger})}/>)}</>}
  {source&&<SourceDrawer key={source.ref.id} runId={run.id} source={source} onClose={closeSource} onActivity={id=>{setSource(null);onActivity(id)}}/>}
 </div>;
}
