-- Migration: agregar columna blocked_slots a event_settings
-- Corré este script una sola vez en Supabase (SQL editor) para bases ya creadas.

alter table event_settings
  add column if not exists blocked_slots jsonb default '[]'::jsonb;

-- Normalizar valores NULL existentes
update event_settings
  set blocked_slots = '[]'::jsonb
  where blocked_slots is null;
