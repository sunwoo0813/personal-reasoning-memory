create extension if not exists pgcrypto;
create table if not exists public.projects (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 100),
 objective text not null default '', status text not null default 'active' check(status in ('active','archived')), created_at timestamptz not null default now()
);
create table if not exists public.sessions (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 started_at timestamptz not null default now(), ended_at timestamptz,
 recording_status text not null default 'recording' check(recording_status in ('recording','closing','closed')),
 sync_status text not null default 'pending' check(sync_status in ('pending','synced','partial')),
 analysis_status text not null default 'not_started', event_count integer not null default 0,
 input_version integer not null default 1, input_manifest_hash text, device_id uuid not null,
 check(ended_at is null or ended_at >= started_at)
);
create unique index if not exists one_active_session on public.sessions ((true)) where recording_status <> 'closed';
create table if not exists public.events (
 id uuid primary key default gen_random_uuid(), session_id uuid not null references public.sessions(id) on delete cascade,
 client_event_id uuid not null, device_id uuid not null, client_seq bigint not null check(client_seq > 0),
 schema_version text not null default '1.0', event_type text not null check(event_type in ('search','page_view','llm_exchange','copy_highlight')),
 started_at timestamptz not null, ended_at timestamptz not null, received_at timestamptz not null default now(),
 source text not null, source_ref jsonb not null default '{}'::jsonb, metadata jsonb not null default '{}'::jsonb,
 capture_status text not null check(capture_status in ('complete','partial','error','metadata_only')),
 unique(session_id,client_event_id), unique(session_id,device_id,client_seq), check(ended_at >= started_at)
);
create index if not exists events_session_order on public.events(session_id,client_seq);
create table if not exists public.event_contents (
 event_id uuid primary key references public.events(id) on delete cascade, content_jsonb jsonb,
 content_hash text, parser_version text, truncated boolean not null default false, redaction_status text not null default 'filtered'
);
alter table public.projects enable row level security;
alter table public.sessions enable row level security;
alter table public.events enable row level security;
alter table public.event_contents enable row level security;
revoke all on public.projects,public.sessions,public.events,public.event_contents from anon,authenticated;
create or replace function public.prm_store_event(p_session uuid,p_event jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare s public.sessions%rowtype; eid uuid; old_event public.events%rowtype;
begin
 select * into s from public.sessions where id=p_session for update;
 if not found or s.recording_status not in ('recording','closing') then raise exception 'session unavailable'; end if;
 if s.device_id <> (p_event->>'device_id')::uuid then raise exception 'device mismatch'; end if;
 select * into old_event from public.events where session_id=p_session and client_event_id=(p_event->>'client_event_id')::uuid;
 if found then
  if old_event.client_seq <> (p_event->>'client_seq')::bigint or old_event.device_id <> (p_event->>'device_id')::uuid then raise exception 'client id conflict'; end if;
  return 'duplicate';
 end if;
 insert into public.events(session_id,client_event_id,device_id,client_seq,event_type,started_at,ended_at,source,source_ref,metadata,capture_status)
 values(p_session,(p_event->>'client_event_id')::uuid,(p_event->>'device_id')::uuid,(p_event->>'client_seq')::bigint,p_event->>'event_type',(p_event->>'started_at')::timestamptz,(p_event->>'ended_at')::timestamptz,p_event->>'source',coalesce(p_event->'source_ref','{}'::jsonb),coalesce(p_event->'metadata','{}'::jsonb),p_event->>'capture_status') returning id into eid;
 insert into public.event_contents(event_id,content_jsonb,content_hash,parser_version,truncated)
 values(eid,p_event->'content',encode(sha256(convert_to((p_event->'content')::text,'UTF8')),'hex'),'1.0',coalesce((p_event->'metadata'->>'truncated')::boolean,false));
 return 'saved';
end $$;
revoke all on function public.prm_store_event(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prm_store_event(uuid,jsonb) to service_role;
create or replace function public.prm_close_session(p_session uuid,p_ids uuid[],p_last_seq bigint)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare s public.sessions%rowtype; n bigint; bad bigint;
begin
 select * into s from public.sessions where id=p_session for update;
 if not found then raise exception 'session missing'; end if;
 if s.recording_status = 'closed' then return s.event_count=p_last_seq and s.input_manifest_hash=encode(sha256(convert_to(array_to_string(p_ids,','),'UTF8')),'hex'); end if;
 if s.recording_status <> 'closing' then raise exception 'session not closing'; end if;
 select count(*), count(*) filter(where not(client_event_id=any(p_ids)) or client_seq > p_last_seq) into n,bad from public.events where session_id=p_session;
 if n<>p_last_seq or n<>coalesce(array_length(p_ids,1),0) or bad<>0 or (select count(distinct x) from unnest(p_ids) x)<>n then return false; end if;
 update public.sessions set recording_status='closed',sync_status='synced',ended_at=now(),event_count=n,input_manifest_hash=encode(sha256(convert_to(array_to_string(p_ids,','),'UTF8')),'hex') where id=p_session;
 return true;
end $$;
revoke all on function public.prm_close_session(uuid,uuid[],bigint) from public,anon,authenticated;
grant execute on function public.prm_close_session(uuid,uuid[],bigint) to service_role;
grant select,insert,update,delete on public.projects,public.sessions,public.events,public.event_contents to service_role;
