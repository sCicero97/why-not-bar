-- Migración: tabla blacklist (lista de personas a vigilar)
-- Corré esto una sola vez en Supabase (SQL editor).

create table if not exists blacklist (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  cedula      text,
  email       text,
  phone       text,
  reasons     text[] default '{}',   -- 'no_devolvio_tarjeta' | 'no_pago_bar' | 'entrada_bloqueada'
  notes       text,
  added_by    uuid references profiles(id),
  created_at  timestamptz default now()
);

-- Índices para las búsquedas al crear asistentes
create index if not exists blacklist_cedula_idx on blacklist (cedula);
create index if not exists blacklist_email_idx  on blacklist (email);
create index if not exists blacklist_phone_idx  on blacklist (phone);
create index if not exists blacklist_name_idx   on blacklist (lower(name));

alter table blacklist enable row level security;

-- Todos los usuarios autenticados pueden leer (para chequear al crear asistente)
drop policy if exists "Staff reads blacklist" on blacklist;
create policy "Staff reads blacklist" on blacklist
  for select to authenticated using (true);

-- Sólo admin puede modificar la blacklist
drop policy if exists "Admin manages blacklist" on blacklist;
create policy "Admin manages blacklist" on blacklist
  for all to authenticated
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');
