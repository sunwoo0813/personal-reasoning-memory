import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreCase} from '../evals/score.mjs';
const events=[{id:'a',event_contents:{content_jsonb:{question:'API는 FastAPI로 결정. DB는 PostgreSQL로 결정.'}}}];
const definition={decisions:[{event:1,field:'question',anchor:'API는 FastAPI'},{event:1,field:'question',anchor:'DB는 PostgreSQL'}],openQuestions:[],boundaries:[]};
const item={type:'decision',speaker:'user',text:'설정 결정',evidence:[{event_id:'a',field:'question',quote:'API는 FastAPI로 결정. DB는 PostgreSQL로 결정.'}]};
test('a single compound object cannot count as two recovered decisions',()=>{
 const score=scoreCase(definition,events,{episodes:[{event_ids:['a'],objects:[item]}]});
 assert.equal(score.decisions.matched,1);assert.equal(score.decisions.expected,2);assert.equal(score.decisions.predicted,1);
});
test('an extra decision is counted against precision and missing facts stay missing',()=>{
 const score=scoreCase({...definition,decisions:[]},events,{episodes:[{event_ids:['a'],objects:[item]}]});
 assert.equal(score.decisions.matched,0);assert.equal(score.decisions.predicted,1);
});
