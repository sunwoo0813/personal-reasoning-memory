'use client';
import {useEffect,useRef,useState} from 'react';

const labels={question:'질문',evidence:'근거',hypothesis:'가설',insight:'발견',contradiction:'반론',decision:'결정',open_question:'미해결 질문'};
const speakers={user:'사용자',assistant:'AI 응답',source:'웹 자료',unknown:'주체 미확인'};
const statusLabels={queued:'분석 대기 중',processing:'분할·추출 중',complete:'분할·추출 완료',failed:'분석 실패'};
const date=value=>new Date(value).toLocaleString('ko-KR');
async function request(url,method='GET'){
 const response=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'분석 결과를 불러오지 못했습니다.');return data;
}
export default function AnalysisPanel({session}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[runId,setRunId]=useState(null),[source,setSource]=useState(null),[reload,setReload]=useState(0);
 const generation=useRef(0),activeRun=useRef(null),sourceDialog=useRef(null);
 useEffect(()=>{
  const id=++generation.current;let timer;
  setData(null);setError('');setRunId(null);setSource(null);
  if(!session||session.recording_status!=='closed')return;
  async function refresh(){
   try{const next=await request(`/api/sessions/${session.id}/analysis`);if(generation.current!==id)return;setData(next);setError('');if(next.runs?.some(run=>['queued','processing'].includes(run.status)))timer=setTimeout(refresh,3000)}
   catch(e){if(generation.current===id)setError(e.message)}
  }
  refresh();return()=>{generation.current++;clearTimeout(timer)};
 },[session?.id,session?.recording_status,reload]);
 const run=data?.runs?.find(value=>value.id===runId)||data?.runs?.[0];
 useEffect(()=>{activeRun.current=run?.id},[run?.id]);
 useEffect(()=>{
  const dialog=sourceDialog.current;
  if(source&&dialog&&!dialog.open)dialog.showModal();
  return()=>{if(dialog?.open)dialog.close()};
 },[source]);
 async function start(){
  const id=generation.current;setBusy(true);setError('');setRunId(null);setSource(null);
  try{await request(`/api/sessions/${session.id}/analysis`,'POST');if(generation.current===id)setReload(value=>value+1)}catch(e){if(generation.current===id)setError(e.message)}finally{setBusy(false)}
 }
 async function openSource(ref){
  const id=generation.current,requestedRun=run.id;setError('');
  try{const next=await request(`/api/analysis/${run.id}/source/${ref.event_id}`);if(generation.current===id&&activeRun.current===requestedRun)setSource({event:next,ref})}catch(e){if(generation.current===id)setError(e.message)}
 }
 if(!session||session.recording_status!=='closed')return null;
 const pending=data?.runs?.some(value=>['queued','processing'].includes(value.status));
 return <section className="panel analysis-panel"><div className="panel-head"><div><h2>생각의 흐름</h2><p className="panel-description">기록을 조사 목적별로 나누고 질문·근거·결정을 추출합니다.</p></div><button className="text-button" disabled={busy||!data?.available||!data?.configured||pending} onClick={start}>{pending?'분석 중':run?'다시 분석':'분석하기'}</button></div>
 {error&&<p className="analysis-error" role="alert">{error}</p>}
 {data?.available===false&&<p className="analysis-note">분석 기능 설정이 필요합니다.</p>}
 {data?.available&&data.configured===false&&<p className="analysis-note">AI 분석 연결 설정이 필요합니다.</p>}
 {data?.available&&!run&&<p className="analysis-note">세션 분석을 시작하면 원문 근거와 함께 결과를 확인할 수 있습니다.</p>}
 {data?.runs?.length>1&&<label className="analysis-run-select">분석 이력<select value={run?.id||''} onChange={event=>{setRunId(event.target.value);setSource(null)}}>{data.runs.map(value=><option key={value.id} value={value.id}>{date(value.created_at)} · {statusLabels[value.status]}</option>)}</select></label>}
 {run&&<><p className="analysis-note" role="status">{statusLabels[run.status]} · {date(run.created_at)}</p>{run.error&&<p className="analysis-error">{run.error}</p>}
 {run.status==='complete'&&<p className="analysis-note">자동 추출 결과입니다. 인용문 일치만 확인했으며, 내용의 타당성과 판단 변화는 검토가 필요합니다.</p>}
 {[...(run.episodes||[])].sort((a,b)=>a.sequence-b.sequence).map(episode=><article className="analysis-episode" key={episode.id}><h3>{episode.sequence}. {episode.title}</h3><p className="analysis-note">{episode.goal}</p><details className="analysis-boundary"><summary>구분 이유</summary><p>{episode.boundary_reason}</p></details>{episode.reasoning_objects?.length?episode.reasoning_objects.map(item=><div className="analysis-object" key={item.id}><div className="analysis-object-meta"><strong>{labels[item.type]}</strong><span>{speakers[item.speaker]}</span></div><p>{item.text}</p>{item.object_evidence_links?.map(ref=><div className="analysis-evidence" key={ref.id}><blockquote>{ref.quote}</blockquote><button className="text-button" onClick={()=>openSource(ref)}>저장된 원문 확인</button></div>)}</div>):<p className="analysis-note">이 구간에서 원문으로 뒷받침되는 사고 요소를 찾지 못했습니다.</p>}</article>)}
 {source&&<dialog ref={sourceDialog} className="analysis-source" aria-label="분석 근거 원문" onCancel={()=>setSource(null)}><div className="panel-head"><h3>저장된 원문</h3><button className="text-button" onClick={()=>setSource(null)}>닫기</button></div><p className="analysis-note">{source.event.metadata?.title||source.event.source} · {date(source.event.started_at)}</p><pre>{typeof source.event.event_contents?.content_jsonb==='string'?source.event.event_contents.content_jsonb:source.event.event_contents?.content_jsonb?.[source.ref.field]||'원문이 없습니다.'}</pre></dialog>}
 </>}
 </section>;
}
