import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvent} from '../lib/events.js';

test('preserves historical page snapshots and bounds newly captured text',()=>{
 const old={event_type:'page_view',content:{text:'old page body'},capture_status:'complete',metadata:{title:'Page',active_seconds:8,truncated:true}};
 const result=normalizeEvent(old);
 assert.equal(result.content.text,'old page body');assert.equal(result.capture_status,'partial');
 assert.equal(old.content.text,'old page body');
 const large=normalizeEvent({...old,content:{text:'x'.repeat(60001)},metadata:{}});
 assert.equal(large.content.text.length,60000);assert.equal(large.capture_status,'partial');
 const empty=normalizeEvent({...old,content:null});assert.equal(empty.capture_status,'metadata_only');
 for(const event_type of ['search','llm_exchange','copy_highlight']){
  const event={event_type,content:{text:'preserve'}};assert.equal(normalizeEvent(event),event);
 }
});
