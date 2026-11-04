import test from 'node:test';
import assert from 'node:assert/strict';
import {groupPageFragments,buildActivityGroups} from '../lib/activity-timeline.js';

const page=(id,start,end,url='https://example.com/',tab=1)=>({id,event_type:'page_view',started_at:new Date(start).toISOString(),ended_at:new Date(end).toISOString(),source_ref:{url,tab_id:tab},metadata:{active_seconds:Math.round((end-start)/1000)}});
test('groups only very short adjacent same-tab page fragments while preserving originals',()=>{
 const first=page('a',1000,1100),second=page('b',5000,8000);
 const grouped=groupPageFragments([first,second]);
 assert.equal(grouped.length,1);assert.deepEqual(grouped[0].fragments,[first,second]);
 assert.equal(grouped[0].event.started_at,first.started_at);assert.equal(grouped[0].event.metadata.active_seconds,3);
 assert.equal(groupPageFragments([first,page('c',7000,9000)]).length,2);
 assert.equal(groupPageFragments([first,page('c',5000,9000,'https://example.com/other')]).length,2);
 assert.equal(groupPageFragments([first,page('c',5000,9000,'https://example.com/',2)]).length,2);
 assert.equal(groupPageFragments([page('a',1000,2000),second]).length,2);
 const search={id:'s',event_type:'search',started_at:new Date(2000).toISOString()};
 assert.equal(groupPageFragments([first,search,second]).length,3);
});

test('hides old Google results page visits but keeps searches and other visits',()=>{
 const google=page('google',1000,2000,'https://www.google.com/search?q=인스타');
 const search={id:'search',event_type:'search',started_at:new Date(1000).toISOString()};
 const destination=page('destination',3000,4000,'https://www.instagram.com/');
 assert.deepEqual(groupPageFragments([google,search,destination]).map(x=>x.event.id),['search','destination']);
});

test('nests questions and selections only in their matching visit interval and tab',()=>{
 const visit=page('visit',1000,10000,'https://chatgpt.com/c/a',7);
 const question={id:'question',event_type:'llm_exchange',started_at:new Date(3000).toISOString(),ended_at:new Date(15000).toISOString(),source_ref:{url:visit.source_ref.url,tab_id:7}};
 const copy={id:'copy',event_type:'copy_highlight',started_at:new Date(5000).toISOString(),source_ref:{url:visit.source_ref.url,tab_id:7}};
 const otherTab={...copy,id:'other',source_ref:{...copy.source_ref,tab_id:8}};
 const after={...question,id:'after',started_at:new Date(10000).toISOString()};
 const groups=buildActivityGroups([after,copy,visit,otherTab,question]);
 assert.deepEqual(groups[0].children.map(e=>e.id),['question','copy']);
 assert.deepEqual(groups.slice(1).map(g=>g.event.id),['other','after']);
});
