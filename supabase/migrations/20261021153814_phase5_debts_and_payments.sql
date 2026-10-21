begin;

-- Opening debt has already been recognized before the opening net balance.
create table public.opening_debts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_accounts(id),
  garden_id uuid not null,
  debt_date date not null,
  payee text not null check (length(trim(payee)) between 1 and 120),
  note text not null default '' check (length(note)<=2000),
  amount_minor bigint not null check (amount_minor between 1 and 9000000000000),
  created_at timestamptz not null default now(),
  unique (id,owner_id),
  foreign key (garden_id,owner_id) references public.gardens(id,owner_id)
);
create index opening_debts_garden_owner on public.opening_debts(garden_id,owner_id);
create index opening_debts_owner_date on public.opening_debts(owner_id,debt_date desc);
alter table public.opening_debts enable row level security;
create policy owner_opening_debts on public.opening_debts for select to authenticated using (owner_id=(select auth.uid()));
revoke all on public.opening_debts from public,anon,authenticated;
grant select on public.opening_debts to authenticated;

-- Keep all existing first payments and their IDs. Exactly one original source.
alter table public.sale_labor add constraint sale_labor_id_owner_unique unique(id,owner_id);
alter table public.expense_payments alter column expense_id drop not null;
alter table public.expense_payments add column sale_labor_id uuid;
alter table public.expense_payments add column opening_debt_id uuid;
alter table public.expense_payments add column voided_at timestamptz;
alter table public.expense_payments add column void_reason text;
alter table public.expense_payments add foreign key(sale_labor_id,owner_id) references public.sale_labor(id,owner_id);
alter table public.expense_payments add foreign key(opening_debt_id,owner_id) references public.opening_debts(id,owner_id);
alter table public.expense_payments add constraint payment_single_source check(num_nonnulls(expense_id,sale_labor_id,opening_debt_id)=1);
alter table public.expense_payments add constraint payment_void_reason check(
  (voided_at is null and void_reason is null) or
  (voided_at is not null and void_reason is not null and length(trim(void_reason)) between 1 and 2000));
create index expense_payments_labor_owner on public.expense_payments(sale_labor_id,owner_id) where sale_labor_id is not null;
create index expense_payments_debt_owner on public.expense_payments(opening_debt_id,owner_id) where opening_debt_id is not null;

create or replace function private.check_expense_payment() returns trigger language plpgsql security invoker set search_path='' as $$
declare total bigint; paid numeric;
begin
  if TG_OP='DELETE' then
    raise exception 'Payment history cannot be deleted' using errcode='23514';
  end if;
  if TG_OP='UPDATE' then
    if (new.id,new.owner_id,new.expense_id,new.sale_labor_id,new.opening_debt_id,new.payment_date,new.amount_minor,new.created_at)
      is distinct from (old.id,old.owner_id,old.expense_id,old.sale_labor_id,old.opening_debt_id,old.payment_date,old.amount_minor,old.created_at)
      or old.voided_at is not null then
      raise exception 'Payment history is immutable; void once instead' using errcode='23514';
    end if;
  elsif new.voided_at is not null or new.void_reason is not null then
    raise exception 'New payment must be active' using errcode='23514';
  end if;
  if new.expense_id is not null then
    select amount_minor into total from public.expenses where id=new.expense_id and owner_id=new.owner_id for update;
  elsif new.sale_labor_id is not null then
    select amount_minor into total from public.sale_labor where id=new.sale_labor_id and owner_id=new.owner_id for update;
  else
    select amount_minor into total from public.opening_debts where id=new.opening_debt_id and owner_id=new.owner_id for update;
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
create trigger expense_payment_history before delete on public.expense_payments for each row execute function private.check_expense_payment();
comment on table public.opening_debts is 'Debt incurred before opening net balance; never deducted from current net balance.';
comment on table public.expense_payments is 'Immutable payment history for expenses, sale_labor or opening debt; voiding reduces effective payments only. Never deduct from net balance.';
commit;
