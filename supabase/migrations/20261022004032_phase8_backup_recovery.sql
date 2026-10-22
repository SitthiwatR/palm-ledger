begin;
-- Imported historical totals may have no trustworthy quantity/rate. NULL means
-- unknown, never a fabricated kilogram/day/rate. Normal entry rules stay strict.
alter table public.sales add column legacy_details jsonb check(legacy_details is null or (jsonb_typeof(legacy_details)='object' and legacy_details ? 'id'));
alter table public.sales alter column net_weight_grams drop not null;
alter table public.sales alter column price_minor_per_kg drop not null;
alter table public.sales add constraint sales_known_calculation check((net_weight_grams is not null and price_minor_per_kg is not null) or (net_weight_grams is null and price_minor_per_kg is null and legacy_details is not null));
alter table public.expenses add column legacy_details jsonb check(legacy_details is null or (jsonb_typeof(legacy_details)='object' and legacy_details ? 'id'));
alter table public.expenses alter column quantity_milli drop not null;
alter table public.expenses alter column rate_minor drop not null;
alter table public.expenses add constraint expenses_known_calculation check((quantity_milli is not null and rate_minor is not null) or (quantity_milli is null and rate_minor is null and legacy_details is not null));
alter table public.sale_labor add column legacy_details jsonb check(legacy_details is null or (jsonb_typeof(legacy_details)='object' and legacy_details ? 'id'));
alter table public.sale_labor alter column basis_units drop not null;
alter table public.sale_labor alter column rate_minor drop not null;
alter table public.sale_labor add constraint sale_labor_known_calculation check((basis_units is not null and rate_minor is not null) or (basis_units is null and rate_minor is null and legacy_details is not null));
alter table public.opening_debts alter column garden_id drop not null;
alter table public.opening_debts add column legacy_details jsonb check(legacy_details is null or jsonb_typeof(legacy_details)='object');
alter table public.expense_payments add column legacy_date_unknown boolean not null default false;
alter table public.receipt_files add column sale_labor_id uuid;
alter table public.receipt_files add column opening_debt_id uuid;
alter table public.receipt_files add foreign key(sale_labor_id,owner_id) references public.sale_labor(id,owner_id);
alter table public.receipt_files add foreign key(opening_debt_id,owner_id) references public.opening_debts(id,owner_id);
alter table public.receipt_files drop constraint receipt_single_source;
alter table public.receipt_files add constraint receipt_single_source check(num_nonnulls(sale_id,expense_id,sale_labor_id,opening_debt_id)=1);
create unique index receipt_files_labor on public.receipt_files(sale_labor_id) where sale_labor_id is not null;
create unique index receipt_files_debt on public.receipt_files(opening_debt_id) where opening_debt_id is not null;

create table private.transfer_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.owner_accounts(id),
 request_key uuid not null,
 request_hash text not null,
 kind text not null check(kind in ('backup','prototype','restore')),
 status text not null check(status in ('pending','processing','ready','confirmed','failed')),
 storage_key text not null unique,
 size_bytes integer not null check(size_bytes between 1 and 134217728),
 object_hash text,
 preview_hash text,
 baseline_hash text,
 summary jsonb,
 result jsonb,
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 unique(owner_id,request_key)
);
create index transfer_jobs_owner_created on private.transfer_jobs(owner_id,created_at desc);
create index transfer_jobs_expiry on private.transfer_jobs(expires_at);
alter table private.transfer_jobs enable row level security;
create policy owner_transfer_jobs on private.transfer_jobs for select to authenticated using(owner_id=(select auth.uid()));
revoke all on private.transfer_jobs from public,anon,authenticated;
create table private.legacy_imports (
 owner_id uuid not null references public.owner_accounts(id),
 entity_type text not null check(entity_type in ('garden','record')),
 legacy_id text not null,
 target_id uuid not null,
 transfer_id uuid not null references private.transfer_jobs(id),
 primary key(owner_id,entity_type,legacy_id)
);
alter table private.legacy_imports enable row level security;
create policy owner_legacy_imports on private.legacy_imports for select to authenticated using(owner_id=(select auth.uid()));
revoke all on private.legacy_imports from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('palm-transfers','palm-transfers',false,134217728,array['application/octet-stream','application/json'])
on conflict(id) do nothing;
comment on table private.transfer_jobs is 'Owner-only encrypted exports and temporary recovery uploads; passwords are never persisted. Restore never replaces a populated environment.';
create or replace function private.check_expense_payment() returns trigger language plpgsql security invoker set search_path='' as $$
declare total bigint; paid numeric;
begin
  if TG_OP='DELETE' then
    raise exception 'Payment history cannot be deleted' using errcode='23514';
  end if;
  if TG_OP='UPDATE' then
    if (new.id,new.owner_id,new.expense_id,new.sale_labor_id,new.opening_debt_id,new.payment_date,new.amount_minor,new.created_at,new.legacy_date_unknown)
      is distinct from (old.id,old.owner_id,old.expense_id,old.sale_labor_id,old.opening_debt_id,old.payment_date,old.amount_minor,old.created_at,old.legacy_date_unknown)
      or old.voided_at is not null then
      raise exception 'Payment history is immutable; void once instead' using errcode='23514';
    end if;
  elsif new.voided_at is not null or new.void_reason is not null then
    raise exception 'New payment must be active' using errcode='23514';
  end if;
  if new.expense_id is not null then
    select amount_minor into total from public.expenses where id=new.expense_id and owner_id=new.owner_id and voided_at is null for update;
  elsif new.sale_labor_id is not null then
    select amount_minor into total from public.sale_labor where id=new.sale_labor_id and owner_id=new.owner_id and voided_at is null for update;
  else
    select amount_minor into total from public.opening_debts where id=new.opening_debt_id and owner_id=new.owner_id and voided_at is null for update;
  end if;
  if total is null then raise exception 'Payment source not found' using errcode='23503'; end if;
  select coalesce(sum(amount_minor),0) into paid from public.expense_payments
    where owner_id=new.owner_id and id<>new.id and voided_at is null and
    (expense_id=new.expense_id or sale_labor_id=new.sale_labor_id or opening_debt_id=new.opening_debt_id);
  if new.voided_at is null and paid+new.amount_minor>total then
    raise exception 'Payment exceeds outstanding amount' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.check_expense_payment() from public,anon,authenticated;

commit;
