import test from 'node:test';
import assert from 'node:assert/strict';
import {filterActivityGroups,activitySearchSnippet,captureNotice} from '../lib/activity-view.js';
import {objectGroup,quoteParts,sortAnalysisRuns} from '../lib/analysis-view.js';
const page={id:'page',event_type:'page_view',started_at:'2026-11-19T00:00:00Z',ended_at:'2026-11-19T00:01:00Z',source_ref:{url:'https://example.com',tab_id:1},metadata:{title:'자료'},event_contents:{content_jsonb:{text:'수집할 본문'}}};
const chat={id:'chat',event_type:'llm_exchange',started_at:'2026-11-19T00:00:05Z',source_ref:page.source_ref,event_contents:{content_jsonb:{question:'고유검색어를 확인하자',response:'확인할 내용'}}};
test('filtering retains parent context for a matching conversation and searches stored body',()=>{
 const result=filterActivityGroups([page,chat],{type:'llm_exchange',query:'고유검색어'});
 assert.equal(result.count,1);assert.equal(result.groups[0].contextOnly,true);assert.equal(result.groups[0].children[0].id,'chat');
 assert.match(activitySearchSnippet(chat,'고유검색어'),/고유검색어/);
 assert.equal(filterActivityGroups([page,chat],{query:'수집할 본문'}).count,1);
 assert.equal(filterActivityGroups([page,chat],{type:'search'}).groups.length,0);
});
test('capture labels distinguish missing content, incomplete observation, truncation and errors',()=>{
 assert.equal(captureNotice(page).label,'본문 저장됨');
 assert.equal(captureNotice({...page,event_contents:{}}).label,'방문 정보만 저장됨');
 assert.match(captureNotice({...chat,metadata:{completion_observed:false}}).detail,/답변이 끝났는지/);
 assert.equal(captureNotice({...chat,metadata:{truncated:true}}).label,'일부 저장됨');
 assert.equal(captureNotice({...chat,capture_status:'error'}).label,'수집 오류');
});
test('view rules preserve attribution, deterministic ordering and exact repeated quote highlighting',()=>{
 assert.equal(objectGroup({type:'decision',speaker:'assistant'}),'other');assert.equal(objectGroup({type:'open_question',speaker:'user'}),'open_questions');
 const parts=quoteParts('문장\n문장','문장');assert.equal(parts.filter(part=>part.matched).length,2);assert.equal(parts.map(part=>part.text).join(''),'문장\n문장');
 assert.deepEqual(quoteParts('<script>','missing'),[{text:'<script>',matched:false}]);
 const result=sortAnalysisRuns([{episodes:[{sequence:2,reasoning_objects:[]},{sequence:1,reasoning_objects:[{id:'b'},{id:'a'}]}]}]);
 assert.equal(result[0].episodes[0].sequence,1);assert.equal(result[0].episodes[0].reasoning_objects[0].id,'a');
});
