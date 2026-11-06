-- =====================================================================================================
-- Plataforma de criadores — fase 3A (a «migração C1» dos comentários da A): leitura dos dados públicos do Instagram
-- pela Business Discovery, a partir da conta Instagram da Loja do Ouro, com autorização expressa e separada
-- (platform_public) e a posse provada por um código na biografia, que se lê e não se guarda. Guarda só números
-- (seguidores, publicações e, por publicação, gostos, comentários e visualizações de reels). Parar apaga tudo na hora.
-- Fora: ligação pela Meta, insights, I1–I6, IA e callbacks da Meta (3B); leituras de hora a hora das publicações de
-- campanha (PR2).
-- Funções da A substituídas (create or replace, mesma assinatura, os privilégios mantêm-se): cr_social_upsert,
-- cr_erase_optional, cr_export_common, cr_retention, ldo_cr_social_delete e ldo_cr_lockdown. Antes de aplicar,
-- confirmar em produção que o md5 do prosrc de cada uma é o do corpo da migração 20261105100000 (README, «Dados
-- públicos do Instagram»). ldo_cr_creators_list não muda: os números públicos só aparecem no perfil do criador
-- («A equipa vê estes números no meu perfil»). Muda também o check de ldo_cr_attempts.kind (junta 'public_code').
-- Compatível com o dashboard em produção: as assinaturas são as mesmas e public_mode nasce 'off'.
-- Teste funcional sobre uma base PGlite local: scripts/criadores-meta-smoke.mjs (README).
-- Depende de 20261105100000.
-- =====================================================================================================

-- ---------------------------------------------------------------- 1. interruptor, estado da ligação e normalização

-- Interruptor da camada pública [rev. R-M14: o lockdown põe 'off']. Nasce desligado: o Super Admin liga-o em
-- Definições depois de testar a ligação à Meta. Desligado, o tick não lê e ninguém autoriza nem confirma; parar e
-- apagar funciona sempre.
alter table public.ldo_cr_settings
  add column public_mode text not null default 'off' check (public_mode in ('off', 'on'));

-- Estado da ligação à Meta (uma linha): pausa (limite pedido pela Meta, ou erro de token, de configuração ou erros
-- temporários seguidos), último erro (a classe e o código da Meta, nunca a resposta), último pedido certo, uso da app
-- e o último aviso aos Super Admin. Só as funções do dono lhe tocam.
create table ldo_private.cr_public_state (
  id integer primary key check (id = 1),
  paused_until timestamptz,
  last_error text check (last_error is null or last_error in ('limit', 'temporary', 'config', 'token')),
  last_code integer,
  last_error_at timestamptz,
  last_ok_at timestamptz,
  usage_pct integer check (usage_pct is null or usage_pct between 0 and 1000),
  alerted_at timestamptz
);
insert into ldo_private.cr_public_state (id) values (1);
alter table ldo_private.cr_public_state enable row level security;
revoke all on ldo_private.cr_public_state from public, anon, authenticated;

-- A A nunca põe 'public' (em produção têm de ser 0; confirmar antes de aplicar): uma que existisse ficaria sem estado
-- nem autorização, por isso volta a declared.
update public.ldo_cr_social_accounts set verification = 'declared', updated_at = now() where verification = 'public';

-- Códigos para a biografia (autorizar e «Gerar um código novo»): um kind próprio em ldo_cr_attempts, contado por
-- cr_public_code_quota; as confirmações continuam em public_proof. O check da A tem o nome que o Postgres lhe deu
-- (<tabela>_<coluna>_check; confirmar antes de aplicar, README). As migrações seguintes que mudem este check mantêm
-- 'public_code'.
alter table public.ldo_cr_attempts drop constraint ldo_cr_attempts_kind_check;
alter table public.ldo_cr_attempts add constraint ldo_cr_attempts_kind_check check (kind in ('login_fail', 'register', 'reset',
  'reauth_fail', 'upload', 'request', 'message', 'export', 'iban_resend', 'public_proof', 'public_code'));

-- ---------------------------------------------------------------- 2. tabelas

-- Todas penduradas em ldo_cr_social_accounts com on delete cascade: apagar a conta em Redes ou anonimizar a conta
-- (cr_anonymize apaga ldo_cr_social_accounts) apaga também tudo o que foi lido.

-- Camada pública de uma conta Instagram (uma linha por conta autorizada). proof: à espera do código na biografia;
-- active: posse provada, leitura periódica; error: a Meta deixou de devolver a conta (deixou de ser profissional ou o
-- @ mudou no Instagram), nova tentativa semanal. A autorização é a de ldo_cr_consents (platform_public, context {}).
-- attempts: falhas seguidas do mesmo tipo; last_error_at: início dessa série (no estado error, desde quando).
create table public.ldo_cr_public_accounts (
  account_id uuid primary key references public.ldo_cr_social_accounts (id) on delete cascade,
  state text not null default 'proof' check (state in ('proof', 'active', 'error')),
  proof_code text check (proof_code is null or proof_code ~ '^LDO-[2-9A-HJ-NP-Z]{6}$'),
  proof_expires_at timestamptz,
  ig_user_id text check (ig_user_id is null or ig_user_id ~ '^[0-9]{5,30}$'),   -- se mudar, o @ é de outra conta
  consented_at timestamptz not null default now(),
  verified_at timestamptz,
  next_at timestamptz,
  lease_until timestamptz,
  attempts integer not null default 0,
  last_read_at timestamptz,
  last_error text check (last_error is null or last_error in ('not_found', 'temporary')),
  last_error_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((state = 'proof') = (proof_code is not null and proof_expires_at is not null)),
  check (state = 'proof' or (ig_user_id is not null and verified_at is not null and next_at is not null))
);
create index ldo_cr_public_accounts_due_idx on public.ldo_cr_public_accounts (next_at) where state <> 'proof';

-- Seguidores e número de publicações, um registo por conta e por dia de Lisboa (ler duas vezes no dia substitui).
create table public.ldo_cr_public_snapshots (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.ldo_cr_public_accounts (account_id) on delete cascade,
  taken_on date not null default ((now() at time zone 'Europe/Lisbon')::date),
  taken_at timestamptz not null default now(),
  followers integer check (followers is null or followers between 0 and 2000000000),
  media_count integer check (media_count is null or media_count >= 0),
  unique (account_id, taken_on)
);
create index ldo_cr_public_snapshots_taken_idx on public.ldo_cr_public_snapshots (taken_on);

-- Números por publicação (os últimos lidos). Sem imagens, URLs, legendas nem texto: só o id, a data e o tipo.
-- null = a Meta não devolveu o campo (gostos escondidos), nunca 0. As visualizações só se guardam nos reels (a
-- autorização fala em «visualizações de reels»): noutro tipo ficam null, mesmo que a Meta as devolva.
create table public.ldo_cr_public_media (
  account_id uuid not null references public.ldo_cr_public_accounts (account_id) on delete cascade,
  media_id text not null check (media_id ~ '^[0-9]{5,30}$'),
  posted_at timestamptz not null,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')),
  product_type text check (product_type is null or product_type in ('FEED', 'REELS', 'STORY', 'AD')),
  like_count bigint check (like_count is null or like_count >= 0),
  comments_count bigint check (comments_count is null or comments_count >= 0),
  view_count bigint check (view_count is null or view_count >= 0),
  read_at timestamptz not null default now(),
  primary key (account_id, media_id)
);
create index ldo_cr_public_media_posted_idx on public.ldo_cr_public_media (account_id, posted_at desc);
create index ldo_cr_public_media_window_idx on public.ldo_cr_public_media (posted_at);

alter table public.ldo_cr_public_accounts enable row level security;
alter table public.ldo_cr_public_snapshots enable row level security;
alter table public.ldo_cr_public_media enable row level security;
revoke all on public.ldo_cr_public_accounts, public.ldo_cr_public_snapshots, public.ldo_cr_public_media
  from anon, authenticated;

-- ---------------------------------------------------------------- 3. auxiliares (ldo_private)

-- Autorização em vigor: o último registo de platform_public sem contexto.
create function ldo_private.cr_public_granted(p_creator uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.granted from public.ldo_cr_consents c
    where c.creator_id = p_creator and c.purpose = 'platform_public' and c.context = '{}'::jsonb
    order by c.id desc limit 1), false);
$$;

-- Código para a biografia: «LDO-» e 6 caracteres sem 0, 1, I nem O, que se confundem ao copiar (32 símbolos: 256 é
-- múltiplo de 32, por isso o resto não enviesa nenhum).
create function ldo_private.cr_public_code() returns text
language sql volatile set search_path = '' as $$
  select 'LDO-' || string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', get_byte(x.b, i) % 32 + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(6) as b) x cross join generate_series(0, 5) as i;
$$;

-- Limite dos códigos: no máximo 5 por pessoa em 24 h, entre autorizações e códigos novos. Sem ele, dava para gerar
-- códigos sem fim até um coincidir com um antigo esquecido na biografia de outra pessoa (a procura não faz pedidos à
-- Meta), e cada ciclo autorizar → parar deixava registos que não se apagam. Parar não tem limite. Recusa (22023)
-- antes de gravar; dois pedidos seguidos não passam ambos o limite.
create function ldo_private.cr_public_code_quota(p_creator uuid, p_ip_hash text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('ldo_cr_public_code:' || p_creator::text, 0));
  if (select count(*) from public.ldo_cr_attempts where kind = 'public_code' and creator_id = p_creator
      and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Já pediu 5 códigos nas últimas 24 horas. Tente de novo amanhã.' using errcode = '22023';
  end if;
  insert into public.ldo_cr_attempts (kind, ip_hash, creator_id) values ('public_code', ldo_private.cr_ip(p_ip_hash), p_creator);
end;
$$;

-- Inteiro não negativo de um valor JSON (gostos, comentários, visualizações) ou null: ausente, texto, decimal ou
-- negativo não dá erro nem 0 (o tipo é visto antes da conversão).
create function ldo_private.cr_public_int(p jsonb) returns bigint
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'number' then
    case when (p #>> '{}')::numeric between 0 and 1000000000000
      and (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric) then (p #>> '{}')::numeric::bigint end end;
$$;

-- Fim da camada pública de uma conta: apaga o estado, as leituras e as publicações (cascade), devolve a conta a
-- «Não verificado» e regista a retirada de platform_public (a autorização nomeava o @). A origem vai no text_shown,
-- nunca no context [rev. R-M5]; a auditoria leva só o motivo [rev. R-A1]. p_why: creator | staff | handle | delete |
-- other_account | proof_expired | not_found | erase. Devolve se havia alguma coisa a parar.
-- Bloqueia primeiro a conta social e só depois a linha pública, a ordem de todas as funções que mexem nas duas
-- (ldo_cr_public_stop, cr_social_upsert, ldo_cr_social_delete, ldo_cr_public_confirm, ldo_cr_public_put): com a ordem
-- trocada, um «Parar» ao mesmo tempo que a limpeza diária ou que uma leitura podia acabar num deadlock.
create function ldo_private.cr_public_purge(p_account uuid, p_creator uuid, p_why text, p_text text, p_ip_hash text,
  p_staff uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_found boolean;
begin
  perform 1 from public.ldo_cr_social_accounts where id = p_account for update;
  delete from public.ldo_cr_public_accounts where account_id = p_account;
  v_found := found;
  update public.ldo_cr_social_accounts set verification = 'declared', updated_at = now()
  where id = p_account and verification = 'public';
  v_found := v_found or found;
  if (v_found or p_why in ('creator', 'staff', 'erase')) and ldo_private.cr_public_granted(p_creator) then
    perform ldo_private.cr_consent(p_creator, 'platform_public', false, null, null,
      coalesce(nullif(btrim(coalesce(p_text, '')), ''), case p_why
        when 'creator' then 'Leitura dos dados públicos parada pela própria pessoa, em Redes. Os dados lidos foram apagados.'
        when 'staff' then 'Retirado a pedido do titular, num pedido registado pela equipa. Os dados lidos foram apagados.'
        when 'handle' then 'Leitura dos dados públicos parada pela plataforma: o @ ou a rede da conta do Instagram mudou em Redes. Os dados lidos foram apagados.'
        when 'delete' then 'Leitura dos dados públicos parada ao apagar a conta do Instagram em Redes. Os dados lidos foram apagados.'
        when 'other_account' then 'Leitura dos dados públicos parada pela plataforma: o @ passou a corresponder a outra conta do Instagram. Os dados lidos foram apagados.'
        when 'proof_expired' then 'Autorização terminada pela plataforma: a conta não foi confirmada com o código na biografia em 30 dias. Nada foi guardado.'
        when 'not_found' then 'Leitura dos dados públicos terminada pela plataforma: a Meta não devolveu a conta durante 90 dias. Os dados lidos foram apagados.'
        when 'erase' then 'Retirado ao pedir o apagamento da conta (colaboração a decorrer).'
        else 'Leitura dos dados públicos parada pela plataforma. Os dados lidos foram apagados.' end), p_ip_hash);
    v_found := true;
  end if;
  if v_found then
    perform ldo_private.cr_log(case when p_why = 'creator' then 'creator' when p_staff is not null then 'staff' else 'system' end,
      p_staff, p_creator, 'public.stop', p_account, jsonb_build_object('why', p_why));
  end if;
  return v_found;
end;
$$;

-- ---------------------------------------------------------------- 4. site (p_token + p_session)

-- Estado da camada pública para /redes e /painel. account: a conta Instagram declarada (há no máximo uma), com o
-- estado (null sem autorização), o código enquanto espera, a última leitura, as últimas 30 leituras e as 25
-- publicações mais recentes (sem o id da Meta): o mesmo que a equipa vê na ficha (ldo_cr_public_creator), como diz a
-- autorização. proof_left: confirmações que ainda pode tentar nas próximas 24 h. Abre com Termos por aceitar, conta
-- suspensa ou limitada (cr_creator_require false): é daqui que se chega a «Parar a leitura».
create function public.ldo_cr_public_get(p_token text, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  return jsonb_build_object(
    'mode', (select public_mode from public.ldo_cr_settings where id = 1),
    'paused', exists (select 1 from ldo_private.cr_public_state where id = 1 and paused_until > now()),
    'granted', ldo_private.cr_public_granted(v_id),
    'proof_left', greatest(0, 5 - (select count(*) from public.ldo_cr_attempts where kind = 'public_proof'
      and creator_id = v_id and created_at > now() - interval '24 hours')),
    'account', (select jsonb_build_object('account_id', a.id, 'handle', a.handle, 'verification', a.verification,
        'state', p.state, 'code', p.proof_code, 'code_expires_at', p.proof_expires_at, 'consented_at', p.consented_at,
        'verified_at', p.verified_at, 'last_read_at', p.last_read_at, 'next_at', p.next_at, 'last_error', p.last_error,
        'last_error_at', p.last_error_at,
        'snapshot', (select jsonb_build_object('taken_on', s.taken_on, 'taken_at', s.taken_at, 'followers', s.followers,
            'media_count', s.media_count)
          from public.ldo_cr_public_snapshots s where s.account_id = a.id order by s.taken_on desc limit 1),
        'history', coalesce((select jsonb_agg(jsonb_build_object('taken_on', s.taken_on, 'taken_at', s.taken_at,
            'followers', s.followers, 'media_count', s.media_count) order by s.taken_on desc)
          from (select * from public.ldo_cr_public_snapshots where account_id = a.id order by taken_on desc limit 30) s), '[]'::jsonb),
        'media', coalesce((select jsonb_agg(jsonb_build_object('posted_at', m.posted_at, 'media_type', m.media_type,
            'product_type', m.product_type, 'like_count', m.like_count, 'comments_count', m.comments_count,
            'view_count', m.view_count, 'read_at', m.read_at) order by m.posted_at desc)
          from (select * from public.ldo_cr_public_media where account_id = a.id order by posted_at desc limit 25) m), '[]'::jsonb))
      from public.ldo_cr_social_accounts a left join public.ldo_cr_public_accounts p on p.account_id = a.id
      where a.creator_id = v_id and a.platform = 'instagram' limit 1));
end;
$$;

-- «Autorizar a leitura» (Redes). O texto vem de CONSENT_TEXT no servidor [rev. R-B1] e tem de nomear o @ desta conta
-- (corrida com uma edição do @). Grava platform_public = true (context {} e sem documento: o texto e o hash bastam
-- como prova, e ligá-la à Política inflacionava o accepted_count de ldo_cr_legal_list), cria o estado proof e devolve
-- o código, válido 7 dias. Recusa: leitura desligada, conta que não é do Instagram ou com um @ que o Instagram não
-- aceita, conta já autorizada, ou mais de 5 códigos em 24 h (cr_public_code_quota). Um @ já provado por outra conta
-- da plataforma não se recusa aqui: dizê-lo a quem só o declarou revelava que essa pessoa está inscrita e autorizou
-- (dava para o perguntar sobre qualquer @). A recusa fica na confirmação (taken), a que só chega quem tem o código na
-- biografia; a autorização de quem não é dono fica em proof e termina na limpeza (proof_expired).
create function public.ldo_cr_public_start(p_token text, p_session text, p_account uuid, p_text text, p_ip_hash text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_a public.ldo_cr_social_accounts;
  v_code text;
  v_until timestamptz := now() + interval '7 days';
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, true);      -- recusa suspensa, limitada e Termos por aceitar
  perform ldo_private.cr_own(v_id, 'social_account', p_account);
  if (select public_mode from public.ldo_cr_settings where id = 1) is distinct from 'on' then
    raise exception 'A leitura dos dados públicos está desligada de momento. Tente mais tarde.' using errcode = '22023';
  end if;
  select * into v_a from public.ldo_cr_social_accounts where id = p_account for update;
  if v_a.platform <> 'instagram' then
    raise exception 'Só as contas do Instagram têm leitura dos dados públicos.' using errcode = '22023';
  end if;
  if lower(v_a.handle) !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'Este @ não é um nome de utilizador válido do Instagram (letras, números, ponto e _, até 30). Corrija-o em Contas declaradas.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ldo_cr_public_accounts where account_id = p_account) then
    raise exception 'Já autorizou a leitura desta conta.' using errcode = '22023';
  end if;
  if strpos(coalesce(p_text, ''), '(@' || v_a.handle || ')') = 0 then
    raise exception 'O texto da autorização não corresponde ao @ da conta. Recarregue a página.' using errcode = '22023';
  end if;
  perform ldo_private.cr_public_code_quota(v_id, p_ip_hash);
  perform ldo_private.cr_consent(v_id, 'platform_public', true, null, null, p_text, p_ip_hash);
  v_code := ldo_private.cr_public_code();
  insert into public.ldo_cr_public_accounts (account_id, state, proof_code, proof_expires_at)
  values (p_account, 'proof', v_code, v_until);
  perform ldo_private.cr_log('creator', null, v_id, 'public.start', p_account, '{}'::jsonb);
  return jsonb_build_object('state', 'proof', 'code', v_code, 'expires_at', v_until);
end;
$$;

-- Código novo (o anterior expirou ou a pessoa quer outro). Sem consentimento nem auditoria: a autorização é a mesma.
-- Conta para o limite de cr_public_code_quota.
create function public.ldo_cr_public_renew(p_token text, p_session text, p_account uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_p public.ldo_cr_public_accounts;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, true);
  perform ldo_private.cr_own(v_id, 'social_account', p_account);
  if (select public_mode from public.ldo_cr_settings where id = 1) is distinct from 'on' then
    raise exception 'A leitura dos dados públicos está desligada de momento. Tente mais tarde.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ldo_cr_public_accounts where account_id = p_account and state = 'proof') then
    raise exception 'Esta conta já não está à espera de confirmação. Recarregue a página.' using errcode = '22023';
  end if;
  perform ldo_private.cr_public_code_quota(v_id, null);
  update public.ldo_cr_public_accounts set proof_code = ldo_private.cr_public_code(),
    proof_expires_at = now() + interval '7 days', updated_at = now()
  where account_id = p_account and state = 'proof'
  returning * into v_p;
  if v_p.account_id is null then
    raise exception 'Esta conta já não está à espera de confirmação. Recarregue a página.' using errcode = '22023';
  end if;
  return jsonb_build_object('state', 'proof', 'code', v_p.proof_code, 'expires_at', v_p.proof_expires_at);
end;
$$;

-- Reserva uma tentativa de confirmação antes de a aplicação pedir a biografia à Meta: no máximo 5 em 24 h por pessoa
-- [C1]. As recusas devolvem {ok:false, reason} sem raise, para a tentativa ficar gravada. Devolve o @ e o código
-- (lidos da BD, nunca do browser), quantas tentativas sobram e o id da tentativa (attempt), que a aplicação devolve
-- com ldo_cr_public_proof_refund quando a falha é do lado da Meta ou da Loja do Ouro.
create function public.ldo_cr_public_proof(p_token text, p_session text, p_account uuid, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_p public.ldo_cr_public_accounts;
  v_n integer;
  v_attempt bigint;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, true);
  perform ldo_private.cr_own(v_id, 'social_account', p_account);
  if (select public_mode from public.ldo_cr_settings where id = 1) is distinct from 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  select * into v_p from public.ldo_cr_public_accounts where account_id = p_account;
  if v_p.account_id is null or v_p.state <> 'proof' then
    return jsonb_build_object('ok', false, 'reason', 'state');
  end if;
  if v_p.proof_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if exists (select 1 from ldo_private.cr_public_state where id = 1 and paused_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'busy');     -- a pausa da Meta não gasta tentativas
  end if;
  -- Dois cliques seguidos não passam ambos o limite.
  perform pg_advisory_xact_lock(hashtextextended('ldo_cr_public_proof:' || v_id::text, 0));
  select count(*) into v_n from public.ldo_cr_attempts where kind = 'public_proof' and creator_id = v_id
    and created_at > now() - interval '24 hours';
  if v_n >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;
  insert into public.ldo_cr_attempts (kind, ip_hash, creator_id) values ('public_proof', ldo_private.cr_ip(p_ip_hash), v_id)
  returning id into v_attempt;
  return jsonb_build_object('ok', true, 'handle', (select handle from public.ldo_cr_social_accounts where id = p_account),
    'code', v_p.proof_code, 'left', 4 - v_n, 'attempt', v_attempt);
end;
$$;

-- Devolve a tentativa reservada por ldo_cr_public_proof quando o pedido à Meta falhou sem culpa da pessoa (limite,
-- token, configuração, erro temporário ou sem resposta): com a Meta em baixo, cada clique gastava uma das 5 do dia.
-- Só uma tentativa public_proof do próprio criador e dos últimos 10 minutos. A conta não profissional (not_found) e o
-- código em falta contam.
create function public.ldo_cr_public_proof_refund(p_token text, p_session text, p_attempt bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  delete from public.ldo_cr_attempts where id = p_attempt and kind = 'public_proof' and creator_id = v_id
    and created_at > now() - interval '10 minutes';
  return jsonb_build_object('refunded', found);
end;
$$;

-- A aplicação só chama esta função quando encontrou o código na biografia (que não guarda). Confirma que nada mudou
-- entretanto (o @, o código, a validade, o interruptor), passa a conta a 'public' e o estado a active, com a primeira
-- leitura no tick seguinte. Outra pessoa já com o @ provado → taken (índice ldo_cr_social_verified_uniq).
create function public.ldo_cr_public_confirm(p_token text, p_session text, p_account uuid, p_handle text, p_code text,
  p_ig_user_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_a public.ldo_cr_social_accounts;
  v_p public.ldo_cr_public_accounts;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, true);
  perform ldo_private.cr_own(v_id, 'social_account', p_account);
  if coalesce(p_ig_user_id, '') !~ '^[0-9]{5,30}$' then
    raise exception 'Identificador do Instagram inválido.' using errcode = '22023';
  end if;
  if (select public_mode from public.ldo_cr_settings where id = 1) is distinct from 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  select * into v_a from public.ldo_cr_social_accounts where id = p_account for update;
  select * into v_p from public.ldo_cr_public_accounts where account_id = p_account for update;
  if v_p.account_id is null or v_p.state <> 'proof' or v_p.proof_code is distinct from p_code
     or lower(v_a.handle) is distinct from lower(coalesce(p_handle, '')) then
    return jsonb_build_object('ok', false, 'reason', 'changed');
  end if;
  if v_p.proof_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  begin
    update public.ldo_cr_social_accounts set verification = 'public', updated_at = now() where id = p_account;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;
  update public.ldo_cr_public_accounts set state = 'active', proof_code = null, proof_expires_at = null,
    ig_user_id = p_ig_user_id, verified_at = now(), next_at = now(), attempts = 0, last_error = null,
    last_error_at = null, updated_at = now()
  where account_id = p_account;
  perform ldo_private.cr_log('creator', null, v_id, 'public.verified', p_account, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- «Parar a leitura e apagar os dados públicos» (Redes): retirar o consentimento (art. 7.º, n.º 3) é tão fácil como
-- dá-lo e nunca é bloqueado (conta suspensa, limitada ou com Termos por aceitar), nem com a leitura desligada. O
-- apagamento é o DELETE desta transação, não a limpeza diária. p_text = o mesmo texto de CONSENT_TEXT, gravado com
-- granted = false. Como a exportação, fica um pedido RGPD self_service já concluído (art. 5.º, n.º 2).
create function public.ldo_cr_public_stop(p_token text, p_session text, p_account uuid, p_text text, p_ip_hash text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_done boolean;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  perform ldo_private.cr_own(v_id, 'social_account', p_account);
  if coalesce(btrim(p_text), '') = '' then
    raise exception 'Falta o texto da autorização.' using errcode = '22023';
  end if;
  perform 1 from public.ldo_cr_social_accounts where id = p_account for update;
  v_done := ldo_private.cr_public_purge(p_account, v_id, 'creator', p_text, p_ip_hash, null);
  if v_done then
    insert into public.ldo_cr_privacy_requests (creator_id, kind, channel, status, handled_at, response)
    values (v_id, 'withdrawal', 'self_service', 'done', now(),
      'Leitura dos dados públicos do Instagram parada e dados lidos apagados pela própria pessoa.');
  end if;
  return jsonb_build_object('ok', true, 'stopped', v_done);
end;
$$;

-- ---------------------------------------------------------------- 5. servidor (tick: só p_token)

-- Contas a ler agora (o mesmo padrão de ldo_cr_outbox_claim): interruptor ligado, sem pausa da Meta, posse provada,
-- autorização em vigor e criador sem limitação (art. 18.º) nem suspensão (enquanto durar, os números não fazem falta).
-- Reserva-as 3 minutos (lease).
create function public.ldo_cr_public_claim(p_token text, p_limit integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_lease timestamptz := now() + interval '3 minutes';
  v_out jsonb;
begin
  perform ldo_private.cr_server_check(p_token);
  if (select public_mode from public.ldo_cr_settings where id = 1) is distinct from 'on'
     or exists (select 1 from ldo_private.cr_public_state where id = 1 and paused_until > now()) then
    return '[]'::jsonb;
  end if;
  -- (Um WITH que altera dados tem de estar no topo da instrução.)
  with picked as (
    select p.account_id from public.ldo_cr_public_accounts p
    join public.ldo_cr_social_accounts a on a.id = p.account_id
    join public.ldo_cr_creators c on c.id = a.creator_id
    where p.state in ('active', 'error') and p.next_at <= now()
      and (p.lease_until is null or p.lease_until < now())
      and a.platform = 'instagram' and a.verification = 'public'
      and c.deleted_at is null and c.status <> 'restricted' and c.status <> 'suspended'
      and ldo_private.cr_public_granted(c.id)
    order by p.next_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update of p skip locked
  ), upd as (
    update public.ldo_cr_public_accounts p set lease_until = v_lease from picked
    where p.account_id = picked.account_id returning p.account_id, p.ig_user_id
  )
  select jsonb_agg(jsonb_build_object('account_id', u.account_id, 'handle', a.handle, 'ig_user_id', u.ig_user_id,
    'lease', v_lease))
  into v_out
  from upd u join public.ldo_cr_social_accounts a on a.id = u.account_id;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;

-- Grava uma leitura certa. p_media: lista já normalizada pela aplicação ([{media_id, posted_at («…Z»), media_type,
-- product_type, like_count, comments_count, view_count}]); a BD volta a confirmar tudo e ignora o que não servir
-- (as visualizações fora dos reels incluídas). Sem o lease certo (parada ou apagada entretanto) nada se grava. O @
-- que passou a ser de outra conta do Instagram (o id mudou) para a leitura e apaga o que foi lido, sem gravar nada
-- desta. Sem auditoria em cada leitura: o estado da conta chega (minimização). Leitura diária; semanal sem atividade
-- na plataforma há mais de 90 dias (o critério da inatividade da A). Bloqueia a conta social antes da linha pública
-- (a ordem de cr_public_purge, que o ramo other_account chama).
create function public.ldo_cr_public_put(p_token text, p_account uuid, p_lease timestamptz, p_ig_user_id text,
  p_followers integer, p_media_count integer, p_media jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_p public.ldo_cr_public_accounts;
  v_a public.ldo_cr_social_accounts;
  v_c public.ldo_cr_creators;
  v_since timestamptz;
  v_item jsonb;
  v_at timestamptz;
begin
  perform ldo_private.cr_server_check(p_token);
  if coalesce(p_ig_user_id, '') !~ '^[0-9]{5,30}$' or p_followers < 0 or p_followers > 2000000000 or p_media_count < 0
     or (p_media is not null and jsonb_typeof(p_media) <> 'array') then
    raise exception 'Leitura inválida.' using errcode = '22023';
  end if;
  select * into v_a from public.ldo_cr_social_accounts where id = p_account for update;
  select * into v_p from public.ldo_cr_public_accounts where account_id = p_account and lease_until = p_lease for update;
  if v_p.account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'lease');
  end if;
  select * into v_c from public.ldo_cr_creators where id = v_a.creator_id;
  if v_a.verification is distinct from 'public' or v_c.deleted_at is not null or v_c.status in ('restricted', 'suspended')
     or not ldo_private.cr_public_granted(v_c.id) then
    update public.ldo_cr_public_accounts set lease_until = null where account_id = p_account;
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if p_ig_user_id <> v_p.ig_user_id then
    perform ldo_private.cr_public_purge(p_account, v_c.id, 'other_account', null, null, null);
    perform ldo_private.cr_outbox(v_c.id, 'public_stopped', jsonb_build_object('reason', 'other_account'));
    return jsonb_build_object('ok', false, 'reason', 'other_account');
  end if;
  v_since := now() - make_interval(months => coalesce(ldo_private.cr_ret(
    (select retention from public.ldo_cr_settings where id = 1), 'platform_months'), 24));
  insert into public.ldo_cr_public_snapshots (account_id, followers, media_count) values (p_account, p_followers, p_media_count)
  on conflict (account_id, taken_on) do update set followers = excluded.followers, media_count = excluded.media_count,
    taken_at = now();
  for v_item in select e from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) e limit 50 loop
    continue when jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item ->> 'media_id', '') !~ '^[0-9]{5,30}$'
      or coalesce(v_item ->> 'media_type', '') not in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')
      or coalesce(v_item ->> 'posted_at', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?Z$';
    v_at := (v_item ->> 'posted_at')::timestamptz;
    continue when v_at < v_since or v_at > now() + interval '1 day';
    insert into public.ldo_cr_public_media (account_id, media_id, posted_at, media_type, product_type, like_count,
      comments_count, view_count)
    values (p_account, v_item ->> 'media_id', v_at, v_item ->> 'media_type',
      case when v_item ->> 'product_type' in ('FEED', 'REELS', 'STORY', 'AD') then v_item ->> 'product_type' end,
      ldo_private.cr_public_int(v_item -> 'like_count'), ldo_private.cr_public_int(v_item -> 'comments_count'),
      case when v_item ->> 'product_type' = 'REELS' then ldo_private.cr_public_int(v_item -> 'view_count') end)
    on conflict (account_id, media_id) do update set posted_at = excluded.posted_at, media_type = excluded.media_type,
      product_type = excluded.product_type, like_count = excluded.like_count, comments_count = excluded.comments_count,
      view_count = excluded.view_count, read_at = now();
  end loop;
  -- A janela de platform_months aplica-se já aqui à conta lida (a limpeza diária trata das que deixaram de ser lidas).
  delete from public.ldo_cr_public_media where account_id = p_account and posted_at < v_since;
  update public.ldo_cr_public_accounts set state = 'active', lease_until = null, attempts = 0, last_read_at = now(),
    last_error = null, last_error_at = null, updated_at = now(),
    next_at = now() + case when coalesce(v_c.last_login_at, v_c.created_at) < now() - interval '90 days'
                           then interval '7 days' else interval '1 day' end
  where account_id = p_account;
  return jsonb_build_object('ok', true);
end;
$$;

-- Leitura falhada por causa da conta: not_found (a Meta não a devolve: não é profissional ou o @ mudou no Instagram)
-- ou temporary. Os números já lidos ficam (a autorização continua em vigor e a janela de 24 meses aplica-se).
-- - active: falhas seguidas do mesmo tipo em attempts; temporary volta 1 a 6 h depois; not_found 12 h depois e, à 4.ª
--   seguida (cerca de 2 dias), passa a error, com o aviso public_error ao criador;
-- - error: nova tentativa semanal; o erro e o início dele (last_error_at) ficam. 90 dias depois, a limpeza diária
--   termina a autorização (cr_retention).
-- Um erro de limite, de token ou de configuração não é da conta: vai para ldo_cr_public_health.
create function public.ldo_cr_public_fail(p_token text, p_account uuid, p_lease timestamptz, p_error text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_p public.ldo_cr_public_accounts;
  v_creator uuid;
  v_n integer;
begin
  perform ldo_private.cr_server_check(p_token);
  if coalesce(p_error, '') not in ('not_found', 'temporary') then
    raise exception 'Erro de leitura inválido.' using errcode = '22023';
  end if;
  select * into v_p from public.ldo_cr_public_accounts where account_id = p_account and lease_until = p_lease for update;
  if v_p.account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'lease');
  end if;
  if v_p.state = 'error' then
    update public.ldo_cr_public_accounts set attempts = attempts + 1, lease_until = null,
      next_at = now() + interval '7 days', updated_at = now()
    where account_id = p_account;
    return jsonb_build_object('ok', true, 'state', 'error');
  end if;
  v_n := case when v_p.last_error is distinct from p_error then 1 else v_p.attempts + 1 end;
  if p_error = 'not_found' and v_n >= 4 then
    select creator_id into v_creator from public.ldo_cr_social_accounts where id = p_account;
    update public.ldo_cr_public_accounts set state = 'error', attempts = v_n, lease_until = null, last_error = 'not_found',
      last_error_at = coalesce(v_p.last_error_at, now()), next_at = now() + interval '7 days', updated_at = now()
    where account_id = p_account;
    perform ldo_private.cr_outbox(v_creator, 'public_error', '{}'::jsonb);
    perform ldo_private.cr_log('system', null, v_creator, 'public.error', p_account, jsonb_build_object('error', 'not_found'));
    return jsonb_build_object('ok', true, 'state', 'error');
  end if;
  update public.ldo_cr_public_accounts set attempts = v_n, lease_until = null, last_error = p_error,
    last_error_at = case when v_n = 1 then now() else coalesce(last_error_at, now()) end,
    next_at = now() + case when p_error = 'not_found' then interval '12 hours' else make_interval(hours => least(v_n, 6)) end,
    updated_at = now()
  where account_id = p_account;
  return jsonb_build_object('ok', true, 'state', v_p.state);
end;
$$;

-- Estado global da ligação, gravado pelo tick, pela confirmação e pelo teste da ligação. p_kind: ok | limit |
-- temporary | config | token; p_code: o código de erro da Meta (não é dado pessoal e ajuda a diagnosticar); p_minutes:
-- a pausa pedida (5 min a 24 h; a Meta diz quando volta a aceitar pedidos); p_usage: o maior uso da app em %.
-- Um pedido certo acaba com a pausa de um erro de token, de configuração ou temporário (o problema foi resolvido); a
-- de limite fica até ao fim. alert: avisar os Super Admin (token ou configuração), no máximo uma vez por 24 h.
create function public.ldo_cr_public_health(p_token text, p_kind text, p_code integer, p_minutes integer, p_usage integer)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s ldo_private.cr_public_state;
  v_usage integer := case when p_usage is null then null else least(greatest(p_usage, 0), 1000) end;
  v_alert boolean := false;
begin
  perform ldo_private.cr_server_check(p_token);
  if coalesce(p_kind, '') not in ('ok', 'limit', 'temporary', 'config', 'token') then
    raise exception 'Estado da ligação inválido.' using errcode = '22023';
  end if;
  select * into v_s from ldo_private.cr_public_state where id = 1 for update;
  if p_kind = 'ok' then
    update ldo_private.cr_public_state set last_ok_at = now(), usage_pct = coalesce(v_usage, usage_pct),
      paused_until = case when last_error = 'limit' then paused_until end
    where id = 1;
  else
    v_alert := p_kind in ('config', 'token') and (v_s.last_error is distinct from p_kind or v_s.alerted_at is null
      or v_s.alerted_at < now() - interval '24 hours');
    update ldo_private.cr_public_state set last_error = p_kind, last_code = p_code, last_error_at = now(),
      usage_pct = coalesce(v_usage, usage_pct),
      paused_until = greatest(coalesce(paused_until, now()),
        now() + make_interval(mins => greatest(5, least(coalesce(p_minutes, 60), 1440)))),
      alerted_at = case when v_alert then now() else alerted_at end
    where id = 1;
  end if;
  return jsonb_build_object('alert', v_alert);
end;
$$;

-- ---------------------------------------------------------------- 6. equipa (p_session do dashboard)

-- Bloco «Dados públicos» da ficha (separador Redes). A página chama-a depois de ldo_cr_creator_get, que já regista
-- creator.view. Sem o código da biografia (só a validade). history: as últimas 30 leituras; media: as 25 publicações
-- mais recentes, sem o id da Meta: o mesmo que o criador vê em Redes (ldo_cr_public_get), como diz a autorização.
create function public.ldo_cr_public_creator(p_session text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'view');
begin
  if not exists (select 1 from public.ldo_cr_creators where id = p_id) then
    raise exception 'Criador não encontrado.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'mode', (select public_mode from public.ldo_cr_settings where id = 1),
    'granted', ldo_private.cr_public_granted(p_id),
    'account', (select jsonb_build_object('account_id', a.id, 'handle', a.handle, 'verification', a.verification,
        'state', p.state, 'code_expires_at', p.proof_expires_at, 'consented_at', p.consented_at,
        'verified_at', p.verified_at, 'last_read_at', p.last_read_at, 'next_at', p.next_at,
        'attempts', coalesce(p.attempts, 0), 'last_error', p.last_error, 'last_error_at', p.last_error_at,
        'history', coalesce((select jsonb_agg(jsonb_build_object('taken_on', s.taken_on, 'taken_at', s.taken_at,
            'followers', s.followers, 'media_count', s.media_count) order by s.taken_on desc)
          from (select * from public.ldo_cr_public_snapshots where account_id = a.id order by taken_on desc limit 30) s), '[]'::jsonb),
        'media', coalesce((select jsonb_agg(jsonb_build_object('posted_at', m.posted_at, 'media_type', m.media_type,
            'product_type', m.product_type, 'like_count', m.like_count, 'comments_count', m.comments_count,
            'view_count', m.view_count, 'read_at', m.read_at) order by m.posted_at desc)
          from (select * from public.ldo_cr_public_media where account_id = a.id order by posted_at desc limit 25) m), '[]'::jsonb))
      from public.ldo_cr_social_accounts a left join public.ldo_cr_public_accounts p on p.account_id = a.id
      where a.creator_id = p_id and a.platform = 'instagram' limit 1));
end;
$$;

-- Estado das integrações (visão geral): o interruptor, a ligação à Meta (pausa, último erro, último pedido certo,
-- uso) e quantas contas há em cada estado. overdue: contas que se podiam ler e estão atrasadas mais de um dia.
create function public.ldo_cr_public_status(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'view');
begin
  return (select jsonb_build_object('mode', s.public_mode, 'paused_until', h.paused_until, 'last_error', h.last_error,
      'last_code', h.last_code, 'last_error_at', h.last_error_at, 'last_ok_at', h.last_ok_at, 'usage_pct', h.usage_pct,
      'proof', (select count(*) from public.ldo_cr_public_accounts where state = 'proof'),
      'active', (select count(*) from public.ldo_cr_public_accounts where state = 'active'),
      'error', (select count(*) from public.ldo_cr_public_accounts where state = 'error'),
      'overdue', (select count(*) from public.ldo_cr_public_accounts p
        join public.ldo_cr_social_accounts a on a.id = p.account_id
        join public.ldo_cr_creators c on c.id = a.creator_id
        where p.state <> 'proof' and p.next_at < now() - interval '1 day' and c.deleted_at is null
          and c.status <> 'restricted' and c.status <> 'suspended'))
    from public.ldo_cr_settings s cross join ldo_private.cr_public_state h
    where s.id = 1 and h.id = 1);
end;
$$;

-- Ligar ou desligar a leitura (Super Admin), depois de «Testar a ligação à Meta». Fica nas decisões de 5 anos
-- (settings.save, com o antes e o depois). ldo_cr_settings_save não muda: não lista public_mode, por isso não o altera.
create function public.ldo_cr_public_mode(p_session text, p_mode text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_old text;
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin liga ou desliga a leitura dos dados públicos.' using errcode = '42501';
  end if;
  if coalesce(p_mode, '') not in ('on', 'off') then
    raise exception 'Escolha ligada ou desligada.' using errcode = '22023';
  end if;
  select public_mode into v_old from public.ldo_cr_settings where id = 1 for update;
  if v_old is distinct from p_mode then
    update public.ldo_cr_settings set public_mode = p_mode, updated_at = now(), updated_by = v_me where id = 1;
    perform ldo_private.cr_log('staff', v_me, null, 'settings.save', null, jsonb_build_object(
      'before', jsonb_build_object('public_mode', v_old), 'after', jsonb_build_object('public_mode', p_mode)));
  end if;
  return jsonb_build_object('public_mode', p_mode);
end;
$$;

-- Retirada do consentimento pedida por email (art. 7.º, n.º 3): exige o pedido withdrawal desse criador, aberto e com
-- a identidade confirmada. Não fecha o pedido: a equipa responde em Privacidade (privacy_request_done). Fica
-- privacy.withdrawal com o pedido que a justificou (como privacy.export na ldo_cr_admin_export; art. 5.º, n.º 2),
-- nas decisões de 5 anos; public.stop leva só o motivo [rev. R-A1].
create function public.ldo_cr_public_staff_stop(p_session text, p_id uuid, p_request uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_account uuid;
  v_done boolean;
begin
  if not exists (select 1 from public.ldo_cr_privacy_requests where id = p_request and creator_id = p_id
      and kind = 'withdrawal' and status = 'open' and (identity_checked or channel = 'self_service')) then
    raise exception 'Registe primeiro o pedido de retirada do consentimento e confirme a identidade.' using errcode = '22023';
  end if;
  select id into v_account from public.ldo_cr_social_accounts where creator_id = p_id and platform = 'instagram' for update;
  v_done := ldo_private.cr_public_purge(v_account, p_id, 'staff', null, null, v_me);
  perform ldo_private.cr_log('staff', v_me, p_id, 'privacy.withdrawal', p_request,
    jsonb_build_object('request_id', p_request, 'stopped', v_done));
  return jsonb_build_object('ok', true, 'stopped', v_done);
end;
$$;

-- ---------------------------------------------------------------- 7. funções da A substituídas (mesma assinatura)

-- Conta social declarada pelo criador (cria ou edita) e os números do dia. Usada por ldo_cr_social_save e pelo passo
-- «networks» de ldo_cr_profile_save. [rev. S-B4] Um id recebido passa por cr_own. Uma conta verified não muda de
-- handle nem de plataforma. Num perfil aprovado, uma conta nova ou um @ mudado liga changed_since_review.
-- [3A] Mudar o @ ou a rede de uma conta com a camada pública (em qualquer estado) para a leitura, apaga o que foi lido
-- e retira a autorização, que nomeava o @ antigo (corrige também a mudança de plataforma que a A deixava em 'public').
-- Se o update falhar depois (unique_violation), a transação desfaz também a purga.
create or replace function ldo_private.cr_social_upsert(p_creator uuid, p_data jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_raw_id text := nullif(btrim(coalesce(p_data ->> 'id', '')), '');
  v_platform text := lower(btrim(coalesce(p_data ->> 'platform', '')));
  v_handle text := regexp_replace(btrim(coalesce(p_data ->> 'handle', '')), '^@+', '');
  v_url text := nullif(btrim(coalesce(p_data ->> 'profile_url', '')), '');
  v_m jsonb := p_data -> 'metrics';
  v_old public.ldo_cr_social_accounts;
  v_id uuid;
  v_changed boolean := false;
  v_followers integer;
  v_views integer;
  v_likes integer;
  v_comments integer;
  v_pt numeric;
  v_eng numeric;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Dados da conta inválidos.' using errcode = '22023';
  end if;
  if v_platform not in ('instagram', 'tiktok', 'youtube', 'facebook', 'pinterest', 'outra') then
    raise exception 'Escolha a rede social.' using errcode = '22023';
  end if;
  if v_handle !~ '^[A-Za-z0-9._-]{1,60}$' then
    raise exception 'Escreva o nome de utilizador sem espaços (letras, números, ponto, hífen ou _).' using errcode = '22023';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s]+$' or length(v_url) > 300) then
    raise exception 'O endereço do perfil tem de começar por https://.' using errcode = '22023';
  end if;
  if v_raw_id is not null then
    if v_raw_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Não encontrado.' using errcode = 'P0002';
    end if;
    v_id := v_raw_id::uuid;
    perform ldo_private.cr_own(p_creator, 'social_account', v_id);
    select * into v_old from public.ldo_cr_social_accounts where id = v_id for update;
  else
    select * into v_old from public.ldo_cr_social_accounts where creator_id = p_creator and platform = v_platform for update;
  end if;
  if v_m is not null and jsonb_typeof(v_m) = 'object' then
    begin
      v_followers := nullif(btrim(coalesce(v_m ->> 'followers', '')), '')::integer;
      v_views := nullif(btrim(coalesce(v_m ->> 'avg_views', '')), '')::integer;
      v_likes := nullif(btrim(coalesce(v_m ->> 'avg_likes', '')), '')::integer;
      v_comments := nullif(btrim(coalesce(v_m ->> 'avg_comments', '')), '')::integer;
      v_pt := round(nullif(btrim(coalesce(v_m ->> 'pt_audience_pct', '')), '')::numeric, 2);
      v_eng := round(nullif(btrim(coalesce(v_m ->> 'engagement_pct', '')), '')::numeric, 2);
    exception when others then
      raise exception 'Os números têm de ser números inteiros (as percentagens podem ter casas decimais).' using errcode = '22023';
    end;
    if v_followers not between 0 and 1000000000 or v_views < 0 or v_likes < 0 or v_comments < 0
       or v_pt not between 0 and 100 or v_eng not between 0 and 100 then
      raise exception 'Verifique os números: não podem ser negativos e as percentagens vão de 0 a 100.' using errcode = '22023';
    end if;
  end if;
  if v_old.id is not null then
    if v_old.verification = 'verified' and (v_platform <> v_old.platform or lower(v_handle) <> lower(v_old.handle)) then
      raise exception 'Esta conta está verificada pela ligação ao Instagram: para a mudar, desligue-a primeiro em Redes.' using errcode = '22023';
    end if;
    v_changed := v_platform <> v_old.platform or lower(v_handle) <> lower(v_old.handle);
    if v_changed and (v_old.verification = 'public'
        or exists (select 1 from public.ldo_cr_public_accounts where account_id = v_old.id)) then
      perform ldo_private.cr_public_purge(v_old.id, p_creator, 'handle', null, null, null);
    end if;
    begin
      update public.ldo_cr_social_accounts set platform = v_platform, handle = v_handle, profile_url = v_url,
        verification = case when verification = 'public' and v_changed then 'declared' else verification end,
        updated_at = now()
      where id = v_old.id;
    exception when unique_violation then
      raise exception 'Já tem uma conta declarada nesta rede.' using errcode = '22023';
    end;
    v_id := v_old.id;
  else
    begin
      insert into public.ldo_cr_social_accounts (creator_id, platform, handle, profile_url)
      values (p_creator, v_platform, v_handle, v_url)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Já tem uma conta declarada nesta rede.' using errcode = '22023';
    end;
    v_changed := true;
  end if;
  if coalesce(v_followers, v_views, v_likes, v_comments) is not null or coalesce(v_pt, v_eng) is not null then
    -- Números novos voltam a precisar de validação.
    insert into public.ldo_cr_declared_metrics (account_id, followers, avg_views, avg_likes, avg_comments, pt_audience_pct, engagement_pct)
    values (v_id, v_followers, v_views, v_likes, v_comments, v_pt, v_eng)
    on conflict (account_id, declared_on) do update set followers = excluded.followers, avg_views = excluded.avg_views,
      avg_likes = excluded.avg_likes, avg_comments = excluded.avg_comments, pt_audience_pct = excluded.pt_audience_pct,
      engagement_pct = excluded.engagement_pct, validated_by = null, validated_at = null;
  end if;
  if v_changed then
    update public.ldo_cr_creators set changed_since_review = true where id = p_creator and status = 'approved';
  end if;
  return v_id;
end;
$$;

-- Apagar uma conta declarada (e os números). [rev. S-B4] cr_own. Uma conta verified desliga-se em /redes (3B).
-- [3A] Uma conta Instagram com a camada pública: a cascata já apagava os números lidos, mas a retirada da
-- autorização tem de ficar registada (cr_public_purge).
create or replace function public.ldo_cr_social_delete(p_token text, p_session text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_a public.ldo_cr_social_accounts;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  perform ldo_private.cr_own(v_id, 'social_account', p_id);
  select * into v_a from public.ldo_cr_social_accounts where id = p_id for update;
  if v_a.verification = 'verified' then
    raise exception 'Esta conta está ligada: use «Desligar e apagar os dados» em Redes.' using errcode = '22023';
  end if;
  if v_a.platform = 'instagram' then
    perform ldo_private.cr_public_purge(p_id, v_id, 'delete', null, null, null);
  end if;
  delete from public.ldo_cr_social_accounts where id = p_id;
  update public.ldo_cr_creators set changed_since_review = true where id = v_id and status = 'approved';
  perform ldo_private.cr_log('creator', null, v_id, 'social.delete', p_id, jsonb_build_object('platform', v_a.platform));
end;
$$;

-- [rev. R-M7] Apagamento pedido com uma colaboração a decorrer: apaga já o que só existe por consentimento e não
-- serve a colaboração (art. 17.º, n.º 1, al. b)). [3A] + a camada pública: para a leitura, apaga o que foi lido e
-- retira platform_public. A 3B junta a ligação Meta (platform_instagram) e a análise por IA.
create or replace function ldo_private.cr_erase_optional(p_creator uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if coalesce((ldo_private.cr_consent_state(p_creator) -> 'campaign_news' ->> 'granted')::boolean, false) then
    perform ldo_private.cr_consent(p_creator, 'campaign_news', false, null, null,
      'Retirado ao pedir o apagamento da conta (colaboração a decorrer).', null);
  end if;
  perform ldo_private.cr_public_purge((select a.id from public.ldo_cr_social_accounts a
    where a.creator_id = p_creator and a.platform = 'instagram'), p_creator, 'erase', null, null, null);
end;
$$;

-- [rev. R-M14] Paragem de emergência (§7.5). [3A] Desliga também a leitura dos dados públicos (public_mode = 'off').
-- A 3B junta meta_mode = 'off' e ai_enabled = false.
create or replace function public.ldo_cr_lockdown(p_session text, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_n integer;
begin
  if v_me is null then
    raise exception 'Só o Super Admin pode parar a plataforma.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Indique o motivo.' using errcode = '22023';
  end if;
  update public.ldo_cr_logins set revoked_at = now() where revoked_at is null;
  get diagnostics v_n = row_count;
  update public.ldo_cr_settings set registrations_open = false, public_mode = 'off', updated_at = now(), updated_by = v_me
  where id = 1;
  perform ldo_private.cr_log('staff', v_me, null, 'incident.lockdown', null,
    jsonb_build_object('reason', left(btrim(p_reason), 500), 'sessions_revoked', v_n, 'public_mode', 'off'));
  return jsonb_build_object('sessions_revoked', v_n);
end;
$$;

-- Exportação comum ao próprio (ldo_cr_export) e à equipa (ldo_cr_admin_export): tudo menos os dados financeiros, que
-- cada uma junta à sua maneira [rev. S-M8, R-M9]. [3A] + public_instagram: o estado da camada pública, as leituras
-- (seguidores e publicações por dia) e os números por publicação, sem nada cifrado.
create or replace function ldo_private.cr_export_common(p_creator uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select to_jsonb(c) - 'password_hash' from public.ldo_cr_creators c where c.id = p_creator),
    'profile', (select to_jsonb(p) from public.ldo_cr_profiles p where p.creator_id = p_creator),
    'contacts', (select to_jsonb(k) from public.ldo_cr_contacts k where k.creator_id = p_creator),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name) order by s.name)
      from public.ldo_cr_creator_stores cs join public.ldo_app_stores s on s.id = cs.store_id
      where cs.creator_id = p_creator), '[]'::jsonb),
    'social_accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.platform)
      from public.ldo_cr_social_accounts a where a.creator_id = p_creator), '[]'::jsonb),
    'declared_metrics', coalesce((select jsonb_agg(jsonb_build_object('platform', a.platform, 'handle', a.handle,
        'declared_on', m.declared_on, 'followers', m.followers, 'avg_views', m.avg_views, 'avg_likes', m.avg_likes,
        'avg_comments', m.avg_comments, 'pt_audience_pct', m.pt_audience_pct, 'engagement_pct', m.engagement_pct,
        'validated_at', m.validated_at) order by a.platform, m.declared_on)
      from public.ldo_cr_declared_metrics m join public.ldo_cr_social_accounts a on a.id = m.account_id
      where a.creator_id = p_creator), '[]'::jsonb),
    'public_instagram', (select jsonb_build_object('handle', a.handle, 'state', p.state, 'ig_user_id', p.ig_user_id,
        'consented_at', p.consented_at, 'verified_at', p.verified_at, 'last_read_at', p.last_read_at, 'next_at', p.next_at,
        'readings', coalesce((select jsonb_agg(jsonb_build_object('taken_on', s.taken_on, 'followers', s.followers,
            'media_count', s.media_count) order by s.taken_on)
          from public.ldo_cr_public_snapshots s where s.account_id = p.account_id), '[]'::jsonb),
        'posts', coalesce((select jsonb_agg(jsonb_build_object('media_id', m.media_id, 'posted_at', m.posted_at,
            'media_type', m.media_type, 'product_type', m.product_type, 'like_count', m.like_count,
            'comments_count', m.comments_count, 'view_count', m.view_count, 'read_at', m.read_at) order by m.posted_at)
          from public.ldo_cr_public_media m where m.account_id = p.account_id), '[]'::jsonb))
      from public.ldo_cr_public_accounts p join public.ldo_cr_social_accounts a on a.id = p.account_id
      where a.creator_id = p_creator limit 1),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('purpose', c.purpose, 'granted', c.granted,
        'document', case when d.id is null then null else jsonb_build_object('kind', d.kind, 'version', d.version, 'title', d.title) end,
        'context', c.context, 'text_shown', c.text_shown, 'text_hash', c.text_hash, 'created_at', c.created_at) order by c.id)
      from public.ldo_cr_consents c left join public.ldo_cr_legal_documents d on d.id = c.document_id
      where c.creator_id = p_creator), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('author', m.author_kind, 'body', m.body, 'ref_kind', m.ref_kind,
        'ref_id', m.ref_id, 'created_at', m.created_at, 'read_by_creator_at', m.read_by_creator_at) order by m.id)
      from public.ldo_cr_messages m where m.creator_id = p_creator), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'created_at', n.created_at) order by n.id)
      from public.ldo_cr_notes n where n.creator_id = p_creator), '[]'::jsonb),
    'privacy_requests', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'channel', r.channel, 'status', r.status,
        'received_at', r.received_at, 'due_at', r.due_at, 'extended_until', r.extended_until,
        'extension_reason', r.extension_reason, 'details', r.details, 'response', r.response, 'handled_at', r.handled_at)
        order by r.received_at)
      from public.ldo_cr_privacy_requests r where r.creator_id = p_creator), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('actor', a.actor_kind, 'action', a.action, 'details', a.details,
        'created_at', a.created_at) order by a.id)
      from public.ldo_cr_audit a where a.creator_id = p_creator), '[]'::jsonb)
  );
$$;

-- Limpeza diária (03:41). Igual à da A, mais [3A]: public.stop e privacy.withdrawal nas decisões (a prova do
-- apagamento e do pedido fica audit_decisions_years); o fim das autorizações nunca confirmadas e o das contas que a
-- Meta não devolve há 90 dias; a janela de platform_months dos dados públicos do Instagram. Os fins correm antes da
-- janela: cr_public_purge bloqueia a conta social antes das linhas lidas, e a janela, se viesse antes, deixava linhas
-- de publicações bloqueadas que um «Parar» ao mesmo tempo também quer apagar (deadlock).
create or replace function ldo_private.cr_retention() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := (select retention from public.ldo_cr_settings where id = 1);
  v record;
  -- [rev. S-B6] Todos os prazos passam por cr_ret (piso; chave em falta → null → não apaga).
  -- [rev. R-B9] Limitação do tratamento (art. 18.º, n.º 1, al. c)): a limpeza não apaga dados de quem a pediu.
  -- Exceções: segurança (tentativas, tokens, sessões, IBAN pendente) e os dados obtidos da Meta (termos 3.d).
  v_restricted uuid[] := array(select id from public.ldo_cr_creators where status = 'restricted');
  -- [rev. R-M3] Decisões e provas RGPD: audit_decisions_years (5). finance.reveal segue os pagamentos (migração B).
  -- Acrescentadas: R-M7, R-M8, R-M14, R-B2, R-B3, R-B5 e, na 3A, public.stop (prova do apagamento dos dados públicos)
  -- e privacy.withdrawal (o pedido que justificou a paragem pela equipa).
  v_decisions text[] := array['creator.status', 'creator.minor', 'legal.publish', 'settings.save', 'privacy.export',
    'privacy.register', 'privacy.extend', 'privacy.erasure_blocked', 'privacy.erasure', 'meta.data_deletion', 'meta.deauthorize',
    'finance.iban_confirmed', 'finance.iban_rejected', 'finance.iban_confirm_refused', 'licence.image_revoked', 'ai.consent_withdrawn',
    'incident.lockdown', 'public.stop', 'privacy.withdrawal'];
begin
  perform set_config('ldo.cr_retention', 'on', true);
  delete from public.ldo_cr_attempts where created_at < now() - make_interval(days => ldo_private.cr_ret(r, 'attempts_days'));
  delete from public.ldo_cr_tokens where created_at < now() - interval '30 days';
  update public.ldo_cr_logins set revoked_at = now() where revoked_at is null and expires_at < now();
  delete from public.ldo_cr_logins where revoked_at < now() - interval '90 days';
  -- Contas nunca confirmadas (cr_anonymize apaga também os consentimentos delas [rev. R-M11]).
  for v in select id from public.ldo_cr_creators where email_verified_at is null and deleted_at is null
           and created_at < now() - make_interval(days => ldo_private.cr_ret(r, 'unverified_days')) loop
    perform ldo_private.cr_anonymize(v.id, 'unverified');
  end loop;
  -- Inatividade: aviso aos 22 meses e anonimização aos 24, se nada o impedir (senão fica registado para a equipa).
  -- Nunca com a limitação em curso [rev. R-B9].
  for v in select id, coalesce(last_login_at, created_at) as last_seen from public.ldo_cr_creators
           where deleted_at is null and inactivity_warned_at is null and status <> 'restricted'
           and coalesce(last_login_at, created_at) < now() - make_interval(months => ldo_private.cr_ret(r, 'inactive_warn_months')) loop
    perform ldo_private.cr_outbox(v.id, 'inactivity_warning', jsonb_build_object('delete_on',
      v.last_seen + make_interval(months => ldo_private.cr_ret(r, 'inactive_months'))));
    update public.ldo_cr_creators set inactivity_warned_at = now() where id = v.id;
  end loop;
  for v in select id from public.ldo_cr_creators where deleted_at is null and status <> 'restricted'
           and coalesce(last_login_at, created_at) < now() - make_interval(months => ldo_private.cr_ret(r, 'inactive_months')) loop
    begin
      perform ldo_private.cr_delete_blockers(v.id);
      perform ldo_private.cr_anonymize(v.id, 'inactivity');
    exception when sqlstate '22023' then
      perform ldo_private.cr_log('system', null, v.id, 'retention.blocked', v.id, jsonb_build_object('detail', sqlerrm));
    end;
  end loop;
  delete from public.ldo_cr_messages where created_at < now() - make_interval(months => ldo_private.cr_ret(r, 'messages_months'))
    and not (creator_id = any (v_restricted));
  -- [rev. R-M11] Números declarados: 24 meses, guardando sempre o mais recente de cada conta (é o que as sugestões usam).
  delete from public.ldo_cr_declared_metrics m using public.ldo_cr_social_accounts a
  where a.id = m.account_id and not (a.creator_id = any (v_restricted))
    and m.declared_on < (now() - make_interval(months => ldo_private.cr_ret(r, 'declared_metrics_months')))::date
    and exists (select 1 from public.ldo_cr_declared_metrics n where n.account_id = m.account_id and n.declared_on > m.declared_on);
  -- [3A] Autorizações nunca confirmadas: 30 dias depois de o código expirar, terminam (nada foi lido além da
  -- biografia, que não se guardou).
  for v in select p.account_id, a.creator_id from public.ldo_cr_public_accounts p
           join public.ldo_cr_social_accounts a on a.id = p.account_id
           where p.state = 'proof' and p.proof_expires_at < now() - interval '30 days' loop
    perform ldo_private.cr_public_purge(v.account_id, v.creator_id, 'proof_expired', null, null, null);
    perform ldo_private.cr_outbox(v.creator_id, 'public_stopped', jsonb_build_object('reason', 'proof_expired'));
  end loop;
  -- [3A] Conta que a Meta não devolve há 90 dias (deixou de ser profissional ou mudou de @): a leitura termina e o que
  -- foi lido apaga-se, em vez de perguntar à Meta todas as semanas. Não durante a limitação [rev. R-B9].
  for v in select p.account_id, a.creator_id from public.ldo_cr_public_accounts p
           join public.ldo_cr_social_accounts a on a.id = p.account_id
           join public.ldo_cr_creators c on c.id = a.creator_id
           where p.state = 'error' and p.last_error_at < now() - interval '90 days' and c.status <> 'restricted' loop
    perform ldo_private.cr_public_purge(v.account_id, v.creator_id, 'not_found', null, null, null);
    perform ldo_private.cr_outbox(v.creator_id, 'public_stopped', jsonb_build_object('reason', 'not_found'));
  end loop;
  -- [3A] Dados públicos do Instagram: janela de platform_months, também com a limitação em curso (termos da Meta,
  -- 3.d) [rev. R-B9]: sem o filtro de v_restricted.
  delete from public.ldo_cr_public_snapshots
  where taken_on < (now() - make_interval(months => ldo_private.cr_ret(r, 'platform_months')))::date;
  delete from public.ldo_cr_public_media
  where posted_at < now() - make_interval(months => ldo_private.cr_ret(r, 'platform_months'));
  -- Auditoria (só de acrescento): 12 meses para o corrente; as decisões e as provas RGPD ficam audit_decisions_years.
  delete from public.ldo_cr_audit where created_at < now() - make_interval(months => ldo_private.cr_ret(r, 'audit_months'))
    and action <> 'finance.reveal' and not (action = any (v_decisions))
    and (creator_id is null or not (creator_id = any (v_restricted)));
  delete from public.ldo_cr_audit where created_at < now() - make_interval(years => ldo_private.cr_ret(r, 'audit_decisions_years'))
    and action = any (v_decisions) and (creator_id is null or not (creator_id = any (v_restricted)));
  -- Enviadas, e também as que falharam 5 vezes (ldo_cr_outbox_claim já não as escolhe): o mesmo prazo, contado da criação.
  delete from public.ldo_cr_outbox
  where (sent_at < now() - make_interval(days => ldo_private.cr_ret(r, 'outbox_days')))
     or (sent_at is null and attempts >= 5 and created_at < now() - make_interval(days => ldo_private.cr_ret(r, 'outbox_days')));
  -- [rev. S-A1] IBAN pendentes nunca confirmados.
  update public.ldo_cr_finance set iban_pending_ct = null, iban_pending_last4 = null, iban_pending_country = null,
    iban_pending_holder_mismatch = false, iban_pending_at = null
  where iban_pending_at < now() - interval '30 days';
  delete from public.ldo_cr_privacy_requests where status <> 'open'
    and received_at < now() - make_interval(years => ldo_private.cr_ret(r, 'privacy_requests_years'))
    and (creator_id is null or not (creator_id = any (v_restricted)));
  -- Consentimentos de contas apagadas há mais do que o prazo.
  delete from public.ldo_cr_consents c using public.ldo_cr_creators k
  where k.id = c.creator_id and k.deleted_at < now() - make_interval(years => ldo_private.cr_ret(r, 'consents_years_after_end'));
  -- Migrações B e C2: «create or replace» com candidaturas, moradas, ficheiros, pedidos, dados da Meta ligada,
  -- indicadores e IA, sempre com o filtro de v_restricted, salvo nos dados da Meta [rev. R-B9].
end;
$$;

-- ---------------------------------------------------------------- 8. acessos às funções novas

revoke all on function
  ldo_private.cr_public_granted(uuid), ldo_private.cr_public_code(), ldo_private.cr_public_code_quota(uuid, text),
  ldo_private.cr_public_int(jsonb), ldo_private.cr_public_purge(uuid, uuid, text, text, text, uuid)
from public, anon, authenticated;

revoke all on function
  -- site (p_token + p_session)
  public.ldo_cr_public_get(text, text), public.ldo_cr_public_start(text, text, uuid, text, text),
  public.ldo_cr_public_renew(text, text, uuid), public.ldo_cr_public_proof(text, text, uuid, text),
  public.ldo_cr_public_proof_refund(text, text, bigint),
  public.ldo_cr_public_confirm(text, text, uuid, text, text, text), public.ldo_cr_public_stop(text, text, uuid, text, text),
  -- servidor (p_token)
  public.ldo_cr_public_claim(text, integer), public.ldo_cr_public_put(text, uuid, timestamptz, text, integer, integer, jsonb),
  public.ldo_cr_public_fail(text, uuid, timestamptz, text), public.ldo_cr_public_health(text, text, integer, integer, integer),
  -- equipa (p_session)
  public.ldo_cr_public_creator(text, uuid), public.ldo_cr_public_status(text), public.ldo_cr_public_mode(text, text),
  public.ldo_cr_public_staff_stop(text, uuid, uuid)
from public, authenticated;

grant execute on function
  public.ldo_cr_public_get(text, text), public.ldo_cr_public_start(text, text, uuid, text, text),
  public.ldo_cr_public_renew(text, text, uuid), public.ldo_cr_public_proof(text, text, uuid, text),
  public.ldo_cr_public_proof_refund(text, text, bigint),
  public.ldo_cr_public_confirm(text, text, uuid, text, text, text), public.ldo_cr_public_stop(text, text, uuid, text, text),
  public.ldo_cr_public_claim(text, integer), public.ldo_cr_public_put(text, uuid, timestamptz, text, integer, integer, jsonb),
  public.ldo_cr_public_fail(text, uuid, timestamptz, text), public.ldo_cr_public_health(text, text, integer, integer, integer),
  public.ldo_cr_public_creator(text, uuid), public.ldo_cr_public_status(text), public.ldo_cr_public_mode(text, text),
  public.ldo_cr_public_staff_stop(text, uuid, uuid)
to anon;
