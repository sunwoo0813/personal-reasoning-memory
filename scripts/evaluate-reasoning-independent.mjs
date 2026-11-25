// Synthetic-domain holdout smoke tests. No database calls or writes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {analyzeEvents,structuredCall,validateObjects} from '../lib/analysis.js';
import {assertEvidenceSpan} from '../lib/evidence-grounding.js';
import {REASONING_VERSION} from '../lib/reasoning-policy.js';
try{process.loadEnvFile('.env.local')}catch(error){if(error.code!=='ENOENT')throw error}
const output=process.argv[2];if(!output)throw Error('새 출력 경로가 필요합니다.');
const casePath=process.argv[3]||'evals/reasoning-v2/independent-cases.json';
const cases=JSON.parse(await readFile(casePath,'utf8'));
const protocol=JSON.parse(await readFile('evals/reasoning-v2/protocol.json','utf8'));
const paths=['lib/analysis.js','lib/evidence-grounding.js','lib/reasoning-policy.js',casePath];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const before=await hashes();await mkdir(output,{recursive:false});
await writeFile(join(output,'protocol.json'),JSON.stringify({created_at:new Date().toISOString(),model:'gpt-5-mini',reasoning_version:REASONING_VERSION,protocol,cases,code_hashes:before},null,2));
const runs=[];
for(const fixture of cases){
 const events=fixture.turns.map((turn,index)=>({id:`${fixture.id}-${index}`,event_type:'llm_exchange',event_contents:{content_jsonb:turn}}));
 if(fixture.search)events.splice(1,0,{id:fixture.id+'-search',event_type:'search',event_contents:{content_jsonb:{query:fixture.search}}});
 if(fixture.source)events.push({id:fixture.id+'-source',event_type:'page_view',event_contents:{content_jsonb:{text:fixture.source}}});
 const checkpoint={result:{episodes:[{title:fixture.id,goal:'사용자 의사결정 검토',boundary_reason:'독립 테스트의 단일 목적 고정',event_ids:events.map(event=>event.id)}]}};
 const calls=[],audits=[],start=Date.now();let result=null,error=null;
 try{
  result=await analyzeEvents(events,{model:'gpt-5-mini',checkpoint,onGroundingAudit:async trace=>{audits.push(trace)},call:async options=>{
   const call={stage:options.stage,request:{schema:options.schema,instructions:options.instructions,inputData:options.inputData},started_at:new Date().toISOString()};calls.push(call);
   try{const answer=await structuredCall(options);call.response=answer;return answer}catch(error){call.error=error.message;throw error}
  }});
  for(const ep of result.episodes){validateObjects({objects:ep.objects},events);for(const object of ep.objects)for(const ref of object.evidence)assertEvidenceSpan(ref,events);}
 }catch(failure){error={code:failure.code,message:failure.message};}
 const usage=calls.reduce((sum,call)=>{for(const key of Object.keys(sum))sum[key]+=call.response?.usage?.[key]||0;return sum},{input_tokens:0,output_tokens:0,total_tokens:0});
 const entry={id:fixture.id,status:error?'failed':'complete',duration_ms:Date.now()-start,events,expected:fixture.expected,result,error,usage,calls,audits};runs.push(entry);
 await writeFile(join(output,fixture.id+'.json'),JSON.stringify(entry,null,2));console.log(JSON.stringify({id:entry.id,status:entry.status,objects:result?.episodes[0].objects.length,error,usage}));
}
const summary={complete:runs.filter(run=>run.status==='complete').length,total:runs.length,code_unchanged:JSON.stringify(before)===JSON.stringify(await hashes()),runs};
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2));
if(!summary.code_unchanged)process.exitCode=1;
