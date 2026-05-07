-- Fix: la BARRA y los ASISTENTES son sistemas separados.
-- close_bar_account NO debe modificar ningún campo del asistente — ni status,
-- ni amount_paid, ni payment_photo_url.
-- Toda la información del cierre queda en bar_closures (que ya tiene método de
-- pago, foto, vuelto, etc).
--
-- Corré este script una vez en Supabase (SQL editor).

create or replace function close_bar_account(p_account_id uuid, p_closed_by text, p_photo_url text default null)
returns json language plpgsql security definer
set search_path = public as $$
declare v bar_accounts;
begin
  select * into v from bar_accounts where id = p_account_id and not is_closed for update;
  if not found then return json_build_object('ok', false, 'error', 'Cuenta no encontrada o ya cerrada'); end if;
  if v.total = 0 then return json_build_object('ok', false, 'error', 'La cuenta no tiene consumo'); end if;

  insert into bar_closures(event_id, slot, attendee_id, total, qty160, qty260, qty360, closed_by, payment_photo_url)
  values (v.event_id, v.slot, v.attendee_id, v.total, v.qty160, v.qty260, v.qty360, p_closed_by, p_photo_url);

  update bar_accounts set is_closed = true where id = p_account_id;

  -- IMPORTANTE: bar y asistentes son sistemas independientes.
  -- No tocamos status, amount_paid ni payment_photo_url del asistente.
  -- La info del cierre queda en bar_closures.

  return json_build_object('ok', true, 'total', v.total);
end;
$$;
