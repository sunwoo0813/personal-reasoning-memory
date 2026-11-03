const LOCAL='http://localhost:3000/';
let operation=Promise.resolve();
const serial=fn=>{const next=operation.then(fn,fn);operation=next.catch(()=>{});return next};
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('prm-capture',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function read(){const db=await openDb();return new Promise((resolve,reject)=>{const t=db.transaction('state','readonly'),q=t.objectStore('state').get('capture');q.onsuccess=()=>resolve(q.result||{deviceId:crypto.randomUUID(),blocked:[],session:null,queue:[],ids:[],seq:0,paused:false,openPage:null,chats:{}});q.onerror=()=>reject(q.error)})}
async function write(data){const db=await openDb();return new Promise((resolve,reject)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(data,'capture');t.oncomplete=resolve;t.onerror=()=>reject(t.error)})}
const now=()=>new Date().toISOString();
function safeUrl(value){try{const u=new URL(value);for(const key of [...u.searchParams.keys()])if(/token|secret|password|auth|session|key|code/i.test(key))u.searchParams.delete(key);u.hash='';return u.toString()}catch{return ''}}
async function api(path,method='GET',body={}){const tabs=await chrome.tabs.query({url:LOCAL+'*'});for(const tab of tabs){try{const r=await chrome.tabs.sendMessage(tab.id,{channel:'prm-api',path,method,body});if(r?.ok)return r.body;if(r?.body?.error)throw Error(r.body.error)}catch(e){if(e.message&&!e.message.includes('Receiving end'))throw e}}throw Error('PRM 웹사이트를 localhost:3000에서 열어주세요.')}
function blocked(state,url){try{const u=new URL(url);return u.protocol!=='https:'||state.blocked.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))}catch{return true}}
function append(s,type,started,ended,source,ref,content,metadata={},capture_status='complete'){
 if(!s.session||s.paused||s.closing)return;
 const id=crypto.randomUUID();s.seq++;s.ids.push(id);
 s.queue.push({client_event_id:id,device_id:s.deviceId,client_seq:s.seq,event_type:type,started_at:started,ended_at:ended,source,source_ref:ref,content,metadata,capture_status});
}
async function flush(s){if(!s.session||!s.queue.length)return;const batch=s.queue.slice(0,50),r=await api('sessions/'+s.session.id+'/events','POST',{events:batch});const done=new Set(r.items.filter(x=>x.status==='saved'||x.status==='duplicate').map(x=>x.client_event_id));s.queue=s.queue.filter(x=>!done.has(x.client_event_id));s.lastError=r.items.find(x=>x.status==='error')?.message||null}
async function inspectActivePage(s){try{const win=await chrome.windows.getLastFocused();const [tab]=await chrome.tabs.query({active:true,windowId:win.id});if(!tab?.url)return '활성 탭을 확인할 수 없습니다.';if(blocked(s,tab.url))return '현재 페이지는 수집 제외 또는 지원하지 않는 주소입니다.';try{const result=await chrome.tabs.sendMessage(tab.id,{channel:'capture-command',type:'snapshot'});return result?.excluded?'현재 페이지는 민감 정보 보호 설정으로 제외됐습니다.':'현재 페이지에 수집 스크립트가 연결돼 있습니다.'}catch{return '현재 페이지에 수집 스크립트가 없습니다. 페이지를 새로고침하세요.'}}catch{return '활성 탭 상태를 확인할 수 없습니다.'}}
async function endPage(s){const p=s.openPage;if(!p)return;s.openPage=null;let snapshot={};try{snapshot=await chrome.tabs.sendMessage(p.tabId,{channel:'capture-command',type:'snapshot'})}catch{};if(snapshot.excluded)return;if(snapshot.url!==safeUrl(p.url))snapshot=p.snapshot||{};append(s,'page_view',p.start,now(),'web',{url:safeUrl(p.url),tab_id:p.tabId},{text:snapshot.text||null},{title:snapshot.title||p.title,active_seconds:Math.max(0,Math.round((Date.now()-Date.parse(p.start))/1000)),scroll_max_ratio:snapshot.scroll||0,truncated:!!snapshot.truncated,parser_version:'1.0'},snapshot.text?'complete':'metadata_only')}
async function switchPage(s){await endPage(s);if(!s.session||s.paused||s.closing)return;const win=await chrome.windows.getLastFocused();if(!win.focused)return;const [tab]=await chrome.tabs.query({active:true,windowId:win.id});if(!tab||blocked(s,tab.url))return;let snapshot;try{snapshot=await chrome.tabs.sendMessage(tab.id,{channel:'capture-command',type:'snapshot'})}catch{return}if(snapshot?.excluded)return;s.openPage={tabId:tab.id,url:tab.url,title:tab.title,start:now(),snapshot};
 try { if(new URL(tab.url).hostname==='chatgpt.com' && !s.chats[String(tab.id)]) { const chat=await chrome.tabs.sendMessage(tab.id,{channel:'capture-command',type:'chat-snapshot'}); if(!chat.excluded)processChat(s,tab.id,chat,now()); } }catch{}
}
function finalizeChat(s, chat) { if(!chat?.draft)return; const d=chat.draft; append(s,'llm_exchange',d.started,now(),'chatgpt',{url:d.url,tab_id:d.tabId,user_message_id:d.userId,assistant_message_id:d.assistantId||null},{question:d.question,response:d.response||null},{parser_version:'1.0',completion_observed:!!d.complete},d.complete && !d.userId?.startsWith('local-dom-') && !d.assistantId?.startsWith('local-dom-')?'complete':'partial'); chat.draft=null; }
function processChat(s,tabId,m,at){
 const key=String(tabId),messages=Array.isArray(m.messages)?m.messages:[];
 let chat=s.chats[key];
 if(chat && chat.url!==m.url){try{const old=new URL(chat.url),next=new URL(m.url);if((old.pathname==='/'||old.pathname.includes('local-chatgpt'))&&next.pathname.startsWith('/c/')){chat.url=m.url;if(chat.draft)chat.draft.url=m.url}}catch{}}
 if(!chat||chat.url!==m.url){if(chat)finalizeChat(s,chat);chat=s.chats[key]={url:m.url,documentId:m.documentId,seen:messages.map(x=>x.id).filter(Boolean),draft:null,armed:false};return;}
 if(m.documentId && chat.documentId!==m.documentId){chat.documentId=m.documentId;chat.seen=messages.map(x=>x.id).filter(Boolean);chat.armed=false;}
 chat.seen ||= [];
 if(chat.armed){
  const normalize=text=>(text||'').replace(/\s+/g,' ').trim();
  const candidate=messages.filter(x=>x.role==='user'&&x.id&&!chat.seen.includes(x.id)&&(!chat.expectedPrompt||normalize(x.text)===normalize(chat.expectedPrompt))).at(-1);
  if(candidate){if(chat.draft)finalizeChat(s,chat);chat.draft={url:m.url,tabId,userId:candidate.id,question:candidate.text,started:at,response:null,assistantId:null,sawStreaming:false,complete:false};chat.armed=false;chat.expectedPrompt=null;}
 }
 for(const x of messages)if(x.id&&!chat.seen.includes(x.id))chat.seen.push(x.id);
 if(chat.draft){
  const i=messages.findIndex(x=>x.id===chat.draft.userId);
  const nextUser=i<0?-1:messages.findIndex((x,j)=>j>i&&x.role==='user');
  const answer=i<0?null:messages.slice(i+1,nextUser<0?undefined:nextUser).find(x=>x.role==='assistant');
  if(answer){chat.draft.response=answer.text;chat.draft.assistantId=answer.id;chat.draft.sawStreaming ||= !!m.streaming;if(chat.draft.sawStreaming&&!m.streaming&&answer.text){chat.draft.complete=true;finalizeChat(s,chat)}}
 }
}
async function close(s){if(!s.closing){await endPage(s);s.paused=false;for(const [id,chat] of Object.entries(s.chats)){if(chat.draft){try{const snapshot=await chrome.tabs.sendMessage(Number(id),{channel:'capture-command',type:'chat-snapshot'});if(!snapshot.excluded)processChat(s,Number(id),snapshot,now())}catch{}}finalizeChat(s,s.chats[id]);}s.closing=true;await write(s);}await api('sessions/'+s.session.id+'/closing','POST');for(let i=0;i<100&&s.queue.length;i++){await flush(s);await write(s);if(s.lastError)throw Error(s.lastError)}if(s.queue.length)throw Error('전송하지 못한 이벤트가 남아 있습니다.');const r=await api('sessions/'+s.session.id+'/close','POST',{event_ids:s.ids,last_seq:s.seq});if(!r.ok)throw Error('서버 수신 목록이 일치하지 않습니다.');s.session=null;s.queue=[];s.ids=[];s.seq=0;s.openPage=null;s.chats={};s.closing=false;await write(s);return r}
async function command(action,payload){return serial(async()=>{let s=await read();if(action==='status'){await write(s);return {deviceId:s.deviceId,session:s.session,paused:s.paused,closing:!!s.closing,pending:s.queue.length,recorded:s.seq,blocked:s.blocked,error:s.lastError,activePage:await inspectActivePage(s),diagnostics:s.diagnostics||{}};}if(action==='start'){if(s.session)throw Error('이미 시작한 세션이 있습니다.');s.session=payload.session;s.ids=[];s.seq=0;s.queue=[];s.paused=false;s.closing=false;s.lastError=null;s.chats={};s.diagnostics={};await switchPage(s)}else if(action==='stop'){if(!s.session)throw Error('진행 중인 세션이 없습니다.');return close(s)}else if(action==='pause'){await endPage(s);for(const chat of Object.values(s.chats))finalizeChat(s,chat);s.chats={};s.paused=true}else if(action==='resume'){s.paused=false;s.chats={};await switchPage(s)}else if(action==='block'){if(!/^[a-z0-9.-]+$/.test(payload.host))throw Error('도메인을 확인하세요.');s.blocked=[...new Set([...s.blocked,payload.host])];if(s.openPage&&blocked(s,s.openPage.url))s.openPage=null}else if(action==='sync'){await flush(s)}await write(s);return {ok:true,deviceId:s.deviceId,session:s.session,pending:s.queue.length}})}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(m.channel==='prm-control'){
  const trusted=sender.id===chrome.runtime.id && (sender.url?.startsWith('chrome-extension://'+chrome.runtime.id+'/') || sender.url?.startsWith(LOCAL));
  if(!trusted){respond({error:'허용되지 않은 출처입니다.'});return}
  command(m.action,m.payload||{}).then(respond).catch(e=>respond({error:e.message}));return true;
 }
 if(m.channel==='capture'&&sender.tab?.id){serial(async()=>{const s=await read();if(!s.session||s.paused||s.closing||blocked(s,sender.tab.url))return;const at=now();s.diagnostics ||= {};s.diagnostics[m.type]=(s.diagnostics[m.type]||0)+1;if(m.type==='chat')s.diagnostics.chat_message_count=Array.isArray(m.messages)?m.messages.length:0;if(m.type==='ready'&&!s.openPage){await switchPage(s)}if(m.type==='search'){s.searchRecent={tabId:sender.tab.id,query:m.query,at:Date.now()};append(s,'search',at,at,'google',{url:m.url,tab_id:sender.tab.id},{query:m.query},{engine:'google'});}if((m.type==='pagehide'||(m.type==='visibility'&&m.visible===false))&&s.openPage?.tabId===sender.tab.id){if(m.snapshot?.url===safeUrl(s.openPage.url))s.openPage.snapshot=m.snapshot;await endPage(s);}if(m.type==='visibility'&&m.visible===true&&!s.openPage)await switchPage(s);if(m.type==='chat'){
 processChat(s,sender.tab.id,m,at);
}if(m.type==='chat-submit'){
 const key=String(sender.tab.id);let chat=s.chats[key];
 if(!chat || (m.documentId && chat.documentId!==m.documentId)){if(chat)finalizeChat(s,chat);chat=s.chats[key]={url:m.url,documentId:m.documentId,seen:Array.isArray(m.seen)?m.seen:[],draft:null,armed:false};}
 chat.armed=true;chat.expectedPrompt=typeof m.prompt==='string'?m.prompt:null;
}if(m.type==='copy'||m.type==='highlight')append(s,'copy_highlight',at,at,'web',{url:m.url,tab_id:sender.tab.id},{text:m.text},{action:m.type,source_page_url:m.url,location:'unavailable'},'partial');await write(s);try{await flush(s)}catch(e){s.lastError=e.message}await write(s)}).catch(()=>{});}
});
chrome.tabs.onActivated.addListener(()=>serial(async()=>{const s=await read();await switchPage(s);await write(s)}).catch(()=>{}));
chrome.windows.onFocusChanged.addListener(()=>serial(async()=>{const s=await read();await switchPage(s);await write(s)}).catch(()=>{}));
chrome.webNavigation.onCommitted.addListener(d=>{if(d.frameId===0)serial(async()=>{const s=await read();try{const u=new URL(d.url),q=u.searchParams.get('q');if(s.session&&!s.paused&&!s.closing&&u.hostname==='www.google.com'&&u.pathname==='/search'&&q&&!(s.searchRecent?.tabId===d.tabId&&s.searchRecent.query===q&&Date.now()-s.searchRecent.at<5000)){const at=now();append(s,'search',at,at,'google',{url:safeUrl(d.url),tab_id:d.tabId},{query:q.slice(0,2000)},{engine:'google',detection:'navigation'},'partial');s.searchRecent={tabId:d.tabId,query:q,at:Date.now()}}}catch{};if(s.openPage?.tabId===d.tabId){await endPage(s);await switchPage(s)}await write(s)}).catch(()=>{})});
chrome.webNavigation.onHistoryStateUpdated.addListener(d=>{if(d.frameId===0)serial(async()=>{const s=await read();if(s.openPage?.tabId===d.tabId){await endPage(s);await switchPage(s);await write(s)}}).catch(()=>{})});
chrome.tabs.onRemoved.addListener(id=>serial(async()=>{const s=await read();if(s.openPage?.tabId===id)await endPage(s);const chat=s.chats[String(id)];if(chat){finalizeChat(s,chat);delete s.chats[String(id)]}await write(s)}).catch(()=>{}));
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='sync')serial(async()=>{const s=await read();try{await flush(s)}catch(e){s.lastError=e.message}await write(s)}).catch(()=>{})});
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('sync',{periodInMinutes:0.5});chrome.contextMenus.create({id:'prm-highlight',title:'PRM에 선택 영역 기록',contexts:['selection'],documentUrlPatterns:['https://*/*']})});
chrome.contextMenus.onClicked.addListener((info,tab)=>{if(info.menuItemId==='prm-highlight'&&tab?.id)chrome.tabs.sendMessage(tab.id,{channel:'capture-command',type:'selection'}).catch(()=>{})});
