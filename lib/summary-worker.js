import {summarizeRun} from './session-summary.js';
import {structuredCall} from './analysis.js';

export const isSummaryUnavailable=error=>['42P01','PGRST205','PGRST202'].includes(error?.code);
const progressStages=new Set(['review_summary_question_states','summarize_session','review_session_summary_items','repair_session_summary_items','complete']);
export const publicSummary=job=>job?{...Object.fromEntries(['run_id','version','status','result','error','created_at','completed_at'].map(key=>[key,job[key]])),progress:progressStages.has((job.progress||job.checkpoint?.progress)?.stage)?{stage:(job.progress||job.checkpoint.progress).stage}:null}:null;
const checked=({data,error})=>{if(error)throw Error(error.message);return data};
export async function processSummaryJob(db,job,worker,{call=structuredCall}={}) {
 // Every write is conditional on the current lease, including failures.
 async function write(values){
  const rows=checked(await db.from('analysis_summary_jobs').update({...values,heartbeat_at:new Date().toISOString()}).eq('run_id',job.run_id).eq('worker_id',worker).eq('status','processing').select('run_id'));
  if(!rows.length)throw Error('요약 작업의 실행 권한이 변경됐습니다.');
 }
 try{
  const run=checked(await db.from('analysis_runs').select('id,model,status,episodes(sequence,title,goal,reasoning_objects(id,type,speaker,text,object_evidence_links(id,event_id,field,quote)))').eq('id',job.run_id).single());
  if(run.status!=='complete')throw Error('완료된 분석만 요약할 수 있습니다.');
  run.event_order=[];
  for(let offset=0;;offset+=500){
   const page=checked(await db.from('analysis_inputs').select('event_id,position').eq('run_id',job.run_id).order('position').range(offset,offset+499));
   run.event_order.push(...page);if(page.length<500)break;
  }
  const answer=await summarizeRun(run,{
   queuedAt:job.created_at,
   checkpoint:job.checkpoint,
   call:async options=>{await write({});return call(options)},
   onCheckpoint:checkpoint=>write({checkpoint,usage:checkpoint.usage})
  });
  await write({status:'complete',result:answer.result,checkpoint:answer.checkpoint,usage:answer.usage,error:null,completed_at:new Date().toISOString()});
  return {status:'complete'};
 }catch(error){
  // A lost lease must not overwrite the new owner's status.
  const {error:saveError}=await db.from('analysis_summary_jobs').update({status:'failed',error:error.message.slice(0,1000),completed_at:new Date().toISOString()}).eq('run_id',job.run_id).eq('worker_id',worker).eq('status','processing');
  if(saveError)throw Error(saveError.message);
  return {status:'failed',error:error.message};
 }
}
