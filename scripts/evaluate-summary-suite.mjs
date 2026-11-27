// Paid model evaluation. Synthetic cases by default; --source-run performs DB READS only.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {summarizeRun,summaryInput,validateSummary} from '../lib/session-summary.js';
import {database} from '../lib/db.js';
try{process.loadEnvFile('.env.local')}catch(error){if(error.code!=='ENOENT')throw error}
const base=JSON.parse(await readFile(new URL('../tests/fixtures/summary-session.json',import.meta.url),'utf8'));
const clone=value=>structuredClone(value),entry=(id,type,text,event,position)=>({id,type,speaker:'user',text,object_evidence_links:[{id:'ref-'+id,event_id:event,field:'question',quote:text}]});
const openId=base.episodes[0].reasoning_objects[3].id;
const search=clone(base);search.id='synthetic-search-is-not-open';
search.episodes[0].reasoning_objects.push({id:'20000000-0000-4000-8000-000000000001',type:'open_question',speaker:'user',text:'browser data eviction',object_evidence_links:[{id:'search-ref',event_id:'search-event',field:'query',quote:'browser data eviction'}]});
search.event_order.push({event_id:'search-event',position:3});
const resolved=clone(base);resolved.id='synthetic-resolved-and-deferred';
const resolvedId='30000000-0000-4000-8000-000000000001',latestId='30000000-0000-4000-8000-000000000002';
resolved.episodes[0].reasoning_objects.push(entry(resolvedId,'decision','본문이 없는 방문은 제목과 링크를 표시하기로 결정했어. 이 표시 문제는 해결됐어.','resolution',3),entry(latestId,'open_question','이제 회원가입 기능을 넣을지 고민할게. 아직 결정하지 않고 사용자 테스트 후에 다시 판단하자.','deferred',4));
resolved.event_order.push({event_id:'resolution',position:3},{event_id:'deferred',position:4});
const cases=[{name:'search-is-not-open',run:search,expected:{open:[openId],not_open:[search.episodes[0].reasoning_objects.at(-1).id],first_suggestion:openId}},{name:'resolved-then-deferred',run:resolved,expected:{open:[latestId],not_open:[openId],first_suggestion:latestId,state:{[openId]:'resolved',[latestId]:'open'}}}];
const sourceIndex=process.argv.indexOf('--source-run');
if(sourceIndex!==-1){
 const id=process.argv[sourceIndex+1];if(!id)throw Error('--source-run requires a Run ID');
 const db=database(),checked=response=>{if(response.error)throw Error(response.error.message);return response.data};
 const run=checked(await db.from('analysis_runs').select('id,model,status,episodes(sequence,title,goal,reasoning_objects(id,type,speaker,text,object_evidence_links(id,event_id,field,quote)))').eq('id',id).single());
 if(run.status!=='complete')throw Error('Only a completed run may be compared');
 run.event_order=[];
 for(let offset=0;;offset+=500){const page=checked(await db.from('analysis_inputs').select('event_id,position').eq('run_id',id).order('position').range(offset,offset+499));run.event_order.push(...page);if(page.length<500)break;}
 let expected={};const expectationsIndex=process.argv.indexOf('--expectations');
 if(expectationsIndex!==-1){const labels=JSON.parse(await readFile(process.argv[expectationsIndex+1],'utf8'));if(labels.run_id!==id)throw Error('Evaluation labels do not match the source run');expected=labels.expected;}
 cases.push({name:'existing-run-comparison',run,expected});
}
const directory='output/summary-policy-v2/suite';await mkdir(directory,{recursive:true});
const reports=await Promise.all(cases.map(async item=>{
 const checkpoints=[];const began=Date.now();item.run.model=process.env.PRM_ANALYSIS_MODEL||item.run.model;
 try{
  const answer=await summarizeRun(item.run,{onCheckpoint:async state=>{checkpoints.push(state)}});
  validateSummary(answer.result,summaryInput(item.run),answer.checkpoint.question_states);
  const open=answer.result.open_questions.flatMap(row=>row.object_ids),states=new Map(answer.checkpoint.question_states.items.map(row=>[row.object_id,row.status]));
  const checks={reference_and_authorship:true,required_open:(item.expected.open||[]).every(id=>open.includes(id)),not_open:(item.expected.not_open||[]).every(id=>!open.includes(id)),first_suggestion:!item.expected.first_suggestion||answer.result.suggestions[0]?.object_ids.includes(item.expected.first_suggestion),question_states:Object.entries(item.expected.state||{}).every(([id,status])=>states.get(id)===status),overview_reference:!item.expected.overview_reference||answer.result.overview.some(row=>row.object_ids.includes(item.expected.overview_reference))};
  const report={name:item.name,expected:item.expected,synthetic:item.name!=='existing-run-comparison',run_id:item.run.id,policy:answer.checkpoint.policy_version,status:Object.values(checks).every(Boolean)?'passed':'failed',duration_ms:Date.now()-began,checks,result:answer.result,usage:answer.usage,checkpoint:answer.checkpoint,semantic_truth:'not_verified'};
  await writeFile(`${directory}/${item.name}.json`,JSON.stringify(report,null,2)+'\n');
  return {name:item.name,status:report.status,duration_ms:report.duration_ms,checks,usage:answer.usage};
 }catch(error){
  await writeFile(`${directory}/${item.name}.json`,JSON.stringify({name:item.name,status:'failed',error:error.message,checkpoint:checkpoints.at(-1)},null,2)+'\n');
  return {name:item.name,status:'failed',error:error.message};
 }
}));
await writeFile(`${directory}/results.json`,JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2));if(reports.some(row=>row.status==='failed'))process.exitCode=1;
