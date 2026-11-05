import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

function snapshot(html,url='https://example.com/article'){
 const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});
 let listener;
 dom.window.chrome={runtime:{id:'test',sendMessage:async()=>{},onMessage:{addListener(fn){listener=fn}}}};
 dom.window.eval(fs.readFileSync('extension/capture.js','utf8'));
 let value;listener({channel:'capture-command',type:'snapshot'},null,response=>value=response);
 dom.window.close();return value;
}
test('extracts the main article while excluding navigation, inputs and hidden content',()=>{
 const value=snapshot(`<title>Research</title><nav>outside navigation</nav><main><h1>Article title</h1><p>Important evidence.</p><nav>inside navigation</nav><form>private form<input value="secret"></form><div contenteditable>private draft</div><div hidden>hidden note</div><p style="display:none">hidden css</p><div style="display:none"><p>hidden ancestor</p></div><script>private script</script><aside>advertisement</aside></main><footer>footer</footer>`);
 assert.equal(value.text,'Article title\nImportant evidence.');
 assert.equal(value.extraction_status,'captured');assert.equal(value.truncated,false);
 assert.equal(value.extractor_version,'2.0');assert.ok(Date.parse(value.extracted_at));
});
test('marks long articles as partial and avoids document-wide fallback',()=>{
 const long=snapshot('<article><p>'+ '가'.repeat(61000)+'</p></article>');
 assert.equal(long.text.length,60000);assert.equal(long.truncated,true);
 const missing=snapshot('<div>unstructured private app text</div>');
 assert.equal(missing.text,null);assert.equal(missing.extraction_status,'main_not_found');
});
test('keeps sensitive pages excluded and chat capture separate from page body capture',()=>{
 assert.equal(snapshot('<main>private</main>','https://mail.google.com/').excluded,true);
 assert.equal(snapshot('<main>private</main><input type="password">').excluded,true);
 const dom=new JSDOM('<main>private conversation</main>',{url:'https://chatgpt.com/c/test',runScripts:'outside-only'});
 let listener;dom.window.chrome={runtime:{id:'test',sendMessage:async()=>{},onMessage:{addListener(fn){listener=fn}}}};
 dom.window.eval(fs.readFileSync('extension/capture.js','utf8'));let value;
 listener({channel:'capture-command',type:'snapshot'},null,r=>value=r);
 assert.equal(value.text,null);assert.equal(value.extraction_status,'llm_page');dom.window.close();
});
