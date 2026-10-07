-- Um Gestor não pode editar, desativar nem mudar a palavra-passe de quem tem acesso ao Apoio ao
-- Cliente (só o Super Admin), tal como já acontecia com Super Admin e Loja Online.
-- Aplicada ao projeto como migração ldo_support_save_user_guard.
create or replace function public.ldo_save_user(
  p_session text,
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_is_super_admin boolean,
  p_online_access boolean,
  p_active boolean,
  p_stores jsonb,
  p_password text,
  p_must_change boolean
) returns uuid
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
    if v_password = '' then
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
      p_stores, extensions.crypt(v_password, extensions.gen_salt('bf', 10)), now(), coalesce(p_must_change, true), v_me, v_me)
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
    -- A new password ends the person's open sessions.
    if v_password <> '' then
      update public.ldo_app_users set
        password_hash = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
        password_changed_at = now(), must_change_password = coalesce(p_must_change, true),
        failed_logins = 0, locked_until = null
      where id = v_id;
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
