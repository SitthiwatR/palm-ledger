#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
  --set=auth_password="$LOCAL_AUTH_PASSWORD" --set=rest_password="$LOCAL_REST_PASSWORD" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password :'rest_password';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole password :'auth_password';
create schema auth authorization supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid
$$;
alter function auth.uid() owner to supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
SQL
