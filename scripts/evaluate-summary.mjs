// Explicit, paid model evaluation using synthetic data only. Never runs in npm test.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {summarizeRun,summaryInput,validateSummary} from '../lib/session-summary.js';
try{process.loadEnvFile('.env.local')}catch(error){if(error.code!=='ENOENT')throw error}
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/summary-session.json',import.meta.url),'utf8'));
fixture.model=process.env.PRM_ANALYSIS_MODEL||fixture.model;
const output=process.argv[2]||'output/summary-policy-v2/synthetic-evaluation.json';
const checkpoints=[];
const started=Date.now();
try{
 const answer=await summarizeRun(fixture,{onCheckpoint:async state=>{checkpoints.push(state)}});
 validateSummary(answer.result,summaryInput(fixture),answer.checkpoint.question_states);
 await mkdir(dirname(output),{recursive:true});
 await writeFile(output,JSON.stringify({synthetic:true,model:fixture.model,evaluated_at:new Date().toISOString(),duration_ms:Date.now()-started,result:answer.result,usage:answer.usage,checkpoint:answer.checkpoint,checks:{reference_and_authorship:'passed',independent_model_review:'passed',question_state_policy:'applied',item_review:'passed',semantic_truth:'not_verified'}},null,2)+'\n');
 console.log(JSON.stringify({status:'complete',output,usage:answer.usage}));
}catch(error){
 await mkdir(dirname(output),{recursive:true});
 await writeFile(output,JSON.stringify({synthetic:true,status:'failed',error:error.message,checkpoint:checkpoints.at(-1)},null,2)+'\n');
 console.error(error.message);process.exitCode=1;
}
