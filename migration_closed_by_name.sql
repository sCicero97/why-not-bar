-- ═══════════════════════════════════════════════════════════════════════════
-- Guardar el NOMBRE de quien cierra la cuenta (no solo el rol)
--
-- La columna closed_by tiene un CHECK que solo permite 'bar'/'door'/'admin',
-- así que agregamos una columna aparte closed_by_name (texto libre) con el
-- nombre real. close_bar_account (security definer) lo busca solo por auth.uid().
-- Retrocompatible: cierres viejos quedan con closed_by_name null → la app
-- muestra el rol como antes.
--
-- Correr en Supabase → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table bar_closures add column if not exists closed_by_name text;

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
  if v.total = 0 then return json_build_object('ok', false, 'error', 'La cuenta no tiene consumo'); end if;

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
