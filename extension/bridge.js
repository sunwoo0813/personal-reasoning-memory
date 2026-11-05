const allowedOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001']);
const allowedOrigin = location.origin;
window.addEventListener('message', async event => {
 if (!allowedOrigins.has(allowedOrigin) || event.source !== window || event.origin !== allowedOrigin || event.data?.channel !== 'prm-web' || typeof event.data.id !== 'string') return;
 try {
  const response = await chrome.runtime.sendMessage({channel:'prm-control', action:event.data.action, payload:event.data.payload});
  window.postMessage({channel:'prm-extension',id:event.data.id,response},allowedOrigin);
 } catch(error) { window.postMessage({channel:'prm-extension',id:event.data.id,error:error.message},allowedOrigin); }
});
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
 if (message.channel !== 'prm-api' || sender.id !== chrome.runtime.id) return;
 const options = { method:message.method || 'GET', headers:{'Content-Type':'application/json'}, cache:'no-store' };
 if (options.method !== 'GET') options.body=JSON.stringify(message.body || {});
 fetch('/api/'+message.path,options).then(async response=>sendResponse({ok:response.ok,body:await response.json()})).catch(error=>sendResponse({ok:false,error:error.message}));
 return true;
});
