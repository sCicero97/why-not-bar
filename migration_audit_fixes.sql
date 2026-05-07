-- Migración: arreglos de auditoría — endurecer RPCs viejas + nuevo RPC atómico de activate_event.
-- Corré este script una sola vez en Supabase (SQL editor). Idempotente.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1) add_drink: agregar search_path, validar role, escribir en bar_drinks si existe.
--    Acepta numeric (no integer) para evitar el error de candidate function.
-- ──────────────────────────────────────────────────────────────────────────────
drop function if exists add_drink(uuid, integer);
drop function if exists add_drink(uuid, numeric);

create or replace function add_drink(p_account_id uuid, p_amount numeric)
returns json language plpgsql security definer
set search_path = public as $$
declare v bar_accounts; v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('bar', 'admin') then
    return json_build_object('ok', false, 'error', 'Sólo bar o admin');
  end if;

  select * into v from bar_accounts where id = p_account_id and not is_closed for update;
  if not found then return json_build_object('ok', false, 'error', 'Cuenta no encontrada o cerrada'); end if;
  if p_amount <= 0 then return json_build_object('ok', false, 'error', 'Monto inválido'); end if;

  update bar_accounts set
    total  = total  + p_amount,
    qty160 = qty160 + case when p_amount = 160 then 1 else 0 end,
    qty260 = qty260 + case when p_amount = 260 then 1 else 0 end,
    qty360 = qty360 + case when p_amount = 360 then 1 else 0 end
  where id = p_account_id;

  begin
    insert into bar_drinks (event_id, account_id, slot, attendee_id, amount, served_by)
    values (v.event_id, p_account_id, v.slot, v.attendee_id, p_amount, 'bar');
  exception when undefined_table then null; end;

  return json_build_object('ok', true);
end;
$$;
grant execute on function add_drink(uuid, numeric) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) subtract_drink: mismo tratamiento.
-- ──────────────────────────────────────────────────────────────────────────────
drop function if exists subtract_drink(uuid, integer);
drop function if exists subtract_drink(uuid, numeric);

create or replace function subtract_drink(p_account_id uuid, p_amount numeric)
returns json language plpgsql security definer
set search_path = public as $$
declare v bar_accounts; v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('bar', 'admin') then
    return json_build_object('ok', false, 'error', 'Sólo bar o admin');
  end if;

  select * into v from bar_accounts where id = p_account_id and not is_closed for update;
  if not found then return json_build_object('ok', false, 'error', 'Cuenta no encontrada o cerrada'); end if;

  if p_amount = 160 and v.qty160 <= 0 then return json_build_object('ok', false, 'error', 'Sin tragos para restar'); end if;
  if p_amount = 260 and v.qty260 <= 0 then return json_build_object('ok', false, 'error', 'Sin tragos para restar'); end if;
  if p_amount = 360 and v.qty360 <= 0 then return json_build_object('ok', false, 'error', 'Sin tragos para restar'); end if;

  update bar_accounts set
    total  = greatest(total  - p_amount, 0),
    qty160 = greatest(qty160 - case when p_amount = 160 then 1 else 0 end, 0),
    qty260 = greatest(qty260 - case when p_amount = 260 then 1 else 0 end, 0),
    qty360 = greatest(qty360 - case when p_amount = 360 then 1 else 0 end, 0)
  where id = p_account_id;

  begin
    delete from bar_drinks
     where id = (
       select id from bar_drinks
        where account_id = p_account_id and amount = p_amount
        order by created_at desc limit 1
     );
  exception when undefined_table then null; end;

  return json_build_object('ok', true);
end;
$$;
grant execute on function subtract_drink(uuid, numeric) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3) close_bar_account: search_path explícito + sin tocar attendees.
--    (Re-creamos por si hay versión vieja sin el lock).
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function close_bar_account(p_account_id uuid, p_closed_by text, p_photo_url text default null)
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

  insert into bar_closures(event_id, slot, attendee_id, total, qty160, qty260, qty360, closed_by, payment_photo_url)
  values (v.event_id, v.slot, v.attendee_id, v.total, v.qty160, v.qty260, v.qty360, p_closed_by, p_photo_url);

  update bar_accounts set is_closed = true where id = p_account_id;

  return json_build_object('ok', true, 'total', v.total);
end;
$$;
grant execute on function close_bar_account(uuid, text, text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4) mark_exit: search_path explícito.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function mark_exit(p_attendee_id uuid)
returns json language plpgsql security definer
set search_path = public as $$
declare v attendees; acc bar_accounts;
begin
  select * into v from attendees where id = p_attendee_id;
  if not found then return json_build_object('ok', false, 'error', 'Asistente no encontrado'); end if;

  if v.bar_account_slot is not null then
    select * into acc from bar_accounts
     where event_id = v.event_id and slot = v.bar_account_slot and not is_closed and total > 0;
    if found then
      return json_build_object('ok', false, 'error', 'Tiene cuenta abierta con saldo. Debe cerrar antes de salir.');
    end if;
  end if;

  update attendees set exit_time = now() where id = p_attendee_id;
  return json_build_object('ok', true);
end;
$$;
grant execute on function mark_exit(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5) activate_event: nuevo RPC atómico (sin race entre dos UPDATEs separados).
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function activate_event(p_event_id uuid)
returns json language plpgsql security definer
set search_path = public as $$
declare v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role <> 'admin' then
    return json_build_object('ok', false, 'error', 'Sólo admin');
  end if;

  -- Bloqueamos la tabla mientras hacemos el swap atómico
  perform pg_advisory_xact_lock(hashtext('events_activate'));

  update events set is_active = false where is_active = true and id <> p_event_id;
  update events set is_active = true  where id = p_event_id;

  return json_build_object('ok', true);
end;
$$;
grant execute on function activate_event(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6) Endurecer RLS de bar_closures: el rol 'bar' ya no puede UPDATE arbitrario.
--    Sólo admin puede actualizar (los closures se crean vía RPC, no via REST).
-- ──────────────────────────────────────────────────────────────────────────────
drop policy if exists "Bar+door+admin inserts closures" on bar_closures;
drop policy if exists "Admin modifies closures" on bar_closures;

create policy "Bar+door+admin inserts closures" on bar_closures
  for insert to authenticated with check (get_user_role() in ('bar','door','admin'));
create policy "Admin updates closures" on bar_closures
  for update to authenticated using (get_user_role() = 'admin');
create policy "Admin deletes closures" on bar_closures
  for delete to authenticated using (get_user_role() = 'admin');
