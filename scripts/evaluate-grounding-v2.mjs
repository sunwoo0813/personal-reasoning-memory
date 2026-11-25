// Local, repeated evaluation against immutable E2E snapshots. DB is read-only.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {database} from '../lib/db.js';
import {analyzeEvents,structuredCall,inputHash,validateObjects,validateSegments} from '../lib/analysis.js';
import {buildEvidenceCatalog,assertEvidenceSpan,GROUNDING_VERSION} from '../lib/evidence-grounding.js';

try{process.loadEnvFile('.env.local')}catch(error){if(error.code!=='ENOENT')throw error}
const output=process.argv[2],repeats=Number(process.argv[3]||3);
if(!output||process.argv.length>4||!Number.isInteger(repeats)||repeats<1||repeats>5)throw Error('사용법: node scripts/evaluate-grounding-v2.mjs <새 출력 경로> [반복 횟수 1~5]');
const sourceRun='c4bbd6f5-77d4-4a55-a5b3-7d3f1c410061',previous='output/e2e-test-01-2026-11-19';
const legacy=JSON.parse(await readFile(join(previous,'new-analysis.json'),'utf8'));
const frozen=JSON.parse(await readFile(join(previous,'source-snapshot.json'),'utf8'));
const split=JSON.parse(await readFile('output/segmentation/purpose-v2-comparison-2026-11-19-4.json','utf8')).run.segmentation;
const events=frozen.inputs.map(input=>input.snapshot),position=new Map(events.map((event,index)=>[event.id,index+1]));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
assert.equal(events.length,22);assert.equal(split.result.segmentation_policy.input_hash,inputHash(events));
assert.deepEqual(split.result.episodes.map(ep=>ep.event_ids.map(id=>position.get(id))),[Array.from({length:19},(_,i)=>i+1),[20,21,22]]);
const db=database(),check=result=>{if(result.error)throw Error(result.error.message);return result.data};
async function readSource(){
 const run=check(await db.from('analysis_runs').select('*').eq('id',sourceRun).single());
 const session=check(await db.from('sessions').select('*').eq('id',run.session_id).single());
 const project=check(await db.from('projects').select('*').eq('id',session.project_id).single());
 const inputs=[],stored=[];
 for(const [table,target,column,id,order] of [['analysis_inputs',inputs,'run_id',run.id,'position'],['events',stored,'session_id',session.id,'client_seq']]){
  for(let offset=0;;offset+=500){const page=check(await db.from(table).select(table==='events'?'*,event_contents(*)':'*').eq(column,id).order(order).range(offset,offset+499));target.push(...page);if(page.length<500)break;}
 }
 const episodes=check(await db.from('episodes').select('*,episode_event_links(*),reasoning_objects(*,object_evidence_links(*))').eq('run_id',run.id).order('sequence'));
 const steps=check(await db.from('analysis_steps').select('*').eq('run_id',run.id).order('stage').order('sequence'));
 for(const ep of episodes){ep.episode_event_links.sort((a,b)=>a.position-b.position);ep.reasoning_objects.sort((a,b)=>a.id.localeCompare(b.id));for(const obj of ep.reasoning_objects)obj.object_evidence_links.sort((a,b)=>a.id.localeCompare(b.id));}
 return {run,session,project,inputs,events:stored,episodes,steps};
}
const codePaths=['lib/analysis.js','lib/evidence-grounding.js','lib/segmentation.js','scripts/analyze.mjs','db/analysis.sql'];
const codeHashes=async()=>Object.fromEntries(await Promise.all(codePaths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await mkdir(output,{recursive:false});
const before=await readSource(),codeBefore=await codeHashes();
assert.equal(hash(before.inputs),hash(frozen.inputs));
const protocol={created_at:new Date().toISOString(),source_run_id:sourceRun,model:'gpt-5-mini',repeats,grounding_version:GROUNDING_VERSION,segmentation_policy:'purpose-v2',segmentation_mode:'fixed previously validated E01-E19 / E20-E22',classification_policy:'unchanged extraction-v1 types, authorship, decisions and open-question rules',source_state_hash:hash(before),input_hash:inputHash(events),code_hashes:codeBefore,
 comparator:{kind:'historical single full-run test',path:join(previous,'new-analysis.json'),full_status:legacy.run.status,full_complete:0,full_total:1,extra_ep02_diagnostic:'separate scope, not a completed full run'},
 design:'Three sequential independent extractions by default, no checkpoint reuse between repeats. No DB writes. No change to thresholds after observing results. Same source session is not a general reliability benchmark.',
 metrics:'candidate_count is the first parsed object-slot count. validated_count requires literal/author checks and model support review. failed_count is unresolved final slots. Error counts count occurrences, not unique objects. Whole-run accepted count is zero when the run fails. model_supported is not semantic truth verification.'};
const write=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
await write('protocol.json',protocol);await write('source-snapshot.json',frozen);await write('segmentation-checkpoint.json',split);
const runs=[];
for(let repeat=1;repeat<=repeats;repeat++){
 const path=join(output,`run-${String(repeat).padStart(2,'0')}`);await mkdir(path);
 const run={id:randomUUID(),repeat,model:protocol.model,created_at:new Date().toISOString(),status:'processing'},audits=new Map(),checkpoints=[],calls=[];
 const started=Date.now();let result=null,failure=null;
 console.log(`Grounding v2 반복 ${repeat}/${repeats}: 시작`);
 try{
  result=await analyzeEvents(events,{model:run.model,checkpoint:split,groundingVersion:GROUNDING_VERSION,reasoningVersion:'reasoning-v1',
   onGroundingAudit:async({sequence,audit})=>{audits.set(sequence,audit);await appendFile(join(path,'audit-trace.jsonl'),JSON.stringify({sequence,audit})+'\n');},
   onCheckpoint:async step=>{checkpoints.push(step);await writeFile(join(path,`checkpoint-ep${step.sequence+1}.json`),JSON.stringify(step,null,2)+'\n',{flag:'wx'});console.log(`반복 ${repeat}: EP${step.sequence+1} 검증 완료 ${step.result.objects.length}개`);},
   call:async options=>{
    const time=Date.now(),record={stage:options.stage,started_at:new Date().toISOString(),request:{schema:options.schema,instructions:options.instructions,inputData:options.inputData}};
    calls.push(record);console.log(`반복 ${repeat}: ${options.stage}`);
    try{const answer=await structuredCall(options);record.response=answer;record.status='received';return answer}
    catch(error){record.status='error';record.error=error.message;throw error}
    finally{record.completed_at=new Date().toISOString();record.duration_ms=Date.now()-time;await writeFile(join(path,`call-${String(calls.length).padStart(2,'0')}.json`),JSON.stringify(record,null,2)+'\n',{flag:'wx'})}
   }
  });
  validateSegments(result,events);
  for(const ep of result.episodes){const source=events.filter(event=>ep.event_ids.includes(event.id));validateObjects({objects:ep.objects},source);for(const item of ep.objects)for(const ref of item.evidence)assertEvidenceSpan(ref,source);}
  run.status='complete';
 }catch(error){failure=error;run.status='failed';run.error=error.message;run.error_code=error.code||'runtime_error';}
 run.completed_at=new Date().toISOString();run.duration_ms=Date.now()-started;
 const episodes=split.result.episodes.map((ep,index)=>{
  const audit=audits.get(index),saved=checkpoints.find(step=>step.sequence===index),source=events.filter(event=>ep.event_ids.includes(event.id));
  return {episode:index+1,title:ep.title,status:saved?'complete':audit?.status||'not_reached',candidate_objects:audit?.candidate_count??null,validated_objects:audit?.validated_count??0,unresolved_objects:audit?.failed_count??null,
   accepted_in_full_run:run.status==='complete'?(saved?.result.objects.length||0):0,repair_rounds:audit?.repair_rounds||0,error_counts:audit?.error_counts||{},catalog_size:buildEvidenceCatalog(source).units.length,audit:audit||null};
 });
 const usage=calls.reduce((sum,call)=>{for(const key of ['input_tokens','output_tokens','total_tokens'])sum[key]+=call.response?.usage?.[key]||0;return sum},{input_tokens:0,output_tokens:0,total_tokens:0});
 const decisions=result?.episodes.flatMap(ep=>ep.objects).filter(item=>item.type==='decision'&&item.speaker==='user'&&item.evidence.some(ref=>ref.event_id===events[18].id&&ref.field==='question'))||[];
 const decisionAssessment={method:'typed source check plus manual review required; no causal graph scoring',event19_user_decision_objects:decisions.map(item=>({text:item.text,evidence:item.evidence})),retrieved:decisions.length>0};
 const entry={run,episodes,usage,call_count:calls.length,result,checkpoints,decisionAssessment};runs.push(entry);
 await writeFile(join(path,'analysis-result.json'),JSON.stringify(entry,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({repeat,status:run.status,episodes:episodes.map(ep=>({episode:ep.episode,status:ep.status,candidates:ep.candidate_objects,validated:ep.validated_objects,failed:ep.unresolved_objects,repairs:ep.repair_rounds})),usage,duration_ms:run.duration_ms,error:run.error}));
}
const after=await readSource(),codeAfter=await codeHashes();
const summary={protocol,source_unchanged:hash(before)===hash(after),code_unchanged:hash(codeBefore)===hash(codeAfter),complete:runs.filter(entry=>entry.run.status==='complete').length,total:runs.length,runs};
await write('summary.json',summary);
console.log(JSON.stringify({complete:summary.complete,total:summary.total,source_unchanged:summary.source_unchanged,code_unchanged:summary.code_unchanged,output}));
if(!summary.source_unchanged||!summary.code_unchanged)process.exitCode=1;
