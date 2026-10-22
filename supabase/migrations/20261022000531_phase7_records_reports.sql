begin;
-- Preserve identities and all historical amounts. Labor keeps its own attribution
-- when the parent invoice is edited or voided.
alter table public.sale_labor add column garden_id uuid;
alter table public.sale_labor add column labor_date date;
update public.sale_labor l set garden_id=s.garden_id,labor_date=s.sale_date from public.sales s where s.id=l.sale_id and s.owner_id=l.owner_id;
alter table public.sale_labor alter column garden_id set not null;
alter table public.sale_labor alter column labor_date set not null;
alter table public.sale_labor add foreign key(garden_id,owner_id) references public.gardens(id,owner_id);
alter table public.sales add foreign key(garden_id,owner_id) references public.gardens(id,owner_id);
alter table public.sales add column note text not null default '' check(length(note)<=2000);
alter table public.sale_labor add column note text not null default '' check(length(note)<=2000);
alter table public.sales add column version integer not null default 1 check(version>0);
alter table public.sales add column updated_at timestamptz not null default now();
alter table public.sales add column voided_at timestamptz;
alter table public.sales add column void_reason text;
alter table public.sales add constraint sales_void_reason check((voided_at is null and void_reason is null) or (voided_at is not null and void_reason is not null and length(trim(void_reason)) between 1 and 2000));
create index sales_owner_current on public.sales(owner_id) where voided_at is null;
alter table public.sale_labor add column version integer not null default 1 check(version>0);
alter table public.sale_labor add column updated_at timestamptz not null default now();
alter table public.sale_labor add column voided_at timestamptz;
alter table public.sale_labor add column void_reason text;
alter table public.sale_labor add constraint sale_labor_void_reason check((voided_at is null and void_reason is null) or (voided_at is not null and void_reason is not null and length(trim(void_reason)) between 1 and 2000));
create index sale_labor_owner_current on public.sale_labor(owner_id) where voided_at is null;
alter table public.expenses add column version integer not null default 1 check(version>0);
alter table public.expenses add column updated_at timestamptz not null default now();
alter table public.expenses add column voided_at timestamptz;
alter table public.expenses add column void_reason text;
alter table public.expenses add constraint expenses_void_reason check((voided_at is null and void_reason is null) or (voided_at is not null and void_reason is not null and length(trim(void_reason)) between 1 and 2000));
create index expenses_owner_current on public.expenses(owner_id) where voided_at is null;
alter table public.opening_debts add column version integer not null default 1 check(version>0);
alter table public.opening_debts add column updated_at timestamptz not null default now();
alter table public.opening_debts add column voided_at timestamptz;
alter table public.opening_debts add column void_reason text;
alter table public.opening_debts add constraint opening_debts_void_reason check((voided_at is null and void_reason is null) or (voided_at is not null and void_reason is not null and length(trim(void_reason)) between 1 and 2000));
create index opening_debts_owner_current on public.opening_debts(owner_id) where voided_at is null;

create function private.snapshot_sale_labor() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.garden_id is null or new.labor_date is null then
    select coalesce(new.garden_id,s.garden_id),coalesce(new.labor_date,s.sale_date) into new.garden_id,new.labor_date from public.sales s where s.id=new.sale_id and s.owner_id=new.owner_id;
  end if;
  return new;
end $$;
revoke all on function private.snapshot_sale_labor() from public,anon,authenticated;
create trigger sale_labor_snapshot before insert on public.sale_labor for each row execute function private.snapshot_sale_labor();
create function private.guard_ledger_source() returns trigger language plpgsql security invoker set search_path='' as $$
declare paid numeric;
begin
  if TG_OP='DELETE' then raise exception 'Source history cannot be deleted' using errcode='23514'; end if;
  if old.voided_at is not null or (new.id,new.owner_id,new.created_at) is distinct from (old.id,old.owner_id,old.created_at) then
    raise exception 'Source identity and voided history are immutable' using errcode='23514';
  end if;
  if TG_TABLE_NAME='sale_labor' and to_jsonb(new)->'sale_id' is distinct from to_jsonb(old)->'sale_id' then
    raise exception 'Labor invoice is immutable' using errcode='23514';
  end if;
  if TG_TABLE_NAME<>'sales' then
    select coalesce(sum(amount_minor),0) into paid from public.expense_payments where owner_id=new.owner_id and voided_at is null and
      ((TG_TABLE_NAME='expenses' and expense_id=new.id) or (TG_TABLE_NAME='sale_labor' and sale_labor_id=new.id) or (TG_TABLE_NAME='opening_debts' and opening_debt_id=new.id));
    if (to_jsonb(new)->>'amount_minor')::bigint<paid or (new.voided_at is not null and paid>0) then
      raise exception 'Source amount is below effective payments' using errcode='23514';
    end if;
  end if;
  if TG_TABLE_NAME='expenses' then
    if (to_jsonb(new)->'amount_minor',to_jsonb(new)->'garden_id') is distinct from (to_jsonb(old)->'amount_minor',to_jsonb(old)->'garden_id') then
      new.allocation_version=old.allocation_version+1;
    end if;
  end if;
  new.version=old.version+1;
  new.updated_at=now();
  return new;
end $$;
revoke all on function private.guard_ledger_source() from public,anon,authenticated;
create trigger sales_history before update or delete on public.sales for each row execute function private.guard_ledger_source();
create trigger sale_labor_history before update or delete on public.sale_labor for each row execute function private.guard_ledger_source();
create trigger expenses_history before update or delete on public.expenses for each row execute function private.guard_ledger_source();
create trigger opening_debts_history before update or delete on public.opening_debts for each row execute function private.guard_ledger_source();
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
create or replace function private.check_expense_allocation() returns trigger language plpgsql security invoker set search_path='' as $$
declare source_id uuid; source_owner uuid; source_garden uuid; total bigint; allocated numeric;
begin
  if TG_OP='UPDATE' and (new.expense_id,new.owner_id,new.garden_id) is distinct from (old.expense_id,old.owner_id,old.garden_id) then
    raise exception 'Allocation target cannot change; replace the set' using errcode='23514';
  end if;
  if TG_OP='DELETE' then source_id=old.expense_id; source_owner=old.owner_id;
  else source_id=new.expense_id; source_owner=new.owner_id; end if;
  select garden_id,amount_minor into source_garden,total from public.expenses where id=source_id and owner_id=source_owner and voided_at is null for update;
  if total is null then raise exception 'Expense not found' using errcode='23503'; end if;
  if source_garden is not null then raise exception 'Only shared expenses can be allocated' using errcode='23514'; end if;
  if TG_OP<>'DELETE' then
    select coalesce(sum(amount_minor),0) into allocated from public.expense_allocations where expense_id=source_id and owner_id=source_owner and garden_id<>new.garden_id;
    if allocated+new.amount_minor>total then raise exception 'Allocations exceed expense' using errcode='23514'; end if;
    return new;
  end if;
  return old;
end $$;
revoke all on function private.check_expense_allocation() from public,anon,authenticated;

alter table public.sales add constraint sales_gross_math check(gross_minor=((net_weight_grams::bigint*price_minor_per_kg+500)/1000));
create function private.check_sale_deductions() returns trigger language plpgsql security invoker set search_path='' as $$
declare sid uuid; total bigint; actual numeric;
begin
  if TG_TABLE_NAME='sales' then sid=new.id;
  elsif TG_OP='DELETE' then sid=old.sale_id;
  else sid=new.sale_id; end if;
  select deductions_minor into total from public.sales where id=sid for update;
  select coalesce(sum(amount_minor),0) into actual from public.sale_deductions where sale_id=sid;
  if total is distinct from actual then raise exception 'Deductions do not match sale' using errcode='23514'; end if;
  return null;
end $$;
revoke all on function private.check_sale_deductions() from public,anon,authenticated;
create constraint trigger sale_deductions_complete after insert or update or delete on public.sale_deductions deferrable initially deferred for each row execute function private.check_sale_deductions();
create constraint trigger sale_deductions_source after insert or update on public.sales deferrable initially deferred for each row execute function private.check_sale_deductions();
alter view private.expense_attributions rename to expense_attributions_all;
create view private.expense_attributions with(security_invoker=true) as select a.* from private.expense_attributions_all a join public.expenses e on e.id=a.expense_id and e.owner_id=a.owner_id where e.voided_at is null;
revoke all on private.expense_attributions,private.expense_attributions_all from public,anon,authenticated;
create view private.ledger_records with(security_invoker=true) as
with sources as (
 select 'sales'::text source,id,owner_id,garden_id,sale_date business_date,'sale'::text kind,buyer payee,note,invoice_number,net_minor amount_minor,version,voided_at,void_reason,created_at from public.sales
 union all select 'expenses',id,owner_id,garden_id,expense_date,kind,payee,note,null,amount_minor,version,voided_at,void_reason,created_at from public.expenses
 union all select 'sale-labor',l.id,l.owner_id,l.garden_id,l.labor_date,l.mode,l.payee,l.note,s.invoice_number,l.amount_minor,l.version,l.voided_at,l.void_reason,l.created_at from public.sale_labor l join public.sales s on s.id=l.sale_id and s.owner_id=l.owner_id
 union all select 'opening-debts',id,owner_id,garden_id,debt_date,'opening_debt',payee,note,null,amount_minor,version,voided_at,void_reason,created_at from public.opening_debts
)
select s.*,coalesce(p.paid,0)::bigint paid_minor,case when s.source='sales' or s.voided_at is not null then 0 else s.amount_minor-coalesce(p.paid,0) end::bigint pending_minor
from sources s left join lateral(select sum(p.amount_minor) paid from public.expense_payments p where p.owner_id=s.owner_id and p.voided_at is null and ((s.source='expenses' and p.expense_id=s.id) or (s.source='sale-labor' and p.sale_labor_id=s.id) or (s.source='opening-debts' and p.opening_debt_id=s.id))) p on true;
create view private.ledger_attributions with(security_invoker=true) as
 select source,id,owner_id,garden_id,amount_minor,paid_minor,pending_minor from private.ledger_records where source<>'expenses'
 union all select 'expenses',a.expense_id,a.owner_id,a.garden_id,a.amount_minor,a.paid_minor,case when e.voided_at is null then a.pending_minor else 0 end from private.expense_attributions_all a join public.expenses e on e.id=a.expense_id and e.owner_id=a.owner_id;
revoke all on private.ledger_records,private.ledger_attributions from public,anon,authenticated;
comment on column public.sale_labor.garden_id is 'Independent cost attribution snapshot; parent invoice edits never move labor silently.';
commit;
