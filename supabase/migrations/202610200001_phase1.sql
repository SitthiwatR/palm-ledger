begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.owner_accounts (
  id uuid primary key references auth.users(id),
  singleton boolean not null default true unique check (singleton),
  username text not null unique check (length(username) between 3 and 40),
  auth_epoch integer not null default 1,
  created_at timestamptz not null default now()
);
alter table public.owner_accounts enable row level security;
create policy owner_self on public.owner_accounts for select to authenticated using (id = auth.uid());
grant select on public.owner_accounts to authenticated;
revoke all on public.owner_accounts from anon;

create table public.gardens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_accounts(id),
  name text not null check (length(trim(name)) between 1 and 80),
  opening_minor bigint not null default 0 check (opening_minor between -99999999999 and 99999999999),
  archived boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index gardens_active_name on public.gardens(owner_id, lower(name)) where not archived;
alter table public.gardens enable row level security;
create policy owner_gardens on public.gardens for select to authenticated
using (owner_id = auth.uid() and exists (select 1 from public.owner_accounts where id = auth.uid()));
-- All writes go through the API's validated transactions and audit trail.
revoke all on public.gardens from anon, authenticated;
grant select on public.gardens to authenticated;

create table public.audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.owner_accounts(id),
  action text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
create policy owner_audit on public.audit_events for select to authenticated using (owner_id = auth.uid());
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;

create table private.owner_sessions (
  token_hash text primary key,
  owner_id uuid not null references public.owner_accounts(id),
  auth_epoch integer not null,
  sealed_tokens text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index owner_sessions_expiry on private.owner_sessions(expires_at);
create table private.login_attempts (
  key text primary key,
  failures integer not null default 0,
  window_start timestamptz not null default now()
);
create table private.idempotency_requests (
  owner_id uuid not null references public.owner_accounts(id),
  key text not null,
  request_hash text not null,
  response jsonb not null,
  primary key (owner_id, key)
);
revoke all on all tables in schema private from public, anon, authenticated;
commit;
