-- Migración: caja inicial y final del evento.
-- Permite registrar el efectivo con el que se abre el evento y el conteo al cierre,
-- para detectar diferencias.
--
-- Corré este script una sola vez en Supabase (SQL editor).

alter table events
  add column if not exists opening_cash numeric(10,2) default 0,
  add column if not exists closing_cash numeric(10,2) default null;
