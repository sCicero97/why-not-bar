-- ═══════════════════════════════════════════════════════════════════════════
-- TANDA 2 · Paso 1 — Arreglar pérdida del método de pago al cerrar cuenta (bug C1)
--
-- Problema: barra y puerta cierran la cuenta con el RPC (OK) y después intentan
-- guardar payment_method / cash_received / change_given con un UPDATE directo a
-- bar_closures. Ese UPDATE está permitido SOLO para admin (RLS), así que para
-- barra/puerta falla en silencio → se pierde el método, el efectivo y el vuelto.
--
-- Solución: que close_bar_account reciba y guarde esos datos en el mismo INSERT
-- (el RPC es security-definer, tiene permiso). La firma nueva es RETROCOMPATIBLE:
-- los nuevos parámetros tienen default null, así que el frontend viejo (que llama
-- con 3 argumentos) sigue funcionando igual hasta que se publique el nuevo.
--
-- Correr en Supabase → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists close_bar_account(uuid, text, text);

create or replace function close_bar_account(
  p_account_id     uuid,
  p_closed_by      text,                       -- se ignora; se usa el rol real (auditoría)
  p_photo_url      text    default null,
  p_payment_method text    default null,       -- 'cash' | 'transfer'
  p_cash_received  numeric default null,        -- efectivo recibido
  p_change_given   numeric default null,        -- vuelto entregado
  p_paid_by_slot   integer default null         -- si la pagó otra cuenta, su slot
)
returns json language plpgsql security definer
set search_path = public as $$
declare v bar_accounts; v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('bar', 'door', 'admin') then
    return json_build_object('ok', false, 'error', 'Sin permisos');
  end if;

  select * into v from bar_accounts where id = p_account_id and not is_closed for update;
  if not found then return json_build_object('ok', false, 'error', 'Cuenta no encontrada o ya cerrada'); end if;
  if v.total = 0 then return json_build_object('ok', false, 'error', 'La cuenta no tiene consumo'); end if;

  insert into bar_closures(
    event_id, slot, attendee_id, total, qty160, qty260, qty360,
    closed_by, payment_photo_url, payment_method, cash_received, change_given, paid_by_slot
  ) values (
    v.event_id, v.slot, v.attendee_id, v.total, v.qty160, v.qty260, v.qty360,
    v_role, p_photo_url, p_payment_method, p_cash_received, p_change_given, p_paid_by_slot
  );

  update bar_accounts set is_closed = true where id = p_account_id;

  return json_build_object('ok', true, 'total', v.total);
end;
$$;

grant execute on function close_bar_account(uuid, text, text, text, numeric, numeric, integer) to authenticated;
