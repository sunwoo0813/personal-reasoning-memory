// Deterministic scoring of pre-annotated core facts, not an LLM judge.
function compatible(target,item,idToPosition){
 return item.evidence.some(ref=>idToPosition.get(ref.event_id)===target.event&&ref.field===target.field&&ref.quote.includes(target.anchor));
}
function matchTargets(targets,items,positions){
 // Maximum one-to-one matching: a compound object cannot count as three facts.
 const owner=new Map();
 function augment(index,visited){
  for(let i=0;i<items.length;i++){
   if(visited.has(i)||!compatible(targets[index],items[i],positions))continue;
   visited.add(i);
   if(!owner.has(i)||augment(owner.get(i),visited)){owner.set(i,index);return true;}
  }return false;
 }
 let matched=0;for(let i=0;i<targets.length;i++)if(augment(i,new Set()))matched++;
 return {matched,expected:targets.length,predicted:items.length,unmatched_targets:targets.filter((_,i)=>![...owner.values()].includes(i))};
}
export function scoreCase(definition,events,result){
 const positions=new Map(events.map((e,i)=>[e.id,i+1]));
 const items=result.episodes.flatMap(ep=>ep.objects);
 const decisions=matchTargets(definition.decisions,items.filter(item=>item.type==='decision'&&item.speaker==='user'),positions);
 const questions=matchTargets(definition.openQuestions,items.filter(item=>item.type==='open_question'&&item.speaker==='user'),positions);
 const predictedBoundaries=result.episodes.slice(0,-1).map(ep=>positions.get(ep.event_ids.at(-1)));
 const goldBoundaries=definition.boundaries;
 const boundaryTP=predictedBoundaries.filter(x=>goldBoundaries.includes(x)).length;
 const captured=[];let quoteMatches=0;
 const byId=new Map(events.map(e=>[e.id,e]));
 for(const item of items)for(const ref of item.evidence){
  const content=byId.get(ref.event_id)?.event_contents?.content_jsonb;
  const field=typeof content==='string'&&ref.field==='text'?content:content?.[ref.field];
  captured.push(ref);if(typeof field==='string'&&field.includes(ref.quote))quoteMatches++;
 }
 const requiredEvidence=(definition.requiredEvidence||[]).map(target=>({...target,matched:items.some(item=>item.evidence.some(ref=>positions.get(ref.event_id)===target.event&&ref.quote.includes(target.anchor)))}));
 return {objects:items.length,episodes:result.episodes.length,decisions,open_questions:questions,boundaries:{expected:goldBoundaries,predicted:predictedBoundaries,true_positive:boundaryTP},quotes:{matched:quoteMatches,total:captured.length},required_evidence:requiredEvidence,no_objects_check:definition.expectNoObjects?items.length===0:null};
}
