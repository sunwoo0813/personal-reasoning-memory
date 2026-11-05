import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {database} from '../lib/db.js';
import {cases} from '../evals/cases.mjs';
import {scoreCase} from '../evals/score.mjs';
process.loadEnvFile('.env.local');
const db=database();
const output=process.argv[2]||'docs/verification/evaluation-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(output,{recursive:true});
const projectId=JSON.parse(readFileSync('docs/verification/live-integration.json','utf8')).project_id;
const repeats=2,model='gpt-5-mini';
const check=result=>{if(result.error)throw Error(result.error.message);return result.data};
const protocol={created_at:new Date().toISOString(),project_id:projectId,model,repeats,case_count:cases.length,synthetic:true,pipeline_hash:createHash('sha256').update(readFileSync('lib/analysis.js')).digest('hex'),method:'Fixed existing prompts. Core decision recall/precision via one-to-one event/field/quote-anchor matching. No all-object semantic accuracy claim. Exact boundary positions from explicit topic switches. Failed runs remain in denominator.',cases:cases.map(c=>({id:c.id,name:c.name,events:c.events.length,input_chars:JSON.stringify(c.events).length,decisions:c.decisions,openQuestions:c.openQuestions,boundaries:c.boundaries,notes:c.notes}))};
writeFileSync(output+'/protocol.json',JSON.stringify(protocol,null,2)+'\n');
const jobs=[];
for(const definition of cases)for(let repeat=1;repeat<=repeats;repeat++){
 const device=randomUUID();
 const session=check(await db.from('sessions').insert({project_id:projectId,device_id:device}).select().single());
 const start=Date.parse('2026-11-05T06:00:00Z');
 const submitted=definition.events.map((e,i)=>({...e,client_event_id:randomUUID(),device_id:device,client_seq:i+1,started_at:new Date(start+i*60000).toISOString(),ended_at:new Date(start+i*60000+30000).toISOString(),metadata:{...e.metadata,evaluation_case:definition.id,evaluation_name:definition.name,evaluation_repeat:repeat}}));
 for(const event of submitted){
  // Use the same normalization contract as the collection API.
  const {normalizeEvent}=await import('../lib/events.js');
  check(await db.rpc('prm_store_event',{p_session:session.id,p_event:normalizeEvent(event)}));
 }
 check(await db.from('sessions').update({recording_status:'closing'}).eq('id',session.id));
 if(!check(await db.rpc('prm_close_session',{p_session:session.id,p_ids:submitted.map(e=>e.client_event_id),p_last_seq:submitted.length})))throw Error('Close did not synchronize');
 const runId=check(await db.rpc('prm_create_analysis_run',{p_session:session.id,p_model:model}));
 const job={case_id:definition.id,name:definition.name,repeat,session_id:session.id,run_id:runId,status:'queued'};jobs.push(job);
 writeFileSync(output+'/jobs.json',JSON.stringify(jobs,null,2)+'\n');
 console.log(`Queued ${definition.id} #${repeat}: ${runId}`);
}
const deadline=Date.now()+30*60000;
while(jobs.some(job=>!['complete','failed','timeout'].includes(job.status))){
 if(Date.now()>deadline){for(const job of jobs)if(!['complete','failed'].includes(job.status))job.status='timeout';break;}
 const pending=jobs.filter(job=>!['complete','failed'].includes(job.status));
 const current=check(await db.from('analysis_runs').select('*').in('id',pending.map(job=>job.run_id)));
 for(const run of current){
  const job=jobs.find(job=>job.run_id===run.id),previous=job.status;
  job.status=run.status;
  if(['complete','failed'].includes(run.status)&&previous!==run.status){
   job.error=run.error;job.created_at=run.created_at;job.started_at=run.started_at;job.completed_at=run.completed_at;
   job.queue_ms=Date.parse(run.started_at)-Date.parse(run.created_at);job.processing_ms=Date.parse(run.completed_at)-Date.parse(run.started_at);
   const inputs=check(await db.from('analysis_inputs').select('*').eq('run_id',run.id).order('position'));
   const steps=check(await db.from('analysis_steps').select('*').eq('run_id',run.id));
   const episodes=check(await db.from('episodes').select('*,episode_event_links(*),reasoning_objects(*,object_evidence_links(*))').eq('run_id',run.id).order('sequence'));
   const result={episodes:episodes.map(ep=>({...ep,event_ids:ep.episode_event_links.sort((a,b)=>a.position-b.position).map(link=>link.event_id),objects:ep.reasoning_objects.map(item=>({...item,evidence:item.object_evidence_links}))}))};
   if(run.status==='complete')job.score=scoreCase(cases.find(c=>c.id===job.case_id),inputs.map(i=>i.snapshot),result);
   job.usage=steps.reduce((sum,step)=>({input_tokens:sum.input_tokens+(step.usage.input_tokens||0),output_tokens:sum.output_tokens+(step.usage.output_tokens||0),total_tokens:sum.total_tokens+(step.usage.total_tokens||0)}),{input_tokens:0,output_tokens:0,total_tokens:0});
   writeFileSync(`${output}/${job.case_id}-${job.repeat}.json`,JSON.stringify({job,run,inputs,steps,result},null,2)+'\n');
   console.log(`Finished ${job.case_id} #${job.repeat}: ${run.status} ${job.processing_ms}ms ${job.score?`objects=${job.score.objects} decisions=${job.score.decisions.matched}/${job.score.decisions.expected}`:job.error}`);
  }
 }
 writeFileSync(output+'/jobs.json',JSON.stringify(jobs,null,2)+'\n');
 if(jobs.some(job=>!['complete','failed'].includes(job.status)))await new Promise(resolve=>setTimeout(resolve,2500));
}
writeFileSync(output+'/jobs.json',JSON.stringify(jobs,null,2)+'\n');
console.log('Evaluation finished.');
