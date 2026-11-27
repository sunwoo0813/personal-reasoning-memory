'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import ActivityTimeline from './activity';
import AnalysisPanel,{analysisRequest} from './analysis';
import {recordingLabels,syncLabels,runStatusLabels} from '../lib/analysis-view';

function useSessionAnalysis(session){
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(session.recording_status==='closed'),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(session.recording_status!=='closed'){setLoading(false);return;}
  const controller=new AbortController();let timer;
  async function refresh(){
   try{
    const next=await analysisRequest(`/api/sessions/${session.id}/analysis`,'GET',controller.signal);
    if(controller.signal.aborted)return;
    setData(next);setError('');setLoading(false);
    if(next.runs?.some(run=>['queued','processing'].includes(run.status)||['queued','processing'].includes(run.summary?.status)))timer=setTimeout(refresh,3000);
   }catch(e){if(!controller.signal.aborted){setError(e.message);setLoading(false)}}
  }
  refresh();return()=>{controller.abort();clearTimeout(timer)};
 },[session.id,session.recording_status,revision]);
 return {data,error,loading,refresh:()=>setRevision(value=>value+1)};
}
export default function SessionDetail({session,events,eventsLoading,eventsError,onRetryEvents,onRemove}){
 const {data,error,loading,refresh}=useSessionAnalysis(session);
 const [tab,setTab]=useState(null),[runId,setRunId]=useState(null),[targetId,setTargetId]=useState(null),[busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
 const alive=useRef(false),tabRefs=useRef([]),root=useRef(null),scrollPositions=useRef({flow:0,activity:0});
 const [visited,setVisited]=useState({flow:false,activity:false});
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const runs=data?.runs||[],run=runs.find(item=>item.id===runId)||runs[0];
 const selectedTab=tab||(runs.some(item=>item.status==='complete')?'flow':'activity');
 function scrollHost(){return window.matchMedia?.('(max-width: 900px)').matches?(document.scrollingElement||document.documentElement):(root.current?.closest('.project-column')||document.documentElement)}
 function changeTab(value){scrollPositions.current[selectedTab]=scrollHost().scrollTop;setTab(value)}
 useLayoutEffect(()=>{scrollHost().scrollTop=scrollPositions.current[selectedTab]},[selectedTab]);
 useEffect(()=>{setVisited(previous=>previous[selectedTab]?previous:{...previous,[selectedTab]:true})},[selectedTab]);
 function returnToRecap(){root.current?.querySelector('.session-recap')?.scrollIntoView?.({block:'start',behavior:'smooth'})}
 const pending=runs.some(item=>['queued','processing'].includes(item.status));
 const eligible=session.recording_status==='closed'&&session.sync_status==='synced';
 async function act(kind){
  setBusy(true);setActionError('');
  try{
   const next=await analysisRequest(kind==='summary'?`/api/analysis/${run.id}/summary`:`/api/sessions/${session.id}/analysis`,'POST');
   if(!alive.current)return;
   if(kind==='analysis'){setRunId(next.id);changeTab('flow')}
   refresh();
  }catch(e){if(alive.current)setActionError(e.message)}finally{if(alive.current)setBusy(false)}
 }
 function openActivity(id){setTargetId(id);changeTab('activity')}
 function tabKey(event,index){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-index;changeTab(next?'activity':'flow');tabRefs.current[next]?.focus();
 }
 return <section ref={root} className="panel session-detail" aria-labelledby="session-detail-title"><div className="session-sticky"><header className="session-detail-header"><div><p className="eyebrow">선택한 작업 세션</p><h2 id="session-detail-title">{new Date(session.started_at).toLocaleString('ko-KR',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})}</h2><div className="session-meta"><span>{recordingLabels[session.recording_status]||'상태 확인 필요'}</span><span>{syncLabels[session.sync_status]||'동기화 확인 필요'}</span><span>활동 {session.event_count??events.length}건</span></div></div><div className="session-detail-actions">{eligible&&<button className="button" disabled={busy||pending||loading||!data?.available||!data?.configured} onClick={()=>act('analysis')}>{pending?'분석 중':run?'다시 분석':'분석하기'}</button>}{session.recording_status==='closed'&&<button className="text-button delete-session" onClick={onRemove}>세션 삭제</button>}</div></header>
  {session.recording_status==='closed'&&!eligible&&<p className="analysis-note">활동 전송과 저장이 끝나면 분석할 수 있어요.</p>}
  {data?.available===false&&<p className="analysis-note">분석 기능 설정이 필요합니다.</p>}
  {data?.available&&data.configured===false&&<p className="analysis-note">AI 분석 연결 설정이 필요합니다.</p>}
  {error&&<div className="analysis-error" role="alert">{error} <button className="text-button" onClick={refresh}>다시 불러오기</button></div>}{actionError&&<p className="analysis-error" role="alert">{actionError}</p>}
  <div className="session-navigation"><div className="session-tabs" role="tablist" aria-label="세션 상세 보기">{[['flow','생각의 흐름'],['activity','활동 기록']].map(([value,label],index)=><button key={value} ref={node=>{tabRefs.current[index]=node}} type="button" id={'session-tab-'+value} role="tab" aria-selected={selectedTab===value} aria-controls={'session-panel-'+value} tabIndex={selectedTab===value?0:-1} onClick={()=>changeTab(value)} onKeyDown={event=>tabKey(event,index)}>{label}</button>)}</div>{selectedTab==='flow'&&run?.status==='complete'&&<button className="text-button recap-return" onClick={returnToRecap}>회고로 돌아가기 ↑</button>}</div></div>
  <div id="session-panel-activity" role="tabpanel" aria-labelledby="session-tab-activity" className="session-tab-content" hidden={selectedTab!=='activity'}>
   {(selectedTab==='activity'||visited.activity)&&(eventsError?<div className="analysis-error" role="alert">{eventsError} <button className="text-button" onClick={onRetryEvents}>활동 다시 불러오기</button></div>:eventsLoading?<p className="empty" role="status">활동을 불러오고 있어요…</p>:<ActivityTimeline events={events} targetId={selectedTab==='activity'?targetId:null} onClearTarget={()=>setTargetId(null)}/>)}
  </div>
  <div id="session-panel-flow" role="tabpanel" aria-labelledby="session-tab-flow" className="session-tab-content" hidden={selectedTab!=='flow'}>
   {(selectedTab==='flow'||visited.flow)&&<>
    {loading&&!data?<p className="empty" role="status">분석 결과를 불러오고 있어요…</p>:session.recording_status!=='closed'?<div className="empty"><h3>지금은 활동을 기록하고 있어요</h3><p>작업을 종료하고 저장을 마치면 생각의 흐름을 분석할 수 있어요.</p></div>:data?.available===false?<div className="empty">분석 기능 설정이 필요합니다.</div>:!run?<div className="empty"><h3>기록을 생각의 흐름으로 정리해보세요</h3><p>{!eligible?'활동 전송과 저장이 끝나면 분석할 수 있어요.':data?.configured===false?'AI 분석 연결 설정이 필요합니다.':'분석하기를 누르면 주제, 질문과 결정, 다음 작업 제안을 정리해드려요.'}</p><p>AI 분석과 자동 요약에는 API 사용량이 발생해요.</p></div>:<>
     <div className="analysis-toolbar"><p className="analysis-note" role="status">{runStatusLabels[run.status]}</p>{runs.length>1&&<details className="analysis-history"><summary>분석 이력</summary><label>확인할 분석<select value={run.id} onChange={event=>{setRunId(event.target.value);setTargetId(null)}}>{runs.map(item=><option value={item.id} key={item.id}>{new Date(item.created_at).toLocaleString('ko-KR')} · {runStatusLabels[item.status]}</option>)}</select></label></details>}</div>
     {['queued','processing'].includes(run.status)?<div className="analysis-progress" role="status"><span className="progress-dot"/>활동을 주제별로 나누고 근거를 정리하고 있어요.<p>활동 기록 탭은 계속 확인할 수 있어요. 분석 워커가 실행 중이어야 작업이 진행됩니다.</p></div>:<AnalysisPanel key={run.id} run={run} summaryAvailable={data?.summary_available!==false} configured={data?.configured} busy={busy} onSummary={()=>act('summary')} onActivity={openActivity}/>}
    </>}
   </>}
  </div>
 </section>;
}
