-- Additive, repeatable setup. Apply AFTER db/analysis.sql.
-- Existing completed runs are not backfilled. No source events are modified.
create table if not exists public.analysis_summary_jobs (
 run_id uuid primary key references public.analysis_runs(id) on delete cascade,
 version text not null default 'summary-v1' check(version='summary-v1'),
 status text not null default 'queued' check(status in ('queued','processing','complete','failed')),
 result jsonb, checkpoint jsonb not null default '{}'::jsonb, usage jsonb not null default '{}'::jsonb,
 error text, worker_id uuid, heartbeat_at timestamptz,
 created_at timestamptz not null default now(), completed_at timestamptz,
 check(status<>'complete' or result is not null)
);
create index if not exists summary_jobs_pending on public.analysis_summary_jobs(created_at) where status in ('queued','processing');
alter table public.analysis_summary_jobs enable row level security;
revoke all on public.analysis_summary_jobs from anon,authenticated;
grant select,insert,update,delete on public.analysis_summary_jobs to service_role;

-- This trigger runs in the SAME transaction as extraction completion.
create or replace function public.prm_queue_completed_summary()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status='complete' and old.status is distinct from 'complete' then
  insert into public.analysis_summary_jobs(run_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists queue_completed_summary on public.analysis_runs;
create trigger queue_completed_summary after update of status on public.analysis_runs
 for each row execute function public.prm_queue_completed_summary();

create or replace function public.prm_request_summary(p_run uuid)
returns setof public.analysis_summary_jobs language plpgsql security invoker set search_path='' as $$
begin
 -- Serialize requests for a run; queued/processing/complete requests are idempotent.
 perform 1 from public.analysis_runs where id=p_run and status='complete' for update;
 if not found then raise exception 'Summary requires a completed analysis run'; end if;
 insert into public.analysis_summary_jobs(run_id) values(p_run) on conflict do nothing;
 update public.analysis_summary_jobs set status='queued',error=null,result=null,
  checkpoint=jsonb_build_object('usage',usage),worker_id=null,heartbeat_at=null,completed_at=null
  where run_id=p_run and status='failed';
 return query select * from public.analysis_summary_jobs where run_id=p_run;
end $$;

create or replace function public.prm_claim_summary(p_worker uuid)
returns setof public.analysis_summary_jobs language plpgsql security invoker set search_path='' as $$
declare rid uuid;
begin
 if p_worker is null then raise exception 'Worker ID required'; end if;
 select run_id into rid from public.analysis_summary_jobs
  where status='queued' or (status='processing' and heartbeat_at<now()-interval '10 minutes')
  order by created_at for update skip locked limit 1;
 if rid is null then return; end if;
 update public.analysis_summary_jobs set status='processing',worker_id=p_worker,heartbeat_at=now(),error=null where run_id=rid;
 return query select * from public.analysis_summary_jobs where run_id=rid;
end $$;
revoke all on function public.prm_queue_completed_summary(),public.prm_request_summary(uuid),public.prm_claim_summary(uuid) from public,anon,authenticated;
grant execute on function public.prm_queue_completed_summary(),public.prm_request_summary(uuid),public.prm_claim_summary(uuid) to service_role;
