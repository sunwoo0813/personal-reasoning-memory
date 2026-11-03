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
 const body=location.hostname==='chatgpt.com'?null:document.querySelector('article,main');
 const raw=body?.innerText || '';
 return {url:safeUrl(location.href),title:document.title,text:raw.slice(0,60000),truncated:raw.length>60000,scroll:maxScroll};
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
  return {role,id,text:(el.innerText||'').slice(0,60000)};
 }).filter(x => x.role === 'user' || x.role === 'assistant');
}

document.addEventListener('visibilitychange',()=>send({type:'visibility',visible:document.visibilityState==='visible',snapshot:document.visibilityState==='hidden'?info():null}));
addEventListener('pagehide',()=>send({type:'pagehide',snapshot:info()}));
document.addEventListener('copy', () => {
 const selected = getSelection();
 if (!selected || selected.isCollapsed) return;
 const asElement = node => node instanceof Element ? node : node?.parentElement;
 if (isPrivateTarget(asElement(selected.anchorNode)) || isPrivateTarget(asElement(selected.focusNode))) return;
 const text = String(selected).trim();
 if (text) send({...info(),type:'copy',text:text.slice(0,10000)});
},true);
document.addEventListener('submit',e=>{ const u=new URL(location.href); if(u.hostname==='www.google.com' && e.target instanceof HTMLFormElement){const q=new FormData(e.target).get('q');if(typeof q==='string'&&q.trim())send({type:'search',query:q.slice(0,2000),url:safeUrl(location.href)});}},true);
// Only a deliberate prompt submission can arm capture of a new user message.
if (location.hostname === 'chatgpt.com') {
 const promptTarget = target => target instanceof Element && !!target.closest('textarea, [contenteditable="true"], [role="textbox"]');
 const submitIntent = target => {
  const editor = target?.closest?.('textarea, [contenteditable="true"], [role="textbox"]') || document.querySelector('#prompt-textarea, textarea[name="prompt-textarea"], [contenteditable="true"][role="textbox"]');
  const prompt = (editor?.value ?? editor?.innerText ?? '').trim().slice(0,60000);
  if (prompt) send({type:'chat-submit',url:safeUrl(location.href),documentId:chatDocumentId,seen:readChatMessages().map(m=>m.id),prompt});
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
 if(m.type==='snapshot') {reply(excluded()?{excluded:true}:info());return;}
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
  reply({url:safeUrl(location.href),documentId:chatDocumentId,messages,streaming:!!document.querySelector('[data-testid="stop-button"]')});return;
 }
});
if(location.hostname==='chatgpt.com'){
 let timer;
 const snapshot=()=>{
  if(excluded())return;
  const messages=readChatMessages();
  send({type:'chat',url:safeUrl(location.href),documentId:chatDocumentId,messages,streaming:!!document.querySelector('[data-testid="stop-button"]')});
 };
 new MutationObserver(()=>{if(!timer)timer=setTimeout(()=>{timer=null;snapshot()},750)}).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
 snapshot();
}
send({type:'ready'});
