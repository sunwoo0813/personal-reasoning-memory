import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';

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

test('records locally, recovers after a failed upload and closes only after syncing', async () => {
  const listeners = {};
  const listener = name => ({ addListener(fn) { listeners[name] = fn; } });
  let online = false;
  const received = new Map();
  const chrome = {
    runtime: { id: 'prm-test', onMessage: listener('message'), onInstalled: listener('installed') },
    tabs: { onActivated: listener('activated'), onRemoved: listener('removed'),
      query: async query => query.url ? [{ id: 1 }] : [],
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
  const control = (action, payload = {}) => new Promise(resolve => listeners.message({ channel: 'prm-control', action, payload }, { id:'prm-test', url:'http://localhost:3000/' }, resolve));
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
  listeners.message({channel:'capture',type:'copy',text:'test selection',url:'https://example.com/'},{tab:{id:4,url:'https://example.com/'}},()=>{});
  let pending = await control('status');
  assert.equal(pending.pending, 3);
  const failed = await control('stop');
  assert.ok(failed.error);
  pending = await control('status');
  assert.equal(pending.closing, true);
  assert.equal(pending.pending, 3);
  online = true;
  const closed = await control('stop');
  assert.equal(closed.ok, true);
  const final = await control('status');
  assert.equal(final.session, null);
  assert.equal(final.pending, 0);
  assert.equal(received.size, 3);
  const chat = [...received.values()].find(event => event.event_type === 'llm_exchange');
  assert.equal(chat.content.question, '안녕');
  assert.equal(chat.content.response, '안녕하세요');
  assert.equal(chat.capture_status, 'complete');
});
