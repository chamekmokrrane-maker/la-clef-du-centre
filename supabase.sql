-- =========================================================
-- LA CLEF DU CENTRE - Supabase v4
-- Factures et devis séparés dans 2 tables différentes
-- À coller dans Supabase > SQL Editor > New Query > Run
-- =========================================================

create extension if not exists pgcrypto;

create table if not exists public.la_clef_company_settings (
  id text primary key default 'default',
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.la_clef_factures (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.la_clef_devis (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.la_clef_billing_counters (
  doc_type text primary key check (doc_type in ('devis', 'facture')),
  value integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.la_clef_billing_counters (doc_type, value)
values ('devis', 0), ('facture', 0)
on conflict (doc_type) do nothing;

create or replace function public.la_clef_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_la_clef_company_settings_updated_at on public.la_clef_company_settings;
create trigger trg_la_clef_company_settings_updated_at
before update on public.la_clef_company_settings
for each row execute function public.la_clef_touch_updated_at();

drop trigger if exists trg_la_clef_factures_updated_at on public.la_clef_factures;
create trigger trg_la_clef_factures_updated_at
before update on public.la_clef_factures
for each row execute function public.la_clef_touch_updated_at();

drop trigger if exists trg_la_clef_devis_updated_at on public.la_clef_devis;
create trigger trg_la_clef_devis_updated_at
before update on public.la_clef_devis
for each row execute function public.la_clef_touch_updated_at();

create or replace function public.la_clef_next_document_number(p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value integer;
  v_prefix text;
begin
  if p_doc_type not in ('devis', 'facture') then
    raise exception 'Type de document invalide: %', p_doc_type;
  end if;

  insert into public.la_clef_billing_counters (doc_type, value)
  values (p_doc_type, 0)
  on conflict (doc_type) do nothing;

  update public.la_clef_billing_counters
  set value = value + 1,
      updated_at = now()
  where doc_type = p_doc_type
  returning value into v_value;

  v_prefix := case when p_doc_type = 'facture' then 'FA' else 'DV' end;
  return v_prefix || '-' || lpad(v_value::text, 6, '0');
end;
$$;

-- Migration automatique si tu avais déjà utilisé l'ancienne table unique v1/v2.
do $$
begin
  if to_regclass('public.la_clef_billing_documents') is not null then
    insert into public.la_clef_factures (id, numero, data, created_at, updated_at)
    select id, numero, jsonb_set(data, '{type}', '"facture"'::jsonb, true), created_at, updated_at
    from public.la_clef_billing_documents
    where doc_type = 'facture'
    on conflict (id) do nothing;

    insert into public.la_clef_devis (id, numero, data, created_at, updated_at)
    select id, numero, jsonb_set(data, '{type}', '"devis"'::jsonb, true), created_at, updated_at
    from public.la_clef_billing_documents
    where doc_type = 'devis'
    on conflict (id) do nothing;
  end if;
end $$;

-- Version simple pour démarrer rapidement sans compte utilisateur.
-- Les tables sont accessibles avec la clé anon publique du projet Supabase.
-- À sécuriser plus tard si tu ajoutes une connexion admin/salariés.
alter table public.la_clef_company_settings enable row level security;
alter table public.la_clef_factures enable row level security;
alter table public.la_clef_devis enable row level security;
alter table public.la_clef_billing_counters enable row level security;

drop policy if exists "la_clef_company_select" on public.la_clef_company_settings;
drop policy if exists "la_clef_company_insert" on public.la_clef_company_settings;
drop policy if exists "la_clef_company_update" on public.la_clef_company_settings;
drop policy if exists "la_clef_factures_select" on public.la_clef_factures;
drop policy if exists "la_clef_factures_insert" on public.la_clef_factures;
drop policy if exists "la_clef_factures_update" on public.la_clef_factures;
drop policy if exists "la_clef_factures_delete" on public.la_clef_factures;
drop policy if exists "la_clef_devis_select" on public.la_clef_devis;
drop policy if exists "la_clef_devis_insert" on public.la_clef_devis;
drop policy if exists "la_clef_devis_update" on public.la_clef_devis;
drop policy if exists "la_clef_devis_delete" on public.la_clef_devis;
drop policy if exists "la_clef_counters_select" on public.la_clef_billing_counters;
drop policy if exists "la_clef_counters_insert" on public.la_clef_billing_counters;
drop policy if exists "la_clef_counters_update" on public.la_clef_billing_counters;

create policy "la_clef_company_select" on public.la_clef_company_settings for select using (true);
create policy "la_clef_company_insert" on public.la_clef_company_settings for insert with check (true);
create policy "la_clef_company_update" on public.la_clef_company_settings for update using (true) with check (true);

create policy "la_clef_factures_select" on public.la_clef_factures for select using (true);
create policy "la_clef_factures_insert" on public.la_clef_factures for insert with check (true);
create policy "la_clef_factures_update" on public.la_clef_factures for update using (true) with check (true);
create policy "la_clef_factures_delete" on public.la_clef_factures for delete using (true);

create policy "la_clef_devis_select" on public.la_clef_devis for select using (true);
create policy "la_clef_devis_insert" on public.la_clef_devis for insert with check (true);
create policy "la_clef_devis_update" on public.la_clef_devis for update using (true) with check (true);
create policy "la_clef_devis_delete" on public.la_clef_devis for delete using (true);

create policy "la_clef_counters_select" on public.la_clef_billing_counters for select using (true);
create policy "la_clef_counters_insert" on public.la_clef_billing_counters for insert with check (true);
create policy "la_clef_counters_update" on public.la_clef_billing_counters for update using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.la_clef_company_settings to anon, authenticated;
grant select, insert, update, delete on public.la_clef_factures to anon, authenticated;
grant select, insert, update, delete on public.la_clef_devis to anon, authenticated;
grant select, insert, update on public.la_clef_billing_counters to anon, authenticated;
grant execute on function public.la_clef_next_document_number(text) to anon, authenticated;

-- =========================================================
-- Connexion par identifiant / mot de passe - version v7
-- À relancer même si les anciennes tables existent déjà.
-- =========================================================

create table if not exists public.la_clef_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  role text not null default 'admin' check (role in ('admin', 'utilisateur')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.la_clef_users enable row level security;

drop trigger if exists trg_la_clef_users_updated_at on public.la_clef_users;
create trigger trg_la_clef_users_updated_at
before update on public.la_clef_users
for each row execute function public.la_clef_touch_updated_at();

create or replace function public.la_clef_has_users()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from public.la_clef_users where active = true);
$$;

create or replace function public.la_clef_create_first_admin(
  p_username text,
  p_password text,
  p_display_name text default null
)
returns table(id uuid, username text, display_name text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := lower(trim(p_username));
  v_id uuid;
begin
  if v_username is null or v_username = '' then
    raise exception 'Identifiant obligatoire';
  end if;

  if p_password is null or length(p_password) < 4 then
    raise exception 'Mot de passe trop court';
  end if;

  if exists(select 1 from public.la_clef_users) then
    raise exception 'Un compte existe déjà';
  end if;

  insert into public.la_clef_users (username, display_name, role, password_hash)
  values (
    v_username,
    coalesce(nullif(trim(p_display_name), ''), v_username),
    'admin',
    crypt(p_password, gen_salt('bf'))
  )
  returning la_clef_users.id into v_id;

  return query
  select u.id, u.username, u.display_name, u.role
  from public.la_clef_users u
  where u.id = v_id;
end;
$$;

create or replace function public.la_clef_login(
  p_username text,
  p_password text
)
returns table(id uuid, username text, display_name text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select u.id, u.username, u.display_name, u.role
  from public.la_clef_users u
  where u.username = lower(trim(p_username))
    and u.active = true
    and u.password_hash = crypt(p_password, u.password_hash)
  limit 1;
end;
$$;

create or replace function public.la_clef_admin_create_user(
  p_admin_username text,
  p_admin_password text,
  p_username text,
  p_password text,
  p_display_name text default null,
  p_role text default 'utilisateur'
)
returns table(id uuid, username text, display_name text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_ok boolean;
  v_username text := lower(trim(p_username));
  v_role text := case when p_role = 'admin' then 'admin' else 'utilisateur' end;
  v_id uuid;
begin
  select exists(
    select 1 from public.la_clef_users u
    where u.username = lower(trim(p_admin_username))
      and u.role = 'admin'
      and u.active = true
      and u.password_hash = crypt(p_admin_password, u.password_hash)
  ) into v_admin_ok;

  if not v_admin_ok then
    raise exception 'Mot de passe admin incorrect';
  end if;

  if v_username is null or v_username = '' then
    raise exception 'Identifiant obligatoire';
  end if;

  if p_password is null or length(p_password) < 4 then
    raise exception 'Mot de passe trop court';
  end if;

  insert into public.la_clef_users (username, display_name, role, password_hash)
  values (
    v_username,
    coalesce(nullif(trim(p_display_name), ''), v_username),
    v_role,
    crypt(p_password, gen_salt('bf'))
  )
  returning la_clef_users.id into v_id;

  return query
  select u.id, u.username, u.display_name, u.role
  from public.la_clef_users u
  where u.id = v_id;
end;
$$;

grant execute on function public.la_clef_has_users() to anon, authenticated;
grant execute on function public.la_clef_create_first_admin(text, text, text) to anon, authenticated;
grant execute on function public.la_clef_login(text, text) to anon, authenticated;
grant execute on function public.la_clef_admin_create_user(text, text, text, text, text, text) to anon, authenticated;
