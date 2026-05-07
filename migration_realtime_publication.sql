-- Migración: garantizar que todas las tablas relevantes emitan eventos realtime.
-- Supabase usa la publicación `supabase_realtime` para decidir qué tablas
-- emiten cambios. Si una tabla no está agregada, los suscriptores nunca se enteran.
--
-- Corré este script una sola vez en Supabase (SQL editor). Idempotente.

-- Las tablas que las apps escuchan
do $$
declare
  t text;
  tables text[] := array[
    'events',
    'profiles',
    'attendees',
    'bar_accounts',
    'bar_closures',
    'expenses',
    'tasks',
    'task_checks',
    'event_settings',
    'bar_drinks',
    'blacklist',
    'blocked_cards'
  ];
begin
  foreach t in array tables loop
    -- Saltar si la tabla no existe todavía
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      -- Sólo agregar si todavía no está en la publicación
      if not exists (
        select 1 from pg_publication_tables
         where pubname='supabase_realtime' and schemaname='public' and tablename=t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end if;
  end loop;
end $$;

-- Habilitar full row data en UPDATEs/DELETEs para que los payloads tengan los valores completos
-- (necesario para joins/filters precisos). Replica IDENTITY FULL no agrega indices, sólo metadata.
alter table attendees       replica identity full;
alter table bar_accounts    replica identity full;
alter table bar_closures    replica identity full;
alter table expenses        replica identity full;
alter table event_settings  replica identity full;
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='bar_drinks') then
    execute 'alter table bar_drinks replica identity full';
  end if;
end $$;
alter table blocked_cards   replica identity full;
alter table blacklist       replica identity full;
alter table events          replica identity full;
alter table tasks           replica identity full;
