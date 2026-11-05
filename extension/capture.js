const defaultBlocked = ['mail.google.com','accounts.google.com','docs.google.com','drive.google.com','calendar.google.com','outlook.live.com','outlook.office.com','bank','pay','billing','login','signin','account'];
function excluded() {
 const host=location.hostname.toLowerCase();
 return defaultBlocked.some(x=>host.includes(x)) || !!document.querySelector('input[type=password],input[autocomplete="cc-number"],input[autocomplete="current-password"]');
}
function send(data) {
 if (excluded()) return;
 try {
  if (!chrome.runtime?.id) return;
  chrome.runtime.sendMessage({channel:'capture',...data}).catch(error => {
   if (!/extension context invalidated|receiving end does not exist/i.test(error?.message || '')) console.warn('PRM 메시지 전송 실패:', error);
  });
 } catch (error) {
  if (!/extension context invalidated/i.test(error?.message || '')) console.warn('PRM 메시지 전송 실패:', error);
 }
}
let maxScroll=0;
function trackScroll(){maxScroll=Math.max(maxScroll,Math.min(1,(window.scrollY+innerHeight)/Math.max(document.documentElement.scrollHeight,1)))}
addEventListener('scroll',trackScroll,{passive:true});trackScroll();
function safeUrl(value){try{const u=new URL(value);for(const key of [...u.searchParams.keys()])if(/token|secret|password|auth|session|key|code/i.test(key))u.searchParams.delete(key);u.hash='';return u.toString()}catch{return ''}}
function info() {
 return {url:safeUrl(location.href),title:document.title,scroll:maxScroll};
}
// Capture only semantic main content. Never fall back to the whole document.
function pageSnapshot() {
 const base={...info(),extracted_at:new Date().toISOString(),extractor_version:'2.0'};
 if(excluded())return {...base,excluded:true};
 if(location.hostname==='chatgpt.com')return {...base,text:null,extraction_status:'llm_page',truncated:false};
 try {
  const root=document.querySelector('article, main, [role="main"]');
  if(!root)return {...base,text:null,extraction_status:'main_not_found',truncated:false};
  const skip='script,style,noscript,template,nav,header,footer,aside,form,input,textarea,select,button,[contenteditable],[role="textbox"],[hidden],[aria-hidden="true"],[inert]';
  const visibility=new WeakMap();
  function readable(element){
   if(!element)return false;
   if(visibility.has(element))return visibility.get(element);
   if(element.matches(skip)){visibility.set(element,false);return false;}
   const style=getComputedStyle(element);
   const visible=style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&(!element.parentElement||readable(element.parentElement));
   visibility.set(element,visible);return visible;
  }
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const chunks=[];let length=0,visited=0,node,truncated=false;
  while((node=walker.nextNode())){
   if(++visited>20000){truncated=true;break;}
   if(!readable(node.parentElement))continue;
   const part=(node.textContent||'').replace(/\s+/g,' ').trim();if(!part)continue;
   const remaining=60000-length-(chunks.length?1:0);
   if(remaining<=0){truncated=true;break;}
   chunks.push(part.slice(0,remaining));length+=Math.min(part.length,remaining)+(chunks.length>1?1:0);
   if(part.length>remaining){truncated=true;break;}
  }
  const text=chunks.join('\n');
  return {...base,text:text||null,extraction_status:text?'captured':'empty',truncated};
 }catch{return {...base,text:null,extraction_status:'failed',truncated:false};}
}
function isPrivateTarget(target) { return target instanceof Element && !!target.closest('input,textarea,[contenteditable=true],[role=textbox]'); }
const chatNodeIds = new WeakMap();
let nextChatNodeId = 0;
const chatDocumentId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function readChatMessages() {
 const selector = '[data-message-author-role], [data-user-message-bubble="true"], [data-markdown-text-style="assistant-message"]';
 return [...document.querySelectorAll(selector)].filter(el => !el.parentElement?.closest(selector)).map(el => {
  const role = el.getAttribute('data-message-author-role') || (el.matches('[data-user-message-bubble="true"]') ? 'user' : 'assistant');
  let id = el.getAttribute('data-message-id') || el.closest('[data-message-id]')?.getAttribute('data-message-id') || el.closest('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id') || el.closest('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids');
  if (!id) {
   if (!chatNodeIds.has(el)) chatNodeIds.set(el, 'local-dom-' + (++nextChatNodeId));
   id = chatNodeIds.get(el);
  }
  const text=el.innerText||'';
  return {role,id,text:text.slice(0,60000),truncated:text.length>60000};
 }).filter(x => x.role === 'user' || x.role === 'assistant');
}

document.addEventListener('visibilitychange',()=>send({type:'visibility',visible:document.visibilityState==='visible',snapshot:document.visibilityState==='hidden'?pageSnapshot():null}));
addEventListener('pagehide',()=>send({type:'pagehide',snapshot:pageSnapshot()}));
document.addEventListener('copy', () => {
 const selected = getSelection();
 if (!selected || selected.isCollapsed) return;
 const asElement = node => node instanceof Element ? node : node?.parentElement;
 if (isPrivateTarget(asElement(selected.anchorNode)) || isPrivateTarget(asElement(selected.focusNode))) return;
 const text = String(selected).trim();
 if (text) send({...info(),type:'copy',text:text.slice(0,10000)});
},true);
// Google may handle Enter without dispatching a form submit. Only observe its
// named search box; other text inputs can contain private information.
if (location.hostname === 'www.google.com') {
 let lastSearch = null;
 const recordSearch = (query, method) => {
  if (typeof query !== 'string' || !query.trim()) return;
  query = query.trim().slice(0,2000);
  const at = Date.now();
  if (lastSearch && lastSearch.query === query && lastSearch.method !== method && at - lastSearch.at < 1000) return;
  lastSearch = {query, method, at};
  send({type:'search',query,url:safeUrl(location.href),detection:method});
 };
 document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing || e.repeat || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  if (!(e.target instanceof Element) || !e.target.matches('input[name="q"], textarea[name="q"]')) return;
  recordSearch(e.target.value, 'enter');
 }, true);
 document.addEventListener('submit', e => {
  if (e.target instanceof HTMLFormElement) recordSearch(new FormData(e.target).get('q'), 'submit');
 }, true);
}
// Only a deliberate prompt submission can arm capture of a new user message.
if (location.hostname === 'chatgpt.com') {
 const promptTarget = target => target instanceof Element && !!target.closest('textarea, [contenteditable="true"], [role="textbox"]');
 const submitIntent = target => {
  const editor = target?.closest?.('textarea, [contenteditable="true"], [role="textbox"]') || document.querySelector('#prompt-textarea, textarea[name="prompt-textarea"], [contenteditable="true"][role="textbox"]');
  const prompt = (editor?.value ?? editor?.innerText ?? '').trim();
  if (prompt) send({type:'chat-submit',url:safeUrl(location.href),documentId:chatDocumentId,seen:readChatMessages().map(m=>m.id),prompt:prompt.slice(0,60000),truncated:prompt.length>60000});
 };
 document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.repeat && promptTarget(e.target)) submitIntent(e.target);
 }, true);
 document.addEventListener('click', e => {
  if (e.target instanceof Element && e.target.closest('[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="프롬프트 보내기"]')) submitIntent(e.target);
 }, true);
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(m.channel!=='capture-command') return;
 if(m.type==='snapshot') {reply(pageSnapshot());return;}
 if(m.type==='selection') {
  const selected=getSelection(), asElement=node=>node instanceof Element?node:node?.parentElement;
  if(excluded() || isPrivateTarget(asElement(selected?.anchorNode)) || isPrivateTarget(asElement(selected?.focusNode))){reply({ok:false,reason:'excluded'});return;}
  let text=String(selected||'').trim();
  // The browser can clear the DOM selection when its context menu is opened.
  // A focused child frame can hide the actual editable element from us.
  const focusedFrame = document.activeElement?.tagName === 'IFRAME' || document.activeElement?.tagName === 'FRAME';
  if(!text && !focusedFrame && !isPrivateTarget(document.activeElement) && typeof m.selectionText==='string')text=m.selectionText.trim();
  if(text){send({...info(),type:'highlight',text:text.slice(0,10000)});reply({ok:true});}else reply({ok:false,reason:'no_selection'});return;
 }
 if(m.type==='chat-snapshot') {
  if(excluded() || location.hostname!=='chatgpt.com'){reply({excluded:true});return;}
  const messages=readChatMessages();
  reply({url:safeUrl(location.href),documentId:chatDocumentId,messages,streaming:!!document.querySelector('[data-testid="stop-button"]'),ready:!!document.querySelector('[data-testid="send-button"]')});return;
 }
});
if(location.hostname==='chatgpt.com'){
 let timer,settleTimer;
 const snapshot=()=>{
  if(excluded())return;
  const messages=readChatMessages();
  const streaming=!!document.querySelector('[data-testid="stop-button"]');
  const ready=!!document.querySelector('[data-testid="send-button"]');
  send({type:'chat',url:safeUrl(location.href),documentId:chatDocumentId,messages,streaming,ready});
 };
 const schedule=()=>{if(!timer)timer=setTimeout(()=>{timer=null;snapshot();clearTimeout(settleTimer);settleTimer=setTimeout(snapshot,5000)},750)};
 new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){snapshot();clearTimeout(settleTimer);settleTimer=setTimeout(snapshot,5000)}});
 snapshot();
}
send({type:'ready'});
