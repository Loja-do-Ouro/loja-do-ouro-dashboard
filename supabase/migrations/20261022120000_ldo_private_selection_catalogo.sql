-- Private Selection, fase 2: catálogo exclusivo.
--
-- * Código de membro: um só código de desconto da Shopify (7,5 % nas peças da Private Selection, não acumulável),
--   secreto e só conhecido pelo dashboard (ldo_ps_settings.member_code, definido pela equipa). A entrada
--   (ldo_ps_login) e a confirmação da sessão (ldo_ps_session) devolvem-no em "code" (null enquanto não houver): a
--   página reservada aplica-o sem o mostrar e nunca o escreve no HTML da loja. A equipa vê-o em ldo_ps_list.
-- * Peças guardadas no perfil ("Adicionar ao perfil"): por membro, até 300, pelo handle do produto na Shopify. O
--   membro vê-as na página reservada ("As minhas peças"), com a sessão da loja; a equipa vê as de cada membro e as
--   peças mais desejadas (só membros ativos). Remover um membro é uma marca: as peças ficam (voltam se for adicionado
--   de novo), mas as sessões dele terminam e deixam de as poder ler ou mudar.
--
-- Como na fase 1: tabela sem acesso direto (anon/authenticated sem privilégios); a equipa usa funções com p_session
-- e a página reservada chega pelo servidor (token, ldo_private.bi_check) com a sessão da loja.

-- ---------------------------------------------------------------- tabelas

alter table public.ldo_ps_settings add column member_code text
  check (member_code is null or member_code ~ '^[A-Za-z0-9_-]{4,40}$');

-- Peças guardadas (handle da Shopify). Até 300 por membro (ldo_ps_favorites).
create table public.ldo_ps_favorites (
  member_id uuid not null references public.ldo_ps_members (id) on delete cascade,
  handle text not null check (handle ~ '^[a-z0-9][a-z0-9-]{0,254}$'),
  created_at timestamptz not null default now(),
  primary key (member_id, handle)
);

alter table public.ldo_ps_favorites enable row level security;
revoke all on public.ldo_ps_favorites from anon, authenticated;

-- ---------------------------------------------------------------- equipa (sessão)

-- Membros (mais recentes primeiro), com as peças guardadas de cada um (mais recentes primeiro), e a configuração,
-- com o código de membro. Nunca devolve a senha, o hash nem a cifra.
create or replace function public.ldo_ps_list(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.ps_admin(p_session);
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone, 'locale', m.locale, 'brand', m.brand,
        'source', m.source, 'status', m.status, 'consent_marketing', m.consent_marketing, 'created_at', m.created_at,
        'created_by_name', coalesce(c.full_name, c.username), 'removed_at', m.removed_at,
        'removed_by_name', coalesce(r.full_name, r.username),
        'email_due_at', m.email_due_at, 'email_sent_at', m.email_sent_at, 'email_attempts', m.email_attempts,
        'email_detail', m.email_detail, 'klaviyo_action', m.klaviyo_action, 'klaviyo_synced_at', m.klaviyo_synced_at,
        'klaviyo_subscribed_at', m.klaviyo_subscribed_at, 'klaviyo_attempts', m.klaviyo_attempts,
        'klaviyo_detail', m.klaviyo_detail, 'last_login_at', m.last_login_at,
        'favorites', coalesce((select jsonb_agg(f.handle order by f.created_at desc, f.handle)
          from public.ldo_ps_favorites f where f.member_id = m.id), '[]'::jsonb)
      ) order by m.created_at desc)
      from public.ldo_ps_members m
      left join public.ldo_app_users c on c.id = m.created_by
      left join public.ldo_app_users r on r.id = m.removed_by
    ), '[]'::jsonb),
    'settings', (
      select jsonb_build_object('has_password', s.password_hash is not null, 'password_changed_at', s.password_changed_at,
        'password_changed_by_name', coalesce(u.full_name, u.username), 'delay_minutes', s.delay_minutes,
        'session_days', s.session_days, 'entry_path', s.entry_path, 'member_code', s.member_code)
      from public.ldo_ps_settings s
      left join public.ldo_app_users u on u.id = s.password_changed_by
      where s.id = 1)
  );
end;
$$;

-- Código de membro (o código de desconto da Shopify). Vazio ou null retira-o: a página deixa de aplicar desconto.
-- O código tem de existir na Shopify (Descontos), senão o carrinho ignora-o.
create function public.ldo_ps_set_member_code(p_session text, p_code text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.ps_admin(p_session);
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Za-z0-9_-]{4,40}$' then
    raise exception 'O código tem de ter entre 4 e 40 caracteres: letras sem acentos, números, "-" ou "_".'
      using errcode = '22023';
  end if;
  update public.ldo_ps_settings set member_code = v_code, updated_at = now(), updated_by = v_me
  where id = 1 and member_code is distinct from v_code;
  -- Como a senha, o código não vai para o registo (é secreto): fica só se foi definido ou retirado.
  if found then
    insert into public.ldo_app_audit (actor, action, target, details)
    values (v_me, 'private.code', null, jsonb_build_object('set', v_code is not null));
  end if;
end;
$$;

-- Peças mais desejadas: quantos membros ativos guardaram cada peça (as mais guardadas primeiro; em empate, a guardada
-- mais recentemente). No máximo 100.
create function public.ldo_ps_favorites_top(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.ps_admin(p_session);
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('handle', t.handle, 'count', t.n) order by t.n desc, t.last_at desc, t.handle)
    from (
      select f.handle, count(*)::integer n, max(f.created_at) last_at
      from public.ldo_ps_favorites f
      join public.ldo_ps_members m on m.id = f.member_id
      where m.status = 'active'
      group by f.handle
      order by n desc, last_at desc, f.handle
      limit 100
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- servidor (token): rotas públicas

-- Entrada na página reservada (email + senha partilhada). Devolve o estado em vez de dar erro, para as falhas
-- ficarem gravadas. Nunca diz se o email é membro: email desconhecido, membro removido ou senha ainda por definir
-- fazem o mesmo trabalho (bcrypt) e respondem 'invalid'. Bloqueios (contados em ldo_ps_events, iguais para membros
-- e para emails que não o são):
-- * 5 falhas do mesmo email a partir da mesma rede em 15 minutos bloqueiam esse email nessa rede; quem está noutra
--   rede (o próprio membro, por exemplo) continua a entrar;
-- * com 20 falhas numa hora, a rede só entra com a senha certa de um membro: as outras tentativas respondem
--   'locked' (um email que não é membro faz o mesmo bcrypt, mas sem registo).
-- A configuração fica bloqueada para leitura (for share): uma senha mudada ao mesmo tempo ou espera por esta entrada
-- e termina a sessão nova, ou fica gravada antes e a entrada já usa a senha nova.
-- Só devolve o primeiro nome (para a saudação da página): a senha é partilhada, por isso entrar só prova que se
-- conhece o email de um membro. Fase 2: também o código de membro (code, null enquanto não houver).
create or replace function public.ldo_ps_login(p_token text, p_email text, p_password text, p_ip_prefix_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_email_hash text := encode(extensions.digest(v_email, 'sha256'), 'hex');
  v_busy boolean;
  v_s public.ldo_ps_settings;
  v_m public.ldo_ps_members;
  v_token text;
  v_expires timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  if coalesce(p_ip_prefix_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  if (select count(*) from public.ldo_ps_events where kind = 'login_fail' and email_hash = v_email_hash
      and ip_prefix_hash = p_ip_prefix_hash and created_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  v_busy := (select count(*) from public.ldo_ps_events where kind = 'login_fail' and ip_prefix_hash = p_ip_prefix_hash
    and created_at > now() - interval '1 hour') >= 20;
  select * into v_s from public.ldo_ps_settings where id = 1 for share;
  if v_s.password_hash is not null then
    select * into v_m from public.ldo_ps_members where email = v_email and status = 'active' for update;
  end if;

  if v_m.id is null then
    -- O mesmo bcrypt que um membro faria, também com a rede travada: o tempo da resposta não diz se o email é membro.
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    if v_busy then
      return jsonb_build_object('ok', false, 'reason', 'locked');
    end if;
  elsif extensions.crypt(coalesce(p_password, ''), v_s.password_hash) = v_s.password_hash then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires := now() + make_interval(days => v_s.session_days);
    insert into public.ldo_ps_sessions (token_hash, member_id, expires_at)
    values (extensions.digest(v_token, 'sha256'), v_m.id, v_expires);
    update public.ldo_ps_members set last_login_at = now() where id = v_m.id;
    return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_expires, 'name', split_part(v_m.name, ' ', 1),
      'code', v_s.member_code);
  end if;

  insert into public.ldo_ps_events (kind, ip_prefix_hash, email_hash) values ('login_fail', p_ip_prefix_hash, v_email_hash);
  return jsonb_build_object('ok', false, 'reason', case when v_busy
    or (select count(*) from public.ldo_ps_events where kind = 'login_fail' and email_hash = v_email_hash
      and ip_prefix_hash = p_ip_prefix_hash and created_at > now() - interval '15 minutes') >= 5 then 'locked' else 'invalid' end);
end;
$$;

-- Confirma a sessão em cada visita da página reservada. Só vale se não foi terminada nem expirou, se o membro
-- continua ativo e se a senha não mudou depois da entrada. Como na entrada, só o primeiro nome e o código de membro.
create or replace function public.ldo_ps_session(p_token text, p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text;
  v_expires timestamptz;
  v_seen timestamptz;
  v_code text;
begin
  perform ldo_private.bi_check(p_token);
  select s.id, split_part(m.name, ' ', 1), s.expires_at, s.last_seen_at, c.member_code
  into v_id, v_name, v_expires, v_seen, v_code
  from public.ldo_ps_sessions s
  join public.ldo_ps_members m on m.id = s.member_id
  join public.ldo_ps_settings c on c.id = 1
  where s.token_hash = extensions.digest(coalesce(p_session, ''), 'sha256')
    and s.revoked_at is null and s.expires_at > now() and m.status = 'active'
    and s.created_at >= coalesce(c.password_changed_at, '-infinity'::timestamptz);
  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;
  if v_seen is null or v_seen < now() - interval '1 minute' then
    update public.ldo_ps_sessions set last_seen_at = now() where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'name', v_name, 'expires_at', v_expires, 'code', v_code);
end;
$$;

-- Peças guardadas do membro da sessão da loja (p_session: o token da entrada). A sessão é confirmada como em
-- ldo_ps_session; sem sessão válida devolve só {ok: false}. Ações: list, add (até 300 peças; guardar outra vez a
-- mesma não muda nada) e remove (sem erro se não estava guardada). Devolve sempre a lista toda, mais recentes primeiro.
-- O handle não é confirmado na Shopify: só o formato.
create function public.ldo_ps_favorites(p_token text, p_session text, p_action text, p_handle text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_member uuid;
  v_seen timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  select s.id, s.member_id, s.last_seen_at into v_id, v_member, v_seen
  from public.ldo_ps_sessions s
  join public.ldo_ps_members m on m.id = s.member_id
  join public.ldo_ps_settings c on c.id = 1
  where s.token_hash = extensions.digest(coalesce(p_session, ''), 'sha256')
    and s.revoked_at is null and s.expires_at > now() and m.status = 'active'
    and s.created_at >= coalesce(c.password_changed_at, '-infinity'::timestamptz);
  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;
  if coalesce(p_action, '') not in ('list', 'add', 'remove')
     or (p_action <> 'list' and coalesce(p_handle, '') !~ '^[a-z0-9][a-z0-9-]{0,254}$') then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;

  if p_action = 'add' then
    -- Um pedido de cada vez por membro, para o limite valer com pedidos ao mesmo tempo.
    perform pg_advisory_xact_lock(hashtextextended('ldo_ps_favorites:' || v_member::text, 0));
    if not exists (select 1 from public.ldo_ps_favorites where member_id = v_member and handle = p_handle)
       and (select count(*) from public.ldo_ps_favorites where member_id = v_member) >= 300 then
      raise exception 'Pode guardar no máximo 300 peças.' using errcode = '22023';
    end if;
    insert into public.ldo_ps_favorites (member_id, handle) values (v_member, p_handle)
    on conflict (member_id, handle) do nothing;
  elsif p_action = 'remove' then
    delete from public.ldo_ps_favorites where member_id = v_member and handle = p_handle;
  end if;
  -- Como em ldo_ps_session. Só depois da peça guardada (que bloqueia o membro para a chave estrangeira): membro e
  -- depois sessão, pela mesma ordem de ldo_ps_remove.
  if v_seen is null or v_seen < now() - interval '1 minute' then
    update public.ldo_ps_sessions set last_seen_at = now() where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'handles', coalesce((
    select jsonb_agg(f.handle order by f.created_at desc, f.handle)
    from public.ldo_ps_favorites f where f.member_id = v_member), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------- acessos

-- Como na fase 1, só a chave pública (anon). As funções substituídas (create or replace) mantêm os acessos que já
-- tinham.
revoke all on function
  public.ldo_ps_set_member_code(text, text),
  public.ldo_ps_favorites_top(text),
  public.ldo_ps_favorites(text, text, text, text)
from public, authenticated;
grant execute on function
  public.ldo_ps_set_member_code(text, text),
  public.ldo_ps_favorites_top(text),
  public.ldo_ps_favorites(text, text, text, text)
to anon;
