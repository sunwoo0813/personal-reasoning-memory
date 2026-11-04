'use client';
import {describePage} from '../lib/page-labels';
import {buildActivityGroups} from '../lib/activity-timeline';

const labels={search:'검색',page_view:'페이지 방문',llm_exchange:'LLM 대화',copy_highlight:'복사 · 하이라이트'};
const icons={search:'⌕',page_view:'↗',llm_exchange:'✳',copy_highlight:'❝'};
const clock=value=>{const date=new Date(value);return Number.isNaN(date.valueOf())?'시간 정보 없음':date.toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit',second:'2-digit'});};
function safeLink(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?u.href:null}catch{return null}}
function duration(seconds){if(!Number.isFinite(seconds))return '시간 정보 없음';if(seconds<60)return `${seconds}초`;return `${Math.floor(seconds/60)}분 ${seconds%60}초`;}
function text(value){return typeof value==='string'?value:'';}
function PageLink({event}){const url=safeLink(event.source_ref?.url);return url?<a href={url} target="_blank" rel="noreferrer">원본 페이지 열기 ↗</a>:null}
function warning(e){if(e.capture_status==='error')return '수집 오류';if(e.event_type==='llm_exchange'){const content=e.event_contents?.content_jsonb;if(e.metadata?.truncated)return '대화 내용이 길어 일부만 저장됨';if(!content?.question||!content?.response)return '질문 또는 답변이 누락됨';if(e.metadata?.completion_observed===false)return '질문과 답변 저장됨 · 답변 완료 여부 미확인';if(e.capture_status==='partial')return '메시지 식별자 또는 수집 상태 확인 필요';return null}if(e.capture_status!=='partial')return null;if(e.event_type==='search')return '검색 제출 여부를 확인하지 못함';if(e.event_type==='copy_highlight')return '원문 내 위치 정보 없음';return '일부 정보 확인 필요'}
function DetailText({value}){if(!value)return <p className="activity-muted">내용이 기록되지 않았습니다.</p>;if(value.length<=180)return <p className="activity-text">{value}</p>;return <details className="activity-expand"><summary><span className="activity-preview">{value.slice(0,180)}…</span><span className="activity-more">전체 보기</span></summary><p className="activity-text">{value}</p></details>}
function ActivityCard({event:e,children,fragments}){
 const content=e.event_contents?.content_jsonb;const value=typeof content==='object'&&content!==null?content:{};const notice=warning(e);const page=e.event_type==='page_view'?describePage(e.source_ref?.url,e.metadata?.title):null;
 return <article className="activity-item"><div className="activity-marker" aria-hidden="true">{icons[e.event_type]||'•'}</div><div className="activity-body"><div className="activity-heading"><span>{labels[e.event_type]||'활동'}</span><time dateTime={e.started_at}>{clock(e.started_at)}</time></div>
 {e.event_type==='search'&&<><strong className="activity-title">{text(value.query)||text(content)||'검색어 없음'}</strong><p className="activity-muted">{e.metadata?.engine||e.source||'검색'}</p></>}
 {e.event_type==='page_view'&&<><strong className="activity-title">{page.title}</strong><p className="activity-muted">{page.category!=='페이지 방문'?page.category:page.site}</p><p className="activity-muted">{clock(e.started_at)} ~ {clock(e.ended_at)} · 활성 시간 {duration(e.metadata?.active_seconds)}</p><p className="activity-muted"><PageLink event={e}/></p>{fragments&&<p className="activity-muted">인접한 짧은 방문 기록 2건을 묶어 표시</p>}</>}
 {e.event_type==='llm_exchange'&&<><p className="activity-muted">질문 전송 {clock(e.started_at)}{e.metadata?.completion_observed===true&&e.ended_at?` · 답변 완료 관찰 ${clock(e.ended_at)}`:''}</p><div className="activity-conversation"><span>질문</span><DetailText value={text(value.question)}/></div><div className="activity-conversation"><span>답변</span><DetailText value={text(value.response)}/></div><PageLink event={e}/></>}
 {e.event_type==='copy_highlight'&&<><p className="activity-muted">{e.metadata?.action==='highlight'?'선택 영역 기록':'복사'}</p><DetailText value={text(value.text)||text(content)}/><PageLink event={e}/></>}
 {notice&&<p className="activity-warning">{notice}</p>}
 {children}
 <details className="activity-raw"><summary>원본 데이터 보기</summary><pre className="event-content">{JSON.stringify(fragments||e,null,2)}</pre></details>
 </div></article>;
}
export default function ActivityTimeline({events}){
 const groups=buildActivityGroups(events);
 if(!groups.length)return <div className="empty">표시할 활동이 없습니다.</div>;
 return <div className="activity-timeline">{groups.map(({event,children,fragments})=><ActivityCard key={event.id} event={event} fragments={fragments}>{children.map(child=><ActivityCard key={child.id} event={child}/>)}</ActivityCard>)}</div>;
}
