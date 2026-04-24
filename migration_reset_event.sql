-- Migración: función RPC para resetear un evento completo, atomic + bypass RLS.
-- Corré este script una sola vez en Supabase (SQL editor).

create or replace function reset_event(p_event_id uuid)
returns json language plpgsql security definer
set search_path = public as $$
declare
  v_role text;
begin
  -- Sólo admin puede disparar el reset
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role <> 'admin' then
    return json_build_object('ok', false, 'error', 'Sólo admin puede resetear un evento');
  end if;

  -- 1. Borrar log de tragos (si existe la tabla, si no ignorar)
  begin
    delete from bar_drinks where event_id = p_event_id;
  exception when undefined_table then
    null;
  end;

  -- 2. Borrar historial de cierres (fotos, métodos de pago, vuelto, todo)
  delete from bar_closures where event_id = p_event_id;

  -- 3. Resetear todas las cuentas de barra del evento
  update bar_accounts
     set total = 0,
         qty160 = 0,
         qty260 = 0,
         qty360 = 0,
         is_closed = false
   where event_id = p_event_id;

  -- 4. Resetear asistentes: nadie ingresó, nadie salió, sin foto de pago
  update attendees
     set entered           = false,
         entry_time        = null,
         exit_time         = null,
         payment_photo_url = null,
         amount_paid       = 0
   where event_id = p_event_id;

  return json_build_object('ok', true);
end;
$$;

-- Permitir que cualquier authenticated user lo invoque (la función valida admin internamente)
grant execute on function reset_event(uuid) to authenticated;
