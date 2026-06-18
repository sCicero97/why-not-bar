-- Migración: precios de tragos configurables por evento.
-- Corré este script una sola vez en Supabase (SQL editor).

alter table events
  add column if not exists drink_price_1 numeric(10,2) default 160,
  add column if not exists drink_price_2 numeric(10,2) default 260,
  add column if not exists drink_price_3 numeric(10,2) default 360;

-- Nueva variante de add_drink: acepta rango (1/2/3) + precio.
-- Mapea: rango 1 → qty160, rango 2 → qty260, rango 3 → qty360
-- (mantenemos los nombres de columnas pero ya son agnósticos al precio).
drop function if exists add_drink_ranged(uuid, integer, numeric);
create or replace function add_drink_ranged(p_account_id uuid, p_range integer, p_price numeric)
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
  if p_price <= 0 then return json_build_object('ok', false, 'error', 'Precio inválido'); end if;
  if p_range not in (1, 2, 3) then return json_build_object('ok', false, 'error', 'Rango inválido'); end if;

  update bar_accounts set
    total  = total + p_price,
    qty160 = qty160 + case when p_range = 1 then 1 else 0 end,
    qty260 = qty260 + case when p_range = 2 then 1 else 0 end,
    qty360 = qty360 + case when p_range = 3 then 1 else 0 end
  where id = p_account_id;

  begin
    insert into bar_drinks (event_id, account_id, slot, attendee_id, amount, served_by)
    values (v.event_id, p_account_id, v.slot, v.attendee_id, p_price, 'bar');
  exception when undefined_table then null; end;

  return json_build_object('ok', true);
end;
$$;
grant execute on function add_drink_ranged(uuid, integer, numeric) to authenticated;

drop function if exists subtract_drink_ranged(uuid, integer, numeric);
create or replace function subtract_drink_ranged(p_account_id uuid, p_range integer, p_price numeric)
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
  if p_range = 1 and v.qty160 <= 0 then return json_build_object('ok', false, 'error', 'Sin tragos para restar'); end if;
  if p_range = 2 and v.qty260 <= 0 then return json_build_object('ok', false, 'error', 'Sin tragos para restar'); end if;
  if p_range = 3 and v.qty360 <= 0 then return json_build_object('ok', false, 'error', 'Sin tragos para restar'); end if;

  update bar_accounts set
    total  = greatest(total - p_price, 0),
    qty160 = greatest(qty160 - case when p_range = 1 then 1 else 0 end, 0),
    qty260 = greatest(qty260 - case when p_range = 2 then 1 else 0 end, 0),
    qty360 = greatest(qty360 - case when p_range = 3 then 1 else 0 end, 0)
  where id = p_account_id;

  begin
    delete from bar_drinks where id = (
      select id from bar_drinks where account_id = p_account_id
      order by created_at desc limit 1
    );
  exception when undefined_table then null; end;
  return json_build_object('ok', true);
end;
$$;
grant execute on function subtract_drink_ranged(uuid, integer, numeric) to authenticated;
