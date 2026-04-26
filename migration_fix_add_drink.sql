-- Fix: hay dos versiones de add_drink/subtract_drink en la DB después de la
-- migración bar_drinks (la vieja con integer y la nueva con numeric). Postgres
-- tira "Could not choose a candidate function". Borramos AMBAS firmas y dejamos
-- una sola con numeric (que acepta enteros sin problema).
--
-- Corré este script una vez en Supabase (SQL editor).

drop function if exists add_drink(uuid, integer);
drop function if exists add_drink(uuid, numeric);
drop function if exists subtract_drink(uuid, integer);
drop function if exists subtract_drink(uuid, numeric);

-- Versión única — acepta numeric (los enteros 160/260/360 son numeric implícito).
create or replace function add_drink(p_account_id uuid, p_amount numeric)
returns json language plpgsql security definer
set search_path = public as $$
declare v bar_accounts;
begin
  select * into v from bar_accounts where id = p_account_id and not is_closed for update;
  if not found then return json_build_object('ok', false, 'error', 'Cuenta no encontrada o ya cerrada'); end if;
  if p_amount <= 0 then return json_build_object('ok', false, 'error', 'Monto inválido'); end if;

  update bar_accounts set
    total = total + p_amount,
    qty160 = qty160 + case when p_amount = 160 then 1 else 0 end,
    qty260 = qty260 + case when p_amount = 260 then 1 else 0 end,
    qty360 = qty360 + case when p_amount = 360 then 1 else 0 end
  where id = p_account_id;

  -- Log de cada trago (si la tabla existe — si no, ignorar para no romper)
  begin
    insert into bar_drinks (event_id, account_id, slot, attendee_id, amount, served_by)
    values (v.event_id, p_account_id, v.slot, v.attendee_id, p_amount, 'bar');
  exception when undefined_table then
    null;
  end;

  return json_build_object('ok', true);
end;
$$;

create or replace function subtract_drink(p_account_id uuid, p_amount numeric)
returns json language plpgsql security definer
set search_path = public as $$
declare v bar_accounts;
begin
  select * into v from bar_accounts where id = p_account_id and not is_closed for update;
  if not found then return json_build_object('ok', false, 'error', 'Cuenta no encontrada o ya cerrada'); end if;

  update bar_accounts set
    total = greatest(total - p_amount, 0),
    qty160 = greatest(qty160 - case when p_amount = 160 then 1 else 0 end, 0),
    qty260 = greatest(qty260 - case when p_amount = 260 then 1 else 0 end, 0),
    qty360 = greatest(qty360 - case when p_amount = 360 then 1 else 0 end, 0)
  where id = p_account_id;

  -- Borrar el último registro matching de ese account (si la tabla existe)
  begin
    delete from bar_drinks
     where id = (
       select id from bar_drinks
        where account_id = p_account_id and amount = p_amount
        order by created_at desc limit 1
     );
  exception when undefined_table then
    null;
  end;

  return json_build_object('ok', true);
end;
$$;

grant execute on function add_drink(uuid, numeric)      to authenticated;
grant execute on function subtract_drink(uuid, numeric) to authenticated;
