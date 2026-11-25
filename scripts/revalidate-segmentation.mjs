// Read-only DB comparison. Standard create/finish RPCs update sessions, so this
// creates a separate local evaluation run and never invokes a mutation RPC.
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {database} from '../lib/db.js';
import {segmentEvents,validateSegments,structuredCall} from '../lib/analysis.js';
import {SEGMENTATION_POLICY_VERSION} from '../lib/segmentation.js';

try{process.loadEnvFile('.env.local')}catch(error){if(error.code!=='ENOENT')throw error}
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--source-run'||args[2]!=='--output'||!/^[0-9a-f-]{36}$/i.test(args[1]))throw Error('사용법: node scripts/revalidate-segmentation.mjs --source-run <기존 Run UUID> --output <로컬 JSON 경로>');
const sourceRunId=args[1],output=args[3],db=database();
try{await stat(output);throw Error('기존 검증 Run을 덮어쓸 수 없습니다. 새 출력 경로를 지정하세요.')}catch(error){if(error.code!=='ENOENT')throw error}
const check=result=>{if(result.error)throw Error(result.error.message);return result.data};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
async function readSource(){
 const source=check(await db.from('analysis_runs').select('*').eq('id',sourceRunId).single());
 if(source.status!=='complete')throw Error('완료된 기존 Run을 지정하세요.');
 const session=check(await db.from('sessions').select('*').eq('id',source.session_id).single());
 const inputs=[];
 for(let offset=0;;offset+=500){
  const page=check(await db.from('analysis_inputs').select('*').eq('run_id',sourceRunId).order('position').range(offset,offset+499));
  inputs.push(...page);if(page.length<500)break;
 }
 const episodes=check(await db.from('episodes').select('*,episode_event_links(*),reasoning_objects(*,object_evidence_links(*))').eq('run_id',sourceRunId).order('sequence'));
 const steps=check(await db.from('analysis_steps').select('*').eq('run_id',sourceRunId).order('stage').order('sequence'));
 const events=[];
 for(let offset=0;;offset+=500){
  const page=check(await db.from('events').select('*,event_contents(*)').eq('session_id',source.session_id).order('client_seq').range(offset,offset+499));
  events.push(...page);if(page.length<500)break;
 }
 // Relations have no declared order in PostgREST; canonicalize them for the
 // before/after immutability check without reordering the captured input.
 for(const ep of episodes){
  ep.episode_event_links.sort((a,b)=>a.position-b.position);
  ep.reasoning_objects.sort((a,b)=>a.id.localeCompare(b.id));
  for(const obj of ep.reasoning_objects)obj.object_evidence_links.sort((a,b)=>a.id.localeCompare(b.id));
 }
 return {source,session,inputs,episodes,steps,events};
}
const before=await readSource(),snapshots=before.inputs.map(input=>input.snapshot);
const run={id:randomUUID(),kind:'local_segmentation_evaluation',source_run_id:sourceRunId,model:before.source.model,
 policy:SEGMENTATION_POLICY_VERSION,status:'processing',created_at:new Date().toISOString(),model_attempts:[]};
console.log(`분할 검증 시작: 원본 ${snapshots.length}개, 정책 ${run.policy}, 모델 ${run.model}. DB에는 쓰지 않습니다.`);
let failure;
try{
 const segmentation=await segmentEvents(snapshots,{model:run.model,call:async options=>{
  const reason=options.instructions.match(/previous candidate failed validation: (.*)/)?.[1];
  console.log(`모델 호출: ${options.stage}${reason?' (교정: '+reason+')':''}`);
  const answer=await structuredCall(options);
  run.model_attempts.push({stage:options.stage,result:answer.result,usage:answer.usage});
  return answer;
 }});
 validateSegments(segmentation.result,snapshots);
 run.status='complete';run.segmentation=segmentation;
}catch(error){run.status='failed';run.error=error.message;failure=error}
run.completed_at=new Date().toISOString();
const after=await readSource();
run.source_unchanged=hash(before)===hash(after);
if(!run.source_unchanged){run.status='failed';run.error='검증 중 원본 상태가 변경됐습니다. 다른 프로세스의 동작을 확인하세요.';failure=Error(run.error)}
const positions=new Map(snapshots.map((event,index)=>[event.id,index+1]));
const summarize=episodes=>episodes.map((episode,index)=>({sequence:index+1,title:episode.title,goal:episode.goal,boundary_reason:episode.boundary_reason,
 event_indices:(episode.event_ids||episode.episode_event_links.map(link=>link.event_id)).map(id=>positions.get(id))}));
const comparison={run,source_state_hash:hash(before),source_input_hash:before.source.input_hash,
 before:summarize(before.episodes),after:run.segmentation?summarize(run.segmentation.result.episodes):[]};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(comparison,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:run.status,source_unchanged:run.source_unchanged,before:comparison.before,after:comparison.after,error:run.error,output},null,2));
if(failure)process.exitCode=1;
