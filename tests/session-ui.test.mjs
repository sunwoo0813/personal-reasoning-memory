import './helpers/jsx-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const {default:SessionDetail}=await import('../src/session-detail.jsx');
const {default:ActivityTimeline}=await import('../src/activity.jsx');
const {SourceDrawer}=await import('../src/analysis.jsx');
const session={id:'s1',started_at:'2026-11-19T00:00:00Z',recording_status:'closed',sync_status:'synced',event_count:2};
const sourceEvent={id:'event1',event_type:'llm_exchange',started_at:session.started_at,source_ref:{url:'https://example.com'},event_contents:{content_jsonb:{question:'기록부터 저장한다. 기록부터 저장한다.',response:'자료를 비교해보세요.'}}};
const ref={id:'ref1',event_id:'event1',field:'question',quote:'기록부터 저장한다.'};
const run={id:'run1',status:'complete',created_at:session.started_at,episodes:[{id:'episode1',sequence:1,title:'수집 범위 검토',goal:'저장할 범위 결정',boundary_reason:'동일한 조사 목적',reasoning_objects:[{id:'obj1',type:'decision',speaker:'user',text:'원본 기록부터 저장하기',object_evidence_links:[ref]}]}],summary:null};
const response=runs=>({available:true,summary_available:true,configured:true,runs});
const json=data=>({ok:true,json:async()=>data});
async function setup(fetchImpl){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost:3001'}),oldFetch=globalThis.fetch;
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};
 globalThis.fetch=fetchImpl;
 const {createRoot}=await import('react-dom/client');
 const root=createRoot(document.getElementById('root'));
 return {root,dom,async render(element){await act(async()=>{root.render(element);await new Promise(resolve=>setTimeout(resolve,0))})},async close(){await act(()=>root.unmount());dom.window.close();globalThis.fetch=oldFetch;delete globalThis.window;delete globalThis.document;delete globalThis.HTMLElement;delete globalThis.requestAnimationFrame;delete globalThis.IS_REACT_ACT_ENVIRONMENT}};
}
const byText=(selector,text)=>[...document.querySelectorAll(selector)].find(node=>node.textContent.includes(text));
const click=async node=>{assert.ok(node,'click target exists');await act(async()=>{node.click();await new Promise(resolve=>setTimeout(resolve,0))})};
async function input(node,value){await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new window.Event('input',{bubbles:true}));node.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0))})}

test('completed analysis opens flow, evidence highlights exact quotes and navigates to expanded activity',async()=>{
 const env=await setup(async url=>json(url.includes('/source/')?sourceEvent:response([run])));
 try{
  await env.render(React.createElement(SessionDetail,{session,events:[sourceEvent]}));
  assert.equal(document.querySelector('[role=tab][aria-selected=true]').textContent,'생각의 흐름');
  assert.match(document.body.textContent,/원본 기록부터 저장하기/);
  const trigger=byText('button','저장된 원문 확인');
  await click(trigger);
  assert.equal(document.querySelector('dialog').open,true);assert.equal(document.querySelectorAll('dialog mark').length,2);
  await click(document.querySelector('[aria-label="원문 닫기"]'));assert.equal(document.activeElement,trigger);
  await click(trigger);
  await click(byText('button','활동 기록에서 보기'));
  assert.equal(document.querySelector('dialog'),null);
  assert.equal(document.querySelector('[role=tab][aria-selected=true]').textContent,'활동 기록');
  assert.equal(document.querySelector('#activity-event1').open,true);
 }finally{await env.close()}
});
test('activity filters search body and reset without hiding nested matching conversations',async()=>{
 const page={id:'p',event_type:'page_view',started_at:'2026-11-19T00:00:00Z',ended_at:'2026-11-19T00:02:00Z',source_ref:{url:'https://example.com',tab_id:1},metadata:{title:'자료 페이지'},event_contents:{content_jsonb:{text:'별도의 본문검색어'}}};
 const chat={...sourceEvent,started_at:'2026-11-19T00:00:01Z',source_ref:page.source_ref};
 const env=await setup(async()=>json({}));
 try{
  await env.render(React.createElement(ActivityTimeline,{events:[page,chat]}));
  await click(byText('.activity-filters button','AI 대화'));
  assert.match(document.body.textContent,/관련 페이지/);assert.match(document.querySelector('[role=status]').textContent,/1건/);
  await click(byText('button','초기화'));
  await input(document.querySelector('input'),'본문검색어');
  assert.match(document.querySelector('[role=status]').textContent,/1건/);assert.match(document.querySelector('.activity-match').textContent,/본문검색어/);
  await input(document.querySelector('input'),'존재하지않음');
  assert.match(document.body.textContent,/조건에 맞는 활동이 없어요/);
 }finally{await env.close()}
});
test('late responses from a previous session do not overwrite the new selection',async()=>{
 let resolveOld;
 const env=await setup(url=>url.includes('/s1/')?new Promise(resolve=>{resolveOld=resolve}):Promise.resolve(json(response([{...run,id:'new-run',episodes:[{...run.episodes[0],title:'새 세션 주제'}]}]))));
 try{
  await env.render(React.createElement(SessionDetail,{key:'s1',session,events:[]}));
  await env.render(React.createElement(SessionDetail,{key:'s2',session:{...session,id:'s2'},events:[]}));
  await act(async()=>{resolveOld(json(response([run])));await new Promise(resolve=>setTimeout(resolve,0))});
  assert.match(document.body.textContent,/새 세션 주제/);assert.doesNotMatch(document.body.textContent,/수집 범위 검토/);
 }finally{await env.close()}
});
test('tabs support keyboard navigation',async()=>{
 const env=await setup(async()=>json(response([run])));
 try{
  await env.render(React.createElement(SessionDetail,{session,events:[sourceEvent]}));
  const flow=byText('[role=tab]','생각의 흐름');
  await act(()=>{flow.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))});
  assert.equal(document.querySelector('[role=tab][aria-selected=true]').textContent,'활동 기록');
  assert.equal(document.activeElement.textContent,'활동 기록');
 }finally{await env.close()}
});
test('summary failure leaves extracted objects readable and retry sends only a summary request',async()=>{
 const posts=[],failed={...run,summary:{status:'failed',error:'검토 실패'}};
 const env=await setup(async(url,options)=>{if(options?.method==='POST')posts.push(url);return json(options?.method==='POST'?{status:'queued'}:response([failed]))});
 try{
  await env.render(React.createElement(SessionDetail,{session,events:[]}));
  assert.match(document.body.textContent,/원본 기록부터 저장하기/);
  await click(byText('button','요약만 다시 시도'));
  assert.deepEqual(posts,['/api/analysis/run1/summary']);
 }finally{await env.close()}
});
test('source loading failure can be retried and cancelled',async()=>{
 let calls=0,closed=0;
 const env=await setup(async()=>{calls++;if(calls===1)throw Error('일시적인 오류');return json(sourceEvent)});
 try{
  await env.render(React.createElement(SourceDrawer,{runId:'run1',source:{ref},onClose:()=>closed++,onActivity:()=>{}}));
  assert.match(document.querySelector('[role=alert]').textContent,/일시적인 오류/);
  await click(byText('button','원문 다시 불러오기'));assert.equal(document.querySelectorAll('mark').length,2);
  await act(()=>{document.querySelector('dialog').dispatchEvent(new window.Event('cancel',{cancelable:true}))});assert.equal(closed,1);
 }finally{await env.close()}
});

 test('manual tab choice survives a late refresh after starting a new analysis',async()=>{
 let count=0,resolveRefresh;
 const env=await setup(async(url,options)=>{
  if(options?.method==='POST')return json({id:'new-run',status:'queued'});
  if(++count===1)return json(response([run]));
  return new Promise(resolve=>{resolveRefresh=resolve});
 });
 try{
  await env.render(React.createElement(SessionDetail,{session,events:[sourceEvent]}));
  await click(byText('button','다시 분석'));
  await click(byText('[role=tab]','활동 기록'));
  await act(async()=>{resolveRefresh(json(response([{...run,id:'new-run'}])));await new Promise(resolve=>setTimeout(resolve,0))});
  assert.equal(document.querySelector('[role=tab][aria-selected=true]').textContent,'활동 기록');
 }finally{await env.close()}
});

test('a source target inside a grouped page visit opens every enclosing disclosure',async()=>{
 const first={id:'first',event_type:'page_view',source_ref:{url:'https://example.com',tab_id:1},started_at:'2026-11-19T00:00:00.000Z',ended_at:'2026-11-19T00:00:00.100Z',metadata:{title:'첫 방문'},event_contents:{content_jsonb:{text:'첫 본문'}}};
 const second={...first,id:'second',started_at:'2026-11-19T00:00:01Z',ended_at:'2026-11-19T00:01:00Z'};
 const env=await setup(async()=>json({}));
 try{
  await env.render(React.createElement(ActivityTimeline,{events:[first,second],targetId:'first'}));
  assert.equal(document.querySelector('.activity-fragments').open,true);
  assert.equal(document.querySelector('#activity-first').open,true);
  assert.equal(document.querySelector('#activity-group-second').open,true);
 }finally{await env.close()}
});

test('activity search and scroll position survive tab switches and recap navigation stays available',async()=>{
 const env=await setup(async()=>json(response([run])));
 try{
  await env.render(React.createElement(SessionDetail,{session,events:[sourceEvent]}));
  await click(byText('[role=tab]','활동 기록'));
  await input(document.querySelector('input'),'기록부터');document.documentElement.scrollTop=220;
  await click(byText('[role=tab]','생각의 흐름'));
  assert.equal(document.querySelector('#session-panel-activity').hidden,true);
  assert.ok(byText('button','회고로 돌아가기'));
  await click(byText('[role=tab]','활동 기록'));
  assert.equal(document.querySelector('input').value,'기록부터');assert.equal(document.documentElement.scrollTop,220);
 }finally{await env.close()}
});

test('summary processing tells the user which verification stage is running',async()=>{
 const env=await setup(async()=>json(response([{...run,summary:{status:'processing',progress:{stage:'review_session_summary_items'}}}])));
 try{
  await env.render(React.createElement(SessionDetail,{session,events:[]}));
  assert.match(document.body.textContent,/각 문장과 원문 근거를 대조하고 있어요/);
 }finally{await env.close()}
});
