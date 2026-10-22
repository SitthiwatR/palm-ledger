begin;
create table private.automatic_backup_runs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.owner_accounts(id),
 slot date not null,
 destination_repository text not null check(destination_repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
 status text not null check(status in ('running','complete','failed')),
 attempt integer not null default 1 check(attempt>0),
 lease_token uuid not null,
 lease_until timestamptz not null,
 started_at timestamptz not null default now(),
 completed_at timestamptz,
 snapshot_at timestamptz,
 sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes integer check(size_bytes between 1 and 41943040),
 artifact_id text check(artifact_id ~ '^[0-9]+$'),
 proof_artifact_id text check(proof_artifact_id ~ '^[0-9]+$'),
 workflow_run_id text not null check(workflow_run_id ~ '^[0-9]+$'),
 error_code text check(error_code in ('BACKUP_FAILED','LEASE_EXPIRED')),
 unique(owner_id,slot),
 check(status<>'complete' or (completed_at is not null and snapshot_at is not null and sha256 is not null and size_bytes is not null and artifact_id is not null and proof_artifact_id is not null))
);
create index automatic_backups_owner_success on private.automatic_backup_runs(owner_id,snapshot_at desc) where status='complete';
alter table private.automatic_backup_runs enable row level security;
create policy owner_automatic_backups on private.automatic_backup_runs for select to authenticated using(owner_id=(select auth.uid()));
revoke all on private.automatic_backup_runs from public,anon,authenticated;
comment on table private.automatic_backup_runs is 'Only encrypted, downloaded-and-verified offsite artifacts can complete; daily leases never overwrite an earlier successful backup. No passwords, auth tokens or raw provider errors.';
commit;
