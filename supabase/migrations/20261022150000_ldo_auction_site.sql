-- Leilão, fase 2: site público (leilao.lojadoouro.pt). Contas de clientes (registo, confirmação do email, entrada,
-- recuperação da palavra-passe), área de cliente (perfil, exportar e apagar dados — RGPD), catálogo público sem
-- reserva nem máximos, licitação, favoritos e fila de emails. Tudo com p_token (servidor do site) e, quando é do
-- cliente, a sessão dele (só o hash fica na BD). Identificação legal da empresa editável no backoffice.

alter table public.ldo_auc_settings
  add column company_name text not null default '' check (length(company_name) <= 200),
  add column company_nif text not null default '' check (company_nif = '' or company_nif ~ '^[0-9]{9}$'),
  add column company_address text not null default '' check (length(company_address) <= 400),
  add column company_registry text not null default '' check (length(company_registry) <= 200),
  add column rjoc_title text not null default '' check (length(rjoc_title) <= 120),
  add column contact_email text not null default 'apoiocliente@lojadoouro.pt' check (length(contact_email) <= 254),
  add column contact_phone text not null default '' check (length(contact_phone) <= 40),
  add column ral_entity text not null default '' check (length(ral_entity) <= 400),
  add column terms_version text not null default '2026-10-rascunho' check (length(terms_version) between 1 and 40),
  add column session_days integer not null default 30 check (session_days between 1 and 90);

-- Tokens de confirmação do email e de recuperação da palavra-passe (só o hash; uso único).
create table public.ldo_auc_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  customer_id uuid not null references public.ldo_auc_customers (id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index ldo_auc_tokens_customer_idx on public.ldo_auc_tokens (customer_id, kind);

-- Tentativas (entradas falhadas, registos, recuperações) para limites contra abuso; só hashes.
create table public.ldo_auc_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('login_fail', 'register', 'reset', 'bid')),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index ldo_auc_attempts_idx on public.ldo_auc_attempts (kind, created_at);

alter table public.ldo_auc_tokens enable row level security;
alter table public.ldo_auc_attempts enable row level security;
revoke all on public.ldo_auc_tokens, public.ldo_auc_attempts from anon, authenticated;

-- ---------------------------------------------------------------- ajudas

-- Cliente da sessão (ativo, não apagado, sessão válida); null se não houver.
create function ldo_private.auc_customer(p_session text) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.ldo_auc_logins s join public.ldo_auc_customers c on c.id = s.customer_id
  where s.token_hash = extensions.digest(coalesce(p_session, ''), 'sha256') and s.revoked_at is null and s.expires_at > now()
    and c.deleted_at is null and c.level <> 'blocked';
$$;

-- Novo token de uso único (devolve o valor; a BD guarda o hash). Anula os anteriores do mesmo tipo.
create function ldo_private.auc_new_token(p_customer uuid, p_kind text, p_hours integer) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  update public.ldo_auc_tokens set used_at = now() where customer_id = p_customer and kind = p_kind and used_at is null;
  insert into public.ldo_auc_tokens (token_hash, customer_id, kind, expires_at)
  values (extensions.digest(v, 'sha256'), p_customer, p_kind, now() + make_interval(hours => p_hours));
  return v;
end;
$$;

create function ldo_private.auc_hash(p text) returns text
language sql immutable set search_path = '' as $$ select encode(extensions.digest(lower(btrim(coalesce(p, ''))), 'sha256'), 'hex'); $$;

-- Palavra-passe: 10 a 128 caracteres, com letras e números.
create function ldo_private.auc_check_password(p text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or length(p) < 10 or length(p) > 128 or p !~ '[A-Za-zÀ-ÿ]' or p !~ '[0-9]' then
    raise exception 'A palavra-passe tem de ter pelo menos 10 caracteres, com letras e números.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function ldo_private.auc_customer(text), ldo_private.auc_new_token(uuid, text, integer), ldo_private.auc_hash(text),
  ldo_private.auc_check_password(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- contas

-- Registo. Email já registado: a mesma resposta (não revela quem é cliente); se ainda não confirmou, novo token.
create function public.ldo_auc_register(p_token text, p_email text, p_password text, p_name text, p_phone text,
  p_marketing boolean, p_terms_version text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 120);
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[[:space:]().-]', '', 'g'), '');
  v_c public.ldo_auc_customers;
  v_s public.ldo_auc_settings;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_s from public.ldo_auc_settings where id = 1;
  if v_name = '' then
    raise exception 'Indique o seu nome.' using errcode = '22023';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Indique um email válido.' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Indique o telemóvel com o indicativo do país (ex.: +351 912 345 678).' using errcode = '22023';
  end if;
  perform ldo_private.auc_check_password(p_password);
  if coalesce(p_terms_version, '') <> v_s.terms_version then
    raise exception 'Aceite o regulamento e os termos do leilão.' using errcode = '22023';
  end if;
  if (select count(*) from public.ldo_auc_attempts where kind = 'register' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Demasiados registos a partir desta ligação. Tente mais tarde.' using errcode = '22023';
  end if;
  insert into public.ldo_auc_attempts (kind, ip_hash, email_hash) values ('register', p_ip_hash, ldo_private.auc_hash(v_email));
  perform pg_advisory_xact_lock(hashtextextended('ldo_auc_email:' || v_email, 0));
  select * into v_c from public.ldo_auc_customers where email = v_email;
  if v_c.id is not null then
    if v_c.email_verified_at is null and v_c.deleted_at is null then
      return jsonb_build_object('status', 'pending', 'name', split_part(v_c.name, ' ', 1),
        'verify_token', ldo_private.auc_new_token(v_c.id, 'verify', 48));
    end if;
    return jsonb_build_object('status', 'exists');
  end if;
  insert into public.ldo_auc_customers (email, password_hash, name, alias, phone, marketing_consent, marketing_consent_at,
    terms_version, terms_accepted_at)
  values (v_email, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), v_name, ldo_private.auc_new_alias(), v_phone,
    coalesce(p_marketing, false), case when p_marketing then now() end, v_s.terms_version, now())
  returning * into v_c;
  return jsonb_build_object('status', 'created', 'name', split_part(v_name, ' ', 1),
    'verify_token', ldo_private.auc_new_token(v_c.id, 'verify', 48));
end;
$$;

-- Confirmação do email (link do email). Devolve o primeiro nome.
create function public.ldo_auc_verify_email(p_token text, p_verify text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_t public.ldo_auc_tokens;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_t from public.ldo_auc_tokens
  where token_hash = extensions.digest(coalesce(p_verify, ''), 'sha256') and kind = 'verify' for update;
  if v_t.id is null or v_t.used_at is not null or v_t.expires_at < now() then
    return jsonb_build_object('ok', false);
  end if;
  update public.ldo_auc_tokens set used_at = now() where id = v_t.id;
  update public.ldo_auc_customers set email_verified_at = coalesce(email_verified_at, now()) where id = v_t.customer_id;
  return jsonb_build_object('ok', true, 'name', (select split_part(name, ' ', 1) from public.ldo_auc_customers where id = v_t.customer_id));
end;
$$;

-- Entrada: 5 falhas por email e ligação em 15 minutos (ou 30 por ligação numa hora) bloqueiam. O bcrypt corre sempre.
create function public.ldo_auc_login(p_token text, p_email text, p_password text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_c public.ldo_auc_customers;
  v_s public.ldo_auc_settings;
  v_session text;
  v_expires timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  if (select count(*) from public.ldo_auc_attempts where kind = 'login_fail' and email_hash = ldo_private.auc_hash(v_email)
        and ip_hash = p_ip_hash and created_at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.ldo_auc_attempts where kind = 'login_fail' and ip_hash = p_ip_hash
        and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  select * into v_s from public.ldo_auc_settings where id = 1;
  select * into v_c from public.ldo_auc_customers where email = v_email and deleted_at is null;
  if v_c.id is null or v_c.password_hash is null then
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
  elsif extensions.crypt(coalesce(p_password, ''), v_c.password_hash) = v_c.password_hash then
    if v_c.level = 'blocked' then
      return jsonb_build_object('ok', false, 'reason', 'blocked');
    end if;
    if v_c.email_verified_at is null then
      return jsonb_build_object('ok', false, 'reason', 'unverified', 'name', split_part(v_c.name, ' ', 1),
        'verify_token', ldo_private.auc_new_token(v_c.id, 'verify', 48));
    end if;
    v_session := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires := now() + make_interval(days => v_s.session_days);
    insert into public.ldo_auc_logins (token_hash, customer_id, expires_at) values (extensions.digest(v_session, 'sha256'), v_c.id, v_expires);
    update public.ldo_auc_customers set last_login_at = now() where id = v_c.id;
    return jsonb_build_object('ok', true, 'session', v_session, 'expires_at', v_expires);
  end if;
  insert into public.ldo_auc_attempts (kind, ip_hash, email_hash) values ('login_fail', p_ip_hash, ldo_private.auc_hash(v_email));
  return jsonb_build_object('ok', false, 'reason', 'invalid');
end;
$$;

create function public.ldo_auc_logout(p_token text, p_session text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_auc_logins set revoked_at = now()
  where token_hash = extensions.digest(coalesce(p_session, ''), 'sha256') and revoked_at is null;
end;
$$;

-- Recuperação: devolve o token só se o email existir (o site responde sempre o mesmo). 5 pedidos por ligação/hora.
create function public.ldo_auc_reset_request(p_token text, p_email text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_c public.ldo_auc_customers;
begin
  perform ldo_private.bi_check(p_token);
  if (select count(*) from public.ldo_auc_attempts where kind = 'reset' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.ldo_auc_attempts (kind, ip_hash, email_hash) values ('reset', p_ip_hash, ldo_private.auc_hash(v_email));
  select * into v_c from public.ldo_auc_customers where email = v_email and deleted_at is null and level <> 'blocked';
  if v_c.id is null then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', true, 'email', v_c.email, 'name', split_part(v_c.name, ' ', 1),
    'reset_token', ldo_private.auc_new_token(v_c.id, 'reset', 2));
end;
$$;

-- Nova palavra-passe com o token do email: termina todas as sessões e confirma o email (o link chegou à caixa).
create function public.ldo_auc_reset(p_token text, p_reset text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_t public.ldo_auc_tokens;
begin
  perform ldo_private.bi_check(p_token);
  perform ldo_private.auc_check_password(p_password);
  select * into v_t from public.ldo_auc_tokens
  where token_hash = extensions.digest(coalesce(p_reset, ''), 'sha256') and kind = 'reset' for update;
  if v_t.id is null or v_t.used_at is not null or v_t.expires_at < now() then
    return jsonb_build_object('ok', false);
  end if;
  update public.ldo_auc_tokens set used_at = now() where id = v_t.id;
  update public.ldo_auc_customers set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    email_verified_at = coalesce(email_verified_at, now())
  where id = v_t.customer_id;
  update public.ldo_auc_logins set revoked_at = now() where customer_id = v_t.customer_id and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- área de cliente

create function public.ldo_auc_me(p_token text, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform ldo_private.bi_check(p_token);
  v_id := ldo_private.auc_customer(p_session);
  if v_id is null then
    return null;
  end if;
  return (select jsonb_build_object('id', c.id, 'name', c.name, 'first_name', split_part(c.name, ' ', 1), 'alias', c.alias,
    'email', c.email, 'phone', c.phone, 'nif', c.nif, 'birth_date', c.birth_date, 'address', c.address, 'level', c.level,
    'marketing_consent', c.marketing_consent, 'created_at', c.created_at, 'terms_accepted_at', c.terms_accepted_at)
    from public.ldo_auc_customers c where c.id = v_id);
end;
$$;

create function public.ldo_auc_profile_save(p_token text, p_session text, p_data jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text := left(btrim(regexp_replace(coalesce(p_data ->> 'name', ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 120);
  v_phone text := nullif(regexp_replace(coalesce(p_data ->> 'phone', ''), '[[:space:]().-]', '', 'g'), '');
  v_nif text := nullif(regexp_replace(coalesce(p_data ->> 'nif', ''), '\s', '', 'g'), '');
  v_birth date;
  v_addr jsonb;
  v_c public.ldo_auc_customers;
begin
  perform ldo_private.bi_check(p_token);
  v_id := ldo_private.auc_customer(p_session);
  if v_id is null then
    raise exception 'A sua sessão terminou. Entre de novo.' using errcode = '42501';
  end if;
  select * into v_c from public.ldo_auc_customers where id = v_id for update;
  if v_name = '' then
    raise exception 'Indique o seu nome.' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Indique o telemóvel com o indicativo do país (ex.: +351 912 345 678).' using errcode = '22023';
  end if;
  if v_nif is not null and v_nif !~ '^[0-9]{9}$' then
    raise exception 'O NIF tem 9 algarismos.' using errcode = '22023';
  end if;
  begin
    v_birth := nullif(p_data ->> 'birth_date', '')::date;
  exception when others then
    raise exception 'Data de nascimento inválida.' using errcode = '22023';
  end;
  if v_birth is not null and (v_birth > current_date - interval '18 years' or v_birth < date '1900-01-01') then
    raise exception 'Para licitar tem de ser maior de idade.' using errcode = '22023';
  end if;
  v_addr := jsonb_build_object('line1', left(coalesce(p_data -> 'address' ->> 'line1', ''), 200),
    'line2', left(coalesce(p_data -> 'address' ->> 'line2', ''), 200), 'postal_code', left(coalesce(p_data -> 'address' ->> 'postal_code', ''), 20),
    'city', left(coalesce(p_data -> 'address' ->> 'city', ''), 100));
  -- Uma conta verificada não muda o nome nem o NIF sozinha (a identidade foi confirmada pela equipa).
  if v_c.level in ('verified', 'vip') and (v_name <> v_c.name or v_nif is distinct from v_c.nif) then
    raise exception 'A sua identidade já foi verificada: para mudar o nome ou o NIF fale connosco.' using errcode = '22023';
  end if;
  update public.ldo_auc_customers set name = v_name, phone = v_phone, nif = v_nif, birth_date = v_birth, address = v_addr,
    marketing_consent = coalesce((p_data ->> 'marketing')::boolean, false),
    marketing_consent_at = case when coalesce((p_data ->> 'marketing')::boolean, false) and not v_c.marketing_consent then now()
                                when coalesce((p_data ->> 'marketing')::boolean, false) then marketing_consent_at end
  where id = v_id;
end;
$$;

create function public.ldo_auc_password_change(p_token text, p_session text, p_old text, p_new text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_c public.ldo_auc_customers;
begin
  perform ldo_private.bi_check(p_token);
  v_id := ldo_private.auc_customer(p_session);
  if v_id is null then
    raise exception 'A sua sessão terminou. Entre de novo.' using errcode = '42501';
  end if;
  select * into v_c from public.ldo_auc_customers where id = v_id for update;
  if extensions.crypt(coalesce(p_old, ''), v_c.password_hash) <> v_c.password_hash then
    raise exception 'A palavra-passe atual não está correta.' using errcode = '22023';
  end if;
  perform ldo_private.auc_check_password(p_new);
  update public.ldo_auc_customers set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where id = v_id;
  -- As outras sessões terminam; esta continua.
  update public.ldo_auc_logins set revoked_at = now()
  where customer_id = v_id and revoked_at is null and token_hash <> extensions.digest(p_session, 'sha256');
end;
$$;

-- Os meus dados (RGPD, direito de acesso e portabilidade).
create function public.ldo_auc_export(p_token text, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform ldo_private.bi_check(p_token);
  v_id := ldo_private.auc_customer(p_session);
  if v_id is null then
    raise exception 'A sua sessão terminou. Entre de novo.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select to_jsonb(c) - 'password_hash' - 'notes' - 'verified_by' from public.ldo_auc_customers c where c.id = v_id),
    'bids', coalesce((select jsonb_agg(jsonb_build_object('lot', l.title, 'amount', b.amount, 'max_amount', b.max_amount, 'kind', b.kind,
      'created_at', b.created_at) order by b.id) from public.ldo_auc_bids b join public.ldo_auc_lots l on l.id = b.lot_id
      where b.customer_id = v_id), '[]'::jsonb),
    'favorites', coalesce((select jsonb_agg(jsonb_build_object('lot', l.title, 'since', w.created_at)) from public.ldo_auc_watch w
      join public.ldo_auc_lots l on l.id = w.lot_id where w.customer_id = v_id), '[]'::jsonb),
    'won', coalesce((select jsonb_agg(jsonb_build_object('lot', l.title, 'price', l.current_price, 'closed_at', l.closed_at))
      from public.ldo_auc_lots l where l.leader_id = v_id and l.result = 'sold'), '[]'::jsonb)
  );
end;
$$;

-- Apagar a conta (RGPD): sai o email, o nome, o telemóvel, o NIF, a data de nascimento e a morada; as licitações ficam
-- com o pseudónimo (são prova do contrato). Não é possível enquanto lidera um lote aberto ou tem um lote ganho por pagar.
create function public.ldo_auc_delete_account(p_token text, p_session text, p_password text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_c public.ldo_auc_customers;
begin
  perform ldo_private.bi_check(p_token);
  v_id := ldo_private.auc_customer(p_session);
  if v_id is null then
    raise exception 'A sua sessão terminou. Entre de novo.' using errcode = '42501';
  end if;
  select * into v_c from public.ldo_auc_customers where id = v_id for update;
  if extensions.crypt(coalesce(p_password, ''), v_c.password_hash) <> v_c.password_hash then
    raise exception 'A palavra-passe não está correta.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ldo_auc_lots where leader_id = v_id and (status = 'ready' or (result = 'sold' and payment_due_at > now() - interval '30 days'))) then
    raise exception 'Lidera um lote aberto ou tem um lote ganho por concluir: só pode apagar a conta depois disso.' using errcode = '22023';
  end if;
  update public.ldo_auc_customers set email = 'apagado-' || id || '@apagado.invalid', password_hash = null, name = 'Conta apagada',
    phone = null, nif = null, birth_date = null, address = '{}'::jsonb, marketing_consent = false, marketing_consent_at = null,
    notes = '', deleted_at = now()
  where id = v_id;
  update public.ldo_auc_logins set revoked_at = now() where customer_id = v_id and revoked_at is null;
  delete from public.ldo_auc_watch where customer_id = v_id;
  delete from public.ldo_auc_tokens where customer_id = v_id;
  delete from public.ldo_auc_outbox where customer_id = v_id and sent_at is null;
end;
$$;

-- ---------------------------------------------------------------- catálogo público

-- Campos públicos de um lote: nunca a reserva, o máximo do líder, o email nem o id do líder.
create function ldo_private.auc_public_lot(p_l public.ldo_auc_lots, p_e public.ldo_auc_events) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_l.id, 'position', p_l.position, 'title', p_l.title, 'description', p_l.description, 'images', p_l.images,
    'metal', p_l.metal, 'fineness', p_l.fineness, 'weight_g', p_l.weight_g, 'gems', p_l.gems, 'hallmarked', p_l.hallmarked,
    'condition', p_l.condition, 'condition_report', p_l.condition_report, 'warranty_months', p_l.warranty_months,
    'start_price', p_l.start_price, 'buy_now_price', p_l.buy_now_price, 'has_reserve', p_l.reserve_price is not null,
    'reserve_met', p_l.reserve_price is null or coalesce(p_l.current_price, 0) >= p_l.reserve_price,
    'current_price', p_l.current_price, 'bid_count', p_l.bid_count, 'bidder_count', p_l.bidder_count,
    'leader_alias', (select alias from public.ldo_auc_customers where id = p_l.leader_id),
    'close_at', p_l.close_at, 'extensions', p_l.extensions, 'status', p_l.status, 'result', p_l.result,
    'opens_at', p_e.opens_at, 'event_slug', p_e.slug, 'event_title', p_e.title,
    'deposit', ldo_private.auc_deposit_amount(p_l, (select s from public.ldo_auc_settings s where id = 1)),
    'min_next', ldo_private.auc_min_bid(p_l, (select increments from public.ldo_auc_settings where id = 1)));
$$;

-- Regras e identificação públicas (para o regulamento, o rodapé e a página do lote).
create function ldo_private.auc_public_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) - 'updated_by' - 'updated_at' from public.ldo_auc_settings s where id = 1;
$$;

-- Página inicial: leilões publicados (a decorrer e próximos primeiro; terminados nos últimos 30 dias).
create function public.ldo_auc_public_home(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return jsonb_build_object('settings', ldo_private.auc_public_settings(), 'events', coalesce((
    select jsonb_agg(x order by (x ->> 'sort')::int, x ->> 'first_close_at') from (
      select jsonb_build_object('slug', e.slug, 'title', e.title, 'intro', e.intro, 'opens_at', e.opens_at,
        'first_close_at', e.first_close_at,
        'last_close_at', (select max(close_at) from public.ldo_auc_lots where event_id = e.id and status in ('ready', 'closed')),
        'lots', (select count(*) from public.ldo_auc_lots where event_id = e.id and status in ('ready', 'closed')),
        'cover', (select images -> 0 from public.ldo_auc_lots where event_id = e.id and status in ('ready', 'closed')
                  and jsonb_array_length(images) > 0 order by start_price desc limit 1),
        'open_lots', (select count(*) from public.ldo_auc_lots where event_id = e.id and status = 'ready' and close_at > now()),
        'sort', case when now() >= e.opens_at and exists (select 1 from public.ldo_auc_lots where event_id = e.id and status = 'ready')
                     then 0 when now() < e.opens_at then 1 else 2 end) x
      from public.ldo_auc_events e
      where e.status = 'published' and exists (select 1 from public.ldo_auc_lots l where l.event_id = e.id and l.status in ('ready', 'closed'))
        and (e.first_close_at > now() - interval '30 days' or exists (select 1 from public.ldo_auc_lots l where l.event_id = e.id and l.status = 'ready'))
    ) s
  ), '[]'::jsonb));
end;
$$;

-- Página de um leilão com os lotes (com o estado do cliente em cada um, se tiver sessão).
create function public.ldo_auc_public_event(p_token text, p_slug text, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e public.ldo_auc_events;
  v_me uuid;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_e from public.ldo_auc_events where slug = lower(coalesce(p_slug, '')) and status = 'published';
  if v_e.id is null then
    return null;
  end if;
  v_me := ldo_private.auc_customer(p_session);
  return jsonb_build_object('event', jsonb_build_object('slug', v_e.slug, 'title', v_e.title, 'intro', v_e.intro, 'opens_at', v_e.opens_at,
      'first_close_at', v_e.first_close_at, 'stagger_seconds', v_e.stagger_seconds),
    'settings', ldo_private.auc_public_settings(),
    'lots', coalesce((select jsonb_agg(ldo_private.auc_public_lot(l, v_e) || jsonb_build_object(
        'me_leading', v_me is not null and l.leader_id = v_me,
        'me_bid', v_me is not null and exists (select 1 from public.ldo_auc_bids b where b.lot_id = l.id and b.customer_id = v_me),
        'me_watch', v_me is not null and exists (select 1 from public.ldo_auc_watch w where w.lot_id = l.id and w.customer_id = v_me))
      order by l.position) from public.ldo_auc_lots l where l.event_id = v_e.id and l.status in ('ready', 'closed')), '[]'::jsonb));
end;
$$;

-- Página de um lote: dados públicos, histórico (pseudónimos; sem «subiu o máximo») e o estado do cliente.
create function public.ldo_auc_public_lot(p_token text, p_slug text, p_position integer, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e public.ldo_auc_events;
  v_l public.ldo_auc_lots;
  v_me uuid;
  v_c public.ldo_auc_customers;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_e from public.ldo_auc_events where slug = lower(coalesce(p_slug, '')) and status = 'published';
  if v_e.id is null then
    return null;
  end if;
  select * into v_l from public.ldo_auc_lots where event_id = v_e.id and position = p_position and status in ('ready', 'closed');
  if v_l.id is null then
    return null;
  end if;
  v_me := ldo_private.auc_customer(p_session);
  if v_me is not null then
    select * into v_c from public.ldo_auc_customers where id = v_me;
  end if;
  return jsonb_build_object(
    'lot', ldo_private.auc_public_lot(v_l, v_e),
    'settings', ldo_private.auc_public_settings(),
    'history', coalesce((select jsonb_agg(jsonb_build_object('alias', c.alias, 'amount', b.amount, 'kind', b.kind, 'created_at', b.created_at,
        'mine', v_me is not null and b.customer_id = v_me) order by b.id desc)
      from (select * from public.ldo_auc_bids where lot_id = v_l.id and kind <> 'max_raise' order by id desc limit 50) b
      join public.ldo_auc_customers c on c.id = b.customer_id), '[]'::jsonb),
    'me', case when v_me is null then null else jsonb_build_object(
      'alias', v_c.alias, 'level', v_c.level, 'is_staff', v_c.is_staff,
      'leading', v_l.leader_id = v_me, 'max', case when v_l.leader_id = v_me then v_l.leader_max end,
      'bid', exists (select 1 from public.ldo_auc_bids b where b.lot_id = v_l.id and b.customer_id = v_me),
      'watch', exists (select 1 from public.ldo_auc_watch w where w.lot_id = v_l.id and w.customer_id = v_me),
      'deposit_held', exists (select 1 from public.ldo_auc_deposits d where d.lot_id = v_l.id and d.customer_id = v_me and d.status = 'held'),
      'won', v_l.result = 'sold' and v_l.leader_id = v_me, 'payment_due_at', case when v_l.leader_id = v_me then v_l.payment_due_at end) end);
end;
$$;

-- Estado rápido de um lote (o ecrã atualiza de poucos em poucos segundos).
create function public.ldo_auc_lot_live(p_token text, p_lot uuid, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_l public.ldo_auc_lots;
  v_me uuid;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_l from public.ldo_auc_lots where id = p_lot and status in ('ready', 'closed');
  if v_l.id is null then
    return null;
  end if;
  v_me := ldo_private.auc_customer(p_session);
  return jsonb_build_object('current_price', v_l.current_price, 'bid_count', v_l.bid_count, 'bidder_count', v_l.bidder_count,
    'close_at', v_l.close_at, 'extensions', v_l.extensions, 'status', v_l.status, 'result', v_l.result,
    'reserve_met', v_l.reserve_price is null or coalesce(v_l.current_price, 0) >= v_l.reserve_price,
    'leader_alias', (select alias from public.ldo_auc_customers where id = v_l.leader_id),
    'min_next', ldo_private.auc_min_bid(v_l, (select increments from public.ldo_auc_settings where id = 1)),
    'me_leading', v_me is not null and v_l.leader_id = v_me, 'me_max', case when v_me is not null and v_l.leader_id = v_me then v_l.leader_max end,
    'server_time', clock_timestamp());
end;
$$;

-- Licitar (o cliente vem da sessão). Até 30 licitações por minuto por cliente.
create function public.ldo_auc_bid(p_token text, p_session text, p_lot uuid, p_max numeric, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid;
begin
  perform ldo_private.bi_check(p_token);
  v_me := ldo_private.auc_customer(p_session);
  if v_me is null then
    raise exception 'Entre na sua conta para licitar.' using errcode = '42501';
  end if;
  if (select count(*) from public.ldo_auc_bids where customer_id = v_me and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Demasiadas licitações seguidas. Aguarde um momento.' using errcode = '22023';
  end if;
  return ldo_private.auc_place_bid(p_lot, v_me, p_max, case when p_ip_hash ~ '^[0-9a-f]{64}$' then p_ip_hash end);
end;
$$;

create function public.ldo_auc_watch_toggle(p_token text, p_session text, p_lot uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid;
begin
  perform ldo_private.bi_check(p_token);
  v_me := ldo_private.auc_customer(p_session);
  if v_me is null then
    raise exception 'Entre na sua conta para guardar favoritos.' using errcode = '42501';
  end if;
  if exists (select 1 from public.ldo_auc_watch where customer_id = v_me and lot_id = p_lot) then
    delete from public.ldo_auc_watch where customer_id = v_me and lot_id = p_lot;
    return false;
  end if;
  if not exists (select 1 from public.ldo_auc_lots where id = p_lot and status = 'ready') then
    raise exception 'Este lote já não está aberto.' using errcode = '22023';
  end if;
  insert into public.ldo_auc_watch (customer_id, lot_id) values (v_me, p_lot);
  return true;
end;
$$;

-- As minhas licitações, favoritos e lotes ganhos.
create function public.ldo_auc_my(p_token text, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid;
begin
  perform ldo_private.bi_check(p_token);
  v_me := ldo_private.auc_customer(p_session);
  if v_me is null then
    return null;
  end if;
  return jsonb_build_object(
    'lots', coalesce((select jsonb_agg(ldo_private.auc_public_lot(l, e) || jsonb_build_object(
        'me_leading', l.leader_id = v_me, 'me_max', case when l.leader_id = v_me then l.leader_max end,
        'me_bid', exists (select 1 from public.ldo_auc_bids b where b.lot_id = l.id and b.customer_id = v_me),
        'me_watch', exists (select 1 from public.ldo_auc_watch w where w.lot_id = l.id and w.customer_id = v_me),
        'payment_due_at', case when l.leader_id = v_me then l.payment_due_at end)
      order by (l.status = 'ready') desc, l.close_at desc)
      from public.ldo_auc_lots l join public.ldo_auc_events e on e.id = l.event_id
      where l.status in ('ready', 'closed') and (exists (select 1 from public.ldo_auc_bids b where b.lot_id = l.id and b.customer_id = v_me)
        or exists (select 1 from public.ldo_auc_watch w where w.lot_id = l.id and w.customer_id = v_me))), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------- fila de emails (servidor)

-- Emails na hora, reservados por 2 minutos (uma passagem de cada vez), com os dados para os escrever.
create function public.ldo_auc_outbox_claim(p_token text, p_limit integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_lease timestamptz := now() + interval '2 minutes';
  v_out jsonb;
begin
  perform ldo_private.bi_check(p_token);
  -- (Um WITH que altera dados tem de estar no topo da instrução.)
  with picked as (
    select o.id from public.ldo_auc_outbox o
    where o.sent_at is null and o.due_at <= now() and o.attempts < 5 and (o.lease_until is null or o.lease_until < now())
    order by o.due_at limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ), upd as (
    update public.ldo_auc_outbox o set lease_until = v_lease from picked where o.id = picked.id returning o.*
  )
  select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'payload', u.payload, 'lease', v_lease,
    'email', c.email, 'name', split_part(c.name, ' ', 1), 'alias', c.alias, 'deleted', c.deleted_at is not null,
    'lot', case when l.id is null then null else jsonb_build_object('title', l.title, 'position', l.position, 'image', l.images ->> 0,
      'event_slug', e.slug, 'event_title', e.title, 'current_price', l.current_price, 'close_at', l.close_at) end))
  into v_out
  from upd u join public.ldo_auc_customers c on c.id = u.customer_id
  left join public.ldo_auc_lots l on l.id = u.lot_id left join public.ldo_auc_events e on e.id = l.event_id;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;

create function public.ldo_auc_outbox_done(p_token text, p_id bigint, p_lease timestamptz, p_ok boolean, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_ok then
    update public.ldo_auc_outbox set sent_at = now(), lease_until = null, detail = left(p_detail, 500)
    where id = p_id and lease_until = p_lease;
  else
    update public.ldo_auc_outbox set attempts = attempts + 1, lease_until = null, detail = left(p_detail, 500),
      due_at = now() + interval '10 minutes'
    where id = p_id and lease_until = p_lease;
  end if;
end;
$$;

-- Identificação legal e versão dos termos (backoffice).
create function public.ldo_auc_legal_save(p_session text, p_data jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.auc_require(p_session);
begin
  update public.ldo_auc_settings set
    company_name = left(btrim(coalesce(p_data ->> 'company_name', '')), 200),
    company_nif = regexp_replace(coalesce(p_data ->> 'company_nif', ''), '\s', '', 'g'),
    company_address = left(btrim(coalesce(p_data ->> 'company_address', '')), 400),
    company_registry = left(btrim(coalesce(p_data ->> 'company_registry', '')), 200),
    rjoc_title = left(btrim(coalesce(p_data ->> 'rjoc_title', '')), 120),
    contact_email = left(btrim(coalesce(p_data ->> 'contact_email', '')), 254),
    contact_phone = left(btrim(coalesce(p_data ->> 'contact_phone', '')), 40),
    ral_entity = left(btrim(coalesce(p_data ->> 'ral_entity', '')), 400),
    terms_version = left(btrim(coalesce(nullif(p_data ->> 'terms_version', ''), terms_version)), 40),
    updated_at = now(), updated_by = v_me
  where id = 1;
  insert into public.ldo_app_audit (actor, action, details) values (v_me, 'auction.legal', p_data);
exception
  when check_violation then
    raise exception 'Confirme o NIF da empresa (9 algarismos).' using errcode = '22023';
end;
$$;

-- Limpeza diária das tentativas e tokens antigos.
select cron.schedule('ldo-auction-cleanup', '17 3 * * *', $$
  delete from public.ldo_auc_attempts where created_at < now() - interval '30 days';
  delete from public.ldo_auc_tokens where created_at < now() - interval '30 days';
  update public.ldo_auc_logins set revoked_at = now() where revoked_at is null and expires_at < now();
$$);

revoke all on function ldo_private.auc_public_lot(public.ldo_auc_lots, public.ldo_auc_events), ldo_private.auc_public_settings()
  from public, anon, authenticated;

revoke all on function
  public.ldo_auc_register(text, text, text, text, text, boolean, text, text),
  public.ldo_auc_verify_email(text, text),
  public.ldo_auc_login(text, text, text, text),
  public.ldo_auc_logout(text, text),
  public.ldo_auc_reset_request(text, text, text),
  public.ldo_auc_reset(text, text, text),
  public.ldo_auc_me(text, text),
  public.ldo_auc_profile_save(text, text, jsonb),
  public.ldo_auc_password_change(text, text, text, text),
  public.ldo_auc_export(text, text),
  public.ldo_auc_delete_account(text, text, text),
  public.ldo_auc_public_home(text),
  public.ldo_auc_public_event(text, text, text),
  public.ldo_auc_public_lot(text, text, integer, text),
  public.ldo_auc_lot_live(text, uuid, text),
  public.ldo_auc_bid(text, text, uuid, numeric, text),
  public.ldo_auc_watch_toggle(text, text, uuid),
  public.ldo_auc_my(text, text),
  public.ldo_auc_outbox_claim(text, integer),
  public.ldo_auc_outbox_done(text, bigint, timestamptz, boolean, text),
  public.ldo_auc_legal_save(text, jsonb)
from public, authenticated;
grant execute on function
  public.ldo_auc_register(text, text, text, text, text, boolean, text, text),
  public.ldo_auc_verify_email(text, text),
  public.ldo_auc_login(text, text, text, text),
  public.ldo_auc_logout(text, text),
  public.ldo_auc_reset_request(text, text, text),
  public.ldo_auc_reset(text, text, text),
  public.ldo_auc_me(text, text),
  public.ldo_auc_profile_save(text, text, jsonb),
  public.ldo_auc_password_change(text, text, text, text),
  public.ldo_auc_export(text, text),
  public.ldo_auc_delete_account(text, text, text),
  public.ldo_auc_public_home(text),
  public.ldo_auc_public_event(text, text, text),
  public.ldo_auc_public_lot(text, text, integer, text),
  public.ldo_auc_lot_live(text, uuid, text),
  public.ldo_auc_bid(text, text, uuid, numeric, text),
  public.ldo_auc_watch_toggle(text, text, uuid),
  public.ldo_auc_my(text, text),
  public.ldo_auc_outbox_claim(text, integer),
  public.ldo_auc_outbox_done(text, bigint, timestamptz, boolean, text),
  public.ldo_auc_legal_save(text, jsonb)
to anon;
