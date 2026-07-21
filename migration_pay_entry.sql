-- Migración: RPC para que el bar cobre la entrada de un pay_later.
-- El rol 'bar' no puede hacer UPDATE directo sobre attendees (RLS lo bloquea),
-- así que necesitamos un security-definer que haga la actualización de status,
-- amount_paid y payment_photo_url.
--
-- Corré este script una sola vez en Supabase (SQL editor).

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
