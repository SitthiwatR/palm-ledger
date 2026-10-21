begin;

create table public.sale_labor (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_accounts(id),
  sale_id uuid not null,
  mode text not null check (mode in ('daily','weight')),
  payee text not null check (length(trim(payee)) between 1 and 120),
  basis_units integer not null check (basis_units > 0),
  rate_minor bigint not null check (rate_minor between 1 and 100000000),
  amount_minor bigint not null check (amount_minor between 1 and 9000000000000),
  created_at timestamptz not null default now(),
  foreign key (sale_id,owner_id) references public.sales(id,owner_id),
  check ((mode='daily' and basis_units<=732 and amount_minor=(basis_units*rate_minor+1)/2)
    or (mode='weight' and basis_units<=1000000000 and amount_minor=(basis_units*rate_minor+500000)/1000000))
);
comment on table public.sale_labor is 'Labor expense incurred with a sale; initially unpaid. Future payments must reference this expense without deducting net balance again.';
create index sale_labor_sale_owner on public.sale_labor(sale_id,owner_id);
create index sale_labor_owner on public.sale_labor(owner_id);
alter table public.sale_labor enable row level security;
create policy owner_sale_labor on public.sale_labor for select to authenticated
using (owner_id=(select auth.uid()));
revoke all on public.sale_labor from public,anon,authenticated;
grant select on public.sale_labor to authenticated;

create table public.labor_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_accounts(id),
  mode text not null check (mode in ('daily','weight')),
  payee text not null check (length(trim(payee)) between 1 and 120),
  rate_minor bigint not null check (rate_minor between 1 and 100000000),
  updated_at timestamptz not null default now(),
  unique (owner_id,mode,payee)
);
alter table public.labor_profiles enable row level security;
create policy owner_labor_profiles on public.labor_profiles for select to authenticated
using (owner_id=(select auth.uid()));
revoke all on public.labor_profiles from public,anon,authenticated;
grant select on public.labor_profiles to authenticated;

commit;
