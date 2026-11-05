import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';

test('context menu never forwards editable or child-frame selections', () => {
 const listeners={},listen=name=>({addListener(fn){listeners[name]=fn}}),sent=[];
 const chrome={runtime:{onMessage:listen('message'),onInstalled:listen('installed')},tabs:{onActivated:listen('activated'),onRemoved:listen('removed'),sendMessage:(...args)=>{sent.push(args);return Promise.resolve()}},windows:{onFocusChanged:listen('focus')},webNavigation:{onCommitted:listen('committed'),onHistoryStateUpdated:listen('history')},alarms:{onAlarm:listen('alarm')},contextMenus:{onClicked:listen('context')}};
 const ctx=vm.createContext({chrome,crypto:webcrypto,URL,Date,Promise,Set,Error,console});
 vm.runInContext(fs.readFileSync('extension/worker.js','utf8'),ctx);
 const click=info=>listeners.context({menuItemId:'prm-highlight',selectionText:'sample',...info},{id:5});
 click({editable:true});
 click({editable:true,frameId:3,frameUrl:'https://example.com/'});
 click({editable:false,frameId:3});
 click({editable:false,frameUrl:'https://example.com/'});
 click({});
 assert.equal(sent.length,0);
 click({editable:false});
 click({editable:false,frameId:0});
 assert.equal(sent.length,2);
 assert.equal(sent[0][1].selectionText,'sample');
 assert.equal(sent[0][2].frameId,0);
});

test('rapid tab activations preserve each tab instead of re-reading the final active tab', async () => {
 const listeners={},listen=name=>({addListener(fn){listeners[name]=fn}}),saved=[];
 const tabs={2:{id:2,url:'https://github.com/',title:'GitHub'},3:{id:3,url:'https://supabase.com/',title:'Supabase'},4:{id:4,url:'https://www.sooplive.co.kr/',title:'SOOP'}};
 const chrome={
  runtime:{id:'prm-test',onMessage:listen('message'),onInstalled:listen('installed')},
  tabs:{onActivated:listen('activated'),onRemoved:listen('removed'),get:async id=>tabs[id],query:async q=>q.url?[{id:1}]:[tabs[4]],
   sendMessage:async(id,m)=>{if(m.channel==='prm-api'){if(m.path.endsWith('/events')){saved.push(...m.body.events);return {ok:true,body:{items:m.body.events.map(e=>({client_event_id:e.client_event_id,status:'saved'}))}}}if(m.path.endsWith('/close'))return {ok:true,body:{ok:true}};return {ok:true,body:{}}}return {url:tabs[id].url,title:tabs[id].title,text:'page'};}},
  windows:{onFocusChanged:listen('focus'),get:async()=>({focused:true}),getLastFocused:async()=>({focused:false})},
  webNavigation:{onCommitted:listen('committed'),onHistoryStateUpdated:listen('history')},alarms:{onAlarm:listen('alarm')},contextMenus:{onClicked:listen('context')}
 };
 const ctx=vm.createContext({chrome,indexedDB:new IDBFactory(),crypto:webcrypto,URL,Date,Promise,Set,Error,console});
 vm.runInContext(fs.readFileSync('extension/worker.js','utf8'),ctx);
 const control=(action,payload={})=>new Promise(resolve=>listeners.message({channel:'prm-control',action,payload},{id:'prm-test',url:'http://localhost:3000/'},resolve));
 await control('start',{session:{id:'test'}});
 for(const tabId of [2,3,4])listeners.activated({tabId,windowId:9});
 await control('status');
 const result=await control('stop');
 assert.equal(result.ok,true);
 assert.deepEqual(saved.filter(e=>e.event_type==='page_view').map(e=>e.source_ref.url),['https://github.com/','https://supabase.com/','https://www.sooplive.co.kr/']);
 assert.ok(saved.filter(e=>e.event_type==='page_view').every(e=>e.content?.text==='page' && e.capture_status==='complete' && typeof e.metadata.active_seconds==='number'));
 assert.ok(saved.every(e=>Date.parse(e.ended_at)>=Date.parse(e.started_at)));
});

test('connects an already open tab when its content script is unavailable', async () => {
 const listener={addListener(){}};let connected=false,injections=0;
 const chrome={runtime:{onMessage:listener,onInstalled:listener},tabs:{onActivated:listener,onRemoved:listener,sendMessage:async()=>{if(!connected)throw Error('no receiver');return {url:'https://example.com/',text:'page'}}},windows:{onFocusChanged:listener},webNavigation:{onCommitted:listener,onHistoryStateUpdated:listener},alarms:{onAlarm:listener},contextMenus:{onClicked:listener},scripting:{executeScript:async()=>{injections++;connected=true}}};
 const ctx=vm.createContext({chrome,crypto:webcrypto,URL,Date,Promise,Set,Error,console});
 vm.runInContext(fs.readFileSync('extension/worker.js','utf8'),ctx);
 const result=await vm.runInContext('pageSnapshot(2)',ctx);
 assert.equal(injections,1);assert.equal(result.url,'https://example.com/');
});

test('same-address navigation does not split a page while a different address does', async () => {
 const listeners={},listen=name=>({addListener(fn){listeners[name]=fn}});
 let tab={id:2,url:'https://example.com/a',title:'A'};
 const chrome={runtime:{id:'test',onMessage:listen('message'),onInstalled:listen('installed')},
  tabs:{onActivated:listen('activated'),onRemoved:listen('removed'),get:async()=>tab,query:async()=>[tab],sendMessage:async()=>({url:tab.url,title:tab.title})},
  windows:{onFocusChanged:listen('focus'),getLastFocused:async()=>({id:1,focused:true})},
  webNavigation:{onCommitted:listen('committed'),onHistoryStateUpdated:listen('history')},alarms:{onAlarm:listen('alarm')},contextMenus:{onClicked:listen('context')}};
 const ctx=vm.createContext({chrome,indexedDB:new IDBFactory(),crypto:webcrypto,URL,Date,Promise,Set,Error,console});
 vm.runInContext(fs.readFileSync('extension/worker.js','utf8'),ctx);
 const control=(action,payload={})=>new Promise(resolve=>listeners.message({channel:'prm-control',action,payload},{id:'test',url:'http://localhost:3000/'},resolve));
 await control('start',{session:{id:'s'}});
 listeners.committed({frameId:0,tabId:2,url:tab.url});
 listeners.history({frameId:0,tabId:2,url:tab.url});
 let status=await control('status');assert.equal(status.recorded,0);
 tab={...tab,url:'https://example.com/b',title:'B'};
 listeners.history({frameId:0,tabId:2,url:tab.url});
 status=await control('status');assert.equal(status.recorded,1);
 listeners.message({channel:'capture',type:'pagehide',snapshot:{url:'https://example.com/a'}},{tab},()=>{});
 status=await control('status');assert.equal(status.recorded,1);
});

test('Google results do not create a page visit and search remains recorded', async () => {
 const listeners={},listen=name=>({addListener(fn){listeners[name]=fn}});
 const tab={id:2,url:'https://www.google.com/search?q=instagram',title:'Google'};
 const chrome={runtime:{id:'test',onMessage:listen('message'),onInstalled:listen('installed')},
  tabs:{onActivated:listen('activated'),onRemoved:listen('removed'),get:async()=>tab,query:async()=>[tab],sendMessage:async()=>({url:tab.url,title:tab.title})},
  windows:{onFocusChanged:listen('focus'),getLastFocused:async()=>({id:1,focused:true})},
  webNavigation:{onCommitted:listen('committed'),onHistoryStateUpdated:listen('history')},alarms:{onAlarm:listen('alarm')},contextMenus:{onClicked:listen('context')}};
 const ctx=vm.createContext({chrome,indexedDB:new IDBFactory(),crypto:webcrypto,URL,Date,Promise,Set,Error,console});
 vm.runInContext(fs.readFileSync('extension/worker.js','utf8'),ctx);
 const control=(action,payload={})=>new Promise(resolve=>listeners.message({channel:'prm-control',action,payload},{id:'test',url:'http://localhost:3000/'},resolve));
 await control('start',{session:{id:'s'}});
 assert.equal((await control('status')).recorded,0);
 listeners.committed({frameId:0,tabId:2,url:tab.url});
 assert.equal((await control('status')).recorded,1);
 const state=await vm.runInContext('read()',ctx);
 assert.equal(state.queue[0].event_type,'search');
 assert.equal(state.queue[0].content.query,'instagram');
 assert.equal(state.openPage,null);
});

test('reload baselines old messages and records only submitted questions with their answers', () => {
 const listener={addListener(){}};
 const chrome={runtime:{onMessage:listener,onInstalled:listener},tabs:{onActivated:listener,onRemoved:listener},windows:{onFocusChanged:listener},webNavigation:{onCommitted:listener,onHistoryStateUpdated:listener},alarms:{onAlarm:listener},contextMenus:{onClicked:listener}};
 const ctx=vm.createContext({chrome,crypto:webcrypto,URL,Date,Promise,Set,Error,console});
 vm.runInContext(fs.readFileSync('extension/worker.js','utf8'),ctx);
 vm.runInContext(`
  const state={session:{id:'s'},paused:false,closing:false,seq:0,ids:[],queue:[],deviceId:'d',chats:{}};
  const old=[{role:'user',id:'old-u',text:'old'},{role:'assistant',id:'old-a',text:'old answer'}];
  const snap=(doc,messages,streaming=false)=>processChat(state,3,{url:'https://chatgpt.com/c/test',documentId:doc,messages,streaming},'2026-01-01T00:00:00Z');
  snap('doc1',old);
  state.chats['3'].armed=true;state.chats['3'].expectedPrompt='new 1';
  snap('doc1',[...old,{role:'user',id:'u1',text:''}]);
  const first=[...old,{role:'user',id:'u1',text:'new 1'},{role:'assistant',id:'a1',text:'answer 1'}];
  snap('doc1',first,true);snap('doc1',first,false);
  snap('doc2',[]);snap('doc2',first);
  state.chats['3'].armed=true;state.chats['3'].expectedPrompt='new 2';
  snap('doc2',[...first,{role:'user',id:'late-old',text:'older loaded after refresh'},{role:'assistant',id:'late-answer',text:'old answer'}]);
  const second=[...first,{role:'user',id:'u2',text:'new 2'},{role:'assistant',id:'a2',text:'answer 2'}];
  snap('doc2',second,true);snap('doc2',second,false);
  globalThis.result=state.queue;
 `,ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.result.map(e=>e.content))),[{question:'new 1',response:'answer 1'},{question:'new 2',response:'answer 2'}]);
 assert.ok(ctx.result.every(e=>e.capture_status==='complete'));
});

test('captures an answer completed in the background after stable ready observations', () => {
 const listener={addListener(){}};
 const chrome={runtime:{onMessage:listener,onInstalled:listener},tabs:{onActivated:listener,onRemoved:listener},windows:{onFocusChanged:listener},webNavigation:{onCommitted:listener,onHistoryStateUpdated:listener},alarms:{onAlarm:listener},contextMenus:{onClicked:listener}};
 const ctx=vm.createContext({chrome,crypto:webcrypto,URL,Date,Promise,Set,Error,console});
 vm.runInContext(fs.readFileSync('extension/worker.js','utf8'),ctx);
 vm.runInContext(`
  const state={session:{id:'s'},seq:0,ids:[],queue:[],deviceId:'d',chats:{}};
  const snap=(messages,streaming,ready,at)=>processChat(state,4,{url:'https://chatgpt.com/c/a',documentId:'doc',messages,streaming,ready},at);
  snap([],false,true,'2026-01-01T00:00:00Z');
  state.chats['4'].armed=true;state.chats['4'].expectedPrompt='question';state.chats['4'].submittedAt='2026-01-01T00:00:01Z';
  const messages=[{role:'user',id:'u',text:'question'},{role:'assistant',id:'a',text:'answer'}];
  snap(messages,false,true,'2026-01-01T00:00:02Z');
  snap(messages,false,true,'2026-01-01T00:00:06Z');
  globalThis.before=state.queue.length;
  snap(messages,false,true,'2026-01-01T00:00:07Z');
  snap(messages,false,true,'2026-01-01T00:00:15Z');
  globalThis.result=state.queue;
 `,ctx);
 assert.equal(ctx.before,0);assert.equal(ctx.result.length,1);
 assert.equal(ctx.result[0].capture_status,'complete');
 assert.equal(ctx.result[0].metadata.completion_method,'stable_ready');
 assert.equal(ctx.result[0].started_at,'2026-01-01T00:00:01Z');
});

test('captured answers are complete independently of completion observation, while truncated responses remain partial', () => {
 const listener={addListener(){}};
 const chrome={runtime:{onMessage:listener,onInstalled:listener},tabs:{onActivated:listener,onRemoved:listener},windows:{onFocusChanged:listener},webNavigation:{onCommitted:listener,onHistoryStateUpdated:listener},alarms:{onAlarm:listener},contextMenus:{onClicked:listener}};
 const ctx=vm.createContext({chrome,crypto:webcrypto,URL,Date,Promise,Set,Error,console});
 vm.runInContext(fs.readFileSync('extension/worker.js','utf8'),ctx);
 vm.runInContext(`
 const s={session:{id:'s'},seq:0,ids:[],queue:[],deviceId:'d',chats:{}};
 const chat={draft:{started:'2026-01-01T00:00:00Z',url:'https://chatgpt.com/',tabId:1,userId:'u',assistantId:'a',question:'q',response:'unfinished',complete:false}};
 finalizeChat(s,chat);
 chat.draft={started:'2026-01-01T00:00:00Z',url:'https://chatgpt.com/',tabId:1,userId:'u',assistantId:'a',question:'q',response:'truncated',responseTruncated:true,complete:true};
 finalizeChat(s,chat);globalThis.result=s.queue;
 `,ctx);
 assert.equal(ctx.result[0].capture_status,'complete');
 assert.equal(ctx.result[0].metadata.completion_observed,false);
 assert.equal(ctx.result[1].capture_status,'partial');
 assert.equal(ctx.result[1].metadata.truncated,true);
});

for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001']) {
test(`records, retries and closes through ${origin}`, async () => {
  const listeners = {};
  const listener = name => ({ addListener(fn) { listeners[name] = fn; } });
  let online = false;
  const received = new Map();
  const chrome = {
    runtime: { id: 'prm-test', onMessage: listener('message'), onInstalled: listener('installed') },
    tabs: { onActivated: listener('activated'), onRemoved: listener('removed'),
      query: async query => {
        if (!query.url) return [];
        assert.ok(query.url.includes(origin+'/*'));
        return [{ id: 1 }];
      },
      sendMessage: async (id, message) => {
        if (message.channel !== 'prm-api') return {};
        if (!online) throw new Error('offline');
        if (message.path.endsWith('/events')) {
          return { ok: true, body: { items: message.body.events.map(event => {
            const exists = received.has(event.client_event_id);
            received.set(event.client_event_id, event);
            return { client_event_id: event.client_event_id, status: exists ? 'duplicate' : 'saved' };
          }) } };
        }
        if (message.path.endsWith('/closing')) return { ok: true, body: {} };
        if (message.path.endsWith('/close')) {
          const ids = message.body.event_ids;
          return { ok: true, body: { ok: ids.length === received.size && ids.every(id => received.has(id)) } };
        }
        return { ok: false };
      }
    },
    windows: { onFocusChanged: listener('focus'), getLastFocused: async () => ({ focused: false }) },
    webNavigation: { onCommitted: listener('committed'), onHistoryStateUpdated: listener('history') },
    alarms: { onAlarm: listener('alarm'), create() {} },
    contextMenus: { onClicked: listener('context'), create() {} }
  };
  const ctx = vm.createContext({ chrome, indexedDB: new IDBFactory(), crypto: webcrypto, URL, Date, Promise, Set, Error, console });
  vm.runInContext(fs.readFileSync('extension/worker.js', 'utf8'), ctx);
  const control = (action, payload = {}) => new Promise(resolve => listeners.message({ channel: 'prm-control', action, payload }, { id:'prm-test', url:origin+'/' }, resolve));
  const status = await control('status');
  assert.ok(status.deviceId);
  await control('start', { session: { id:'test-session' } });
  listeners.message({ channel:'capture', type:'search', query:'example', url:'https://www.google.com/search?q=example' }, { tab: { id:2, url:'https://www.google.com/' } }, () => {});
  const chatSender = { tab: { id:3, url:'https://chatgpt.com/' } };
  listeners.message({channel:'capture',type:'chat',url:'https://chatgpt.com/',messages:[],streaming:false},chatSender,()=>{});
  listeners.message({channel:'capture',type:'chat-submit',url:'https://chatgpt.com/',seen:[]},chatSender,()=>{});
  listeners.message({channel:'capture',type:'chat',url:'https://chatgpt.com/c/local-chatgpt:123',messages:[{role:'user',id:'u1',text:'안녕'}],streaming:true},chatSender,()=>{});
  listeners.message({channel:'capture',type:'chat',url:'https://chatgpt.com/c/abc',messages:[{role:'user',id:'u1',text:'안녕'},{role:'assistant',id:'a1',text:'안녕하세요'}],streaming:true},chatSender,()=>{});
  listeners.message({channel:'capture',type:'chat',url:'https://chatgpt.com/c/abc',messages:[{role:'user',id:'u1',text:'안녕'},{role:'assistant',id:'a1',text:'안녕하세요'}],streaming:false},chatSender,()=>{});
  // Navigating to an existing conversation and submitting before its first
  // observer snapshot must retain the submission and baseline.
  listeners.message({channel:'capture',type:'chat-submit',url:'https://chatgpt.com/c/existing',seen:['old'],prompt:'다음 질문'},chatSender,()=>{});
  listeners.message({channel:'capture',type:'chat',url:'https://chatgpt.com/c/existing',messages:[{role:'user',id:'old',text:'이전 질문'},{role:'user',id:'u2',text:'다음 질문'},{role:'assistant',id:'a2',text:'다음 답변'}],streaming:true},chatSender,()=>{});
  listeners.message({channel:'capture',type:'chat',url:'https://chatgpt.com/c/existing',messages:[{role:'user',id:'old',text:'이전 질문'},{role:'user',id:'u2',text:'다음 질문'},{role:'assistant',id:'a2',text:'다음 답변'}],streaming:false},chatSender,()=>{});
  listeners.message({channel:'capture',type:'copy',text:'test selection',url:'https://example.com/'},{tab:{id:4,url:'https://example.com/'}},()=>{});
  let pending = await control('status');
  assert.equal(pending.pending, 4);
  const failed = await control('stop');
  assert.ok(failed.error);
  pending = await control('status');
  assert.equal(pending.closing, true);
  assert.equal(pending.pending, 4);
  online = true;
  const closed = await control('stop');
  assert.equal(closed.ok, true);
  const final = await control('status');
  assert.equal(final.session, null);
  assert.equal(final.pending, 0);
  assert.equal(received.size, 4);
  const chat = [...received.values()].find(event => event.event_type === 'llm_exchange');
  assert.equal(chat.content.question, '안녕');
  assert.equal(chat.content.response, '안녕하세요');
  assert.equal(chat.capture_status, 'complete');
  const secondChat=[...received.values()].find(event=>event.content.question==='다음 질문');
  assert.equal(secondChat.content.response,'다음 답변');
});

}
