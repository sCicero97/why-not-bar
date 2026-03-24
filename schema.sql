-- ═══════════════════════════════════════════════════════════════════════════
-- Why Not — Schema Supabase v3
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─── Perfiles de usuario (roles) ─────────────────────────────────────────────
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('bar', 'door', 'admin')),
  display_name text,
  created_at   timestamptz default now()
);

-- ─── Eventos ──────────────────────────────────────────────────────────────────
create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  date       date not null default current_date,
  is_active  boolean default false,
  created_at timestamptz default now()
);
-- Solo un evento activo a la vez
create unique index if not exists one_active_event on events(is_active) where is_active = true;

-- ─── Asistentes ───────────────────────────────────────────────────────────────
create table if not exists attendees (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  name              text not null,
  cedula            text,
  email             text,
  phone             text,
  status            text default 'invited'
                    check (status in ('invited','crew','in_process','paid','no_show')),
  bar_account_slot  integer,          -- número de cuenta de barra asignada
  entered           boolean default false,
  entry_time        timestamptz,      -- hora de ingreso
  exit_time         timestamptz,      -- hora de egreso
  entry_amount      numeric(10,2) default 0,   -- lo que pagó de entrada
  amount_paid       numeric(10,2) default 0,   -- total pagado (entrada + barra)
  payment_photo_url text,             -- foto de comprobante de pago
  notes             text,
  paid_by_id        uuid references attendees(id),  -- quién pagó por este asistente
  created_at        timestamptz default now()
);

-- ─── Cuentas de barra ─────────────────────────────────────────────────────────
create table if not exists bar_accounts (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  slot        integer not null,
  is_closed   boolean default false,  -- una vez cerrada, NUNCA vuelve a abrirse
  attendee_id uuid references attendees(id),
  total       numeric(10,2) default 0,
  qty160      integer default 0,
  qty260      integer default 0,
  qty360      integer default 0,
  created_at  timestamptz default now(),
  unique(event_id, slot)
);

-- ─── Cierres de cuentas (historial) ──────────────────────────────────────────
create table if not exists bar_closures (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  slot              integer not null,
  attendee_id       uuid references attendees(id),
  total             numeric(10,2) default 0,
  qty160            integer default 0,
  qty260            integer default 0,
  qty360            integer default 0,
  closed_by         text check (closed_by in ('bar','door','admin')),
  payment_photo_url text,
  closed_at         timestamptz default now()
);

-- ─── Gastos de la noche ───────────────────────────────────────────────────────
create table if not exists expenses (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  description text not null,
  amount      numeric(10,2) not null,
  created_at  timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security
-- ═══════════════════════════════════════════════════════════════════════════
alter table profiles     enable row level security;
alter table events       enable row level security;
alter table attendees    enable row level security;
alter table bar_accounts enable row level security;
alter table bar_closures enable row level security;
alter table expenses     enable row level security;

create or replace function get_user_role()
returns text language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;

-- profiles
create policy "Own profile" on profiles for select to authenticated using (id = auth.uid());
create policy "Admin sees all profiles" on profiles for select to authenticated using (get_user_role()='admin');
create policy "Admin manages profiles" on profiles for all to authenticated using (get_user_role()='admin');

-- events
create policy "Staff reads events" on events for select to authenticated using (true);
create policy "Admin manages events" on events for all to authenticated using (get_user_role()='admin');

-- attendees
create policy "Staff reads attendees" on attendees for select to authenticated using (true);
create policy "Door+admin inserts attendees" on attendees for insert to authenticated with check (get_user_role() in ('door','admin'));
create policy "Door+admin updates attendees" on attendees for update to authenticated using (get_user_role() in ('door','admin'));
create policy "Admin deletes attendees" on attendees for delete to authenticated using (get_user_role()='admin');

-- bar_accounts
create policy "Staff reads bar_accounts" on bar_accounts for select to authenticated using (true);
create policy "Bar+admin inserts accounts" on bar_accounts for insert to authenticated with check (get_user_role() in ('bar','admin'));
create policy "Bar+door+admin updates accounts" on bar_accounts for update to authenticated using (get_user_role() in ('bar','door','admin'));
create policy "Admin deletes accounts" on bar_accounts for delete to authenticated using (get_user_role()='admin');

-- bar_closures
create policy "Staff reads closures" on bar_closures for select to authenticated using (true);
create policy "Bar+door+admin inserts closures" on bar_closures for insert to authenticated with check (get_user_role() in ('bar','door','admin'));
create policy "Admin modifies closures" on bar_closures for update to authenticated using (get_user_role()='admin');

-- expenses
create policy "Staff reads expenses" on expenses for select to authenticated using (true);
create policy "Admin manages expenses" on expenses for all to authenticated using (get_user_role()='admin');

-- ═══════════════════════════════════════════════════════════════════════════
-- Funciones atómicas (sin race conditions)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function add_drink(p_account_id uuid, p_amount integer)
returns json language plpgsql security definer as $$
begin
  if p_amount = 160 then
    update bar_accounts set total=total+160, qty160=qty160+1 where id=p_account_id and not is_closed;
  elsif p_amount = 260 then
    update bar_accounts set total=total+260, qty260=qty260+1 where id=p_account_id and not is_closed;
  elsif p_amount = 360 then
    update bar_accounts set total=total+360, qty360=qty360+1 where id=p_account_id and not is_closed;
  else
    return json_build_object('ok',false,'error','Monto inválido');
  end if;
  if not found then return json_build_object('ok',false,'error','Cuenta no encontrada o cerrada'); end if;
  return json_build_object('ok',true);
end;
$$;

create or replace function subtract_drink(p_account_id uuid, p_amount integer)
returns json language plpgsql security definer as $$
declare v bar_accounts;
begin
  select * into v from bar_accounts where id=p_account_id and not is_closed;
  if not found then return json_build_object('ok',false,'error','Cuenta no encontrada o cerrada'); end if;
  if p_amount=160 then
    if v.qty160<=0 then return json_build_object('ok',false,'error','Sin tragos para restar'); end if;
    update bar_accounts set total=total-160, qty160=qty160-1 where id=p_account_id;
  elsif p_amount=260 then
    if v.qty260<=0 then return json_build_object('ok',false,'error','Sin tragos para restar'); end if;
    update bar_accounts set total=total-260, qty260=qty260-1 where id=p_account_id;
  elsif p_amount=360 then
    if v.qty360<=0 then return json_build_object('ok',false,'error','Sin tragos para restar'); end if;
    update bar_accounts set total=total-360, qty360=qty360-1 where id=p_account_id;
  end if;
  return json_build_object('ok',true);
end;
$$;

create or replace function close_bar_account(p_account_id uuid, p_closed_by text, p_photo_url text default null)
returns json language plpgsql security definer as $$
declare v bar_accounts;
begin
  select * into v from bar_accounts where id=p_account_id and not is_closed for update;
  if not found then return json_build_object('ok',false,'error','Cuenta no encontrada o ya cerrada'); end if;
  if v.total=0 then return json_build_object('ok',false,'error','La cuenta no tiene consumo'); end if;

  insert into bar_closures(event_id,slot,attendee_id,total,qty160,qty260,qty360,closed_by,payment_photo_url)
  values(v.event_id,v.slot,v.attendee_id,v.total,v.qty160,v.qty260,v.qty360,p_closed_by,p_photo_url);

  update bar_accounts set is_closed=true where id=p_account_id;

  -- Si tiene asistente vinculado, guardar la foto en su perfil
  if v.attendee_id is not null and p_photo_url is not null then
    update attendees set payment_photo_url=p_photo_url, status='paid', amount_paid=coalesce(amount_paid,0)+v.total
    where id=v.attendee_id;
  end if;

  return json_build_object('ok',true,'total',v.total);
end;
$$;

create or replace function mark_exit(p_attendee_id uuid)
returns json language plpgsql security definer as $$
declare v attendees; acc bar_accounts;
begin
  select * into v from attendees where id=p_attendee_id;
  if not found then return json_build_object('ok',false,'error','Asistente no encontrado'); end if;

  -- Verificar que no tenga cuenta abierta con saldo
  if v.bar_account_slot is not null then
    select * into acc from bar_accounts
    where event_id=v.event_id and slot=v.bar_account_slot and not is_closed and total>0;
    if found then
      return json_build_object('ok',false,'error','Tiene cuenta abierta con saldo. Debe cerrar antes de salir.');
    end if;
  end if;

  update attendees set exit_time=now() where id=p_attendee_id;
  return json_build_object('ok',true);
end;
$$;

create or replace function init_bar_accounts(p_event_id uuid, p_count integer)
returns json language plpgsql security definer as $$
declare i integer;
begin
  delete from bar_accounts where event_id=p_event_id;
  for i in 1..p_count loop
    insert into bar_accounts(event_id,slot) values(p_event_id,i);
  end loop;
  return json_build_object('ok',true,'count',p_count);
end;
$$;

-- ─── Auto-crear perfil al registrar usuario ───────────────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles(id,role,display_name)
  values(new.id,
         coalesce(new.raw_user_meta_data->>'role','bar'),
         coalesce(new.raw_user_meta_data->>'display_name',new.email));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure handle_new_user();
