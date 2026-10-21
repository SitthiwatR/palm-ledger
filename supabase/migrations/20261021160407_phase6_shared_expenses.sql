begin;

-- NULL garden means shared source. Existing costs, receipts and payments keep their IDs.
alter table public.expenses alter column garden_id drop not null;
alter table public.expenses add column allocation_version integer not null default 1 check(allocation_version>0);
create table public.expense_allocations (
  expense_id uuid not null,
  owner_id uuid not null references public.owner_accounts(id),
  garden_id uuid not null,
  amount_minor bigint not null check(amount_minor between 1 and 9000000000000),
  primary key(expense_id,garden_id),
  foreign key(expense_id,owner_id) references public.expenses(id,owner_id),
  foreign key(garden_id,owner_id) references public.gardens(id,owner_id)
);
create index expense_allocations_expense_owner on public.expense_allocations(expense_id,owner_id);
create index expense_allocations_garden_owner on public.expense_allocations(garden_id,owner_id);
create index expense_allocations_owner on public.expense_allocations(owner_id);
alter table public.expense_allocations enable row level security;
create policy owner_expense_allocations on public.expense_allocations for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.expense_allocations from public,anon,authenticated;
grant select on public.expense_allocations to authenticated;

create function private.check_expense_allocation() returns trigger language plpgsql security invoker set search_path='' as $$
declare source_id uuid; source_owner uuid; source_garden uuid; total bigint; allocated numeric;
begin
  if TG_OP='UPDATE' and (new.expense_id,new.owner_id,new.garden_id) is distinct from (old.expense_id,old.owner_id,old.garden_id) then
    raise exception 'Allocation target cannot change; replace the set' using errcode='23514';
  end if;
  if TG_OP='DELETE' then source_id=old.expense_id; source_owner=old.owner_id;
  else source_id=new.expense_id; source_owner=new.owner_id; end if;
  select garden_id,amount_minor into source_garden,total from public.expenses where id=source_id and owner_id=source_owner for update;
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
create trigger expense_allocation_limit before insert or update or delete on public.expense_allocations for each row execute function private.check_expense_allocation();

-- A replacement can be temporarily incomplete inside the transaction, never after commit.
create function private.check_complete_allocation() returns trigger language plpgsql security invoker set search_path='' as $$
declare source_id uuid; total bigint; source_garden uuid; allocated numeric;
begin
  if TG_TABLE_NAME='expenses' then source_id=new.id;
  elsif TG_OP='DELETE' then source_id=old.expense_id;
  else source_id=new.expense_id; end if;
  select amount_minor,garden_id into total,source_garden from public.expenses where id=source_id for update;
  select coalesce(sum(amount_minor),0) into allocated from public.expense_allocations where expense_id=source_id;
  if allocated>0 and (source_garden is not null or allocated<>total) then
    raise exception 'Allocation set must cover the shared expense exactly' using errcode='23514';
  end if;
  return null;
end $$;
revoke all on function private.check_complete_allocation() from public,anon,authenticated;
create constraint trigger expense_allocation_complete after insert or update or delete on public.expense_allocations deferrable initially deferred for each row execute function private.check_complete_allocation();
create constraint trigger expense_allocation_source after update on public.expenses deferrable initially deferred for each row execute function private.check_complete_allocation();

-- Attribution is derived from effective payments, never a copy of their history.
-- Stable UUID order and cumulative half-up rounding conserve cents at every payment total.
create view private.expense_attributions with(security_invoker=true) as
with paid as (
  select expense_id,owner_id,sum(amount_minor) paid_minor from public.expense_payments
  where expense_id is not null and voided_at is null group by expense_id,owner_id
), parts as (
  select e.id expense_id,e.owner_id,e.garden_id,e.amount_minor,e.amount_minor total_minor,
    e.amount_minor::numeric cumulative_minor,coalesce(p.paid_minor,0) paid_minor
  from public.expenses e left join paid p on p.expense_id=e.id and p.owner_id=e.owner_id
  where not exists(select 1 from public.expense_allocations a where a.expense_id=e.id and a.owner_id=e.owner_id)
  union all
  select e.id,e.owner_id,a.garden_id,a.amount_minor,e.amount_minor,
    sum(a.amount_minor) over(partition by e.id order by a.garden_id rows unbounded preceding),coalesce(p.paid_minor,0)
  from public.expenses e join public.expense_allocations a on a.expense_id=e.id and a.owner_id=e.owner_id
  left join paid p on p.expense_id=e.id and p.owner_id=e.owner_id
), shares as (
  select expense_id,owner_id,garden_id,amount_minor,
    (floor((paid_minor*cumulative_minor+total_minor::numeric/2)/total_minor)
    -floor((paid_minor*(cumulative_minor-amount_minor)+total_minor::numeric/2)/total_minor))::bigint paid_minor
  from parts
)
select *,amount_minor-paid_minor pending_minor from shares;
revoke all on private.expense_attributions from public,anon,authenticated;
comment on table public.expense_allocations is 'Complete replacement sets attribute a shared expense to gardens. Source expense, receipts and payment history remain unchanged.';
commit;
