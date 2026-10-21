-- Private Selection: pedidos bloqueados à vista da equipa e engano corrigido sem bloquear.
--
-- Antes, um pedido de quem foi removido (mesmo email, outra forma do mesmo endereço ou o mesmo telemóvel) recebia a
-- resposta de sempre, sem email, e não ficava registado em lado nenhum: um engano (email mal escrito, removido logo a
-- seguir) bloqueava o pedido certo da mesma pessoa sem ninguém saber.
--
-- 1. Margem de engano: um membro removido na primeira hora depois de se registar não bloqueia ninguém (é um engano
--    corrigido, não uma exclusão). Se a mesma pessoa pedir de novo com esse email, volta a ser membro como um pedido
--    novo (email com a senha depois do atraso habitual).
-- 2. Os pedidos bloqueados ficam em ldo_ps_blocked (um por email enquanto não for resolvido; repetições contam em
--    attempts). A equipa vê-os no dashboard e escolhe: Aceitar (membro ativo, senha enviada já) ou Ignorar.
-- O acesso continua automático: só os pedidos de pessoas removidas param à espera da equipa.

create table public.ldo_ps_blocked (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) <= 254),
  name text not null check (length(name) <= 120),
  phone text not null check (length(phone) <= 16),
  locale text not null check (locale in ('pt', 'en', 'es', 'fr', 'de', 'it')),
  brand text not null check (brand in ('ldo', 'gsp')),
  origin text check (origin is null or length(origin) <= 200),
  consent_marketing boolean not null default false,
  -- removed_email: o próprio email foi removido; removed_mailbox: outra forma do mesmo endereço; removed_phone: o mesmo telemóvel.
  reason text not null check (reason in ('removed_email', 'removed_mailbox', 'removed_phone')),
  removed_member_id uuid references public.ldo_ps_members (id) on delete set null,
  attempts integer not null default 1 check (attempts >= 1),
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.ldo_app_users (id) on delete set null,
  resolution text check (resolution in ('accepted', 'dismissed')),
  check ((resolved_at is null) = (resolution is null))
);
create unique index ldo_ps_blocked_open_email on public.ldo_ps_blocked (email) where resolved_at is null;
create index ldo_ps_blocked_created_idx on public.ldo_ps_blocked (created_at);
alter table public.ldo_ps_blocked enable row level security;
revoke all on public.ldo_ps_blocked from anon, authenticated;

-- Removido por engano: removido na primeira hora depois de se registar.
create function ldo_private.ps_quick_removal(p_m public.ldo_ps_members) returns boolean
language sql immutable set search_path = '' as $$
  select p_m.removed_at is not null and p_m.removed_at - p_m.created_at < interval '1 hour';
$$;
revoke all on function ldo_private.ps_quick_removal(public.ldo_ps_members) from public, anon, authenticated;

-- Pedido bloqueado: um registo aberto por email; uma repetição atualiza os dados e conta mais uma tentativa.
create function ldo_private.ps_log_blocked(p_email text, p_name text, p_phone text, p_locale text, p_brand text,
  p_origin text, p_consent boolean, p_reason text, p_removed uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.ldo_ps_blocked (email, name, phone, locale, brand, origin, consent_marketing, reason, removed_member_id)
  values (p_email, p_name, p_phone, p_locale, p_brand, left(nullif(btrim(coalesce(p_origin, '')), ''), 200),
    coalesce(p_consent, false), p_reason, p_removed)
  on conflict (email) where resolved_at is null do update set
    name = excluded.name, phone = excluded.phone, locale = excluded.locale, brand = excluded.brand,
    origin = excluded.origin, consent_marketing = public.ldo_ps_blocked.consent_marketing or excluded.consent_marketing,
    reason = excluded.reason, removed_member_id = excluded.removed_member_id,
    attempts = public.ldo_ps_blocked.attempts + 1, last_at = now();
$$;
revoke all on function ldo_private.ps_log_blocked(text, text, text, text, text, text, boolean, text, uuid) from public, anon, authenticated;

-- Pedido de acesso (formulário da loja). Igual ao anterior, com a margem de engano e o registo dos bloqueios.
create or replace function public.ldo_ps_request(p_token text, p_name text, p_email text, p_phone text, p_locale text,
  p_brand text, p_origin text, p_consent boolean, p_ip_hash text, p_ip_prefix_hash text, p_client_key text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 120);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_key text := case when p_client_key ~ '^[A-Za-z0-9_-]{8,64}$' then lower(p_client_key) end;
  v_email_hash text;
  v_recent boolean;
  v_delay interval;
  v_m public.ldo_ps_members;
  v_r public.ldo_ps_members;
begin
  perform ldo_private.bi_check(p_token);
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_ip_prefix_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_locale, '') not in ('pt', 'en', 'es', 'fr', 'de', 'it') or coalesce(p_brand, '') not in ('ldo', 'gsp') then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'Indique o seu nome.' using errcode = '22023';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Indique um email válido.' using errcode = '22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Indique o telemóvel com o indicativo do país.' using errcode = '22023';
  end if;
  v_email_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');
  -- O mesmo pedido repetido (resposta perdida, duplo clique) não conta para os limites.
  if v_key is not null and exists (select 1 from public.ldo_ps_events where kind = 'request' and client_key = v_key
      and email_hash = v_email_hash and created_at > now() - interval '1 hour') then
    return jsonb_build_object('status', 'existing');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ldo_ps_ip:' || p_ip_prefix_hash, 0));
  if (select count(*) from public.ldo_ps_events where kind = 'request' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.ldo_ps_events where kind = 'request' and ip_prefix_hash = p_ip_prefix_hash
        and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Demasiados pedidos. Tente novamente mais tarde.' using errcode = 'P0429';
  end if;
  if (select count(*) from public.ldo_ps_events where kind = 'request' and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Limite geral de pedidos de acesso atingido.' using errcode = 'P0429';
  end if;
  v_recent := exists (select 1 from public.ldo_ps_events where kind = 'request' and email_hash = v_email_hash
    and created_at > now() - interval '10 minutes');
  insert into public.ldo_ps_events (kind, ip_hash, ip_prefix_hash, email_hash, client_key)
  values ('request', p_ip_hash, p_ip_prefix_hash, v_email_hash, v_key);
  delete from public.ldo_ps_events where created_at < now() - interval '30 days';
  if v_recent then
    return jsonb_build_object('status', 'existing');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ldo_ps_email:' || v_email, 0));
  select * into v_m from public.ldo_ps_members where email = v_email for update;
  select make_interval(mins => delay_minutes) into v_delay from public.ldo_ps_settings where id = 1;
  if v_m.id is null then
    -- Um removido não volta com outra forma do mesmo endereço nem com o mesmo telemóvel (com outro email e outro
    -- telemóvel não há como o reconhecer). Removido por engano (na primeira hora) não bloqueia ninguém.
    select r.* into v_r from public.ldo_ps_members r
    where r.status = 'removed' and not ldo_private.ps_quick_removal(r)
      and (r.phone = v_phone or ldo_private.ps_mailbox(r.email) = ldo_private.ps_mailbox(v_email))
    order by (ldo_private.ps_mailbox(r.email) = ldo_private.ps_mailbox(v_email)) desc, r.removed_at desc
    limit 1;
    if v_r.id is not null then
      perform ldo_private.ps_log_blocked(v_email, v_name, v_phone, p_locale, p_brand, p_origin, p_consent,
        case when ldo_private.ps_mailbox(v_r.email) = ldo_private.ps_mailbox(v_email) then 'removed_mailbox' else 'removed_phone' end,
        v_r.id);
      return jsonb_build_object('status', 'blocked');
    end if;
    insert into public.ldo_ps_members (email, name, phone, locale, brand, origin, source, consent_marketing, consent_at, ip_hash,
      email_due_at, klaviyo_action, klaviyo_due_at)
    values (v_email, v_name, v_phone, p_locale, p_brand, left(nullif(btrim(coalesce(p_origin, '')), ''), 200), 'form',
      coalesce(p_consent, false), case when p_consent then now() end, p_ip_hash, now() + v_delay, 'upsert', now());
    return jsonb_build_object('status', 'created');
  end if;
  if v_m.status = 'removed' then
    if not ldo_private.ps_quick_removal(v_m) then
      perform ldo_private.ps_log_blocked(v_email, v_name, v_phone, p_locale, p_brand, p_origin, p_consent, 'removed_email', v_m.id);
      return jsonb_build_object('status', 'blocked');
    end if;
    -- Removido por engano: volta a ser membro como um pedido novo.
    update public.ldo_ps_members set
      name = v_name, phone = v_phone, locale = p_locale, brand = p_brand,
      origin = left(nullif(btrim(coalesce(p_origin, '')), ''), 200), source = 'form', status = 'active',
      created_at = now(), created_by = null, removed_at = null, removed_by = null, ip_hash = p_ip_hash,
      consent_marketing = coalesce(p_consent, false), consent_at = case when p_consent then now() end,
      email_due_at = now() + v_delay, email_sent_at = null, email_attempts = 0, email_lease_until = null, email_detail = null,
      klaviyo_action = 'upsert', klaviyo_due_at = now(), klaviyo_attempts = 0, klaviyo_lease_until = null, klaviyo_detail = null
    where id = v_m.id;
    return jsonb_build_object('status', 'requeued');
  end if;
  -- Caixa do marketing marcada por quem ainda não tinha dado o consentimento (ex.: adicionado pela equipa): a
  -- Klaviyo inscreve-o na próxima passagem. A resposta continua a mesma.
  if coalesce(p_consent, false) and not v_m.consent_marketing then
    update public.ldo_ps_members set consent_marketing = true, consent_at = now(),
      klaviyo_action = 'upsert', klaviyo_due_at = now(), klaviyo_attempts = 0, klaviyo_lease_until = null, klaviyo_detail = null
    where id = v_m.id;
  end if;
  if v_m.email_sent_at > now() - interval '24 hours'
     or (v_m.email_sent_at is null and v_m.email_due_at is not null and v_m.email_attempts < 5) then
    return jsonb_build_object('status', 'existing');
  end if;
  update public.ldo_ps_members set email_due_at = now() + v_delay, email_sent_at = null, email_attempts = 0,
    email_lease_until = null, email_detail = null
  where id = v_m.id;
  return jsonb_build_object('status', 'requeued');
end;
$$;

-- Pedidos bloqueados por resolver (mais recentes primeiro), com o membro removido que os bloqueia.
create function public.ldo_ps_blocked_list(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.ps_admin(p_session);
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'email', b.email, 'name', b.name, 'phone', b.phone, 'locale', b.locale, 'brand', b.brand,
      'consent_marketing', b.consent_marketing, 'reason', b.reason, 'attempts', b.attempts,
      'created_at', b.created_at, 'last_at', b.last_at,
      'removed_email', r.email, 'removed_name', r.name, 'removed_at', r.removed_at,
      'removed_by_name', coalesce(u.full_name, u.username)
    ) order by b.last_at desc)
    from public.ldo_ps_blocked b
    left join public.ldo_ps_members r on r.id = b.removed_member_id
    left join public.ldo_app_users u on u.id = r.removed_by
    where b.resolved_at is null
  ), '[]'::jsonb);
end;
$$;

-- Aceitar (membro ativo, ou de novo ativo se era o email removido; email com a senha já) ou Ignorar.
create function public.ldo_ps_blocked_resolve(p_session text, p_id uuid, p_accept boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.ps_admin(p_session);
  v_b public.ldo_ps_blocked;
  v_added jsonb;
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  select * into v_b from public.ldo_ps_blocked where id = p_id and resolved_at is null for update;
  if v_b.id is null then
    raise exception 'Este pedido já foi tratado.' using errcode = 'P0002';
  end if;
  if coalesce(p_accept, false) then
    v_added := public.ldo_ps_add(p_session, v_b.name, v_b.email, v_b.phone, v_b.locale, v_b.brand);
    -- O consentimento veio do formulário: segue para a Klaviyo como num pedido aceite.
    if v_b.consent_marketing then
      update public.ldo_ps_members set consent_marketing = true, consent_at = coalesce(consent_at, v_b.last_at)
      where id = (v_added ->> 'id')::uuid;
    end if;
  end if;
  update public.ldo_ps_blocked set resolved_at = now(), resolved_by = v_me,
    resolution = case when coalesce(p_accept, false) then 'accepted' else 'dismissed' end
  where id = v_b.id;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, case when coalesce(p_accept, false) then 'private.blocked_accept' else 'private.blocked_dismiss' end, v_b.id,
    jsonb_build_object('email', v_b.email, 'reason', v_b.reason, 'attempts', v_b.attempts));
  return jsonb_build_object('accepted', coalesce(p_accept, false), 'member_id', v_added ->> 'id');
end;
$$;

revoke all on function
  public.ldo_ps_blocked_list(text),
  public.ldo_ps_blocked_resolve(text, uuid, boolean)
from public, authenticated;
grant execute on function
  public.ldo_ps_blocked_list(text),
  public.ldo_ps_blocked_resolve(text, uuid, boolean)
to anon;
