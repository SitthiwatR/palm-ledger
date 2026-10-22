begin;
-- Durable cleanup metadata is written BEFORE uploading any temporary object.
-- A killed request can leave private bytes, never untracked permanent orphans.
create table private.transfer_objects (
 owner_id uuid not null references public.owner_accounts(id),
 transfer_id uuid not null references private.transfer_jobs(id),
 bucket text not null check(bucket in ('palm-receipts','palm-transfers')),
 storage_key text primary key check(length(storage_key)<=1024),
 expires_at timestamptz not null,
 check(left(storage_key,37)=owner_id::text||'/')
);
create index transfer_objects_owner_expiry on private.transfer_objects(owner_id,expires_at);
alter table private.transfer_objects enable row level security;
create policy owner_transfer_objects on private.transfer_objects for select to authenticated using(owner_id=(select auth.uid()));
revoke all on private.transfer_objects from public,anon,authenticated;

create function private.immutable_legacy_provenance() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.legacy_details is distinct from old.legacy_details then raise exception 'Original import provenance is immutable' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function private.immutable_legacy_provenance() from public,anon,authenticated;
create trigger sales_legacy_provenance before update on public.sales for each row execute function private.immutable_legacy_provenance();
create trigger expenses_legacy_provenance before update on public.expenses for each row execute function private.immutable_legacy_provenance();
create trigger sale_labor_legacy_provenance before update on public.sale_labor for each row execute function private.immutable_legacy_provenance();
create trigger opening_debts_legacy_provenance before update on public.opening_debts for each row execute function private.immutable_legacy_provenance();
commit;
