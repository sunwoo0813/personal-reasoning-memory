import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvent} from '../lib/events.js';

test('removes old page contents before storage without changing other event types', () => {
 const old={event_type:'page_view',content:{text:'old page body'},capture_status:'complete',metadata:{title:'Page',active_seconds:8,truncated:true}};
 const result=normalizeEvent(old);
 assert.equal(result.content,null);
 assert.equal(result.capture_status,'metadata_only');
 assert.deepEqual(result.metadata,{title:'Page',active_seconds:8});
 assert.equal(old.content.text,'old page body');
 for(const event_type of ['search','llm_exchange','copy_highlight']) {
  const event={event_type,content:{text:'preserve'}};
  assert.equal(normalizeEvent(event),event);
 }
});
