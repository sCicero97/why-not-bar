-- Migración: marcar asistentes como organizadores (sin botón de ingreso/salida en portería).
-- Corré este script una sola vez en Supabase (SQL editor).

alter table attendees
  add column if not exists is_organizer boolean default false;

-- Marcar como organizadores a Dave, Angus y Cicero en TODOS los eventos existentes.
-- (Match por nombre — se usa solo una vez para bootstrap.)
update attendees
   set is_organizer = true
 where lower(trim(name)) in ('dave', 'angus', 'cicero');
