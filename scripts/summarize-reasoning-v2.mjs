// Read-only artifact exporter. Semantic scores require explicit developer labels;
// unreviewed objects are never automatically declared semantically correct.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2];if(!root)throw Error('평가 출력 경로가 필요합니다.');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const summary=await read(join(root,'summary.json')),truth=await read('evals/reasoning-v2/ground-truth.json');
const source=await read(join(root,'source-snapshot.json')),events=source.inputs.map(row=>row.snapshot),positions=new Map(events.map((event,index)=>[event.id,index+1]));
const inventories=[];
const add=(id,status,result,meta={})=>{
 const objects=(result?.episodes||[]).flatMap((ep,ei)=>ep.objects.map((object,oi)=>({...object,id:`${id}-E${ei+1}-O${oi+1}`,episode:ei+1,evidence:object.evidence.map(ref=>({...ref,event_position:positions.get(ref.event_id)}))})));
 inventories.push({id,status,...meta,objects});
};
add('original','complete',await read('output/e2e-test-01-2026-11-19/baseline-analysis.json'));
const baseline=await read('output/evidence-grounding-v2-final-2026-11-20/summary.json');
for(const run of baseline.runs)add(`grounding-R${run.run.repeat}`,run.run.status,run.result,{usage:run.usage,duration_ms:run.run.duration_ms});
for(const run of summary.runs)add(`new-R${run.run.repeat}`,run.run.status,run.result,{usage:run.usage,duration_ms:run.run.duration_ms,call_count:run.call_count,episodes:run.episodes.map(({audit,...ep})=>ep)});
await writeFile(join(root,'object-inventory.json'),JSON.stringify(inventories,null,2)+'\n');
let labels={};try{labels=await read(join(root,'developer-assessment.json'))}catch(error){if(error.code!=='ENOENT')throw error}
const measures=inventories.map(inventory=>{
 const judged=labels[inventory.id]||{},byId=new Map(inventory.objects.map(object=>[object.id,object]));
 const targets=truth.map(target=>{
  const ids=judged.targets?.[target.id]||[];
  for(const id of ids){const object=byId.get(id);if(!object)throw Error('평가 객체 ID 없음: '+id);if(!target.allowed_types.includes(object.type)||object.speaker!==target.speaker||!object.evidence.some(ref=>ref.event_position===target.event_position&&ref.field==='question'))throw Error('정답 평가의 유형/주체/근거 불일치: '+id+' / '+target.id);}
  return {...target,matched_object_ids:ids,recovered:ids.length>0};
 });
 const group=ids=>({recovered:targets.filter(row=>ids.includes(row.id)&&row.recovered).length,expected:ids.length});
 const objects=inventory.objects.map(object=>({id:object.id,type:object.type,speaker:object.speaker,...(judged.objects?.[object.id]||{})}));
 const precision=type=>{const predicted=objects.filter(object=>object.type===type);return {supported:predicted.filter(object=>object.type_supported===true).length,predicted:predicted.length,unreviewed:predicted.filter(object=>typeof object.type_supported!=='boolean').length}};
 let exact=0,refs=0,roleCorrect=0;
 for(const object of inventory.objects){let roles=true;for(const ref of object.evidence){refs++;const event=events.find(event=>event.id===ref.event_id),data=event?.event_contents?.content_jsonb,text=typeof data==='string'?data:data?.[ref.field];if(typeof text==='string'&&text.includes(ref.quote)&&(ref.start===undefined||text.slice(ref.start,ref.end)===ref.quote))exact++;const owner=ref.field==='question'?'user':ref.field==='response'?'assistant':event?.event_type==='search'?'user':'source';if(object.speaker!==owner)roles=false;}if(roles)roleCorrect++;}
 return {id:inventory.id,status:inventory.status,episode_count:inventory.episodes?.length??(inventory.id==='original'?4:inventory.objects.length?2:0),object_count:objects.length,questions:group(['Q1','Q2']),hypotheses:group(['H1','H2']),decisions:{...group(['D1','D2']),precision:precision('decision')},open_questions:{...group(['O1','O2']),precision:precision('open_question')},targets,
  quote_match:{matched:exact,total:refs},field_speaker_consistency:{correct:roleCorrect,total:objects.length},speaker_ownership:{correct:objects.filter(object=>object.speaker_correct===true).length,total:objects.length,unreviewed:objects.filter(object=>typeof object.speaker_correct!=='boolean').length},semantic_support:{supported:objects.filter(object=>object.semantic_support==='supported').length,unsupported:objects.filter(object=>object.semantic_support==='unsupported').length,uncertain:objects.filter(object=>object.semantic_support==='uncertain').length,unreviewed:objects.filter(object=>!object.semantic_support).length,total:objects.length},unnecessary_duplicates:objects.filter(object=>object.unnecessary_reason).map(object=>({id:object.id,reason:object.unnecessary_reason})),objects,usage:inventory.usage,duration_ms:inventory.duration_ms,call_count:inventory.call_count};
});
await writeFile(join(root,'quality-metrics.json'),JSON.stringify({assessment_notice:'Semantic labels are fallible Codex-agent source comparisons, not human or independent objective verification.',protocol:summary.protocol.evaluation_protocol,completion:{complete:summary.complete,total:summary.total},source_unchanged:summary.source_unchanged,code_unchanged:summary.code_unchanged,measures},null,2)+'\n');
const lines=['# 전체 사고 요소와 원문 근거','', '문자열 일치는 코드 검사이며, model_supported는 모델 판단이다. 개발자 평가를 객관적 의미 검증으로 해석하지 않는다.',''];
for(const inventory of inventories){lines.push(`## ${inventory.id} — ${inventory.status}`,'');for(const object of inventory.objects){lines.push(`### ${object.id} — ${object.type} / ${object.speaker}`,'',object.text,'',`모델 검토: ${object.grounding_review?.status||'구 방식 검토 없음'} / semantic_verification: ${object.semantic_verification||'미기록'}`,'');for(const ref of object.evidence)lines.push(`E${ref.event_position} / ${ref.event_id} / ${ref.field} / ${ref.evidence_id||'legacy'} / ${ref.start??'?'}–${ref.end??'?'}`,'','```text',ref.quote,'```','');}}
await writeFile(join(root,'all-objects-and-evidence.md'),lines.join('\n'));
console.log(JSON.stringify(measures.map(({objects,targets,...metrics})=>metrics),null,2));
