begin;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_accounts(id),
  garden_id uuid not null references public.gardens(id),
  sale_date date not null,
  buyer text not null check (length(trim(buyer)) between 1 and 120),
  invoice_number text not null check (length(trim(invoice_number)) between 1 and 80),
  net_weight_grams integer not null check (net_weight_grams between 1 and 1000000000),
  price_minor_per_kg integer not null check (price_minor_per_kg between 1 and 100000000),
  gross_minor bigint not null check (gross_minor > 0),
  deductions_minor bigint not null check (deductions_minor >= 0),
  net_minor bigint not null check (net_minor > 0),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  check (gross_minor - deductions_minor = net_minor)
);
create index sales_owner_date on public.sales(owner_id, sale_date desc, created_at desc);
create index sales_duplicate_lookup on public.sales(owner_id, garden_id, lower(invoice_number));
alter table public.sales enable row level security;
create policy owner_sales on public.sales for select to authenticated
using (owner_id = auth.uid() and exists (select 1 from public.owner_accounts where id = auth.uid()));
revoke all on public.sales from anon, authenticated;
grant select on public.sales to authenticated;

create table public.sale_deductions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_accounts(id),
  sale_id uuid not null,
  description text not null check (length(trim(description)) between 1 and 120),
  amount_minor bigint not null check (amount_minor > 0),
  foreign key (sale_id, owner_id) references public.sales(id, owner_id) on delete cascade
);
create index sale_deductions_sale on public.sale_deductions(sale_id);
alter table public.sale_deductions enable row level security;
create policy owner_sale_deductions on public.sale_deductions for select to authenticated
using (owner_id = auth.uid());
revoke all on public.sale_deductions from anon, authenticated;
grant select on public.sale_deductions to authenticated;

create table private.pending_receipt_uploads (
  id uuid primary key,
  owner_id uuid not null references public.owner_accounts(id),
  storage_key text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create table public.receipt_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_accounts(id),
  sale_id uuid not null,
  storage_key text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (sale_id, owner_id) references public.sales(id, owner_id) on delete cascade
);
create index receipt_files_sale on public.receipt_files(sale_id);
alter table public.receipt_files enable row level security;
create policy owner_receipt_files on public.receipt_files for select to authenticated
using (owner_id = auth.uid());
revoke all on public.receipt_files from anon, authenticated;
grant select on public.receipt_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('palm-receipts', 'palm-receipts', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=false, file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;
grant usage on schema storage to service_role;
grant all privileges on all tables in schema storage to service_role;
grant usage, select on all sequences in schema storage to service_role;

revoke all on private.pending_receipt_uploads from public, anon, authenticated;
revoke all on public.sales, public.sale_deductions, public.receipt_files from anon;
commit;
