import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001']) {
 test(`bridge connects only same-origin controls on ${origin}`, async () => {
  let receive;
  const sent=[], replies=[];
  const window={addEventListener(name,fn){receive=fn},postMessage(data,target){replies.push({data,target})}};
  const chrome={runtime:{id:'test',sendMessage:async message=>{sent.push(message);return {deviceId:'device'}},onMessage:{addListener(){}}}};
  const context=vm.createContext({window,location:{origin},chrome,Set});
  vm.runInContext(fs.readFileSync('extension/bridge.js','utf8'),context);
  await receive({source:window,origin,data:{channel:'prm-web',id:'request',action:'status'}});
  assert.equal(sent.length,1);
  assert.equal(replies[0].target,origin);
  assert.equal(replies[0].data.response.deviceId,'device');
  await receive({source:window,origin:'https://example.com',data:{channel:'prm-web',id:'untrusted',action:'start'}});
  assert.equal(sent.length,1);
 });
}
