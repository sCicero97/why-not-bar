-- Migración: tarjetas bloqueadas pasan a ser GLOBALES (cross-event).
-- Antes vivían en event_settings.blocked_slots (jsonb, por evento).
-- Ahora viven en una tabla propia, no se reinician al cambiar de evento.
--
-- Corré este script una sola vez en Supabase (SQL editor).

create table if not exists blocked_cards (
  slot       integer primary key,
  blocked_at timestamptz default now(),
  blocked_by uuid references profiles(id),
  notes      text
);

alter table blocked_cards enable row level security;

drop policy if exists "Staff reads blocked_cards" on blocked_cards;
create policy "Staff reads blocked_cards" on blocked_cards
  for select to authenticated using (true);

drop policy if exists "Admin manages blocked_cards" on blocked_cards;
create policy "Admin manages blocked_cards" on blocked_cards
  for all to authenticated
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

-- Migrar lo que ya estaba bloqueado en cualquier evento → tabla global.
-- Tomamos todos los slots únicos de event_settings.blocked_slots y los insertamos
-- en blocked_cards. Si el slot ya existe (por evento previo) no rompe gracias a ON CONFLICT.
insert into blocked_cards (slot)
select distinct (jsonb_array_elements_text(coalesce(blocked_slots, '[]'::jsonb)))::int as slot
  from event_settings
 where coalesce(jsonb_array_length(blocked_slots), 0) > 0
on conflict (slot) do nothing;

-- (Opcional) Mantenemos el campo blocked_slots en event_settings por compatibilidad,
-- pero ya no se usa. Si querés limpiar:
--   alter table event_settings drop column if exists blocked_slots;
