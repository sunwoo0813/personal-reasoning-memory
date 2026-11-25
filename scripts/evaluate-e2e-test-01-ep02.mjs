// Isolated diagnostic after an earlier episode aborts a full evaluation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {analyzeEvents,structuredCall,validateObjects} from '../lib/analysis.js';
try{process.loadEnvFile('.env.local')}catch(error){if(error.code!=='ENOENT')throw error}
const output=process.argv[2];if(!output||process.argv.length!==3)throw Error('사용법: node scripts/evaluate-e2e-test-01-ep02.mjs <기존 평가 디렉터리>');
const source=JSON.parse(await readFile(join(output,'source-snapshot.json'),'utf8'));
const full=JSON.parse(await readFile(join(output,'new-analysis.json'),'utf8'));
assert.equal(full.run.status,'failed');
const ep=full.segmentation_checkpoint.result.episodes[1],events=source.inputs.map(input=>input.snapshot).filter(event=>ep.event_ids.includes(event.id));
assert.deepEqual(events.map(event=>event.client_seq),[20,21,22]);
const codeBefore=createHash('sha256').update(await readFile('lib/analysis.js')).digest('hex');
assert.equal(codeBefore,JSON.parse(await readFile(join(output,'protocol.json'),'utf8')).code_hashes['lib/analysis.js']);
const packet={run:{id:randomUUID(),kind:'isolated_ep02_diagnostic',parent_failed_run_id:full.run.id,status:'processing',created_at:new Date().toISOString(),model:'gpt-5-mini'},
 scope:'Same fixed EP02 title, originals, model, extraction instructions and validator. No segmentation rerun. Does not change the failed full-run status.',inputs:events,attempts:[],checkpoints:[]};
let failure;
try{
 packet.result=await analyzeEvents(events,{model:packet.run.model,groundingVersion:'legacy-v1',checkpoint:{result:{episodes:[ep]}},call:async options=>{
  assert.equal(options.stage,'extract_episode');console.log('EP02 독립 진단 Extraction'+(options.instructions.includes('previous candidate failed validation')?' (기존 자동 교정)':''));
  const response=await structuredCall(options);packet.attempts.push(response);return response;
 },onCheckpoint:async step=>packet.checkpoints.push(step)});
 validateObjects({objects:packet.result.episodes[0].objects},events);packet.run.status='complete';
}catch(error){packet.run.status='failed';packet.run.error=error.message;failure=error}
packet.run.completed_at=new Date().toISOString();packet.run.extraction_code_unchanged=codeBefore===createHash('sha256').update(await readFile('lib/analysis.js')).digest('hex');
assert.equal(packet.run.extraction_code_unchanged,true);
await writeFile(join(output,'ep02-diagnostic-analysis.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:packet.run.status,objects:packet.result?.episodes[0].objects.length,calls:packet.attempts.length,error:packet.run.error}));
if(failure)process.exitCode=1;
