-- ═══════════════════════════════════════════════════════════════════════════
-- CANDADO GRANDE · FASE 1 — Funciones controladas (aditivo, NO candela nada aún)
--
-- Antes de la Fase 2 (que restringe la escritura directa a admin), la barra y la
-- puerta deben hacer sus operaciones legítimas por funciones security-definer.
-- Este script crea/ajusta esas funciones. Es retrocompatible: la app vieja sigue
-- andando hasta que se publica la nueva.
--
-- Correr en Supabase → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. mark_entry: marcar ingreso (bar/door/admin) sin UPDATE directo a attendees.
create or replace function mark_entry(p_attendee_id uuid)
returns json language plpgsql security definer
set search_path = public as $$
declare v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('bar','door','admin') then
    return json_build_object('ok', false, 'error', 'Sin permisos');
  end if;
  update attendees set entered = true, entry_time = now() where id = p_attendee_id;
  if not found then return json_build_object('ok', false, 'error', 'Asistente no encontrado'); end if;
  return json_build_object('ok', true);
end;
$$;
grant execute on function mark_entry(uuid) to authenticated;

-- 2. close_bar_account: permitir total=0 (cuenta de solo-entrada del pay_later),
--    así ese cierre pasa por la función y no por escritura directa a bar_accounts.
create or replace function close_bar_account(
  p_account_id     uuid,
  p_closed_by      text,
  p_photo_url      text    default null,
  p_payment_method text    default null,
  p_cash_received  numeric default null,
  p_change_given   numeric default null,
  p_paid_by_slot   integer default null
)
returns json language plpgsql security definer
set search_path = public as $$
declare v bar_accounts; v_role text; v_name text;
begin
  select role, display_name into v_role, v_name from profiles where id = auth.uid();
  if v_role is null or v_role not in ('bar', 'door', 'admin') then
    return json_build_object('ok', false, 'error', 'Sin permisos');
  end if;

  select * into v from bar_accounts where id = p_account_id and not is_closed for update;
  if not found then return json_build_object('ok', false, 'error', 'Cuenta no encontrada o ya cerrada'); end if;

  insert into bar_closures(
    event_id, slot, attendee_id, total, qty160, qty260, qty360,
    closed_by, closed_by_name, payment_photo_url, payment_method, cash_received, change_given, paid_by_slot
  ) values (
    v.event_id, v.slot, v.attendee_id, v.total, v.qty160, v.qty260, v.qty360,
    v_role, v_name, p_photo_url, p_payment_method, p_cash_received, p_change_given, p_paid_by_slot
  );

  update bar_accounts set is_closed = true where id = p_account_id;

  return json_build_object('ok', true, 'total', v.total);
end;
$$;
grant execute on function close_bar_account(uuid, text, text, text, numeric, numeric, integer) to authenticated;
