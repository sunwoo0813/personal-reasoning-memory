import {randomUUID} from 'node:crypto';
import {database} from '../lib/db.js';
import {analyzeEvents} from '../lib/analysis.js';
import {REASONING_VERSION} from '../lib/reasoning-policy.js';

try{process.loadEnvFile('.env.local')}catch(error){if(error.code!=='ENOENT')throw error}
// Keep the evaluated v2 policy opt-in until semantic false positives improve.
const reasoningVersion=process.env.PRM_REASONING_POLICY||'reasoning-v1';
if(!['reasoning-v1',REASONING_VERSION].includes(reasoningVersion))throw Error('지원하지 않는 PRM_REASONING_POLICY입니다. reasoning-v1 또는 reasoning-v2를 사용하세요.');
const db=database(),worker=randomUUID();
const check=result=>{if(result.error)throw Error(result.error.message);return result.data};
const once=process.argv.includes('--once');let stopped=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true});
if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY를 .env.local에 설정하세요.');
async function heartbeat(run){
 const rows=check(await db.from('analysis_runs').update({heartbeat_at:new Date().toISOString()}).eq('id',run.id).eq('worker_id',worker).eq('status','processing').select('id'));
 if(!rows.length)throw Error('분석 작업의 실행 권한이 변경됐습니다.');
}
async function processRun(run){
 try{
  const inputs=[];
  for(let offset=0;;offset+=500){
   const page=check(await db.from('analysis_inputs').select('snapshot').eq('run_id',run.id).order('position').range(offset,offset+499));
   inputs.push(...page);if(page.length<500)break;
  }
  const steps=check(await db.from('analysis_steps').select('*').eq('run_id',run.id));
  const checkpoint=steps.find(step=>step.stage==='segmentation');
  const result=await analyzeEvents(inputs.map(input=>input.snapshot),{
   model:run.model,reasoningVersion,checkpoint,extractionCheckpoints:steps.filter(step=>step.stage==='extraction'),
   call:async options=>{await heartbeat(run);const {structuredCall}=await import('../lib/analysis.js');return structuredCall(options)},
   onGroundingAudit:async({sequence,audit})=>{await heartbeat(run);check(await db.from('analysis_steps').upsert({run_id:run.id,stage:'extraction',sequence,result:{grounding_audit:audit},usage:audit.usage}))},
   onCheckpoint:async step=>{await heartbeat(run);check(await db.from('analysis_steps').upsert({run_id:run.id,stage:step.stage,sequence:step.sequence??0,result:step.result,usage:step.usage||{}}))}
  });
  check(await db.rpc('prm_finish_analysis_run',{p_run:run.id,p_worker:worker,p_result:result}));
  console.log(`Analysis ${run.id}: extracted ${result.episodes.length} episodes.`);
 }catch(error){
  const message=error.message.slice(0,1000);
  const rows=check(await db.from('analysis_runs').update({status:'failed',error:message,completed_at:new Date().toISOString()}).eq('id',run.id).eq('worker_id',worker).eq('status','processing').select('id'));
  if(rows.length)check(await db.from('sessions').update({analysis_status:'failed'}).eq('id',run.session_id));
  console.error(`Analysis ${run.id}: ${message}`);
 }
}
console.log('PRM analysis worker ready.');
while(!stopped){
 const rows=check(await db.rpc('prm_claim_analysis_run',{p_worker:worker}));
 if(rows.length)await processRun(rows[0]);
 if(once)break;
 if(!rows.length)await new Promise(resolve=>setTimeout(resolve,2000));
}
