import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

test('page snapshots never read or return page body text', () => {
 let listener;
 const document={querySelector:selector=>{if(selector==='article,main')throw Error('body was read');return null},addEventListener(){},documentElement:{scrollHeight:1000},title:'Example'};
 const context=vm.createContext({document,location:{hostname:'example.com',href:'https://example.com/'},
  chrome:{runtime:{id:'test',sendMessage:()=>Promise.resolve(),onMessage:{addListener(fn){listener=fn}}}},
  addEventListener(){},window:{scrollY:0},innerHeight:500,URL,console});
 vm.runInContext(fs.readFileSync('extension/capture.js','utf8'),context);
 let snapshot;listener({channel:'capture-command',type:'snapshot'},null,r=>{snapshot=r});
 assert.equal(snapshot.title,'Example');assert.equal(snapshot.scroll,0.5);assert.equal('text' in snapshot,false);
});

test('captures Google search box Enter and avoids duplicating its form submission', () => {
 const handlers={},sent=[];
 class Element { constructor(value='', search=false){this.value=value;this.search=search} matches(){return this.search} }
 class HTMLFormElement {}
 const form=new HTMLFormElement();
 const document={querySelector:()=>null,addEventListener:(name,fn)=>{handlers[name]=fn},documentElement:{scrollHeight:1000},title:'Google'};
 const context=vm.createContext({document,location:{hostname:'www.google.com',href:'https://www.google.com/'},Element,HTMLFormElement,
  FormData:class {get(){return '검색어'}},chrome:{runtime:{id:'test',sendMessage:m=>{sent.push(m);return Promise.resolve()},onMessage:{addListener(){}}}},
  addEventListener(){},window:{scrollY:0},innerHeight:500,URL,console});
 vm.runInContext(fs.readFileSync('extension/capture.js','utf8'),context);
 const input=new Element('검색어',true);
 handlers.keydown({key:'Enter',target:input,isComposing:true});
 handlers.keydown({key:'Enter',target:new Element('private',false)});
 assert.equal(sent.filter(m=>m.type==='search').length,0);
 handlers.keydown({key:'Enter',target:input});
 handlers.submit({target:form});
 const searches=sent.filter(m=>m.type==='search');
 assert.equal(searches.length,1);
 assert.equal(searches[0].query,'검색어');
 assert.equal(searches[0].detection,'enter');
});

test('reads the observed ChatGPT user and assistant message structures', () => {
 const sent=[];
 function node(role,id,text) {
  const parent={closest:()=>null};
  return {parentElement:parent,innerText:text,
   matches: selector => selector.includes('data-user-message-bubble') && role==='user',
   getAttribute:()=>null,
   closest: selector => {
    if (role==='user' && selector==='[data-chatgpt-search-message-ids]') return {getAttribute:()=>id};
    if (role==='assistant' && selector==='[data-chatgpt-selection-message-id]') return {getAttribute:()=>id};
    return null;
   }};
 }
 const messages=[node('user','user-id','질문'),node('assistant','assistant-id','답변')];
 const document={querySelector:()=>null,querySelectorAll:()=>messages,addEventListener(){},documentElement:{scrollHeight:1000},title:'ChatGPT'};
 const context=vm.createContext({document,location:{hostname:'chatgpt.com',href:'https://chatgpt.com/c/test'},
  chrome:{runtime:{id:'test',sendMessage:message=>{sent.push(message);return Promise.resolve()},onMessage:{addListener(){}}}},
  MutationObserver:class {observe(){}},addEventListener(){},window:{scrollY:0},innerHeight:500,URL,console});
 vm.runInContext(fs.readFileSync('extension/capture.js','utf8'),context);
 const chat=sent.find(m=>m.type==='chat');
 assert.deepEqual(JSON.parse(JSON.stringify(chat.messages)),[
  {role:'user',id:'user-id',text:'질문',truncated:false}, {role:'assistant',id:'assistant-id',text:'답변',truncated:false}
 ]);
});

test('content script tolerates an invalidated extension context during page events', () => {
 const handlers = {};
 const document = { querySelector: () => null, addEventListener: (name,fn) => { handlers[name]=fn; }, documentElement: { scrollHeight: 1000 }, visibilityState: 'hidden', title: 'Example' };
 const ctx = vm.createContext({
  document, location: { hostname: 'example.com', href: 'https://example.com/' },
  chrome: { runtime: { id:'test', sendMessage(){throw new Error('Extension context invalidated.');}, onMessage:{addListener(){}} } },
  addEventListener: (name,fn)=>{handlers[name]=fn}, window: {scrollY:0}, innerHeight:500, URL, console,
 });
 assert.doesNotThrow(() => vm.runInContext(fs.readFileSync('extension/capture.js','utf8'),ctx));
 assert.doesNotThrow(() => handlers.visibilitychange());
 assert.doesNotThrow(() => handlers.pagehide());
});
test('copies selected page text even if focus remains in an input, without copying input selections', () => {
 const handlers={},sent=[];
 class Element { constructor(privateField=false){this.privateField=privateField} closest(){return this.privateField ? this : null} }
 const page=new Element(),input=new Element(true);
 let selection={isCollapsed:false,anchorNode:page,focusNode:page,toString:()=> 'page selection'};
 const document={querySelector:()=>null,addEventListener:(name,fn)=>{handlers[name]=fn},documentElement:{scrollHeight:1000},title:'Example'};
 const context=vm.createContext({document,location:{hostname:'example.com',href:'https://example.com/'},Element,getSelection:()=>selection,
  chrome:{runtime:{id:'test',sendMessage:message=>{sent.push(message);return Promise.resolve()},onMessage:{addListener(){}}}},
  addEventListener(){},window:{scrollY:0},innerHeight:500,URL,console});
 vm.runInContext(fs.readFileSync('extension/capture.js','utf8'),context);
 handlers.copy({target:input});
 assert.equal(sent.filter(x=>x.type==='copy').length,1);
 assert.equal(sent.find(x=>x.type==='copy').text,'page selection');
 selection={isCollapsed:false,anchorNode:input,focusNode:input,toString:()=> 'private input'};
 handlers.copy({target:input});
 assert.equal(sent.filter(x=>x.type==='copy').length,1);
});

test('records context menu text after selection clears but excludes editable fields', () => {
 const sent=[];let listener;
 class Element {constructor(editable=false){this.editable=editable} closest(){return this.editable?this:null}}
 const page=new Element(),input=new Element(true);
 const document={querySelector:()=>null,addEventListener(){},documentElement:{scrollHeight:1000},title:'Example',activeElement:page};
 const context=vm.createContext({document,location:{hostname:'example.com',href:'https://example.com/'},Element,getSelection:()=>null,
  chrome:{runtime:{id:'test',sendMessage:message=>{sent.push(message);return Promise.resolve()},onMessage:{addListener(fn){listener=fn}}}},
  addEventListener(){},window:{scrollY:0},innerHeight:500,URL,console});
 vm.runInContext(fs.readFileSync('extension/capture.js','utf8'),context);
 let response;
 listener({channel:'capture-command',type:'selection',selectionText:'saved selection'},null,r=>{response=r});
 assert.equal(response.ok,true);
 assert.equal(sent.find(m=>m.type==='highlight').text,'saved selection');
 document.activeElement=input;
 listener({channel:'capture-command',type:'selection',selectionText:'private input'},null,r=>{response=r});
 assert.equal(response.ok,false);
 assert.equal(sent.filter(m=>m.type==='highlight').length,1);
 document.activeElement=Object.assign(new Element(),{tagName:'IFRAME'});
 listener({channel:'capture-command',type:'selection',selectionText:'iframe input'},null,r=>{response=r});
 assert.equal(response.ok,false);
 assert.equal(sent.filter(m=>m.type==='highlight').length,1);
});
