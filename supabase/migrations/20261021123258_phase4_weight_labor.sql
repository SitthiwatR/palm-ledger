begin;

-- Keep every existing quantity and cost unchanged. A kilogram is 1,000 milli-units;
-- weight rates are cents per tonne (1,000,000 milli-kilograms), not per kg.
alter table public.expenses drop constraint expenses_kind_check;
alter table public.expenses drop constraint expenses_unit_check;
alter table public.expenses drop constraint expenses_check;
alter table public.expenses drop constraint expenses_check1;
alter table public.expenses add constraint expenses_kind_check
  check (kind in ('daily_labor','weight_labor','fertilizer','material','maintenance','other'));
alter table public.expenses add constraint expenses_unit_check
  check (unit in ('day','kg','sack','item'));
alter table public.expenses add constraint expenses_kind_unit_check check (
  (kind='daily_labor' and unit='day' and quantity_milli%500=0 and quantity_milli<=366000 and rate_minor<=100000000)
  or (kind='weight_labor' and unit='kg' and rate_minor<=100000000)
  or (kind='fertilizer' and unit='sack')
  or (kind in ('material','maintenance','other') and unit='item')
);
alter table public.expenses add constraint expenses_amount_formula_check check (
  amount_minor=case when kind='weight_labor'
    then floor((quantity_milli::numeric*rate_minor+500000)/1000000)
    else floor((quantity_milli::numeric*rate_minor+500)/1000) end
);
comment on column public.expenses.quantity_milli is 'Quantity x 1000 in unit: kg for weight_labor, day for daily_labor, sack for fertilizer, item otherwise.';
comment on column public.expenses.rate_minor is 'Cents per tonne for weight_labor; cents per day/sack/item for other kinds.';
commit;
