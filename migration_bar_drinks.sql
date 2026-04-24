-- Migración: log de consumo en la barra (un registro por trago servido).
-- Corré esto una sola vez en Supabase (SQL editor).

create table if not exists bar_drinks (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  account_id  uuid references bar_accounts(id) on delete set null,
  slot        integer not null,
  attendee_id uuid references attendees(id) on delete set null,
  amount      numeric(10,2) not null,
  served_by   text,               -- 'bar' por defecto
  created_at  timestamptz default now()
);

create index if not exists bar_drinks_event_idx       on bar_drinks (event_id, created_at);
create index if not exists bar_drinks_account_idx     on bar_drinks (account_id, created_at);

alter table bar_drinks enable row level security;

drop policy if exists "Staff reads drinks" on bar_drinks;
create policy "Staff reads drinks" on bar_drinks
  for select to authenticated using (true);

drop policy if exists "Bar inserts drinks" on bar_drinks;
create policy "Bar inserts drinks" on bar_drinks
  for insert to authenticated with check (get_user_role() in ('bar', 'admin'));

drop policy if exists "Admin manages drinks" on bar_drinks;
create policy "Admin manages drinks" on bar_drinks
  for all to authenticated
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

-- Extender add_drink para que, además de incrementar los contadores, inserte un registro en bar_drinks.
-- Mantiene la misma firma (p_account_id, p_amount) para no romper el frontend existente.
create or replace function add_drink(p_account_id uuid, p_amount numeric)
returns json language plpgsql security definer as $$
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

  insert into bar_drinks (event_id, account_id, slot, attendee_id, amount, served_by)
  values (v.event_id, p_account_id, v.slot, v.attendee_id, p_amount, 'bar');

  return json_build_object('ok', true);
end;
$$;

-- subtract_drink elimina el último registro matching de ese account (opcional, conserva historial consistente).
create or replace function subtract_drink(p_account_id uuid, p_amount numeric)
returns json language plpgsql security definer as $$
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

  -- borrar el registro más reciente de ese monto para esta cuenta
  delete from bar_drinks
   where id = (
     select id from bar_drinks
      where account_id = p_account_id and amount = p_amount
      order by created_at desc limit 1
   );

  return json_build_object('ok', true);
end;
$$;
