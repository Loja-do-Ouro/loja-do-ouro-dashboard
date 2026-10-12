-- Acesso por email: o Super Admin envia a uma pessoa um link de uso único, válido 48 horas, para ela escolher a
-- palavra-passe. Nenhuma palavra-passe vai no email e só o hash do token fica na base de dados (como nas sessões).
-- O link leva o token depois de "#", que o browser nunca envia ao servidor: não fica nos registos de pedidos.
--
-- - ldo_save_user: o Super Admin pode criar um utilizador sem palavra-passe (fica sem poder entrar até usar o link).
-- - ldo_create_access(sessão, utilizador): só Super Admin; anula os links anteriores dessa pessoa e devolve o token
--   uma única vez, para o servidor o pôr no email.
-- - ldo_cancel_access(sessão, utilizador): anula os links pendentes (quando o email não chega a sair).
-- - ldo_access_info(token) e ldo_accept_access(token, palavra-passe): públicas, para a página /acesso.
-- - ldo_list_access(sessão): estado do último link de cada pessoa, para a lista de utilizadores.
-- - Um link pendente deixa de funcionar quando o email da pessoa muda, quando o admin lhe define uma palavra-passe
--   (ldo_save_user) ou quando ela própria a muda (ldo_change_password).

create table public.ldo_app_access_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ldo_app_users (id) on delete cascade,
  token_hash bytea not null unique,
  email text not null,
  created_by uuid references public.ldo_app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index ldo_app_access_links_user_idx on public.ldo_app_access_links (user_id, created_at desc);
alter table public.ldo_app_access_links enable row level security;
revoke all on public.ldo_app_access_links from anon, authenticated;

-- ---------------------------------------------------------------- utilizador sem palavra-passe
-- Igual à versão anterior, exceto: um utilizador novo criado pelo Super Admin pode ficar sem palavra-passe
-- (password_hash nulo: ldo_login recusa-o até a pessoa usar o link do email).
create or replace function public.ldo_save_user(p_session text, p_user_id uuid, p_username text, p_full_name text,
  p_is_super_admin boolean, p_online_access boolean, p_active boolean, p_stores jsonb, p_password text, p_must_change boolean)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_super boolean;
  v_managed uuid[];
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_password text := coalesce(p_password, '');
  v_target public.ldo_app_users;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  select is_super_admin into v_super from public.ldo_app_users where id = v_me;
  v_managed := ldo_private.managed_stores(v_me);
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then
    raise exception 'Nome de utilizador inválido: 3 a 40 letras minúsculas, números, ponto, hífen ou _.' using errcode = '22023';
  end if;
  p_stores := coalesce(p_stores, '{}'::jsonb);
  if jsonb_typeof(p_stores) <> 'object' or exists (
    select 1 from jsonb_each_text(p_stores) a(k, v)
    where v not in ('manager', 'store')
      or not exists (select 1 from public.ldo_app_stores s where s.id::text = k)
  ) then
    raise exception 'Loja ou nível inválido.' using errcode = '22023';
  end if;
  if v_password <> '' and length(v_password) < 8 then
    raise exception 'A palavra-passe tem de ter pelo menos 8 caracteres.' using errcode = '22023';
  end if;

  if p_user_id is null then
    if v_password = '' and not coalesce(v_super, false) then
      raise exception 'Indique uma palavra-passe inicial.' using errcode = '22023';
    end if;
  else
    select * into v_target from public.ldo_app_users where id = p_user_id;
    if v_target.id is null then
      raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
    end if;
  end if;
  if exists (select 1 from public.ldo_app_users where username = v_username and id is distinct from p_user_id) then
    raise exception 'Já existe um utilizador com este nome.' using errcode = '23505';
  end if;

  if not v_super then
    if cardinality(v_managed) = 0 then
      raise exception 'Sem permissão para gerir utilizadores.' using errcode = '42501';
    end if;
    if coalesce(p_is_super_admin, false) or coalesce(p_online_access, false) then
      raise exception 'Só o Super Admin pode dar acesso Super Admin ou Loja Online.' using errcode = '42501';
    end if;
    if p_stores = '{}'::jsonb then
      raise exception 'Escolha pelo menos uma loja.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each_text(p_stores) a(k, v) where v <> 'store' or not (k::uuid = any (v_managed))) then
      raise exception 'Um Gestor só pode dar o nível Loja nas lojas que gere.' using errcode = '42501';
    end if;
    if p_user_id is not null and (p_user_id = v_me or v_target.is_super_admin or v_target.online_access or v_target.support_access or exists (
      select 1 from jsonb_each_text(v_target.store_access) a(k, v) where v <> 'store' or not (k::uuid = any (v_managed))
    )) then
      raise exception 'Este utilizador tem acessos fora das suas lojas. Peça ao Super Admin.' using errcode = '42501';
    end if;
  elsif p_user_id is not null and v_target.is_super_admin and v_target.active
    and not (coalesce(p_is_super_admin, false) and coalesce(p_active, true))
    and not exists (select 1 from public.ldo_app_users where is_super_admin and active and id <> p_user_id) then
    raise exception 'Tem de existir sempre pelo menos um Super Admin ativo.' using errcode = '42501';
  end if;

  if p_user_id is null then
    insert into public.ldo_app_users (username, full_name, is_super_admin, online_access, active, store_access,
      password_hash, password_changed_at, must_change_password, invited_by, updated_by)
    values (v_username, v_name, coalesce(p_is_super_admin, false), coalesce(p_online_access, false), coalesce(p_active, true),
      p_stores,
      case when v_password = '' then null else extensions.crypt(v_password, extensions.gen_salt('bf', 10)) end,
      case when v_password = '' then null else now() end,
      v_password <> '' and coalesce(p_must_change, true), v_me, v_me)
    returning id into v_id;
  else
    update public.ldo_app_users set
      username = v_username,
      full_name = v_name,
      is_super_admin = coalesce(p_is_super_admin, false),
      online_access = coalesce(p_online_access, false),
      active = coalesce(p_active, true),
      store_access = p_stores,
      updated_by = v_me,
      updated_at = now()
    where id = p_user_id
    returning id into v_id;
    -- A new password ends the person's open sessions and any access link still pending.
    if v_password <> '' then
      update public.ldo_app_users set
        password_hash = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
        password_changed_at = now(), must_change_password = coalesce(p_must_change, true),
        failed_logins = 0, locked_until = null
      where id = v_id;
      update public.ldo_app_access_links set revoked_at = now()
      where user_id = v_id and used_at is null and revoked_at is null;
    end if;
  end if;

  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, case when p_user_id is null then 'user.create' else 'user.update' end, v_id,
    jsonb_build_object('username', v_username, 'super', coalesce(p_is_super_admin, false),
      'online', coalesce(p_online_access, false), 'active', coalesce(p_active, true), 'stores', p_stores,
      'password_reset', v_password <> ''));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- criar e anular o link

create function public.ldo_create_access(p_session text, p_user_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_target public.ldo_app_users;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires timestamptz := now() + interval '48 hours';
  v_reply text;
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin and active) then
    raise exception 'Só o Super Admin pode enviar acessos por email.' using errcode = '42501';
  end if;
  select * into v_target from public.ldo_app_users where id = p_user_id for update;
  if v_target.id is null or v_target.username is null then
    raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
  end if;
  if v_target.id = v_me then
    raise exception 'Para a sua própria conta use "A minha conta".' using errcode = '22023';
  end if;
  if not v_target.active then
    raise exception 'A conta está desativada: ative-a antes de enviar o acesso.' using errcode = '22023';
  end if;
  if v_target.email is null then
    raise exception 'Indique o email da pessoa para lhe enviar o acesso.' using errcode = '22023';
  end if;
  -- Evita emails repetidos com um duplo clique (para o mesmo endereço: depois de corrigir o email, envia logo).
  if exists (select 1 from public.ldo_app_access_links
             where user_id = p_user_id and email = v_target.email and created_at > now() - interval '1 minute'
               and revoked_at is null and used_at is null) then
    raise exception 'Acabou de ser enviado um acesso a esta pessoa. Aguarde um minuto antes de enviar outro.' using errcode = '22023';
  end if;
  -- Só o link mais recente funciona.
  update public.ldo_app_access_links set revoked_at = now()
  where user_id = p_user_id and used_at is null and revoked_at is null;
  insert into public.ldo_app_access_links (user_id, token_hash, email, created_by, expires_at)
  values (p_user_id, extensions.digest(v_token, 'sha256'), v_target.email, v_me, v_expires);
  select email into v_reply from public.ldo_app_users where id = v_me;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'user.access_link', p_user_id, jsonb_build_object('email', v_target.email, 'expires_at', v_expires));
  return jsonb_build_object('token', v_token, 'email', v_target.email, 'username', v_target.username,
    'full_name', v_target.full_name, 'expires_at', v_expires, 'reply_to', v_reply);
end;
$$;

create function public.ldo_cancel_access(p_session text, p_user_id uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin and active) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  update public.ldo_app_access_links set revoked_at = now()
  where user_id = p_user_id and used_at is null and revoked_at is null;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'user.access_link_cancel', p_user_id, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- página pública /acesso

create function public.ldo_access_info(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_link public.ldo_app_access_links;
  v_user public.ldo_app_users;
begin
  select * into v_link from public.ldo_app_access_links
  where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256');
  if v_link.id is null or v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_link.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select * into v_user from public.ldo_app_users where id = v_link.user_id;
  -- Um link enviado para um email que entretanto foi corrigido já não serve.
  if v_user.id is null or not v_user.active or v_user.email is distinct from v_link.email then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return jsonb_build_object('ok', true, 'username', v_user.username, 'full_name', v_user.full_name,
    'expires_at', v_link.expires_at);
end;
$$;

-- Define a palavra-passe, gasta o link, termina as sessões antigas e abre uma sessão nova.
create function public.ldo_accept_access(p_token text, p_password text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_link public.ldo_app_access_links;
  v_user public.ldo_app_users;
begin
  select * into v_link from public.ldo_app_access_links
  where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
  for update;
  if v_link.id is null or v_link.revoked_at is not null or v_link.used_at is not null or v_link.expires_at <= now() then
    raise exception 'Este link já não é válido. Peça ao administrador que lhe envie um novo acesso.' using errcode = '22023';
  end if;
  select * into v_user from public.ldo_app_users where id = v_link.user_id for update;
  if v_user.id is null or not v_user.active or v_user.email is distinct from v_link.email then
    raise exception 'Este link já não é válido. Peça ao administrador que lhe envie um novo acesso.' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'A palavra-passe tem de ter pelo menos 8 caracteres.' using errcode = '22023';
  end if;
  if lower(p_password) = v_user.username then
    raise exception 'A palavra-passe não pode ser igual ao nome de utilizador.' using errcode = '22023';
  end if;
  update public.ldo_app_users set
    password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    password_changed_at = now(), must_change_password = false, failed_logins = 0, locked_until = null,
    last_login_at = now()
  where id = v_user.id;
  update public.ldo_app_access_links set used_at = now() where id = v_link.id;
  update public.ldo_app_access_links set revoked_at = now()
  where user_id = v_user.id and id <> v_link.id and used_at is null and revoked_at is null;
  update public.ldo_app_sessions set revoked_at = now() where user_id = v_user.id and revoked_at is null;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_user.id, 'user.access_link_used', v_user.id, jsonb_build_object('link', v_link.id));
  return jsonb_build_object('ok', true, 'username', v_user.username, 'token', ldo_private.new_session(v_user.id));
end;
$$;

-- ---------------------------------------------------------------- mudar a própria palavra-passe
-- Igual à versão anterior, mais: anula um link de acesso que ainda esteja pendente.
create or replace function public.ldo_change_password(p_session text, p_current text, p_new text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_hash text;
begin
  if v_me is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'A nova palavra-passe tem de ter pelo menos 8 caracteres.' using errcode = '22023';
  end if;
  select password_hash into v_hash from public.ldo_app_users where id = v_me;
  if extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    raise exception 'A palavra-passe atual não está correta.' using errcode = '22023';
  end if;
  update public.ldo_app_users set
    password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
    password_changed_at = now(), must_change_password = false
  where id = v_me;
  update public.ldo_app_sessions set revoked_at = now() where user_id = v_me and revoked_at is null;
  update public.ldo_app_access_links set revoked_at = now()
  where user_id = v_me and used_at is null and revoked_at is null;
  return ldo_private.new_session(v_me);
end;
$$;

-- ---------------------------------------------------------------- estado na lista de utilizadores

create function public.ldo_list_access(p_session text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin and active) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', l.user_id, 'email', l.email, 'created_at', l.created_at, 'expires_at', l.expires_at,
      'used_at', l.used_at, 'revoked_at', l.revoked_at))
    from (
      select distinct on (user_id) * from public.ldo_app_access_links order by user_id, created_at desc
    ) l
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.ldo_create_access(text, uuid), public.ldo_cancel_access(text, uuid),
  public.ldo_access_info(text), public.ldo_accept_access(text, text), public.ldo_list_access(text)
  from public, anon, authenticated;
grant execute on function public.ldo_create_access(text, uuid), public.ldo_cancel_access(text, uuid),
  public.ldo_access_info(text), public.ldo_accept_access(text, text), public.ldo_list_access(text)
  to anon;
