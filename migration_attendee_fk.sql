-- Migración: dejar que borrar un asistente no rompa bar_closures.
-- Cambia la FK bar_closures_attendee_id_fkey a ON DELETE SET NULL.
-- Corré este script una vez en Supabase (SQL editor).

alter table bar_closures
  drop constraint if exists bar_closures_attendee_id_fkey;

alter table bar_closures
  add constraint bar_closures_attendee_id_fkey
  foreign key (attendee_id) references attendees(id) on delete set null;

-- Por consistencia, lo mismo para bar_accounts (si apunta a attendees):
alter table bar_accounts
  drop constraint if exists bar_accounts_attendee_id_fkey;

alter table bar_accounts
  add constraint bar_accounts_attendee_id_fkey
  foreign key (attendee_id) references attendees(id) on delete set null;
