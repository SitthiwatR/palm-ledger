begin;

alter table public.gardens add constraint gardens_id_owner_unique unique (id,owner_id);

-- Standalone expenses only: existing sale_labor remains the source of sale-linked costs.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_accounts(id),
  garden_id uuid not null,
  expense_date date not null,
  kind text not null check (kind in ('daily_labor','fertilizer','material','maintenance','other')),
  payee text not null check (length(trim(payee)) between 1 and 120),
  note text not null default '' check (length(note)<=2000),
  unit text not null check (unit in ('day','sack','item')),
  quantity_milli bigint not null check (quantity_milli between 1 and 1000000000),
  rate_minor bigint not null check (rate_minor between 1 and 100000000000),
  amount_minor bigint not null check (amount_minor between 1 and 9000000000000),
  created_at timestamptz not null default now(),
  unique (id,owner_id),
  foreign key (garden_id,owner_id) references public.gardens(id,owner_id),
  check ((kind='daily_labor' and unit='day' and quantity_milli%500=0 and quantity_milli<=366000 and rate_minor<=100000000)
    or (kind='fertilizer' and unit='sack')
    or (kind in ('material','maintenance','other') and unit='item')),
  check (amount_minor=floor((quantity_milli::numeric*rate_minor+500)/1000))
);
create index expenses_owner_date on public.expenses(owner_id,expense_date desc,created_at desc);
create index expenses_garden_owner on public.expenses(garden_id,owner_id);
alter table public.expenses enable row level security;
create policy owner_expenses on public.expenses for select to authenticated using (owner_id=(select auth.uid()));
revoke all on public.expenses from public,anon,authenticated;
grant select on public.expenses to authenticated;

create table public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_accounts(id),
  expense_id uuid not null,
  payment_date date not null,
  amount_minor bigint not null check (amount_minor between 1 and 9000000000000),
  created_at timestamptz not null default now(),
  foreign key (expense_id,owner_id) references public.expenses(id,owner_id)
);
create index expense_payments_expense_owner on public.expense_payments(expense_id,owner_id);
alter table public.expense_payments enable row level security;
create policy owner_expense_payments on public.expense_payments for select to authenticated using (owner_id=(select auth.uid()));
revoke all on public.expense_payments from public,anon,authenticated;
grant select on public.expense_payments to authenticated;

create function private.check_expense_payment() returns trigger language plpgsql security invoker set search_path='' as $$
declare total bigint; paid numeric;
begin
  if TG_OP='UPDATE' and (new.expense_id<>old.expense_id or new.owner_id<>old.owner_id) then
    raise exception 'Payment target cannot change' using errcode='23514';
  end if;
  select amount_minor into total from public.expenses where id=new.expense_id and owner_id=new.owner_id for update;
  if total is null then raise exception 'Expense not found' using errcode='23503'; end if;
  select coalesce(sum(amount_minor),0) into paid from public.expense_payments where expense_id=new.expense_id and owner_id=new.owner_id and id<>new.id;
  if paid+new.amount_minor>total then raise exception 'Payment exceeds expense' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function private.check_expense_payment() from public,anon,authenticated;
create trigger expense_payment_limit before insert or update on public.expense_payments for each row execute function private.check_expense_payment();

alter table public.receipt_files alter column sale_id drop not null;
alter table public.receipt_files add column expense_id uuid;
alter table public.receipt_files add foreign key (expense_id,owner_id) references public.expenses(id,owner_id);
alter table public.receipt_files add constraint receipt_single_source check (num_nonnulls(sale_id,expense_id)=1);
create unique index receipt_files_expense on public.receipt_files(expense_id) where expense_id is not null;

comment on table public.expenses is 'Standalone incurred expenses, including fertilizer actually used. No stock purchases or copies of sale_labor.';
comment on table public.expense_payments is 'Payment history; reduces outstanding debt only, never garden net balance.';
commit;
