-- Migración: permitir al bar cobrar la entrada de un pay_later.
--
-- Hay DOS cambios:
--   1. RLS: el rol 'bar' ahora puede hacer UPDATE sobre attendees (antes sólo
--      door y admin). Bar es staff de confianza — necesita cobrar la entrada
--      cuando cierra la cuenta de un pay_later.
--   2. RPC pay_attendee_entry (backup): security-definer que hace la actualización
--      atómicamente. Se usa si el update directo falla por cualquier razón.
--
-- Corré este script una sola vez en Supabase (SQL editor).

-- ─── 1. Actualizar RLS de attendees ──────────────────────────────────────────
drop policy if exists "Door+admin updates attendees" on attendees;
drop policy if exists "Staff updates attendees" on attendees;
create policy "Staff updates attendees" on attendees for update to authenticated
  using (get_user_role() in ('door','admin','bar'));

-- ─── 2. RPC pay_attendee_entry ───────────────────────────────────────────────
drop function if exists pay_attendee_entry(uuid, numeric, text);
create or replace function pay_attendee_entry(
  p_attendee_id uuid,
  p_amount      numeric,
  p_photo_url   text default null
)
returns json language plpgsql security definer
set search_path = public as $$
declare v attendees; v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('bar','door','admin') then
    return json_build_object('ok', false, 'error', 'Sólo bar, portero o admin');
  end if;
  select * into v from attendees where id = p_attendee_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Asistente no encontrado');
  end if;
  if p_amount is null or p_amount <= 0 then
    return json_build_object('ok', false, 'error', 'Monto inválido');
  end if;

  update attendees set
    status            = 'paid',
    amount_paid       = coalesce(amount_paid, 0) + p_amount,
    payment_photo_url = coalesce(p_photo_url, payment_photo_url)
  where id = p_attendee_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function pay_attendee_entry(uuid, numeric, text) to authenticated;
