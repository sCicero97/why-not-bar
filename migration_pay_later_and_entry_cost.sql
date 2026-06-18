-- Migración: status "pay_later" + costo de acceso configurable por evento.
-- Corré este script una sola vez en Supabase (SQL editor).

-- ── 1) Costo de acceso por defecto del evento ────────────────────────────────
alter table events
  add column if not exists default_entry_amount numeric(10,2) default 700;

-- ── 2) Status "pay_later" para asistentes ────────────────────────────────────
-- Drop el check constraint viejo y crear uno nuevo que acepte 'pay_later'.
alter table attendees drop constraint if exists attendees_status_check;
alter table attendees
  add constraint attendees_status_check
  check (status in ('invited','crew','pay_later','in_process','paid','no_show'));
