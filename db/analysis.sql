-- Additive setup for the existing dedicated PRM project. Run after db/schema.sql.
-- No existing sessions or events are modified or removed.
create table if not exists public.analysis_runs (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.sessions(id) on delete cascade,
 status text not null default 'queued' check(status in ('queued','processing','complete','failed')),
 model text not null, pipeline_version text not null default 'extraction-v1',
 input_version integer not null, input_hash text not null,
 created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
 worker_id uuid, heartbeat_at timestamptz, error text,
 unique(id,session_id)
);
create index if not exists analysis_runs_session on public.analysis_runs(session_id,created_at desc);
create unique index if not exists one_active_analysis_run on public.analysis_runs(session_id) where status in ('queued','processing');
create table if not exists public.analysis_inputs (
 run_id uuid not null references public.analysis_runs(id) on delete cascade,
 event_id uuid not null references public.events(id) on delete cascade,
 position integer not null check(position>0), snapshot jsonb not null,
 primary key(run_id,event_id), unique(run_id,position)
);
create table if not exists public.analysis_steps (
 run_id uuid not null references public.analysis_runs(id) on delete cascade,
 stage text not null check(stage in ('segmentation','extraction')),
 sequence integer not null default 0,
 result jsonb not null, usage jsonb not null default '{}'::jsonb,
 completed_at timestamptz not null default now(),
 primary key(run_id,stage,sequence)
);
create table if not exists public.episodes (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.analysis_runs(id) on delete cascade,
 sequence integer not null check(sequence>0), title text not null, goal text not null, boundary_reason text not null,
 unique(run_id,sequence), unique(run_id,id)
);
create table if not exists public.episode_event_links (
 run_id uuid not null, episode_id uuid not null, event_id uuid not null, position integer not null,
 primary key(run_id,event_id), unique(run_id,episode_id,position), unique(run_id,episode_id,event_id),
 foreign key(run_id,episode_id) references public.episodes(run_id,id) on delete cascade,
 foreign key(run_id,event_id) references public.analysis_inputs(run_id,event_id) on delete cascade
);
create table if not exists public.reasoning_objects (
 id uuid primary key default gen_random_uuid(), run_id uuid not null, episode_id uuid not null,
 type text not null check(type in ('question','evidence','hypothesis','insight','contradiction','decision','open_question')),
 speaker text not null check(speaker in ('user','assistant','source','unknown')), text text not null,
 verification_status text not null default 'quote_matched' check(verification_status='quote_matched'),
 foreign key(run_id,episode_id) references public.episodes(run_id,id) on delete cascade,
 unique(run_id,episode_id,id)
);
create table if not exists public.object_evidence_links (
 id uuid primary key default gen_random_uuid(), run_id uuid not null, episode_id uuid not null, object_id uuid not null,
 event_id uuid not null, field text not null check(field in ('question','response','text','query')), quote text not null,
 foreign key(run_id,episode_id,object_id) references public.reasoning_objects(run_id,episode_id,id) on delete cascade,
 foreign key(run_id,episode_id,event_id) references public.episode_event_links(run_id,episode_id,event_id) on delete cascade
);
create index if not exists analysis_inputs_event on public.analysis_inputs(event_id);
create index if not exists episode_links_episode on public.episode_event_links(run_id,episode_id);
create index if not exists evidence_object on public.object_evidence_links(run_id,episode_id,object_id);
create index if not exists evidence_event on public.object_evidence_links(run_id,episode_id,event_id);
alter table public.analysis_runs enable row level security;
alter table public.analysis_inputs enable row level security;
alter table public.analysis_steps enable row level security;
alter table public.episodes enable row level security;
alter table public.episode_event_links enable row level security;
alter table public.reasoning_objects enable row level security;
alter table public.object_evidence_links enable row level security;
revoke all on public.analysis_runs,public.analysis_inputs,public.analysis_steps,public.episodes,public.episode_event_links,public.reasoning_objects,public.object_evidence_links from anon,authenticated;
grant select,insert,update,delete on public.analysis_runs,public.analysis_inputs,public.analysis_steps,public.episodes,public.episode_event_links,public.reasoning_objects,public.object_evidence_links to service_role;

create or replace function public.prm_create_analysis_run(p_session uuid,p_model text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.sessions%rowtype; rid uuid; payload jsonb; n integer;
begin
 select * into s from public.sessions where id=p_session for update;
 if not found or s.recording_status<>'closed' or s.sync_status<>'synced' or s.input_manifest_hash is null then raise exception 'Only a closed, synchronized session can be analyzed'; end if;
 select jsonb_agg(to_jsonb(e)||jsonb_build_object('event_contents',to_jsonb(c)) order by e.client_seq),count(*) into payload,n from public.events e left join public.event_contents c on c.event_id=e.id where e.session_id=p_session;
 if n=0 or n<>s.event_count then raise exception 'Session input count mismatch or empty session'; end if;
 insert into public.analysis_runs(session_id,model,input_version,input_hash) values(p_session,p_model,s.input_version,encode(sha256(convert_to(payload::text,'UTF8')),'hex')) returning id into rid;
 insert into public.analysis_inputs(run_id,event_id,position,snapshot) select rid,(item->>'id')::uuid,ordinality::integer,item from jsonb_array_elements(payload) with ordinality as x(item,ordinality);
 update public.sessions set analysis_status='queued' where id=p_session;
 return rid;
end $$;

create or replace function public.prm_claim_analysis_run(p_worker uuid)
returns setof public.analysis_runs language plpgsql security invoker set search_path='' as $$
declare rid uuid;
begin
 -- A worker renews its lease before every model call. Stale work resumes checkpoints.
 select id into rid from public.analysis_runs where status='queued' or (status='processing' and heartbeat_at<now()-interval '10 minutes') order by created_at for update skip locked limit 1;
 if p_worker is null then raise exception 'Worker ID required'; end if;
 if rid is null then return; end if;
 update public.analysis_runs set status='processing',worker_id=p_worker,heartbeat_at=now(),started_at=coalesce(started_at,now()),error=null where id=rid;
 update public.sessions set analysis_status='processing' where id=(select session_id from public.analysis_runs where id=rid);
 return query select * from public.analysis_runs where id=rid;
end $$;

create or replace function public.prm_finish_analysis_run(p_run uuid,p_worker uuid,p_result jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_runs%rowtype; ep jsonb; obj jsonb; ref jsonb; eid uuid; oid uuid; epseq integer:=0; pos integer; seen uuid[]:='{}'; expected uuid[]; source jsonb; captured text;
begin
 select * into r from public.analysis_runs where id=p_run for update;
 if not found or r.status<>'processing' or r.worker_id is distinct from p_worker then raise exception 'Analysis lease unavailable'; end if;
 if p_result->>'pipeline_version' is distinct from 'extraction-v1' or jsonb_typeof(p_result->'episodes') is distinct from 'array' or jsonb_array_length(p_result->'episodes')=0 then raise exception 'Invalid analysis result'; end if;
 select array_agg(event_id order by position) into expected from public.analysis_inputs where run_id=p_run;
 for ep in select value from jsonb_array_elements(p_result->'episodes') loop
  epseq:=epseq+1;
  if coalesce(trim(ep->>'title'),'')='' or coalesce(trim(ep->>'goal'),'')='' or coalesce(trim(ep->>'boundary_reason'),'')='' then raise exception 'Missing episode description'; end if;
  insert into public.episodes(run_id,sequence,title,goal,boundary_reason) values(p_run,epseq,ep->>'title',ep->>'goal',ep->>'boundary_reason') returning id into eid;
  pos:=0;
  for ref in select value from jsonb_array_elements(ep->'event_ids') loop
   pos:=pos+1;seen:=array_append(seen,(ref#>>'{}')::uuid);
   insert into public.episode_event_links(run_id,episode_id,event_id,position) values(p_run,eid,(ref#>>'{}')::uuid,pos);
  end loop;
  for obj in select value from jsonb_array_elements(ep->'objects') loop
   if coalesce(trim(obj->>'text'),'')='' or jsonb_array_length(obj->'evidence')=0 then raise exception 'Object has no evidence'; end if;
   if obj->>'type'='decision' and obj->>'speaker'<>'user' then raise exception 'Assistant suggestions are not user decisions'; end if;
   insert into public.reasoning_objects(run_id,episode_id,type,speaker,text) values(p_run,eid,obj->>'type',obj->>'speaker',obj->>'text') returning id into oid;
   for ref in select value from jsonb_array_elements(obj->'evidence') loop
    select snapshot into source from public.analysis_inputs where run_id=p_run and event_id=(ref->>'event_id')::uuid;
    captured:=case when jsonb_typeof(source#>'{event_contents,content_jsonb}')='string' and ref->>'field'='text' then source#>>'{event_contents,content_jsonb}' else source#>>array['event_contents','content_jsonb',ref->>'field'] end;
    if captured is null or coalesce(trim(ref->>'quote'),'')='' or position(ref->>'quote' in captured)=0 then raise exception 'Evidence quote does not match source'; end if;
    if obj->>'type'='decision' and (ref->>'field'<>'question' or source->>'event_type'<>'llm_exchange') then raise exception 'Decision requires explicit user speech'; end if;
    insert into public.object_evidence_links(run_id,episode_id,object_id,event_id,field,quote) values(p_run,eid,oid,(ref->>'event_id')::uuid,ref->>'field',ref->>'quote');
   end loop;
  end loop;
 end loop;
 if seen<>expected then raise exception 'Episode assignment has gaps or is out of order'; end if;
 update public.analysis_runs set status='complete',completed_at=now(),heartbeat_at=now() where id=p_run;
 update public.sessions set analysis_status='needs_review' where id=r.session_id;
 return true;
end $$;
revoke all on function public.prm_create_analysis_run(uuid,text),public.prm_claim_analysis_run(uuid),public.prm_finish_analysis_run(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prm_create_analysis_run(uuid,text),public.prm_claim_analysis_run(uuid),public.prm_finish_analysis_run(uuid,uuid,jsonb) to service_role;
