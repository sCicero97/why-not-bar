-- ═══════════════════════════════════════════════════════════════════════════
-- Endurecimiento de seguridad — TANDA 1 (no rompe nada de la app)
-- Correr una sola vez en Supabase → SQL Editor → New query → Run.
-- Todo es idempotente (create or replace / drop if exists): se puede re-correr.
--
-- NO le saca ningún permiso a acciones que la app ya hace. Solo:
--   · cierra funciones destructivas a usuarios sin login (anon)
--   · agrega search_path a las funciones que faltaban (hardening estándar)
--   · impide falsificar quién cerró una cuenta y quién chequeó una tarea
--   · confirma que el log de tragos (bar_drinks) tenga RLS
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. get_user_role: fijar search_path (es la base de TODA la autorización) ──
create or replace function get_user_role()
returns text language sql stable security definer
set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

-- ─── 2. init_bar_accounts: validar rol (antes: cualquiera, incl. anon) ────────
--     Borra todas las cuentas de barra del evento → ahora solo bar/admin.
create or replace function init_bar_accounts(p_event_id uuid, p_count integer)
returns json language plpgsql security definer
set search_path = public as $$
declare i integer; v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('bar','admin') then
    return json_build_object('ok', false, 'error', 'Sin permisos');
  end if;
  delete from bar_accounts where event_id = p_event_id;
  for i in 1..p_count loop
    insert into bar_accounts(event_id, slot) values(p_event_id, i);
  end loop;
  return json_build_object('ok', true, 'count', p_count);
end;
$$;

-- ─── 3. mark_exit: validar rol (antes: sin chequeo, llamable por anon) ────────
create or replace function mark_exit(p_attendee_id uuid)
returns json language plpgsql security definer
set search_path = public as $$
declare v attendees; acc bar_accounts; v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('bar','door','admin') then
    return json_build_object('ok', false, 'error', 'Sin permisos');
  end if;
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

-- ─── 4. close_bar_account: firmar el cierre con el rol REAL del que llama ──────
--     Antes confiaba en el parámetro p_closed_by (un bar podía firmar 'admin').
--     La app sigue pasándolo igual; ahora se ignora y se usa el rol real.
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
  values (v.event_id, v.slot, v.attendee_id, v.total, v.qty160, v.qty260, v.qty360, v_role, p_photo_url);

  update bar_accounts set is_closed = true where id = p_account_id;

  return json_build_object('ok', true, 'total', v.total);
end;
$$;

-- ─── 5. task_checks: solo podés chequear una tarea como VOS MISMO ─────────────
--     Antes: with check (true) → se podía firmar el check con el id de otro.
drop policy if exists "Staff inserts task_checks" on task_checks;
create policy "Staff inserts task_checks" on task_checks for insert to authenticated
  with check (checked_by = auth.uid());

-- ─── 6. bar_drinks: confirmar RLS + políticas (schema.sql lo omitía) ──────────
--     Los tragos se registran vía RPC (security definer), así que esto NO
--     rompe el logueo de tragos; solo cierra el acceso directo por REST.
alter table bar_drinks enable row level security;
drop policy if exists "Staff reads drinks" on bar_drinks;
create policy "Staff reads drinks" on bar_drinks for select to authenticated using (true);
drop policy if exists "Bar inserts drinks" on bar_drinks;
create policy "Bar inserts drinks" on bar_drinks for insert to authenticated with check (get_user_role() in ('bar','admin'));
drop policy if exists "Admin manages drinks" on bar_drinks;
create policy "Admin manages drinks" on bar_drinks for all to authenticated
  using (get_user_role() = 'admin') with check (get_user_role() = 'admin');
