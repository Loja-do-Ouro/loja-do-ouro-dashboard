-- Apoio ao Cliente: revisão da IA antes de enviar.
--
-- Quando a colaboradora carrega em Enviar, a IA (Claude Haiku 5.5 por omissão) verifica a resposta segundo os critérios
-- de qualidade e de bom atendimento escritos pelo Super Admin. Se puder melhorar, mostra os problemas e uma sugestão, e
-- a colaboradora escolhe o que envia. A revisão nunca bloqueia nem perde um envio: sem resposta da IA, a mensagem segue.
-- * Definições próprias (modo, modelo, orçamento e critérios), com funções próprias e só para o Super Admin. O modo
--   começa "desligada"; ldo_support_save_settings não muda.
-- * Preferência de cada pessoa (ldo_support_user_prefs): no modo "opcional" cada pessoa pode desligar a revisão.
-- * Registo de cada revisão (ldo_support_ai_reviews): veredicto, critérios em falta, custo, tempo e a escolha feita ao
--   enviar. Do texto guarda-se só o hash (sha256) da resposta revista e da sugestão, nunca o texto. A escolha
--   (sugestão, versão própria ou editada) é deduzida aqui pelo hash do texto enviado; do browser só vêm "sem revisão",
--   "não respondeu a tempo" e "erro". Apagado ao fim de 365 dias (passagem diária).
-- * Orçamento próprio, separado do das propostas de resposta, e 300 revisões por pessoa e por dia; não conta para o
--   limite diário de pedidos à IA.
-- * ldo_support_ai_messages.used_message_id: a mensagem enviada a partir de uma proposta da IA ("Usar na resposta"),
--   só da mesma pessoa e da mesma conversa.
-- * Orçamento das propostas (ldo_private.support_ai_month_cost): um pedido em curso só reserva US$ 0,25 durante 15
--   minutos; depois conta pelo que gastou (ou 0), em vez de reservar até ao fim do mês.
-- * ldo_support_ai_admin devolve também os totais do mês da revisão (custos de IA na configuração).
-- As duas funções alteradas partem do texto em produção a 29-10-2026 (pg_get_functiondef: support_ai_month_cost md5
-- 2160259a183b4515c586645fc6ae784c, ldo_support_ai_admin md5 8bd5bc20dc640630f6fd31c3c5115694); fora das linhas
-- assinaladas ficam iguais e mantêm os privilégios (create or replace).
-- Depende de 20261030100000 (ldo_private.support_history_from).

-- ---------------------------------------------------------------- definições

alter table public.ldo_support_settings
  add column if not exists ai_review_mode text not null default 'desligada'
    check (ai_review_mode in ('desligada', 'opcional', 'obrigatoria')),
  add column if not exists ai_review_model text not null default 'claude-haiku-5-5'
    check (ai_review_model in ('claude-haiku-5-5', 'claude-sonnet-5-5')),
  add column if not exists ai_review_monthly_budget numeric(10, 2) not null default 5
    check (ai_review_monthly_budget between 0 and 10000),
  add column if not exists ai_review_criteria text not null default $criterios$1. Saudação: na primeira resposta da conversa ou do dia, uma saudação adequada ao canal, com o nome do cliente quando o conhecemos.
2. Tom caloroso e profissional.
3. Correção: sem contradições com a base de conhecimento e as políticas; não promete prazos, preços, descontos ou resultados não confirmados.
4. Responde a tudo: todas as perguntas e pedidos da última mensagem do cliente têm resposta.
5. Clareza: frases curtas e simples, sem jargão nem ambiguidades.
6. Língua do cliente; em português, sempre português de Portugal (sem "você", "estou verificando", "contato", "equipe", "celular").
7. Próximo passo: o cliente sabe o que acontece a seguir ou o que tem de fazer.
8. Despedida cordial quando a resposta encerra o assunto; no email a assinatura é automática.
9. Marca certa: só a marca da conversa (Loja do Ouro ou Gold Store Premium) e o respetivo site.
10. Privacidade: nos comentários públicos, nada de dados pessoais, encomendas ou valores; nunca pedir dados de pagamento por mensagem.
11. Tamanho adequado ao canal: curto no Messenger, no Instagram, no chat do site e nos comentários; mais completo no email.$criterios$
    check (length(btrim(ai_review_criteria)) between 1 and 4000);

-- Preferências de cada pessoa no Apoio ao Cliente.
create table public.ldo_support_user_prefs (
  user_id uuid primary key references public.ldo_app_users (id) on delete cascade,
  ai_review boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.ldo_support_user_prefs enable row level security;
revoke all on public.ldo_support_user_prefs from anon, authenticated;

-- ---------------------------------------------------------------- registo das revisões

-- O id vem do browser (a mesma revisão fica ligada ao envio, mesmo quando a IA não responde a tempo).
create table public.ldo_support_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ldo_support_conversations (id) on delete cascade,
  user_id uuid not null references public.ldo_app_users (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  veredicto text check (veredicto in ('aprovada', 'melhorar')),
  criterios text[] not null default '{}' check (cardinality(criterios) <= 8),
  sugestao_hash text check (sugestao_hash ~ '^[0-9a-f]{64}$'),
  original_hash text check (original_hash ~ '^[0-9a-f]{64}$'),
  -- Sugestão retirada no servidor (acrescentava factos, compromissos, ligações, a outra marca…).
  descartada text check (descartada in ('ligacao', 'dados_novos', 'compromisso', 'marca', 'dados_pessoais', 'pt_br')),
  choice text check (choice in ('sugestao', 'propria', 'editada', 'sem_revisao', 'timeout', 'erro')),
  message_id uuid references public.ldo_support_messages (id) on delete set null,
  model text check (length(model) <= 60),
  cost_usd numeric(10, 5) not null default 0 check (cost_usd >= 0),
  latency_ms integer check (latency_ms >= 0),
  error text check (length(error) <= 500)
);
create index ldo_support_ai_reviews_user_idx on public.ldo_support_ai_reviews (user_id, created_at);
create index ldo_support_ai_reviews_created_idx on public.ldo_support_ai_reviews (created_at);
alter table public.ldo_support_ai_reviews enable row level security;
revoke all on public.ldo_support_ai_reviews from anon, authenticated;

-- Proposta da IA que deu origem a uma mensagem enviada.
alter table public.ldo_support_ai_messages
  add column if not exists used_message_id uuid references public.ldo_support_messages (id) on delete set null;

-- ---------------------------------------------------------------- auxiliares

-- Custo do mês da revisão: as revisões em curso reservam US$ 0,02 durante 15 minutos; depois contam pelo custo gravado.
create function ldo_private.support_ai_review_month_cost() returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when status = 'pending' and created_at > now() - interval '15 minutes'
    then greatest(cost_usd, 0.02) else cost_usd end), 0)
  from public.ldo_support_ai_reviews
  where created_at >= ldo_private.support_lisbon_start('month');
$$;

-- Totais das revisões desde p_since: de uma pessoa (p_user) ou da equipa (p_user nulo).
create function ldo_private.support_ai_review_stats(p_user uuid, p_since timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'revisoes', count(*),
    'erros', count(*) filter (where status = 'error'),
    'aprovadas', count(*) filter (where veredicto = 'aprovada'),
    'melhorar', count(*) filter (where veredicto = 'melhorar'),
    'sugestoes', count(*) filter (where sugestao_hash is not null),
    'descartadas', count(*) filter (where descartada is not null),
    'sugestao', count(*) filter (where choice = 'sugestao'),
    'editada', count(*) filter (where choice = 'editada'),
    'propria', count(*) filter (where choice = 'propria'),
    'sem_revisao', count(*) filter (where choice = 'sem_revisao'),
    'timeout', count(*) filter (where choice = 'timeout'),
    'erro', count(*) filter (where choice = 'erro'),
    'decididas', count(*) filter (where sugestao_hash is not null and choice in ('sugestao', 'editada', 'propria')),
    'custo', coalesce(sum(cost_usd), 0))
  from public.ldo_support_ai_reviews
  where created_at >= p_since and (p_user is null or user_id = p_user);
$$;

-- Propostas de resposta (texto em produção): um pedido em curso só reserva durante 15 minutos.
create or replace function ldo_private.support_ai_month_cost()
 returns numeric
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(sum(case when status = 'pending' and created_at > now() - interval '15 minutes' then greatest(cost_usd, 0.25) else cost_usd end), 0)
  from public.ldo_support_ai_messages
  where created_at >= ldo_private.support_lisbon_start('month');
$function$;

-- ---------------------------------------------------------------- revisão (sessão e servidor)

-- Regista uma revisão antes de chamar a IA, depois de confirmar o modo, a preferência da pessoa, o limite diário e o
-- orçamento. Devolve o que o servidor precisa: critérios, modelo, base de conhecimento, lojas, canal e marca, se é a
-- primeira resposta da equipa hoje e as últimas 15 mensagens desde o histórico visível (sem notas internas).
create function public.ldo_support_ai_review_begin(p_session text, p_conversation_id uuid, p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_s public.ldo_support_settings;
  v_c public.ldo_support_conversations;
  v_today integer;
begin
  if p_id is null then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  select * into v_c from public.ldo_support_conversations where id = p_conversation_id;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  select * into v_s from public.ldo_support_settings where id = 1;
  if v_s.ai_review_mode = 'desligada' then
    raise exception 'A revisão da IA está desligada na configuração do apoio.' using errcode = '42501';
  end if;
  if v_s.ai_review_mode = 'opcional'
     and not coalesce((select p.ai_review from public.ldo_support_user_prefs p where p.user_id = v_me), true) then
    raise exception 'Desligou a revisão das suas respostas.' using errcode = '42501';
  end if;
  -- Uma revisão de cada vez na contagem (dois envios seguidos não passam ambos o limite).
  perform pg_advisory_xact_lock(hashtextextended('ldo_support_ai_review:' || v_me::text, 0));
  select count(*) into v_today from public.ldo_support_ai_reviews
  where user_id = v_me and created_at >= ldo_private.support_lisbon_start('day');
  if v_today >= 300 then
    raise exception 'Atingiu o limite diário de 300 revisões da IA' using errcode = '42501';
  end if;
  if ldo_private.support_ai_review_month_cost() >= v_s.ai_review_monthly_budget then
    raise exception 'Orçamento mensal da revisão da IA esgotado: US$ %', v_s.ai_review_monthly_budget using errcode = '42501';
  end if;
  insert into public.ldo_support_ai_reviews (id, conversation_id, user_id, model)
  values (p_id, v_c.id, v_me, v_s.ai_review_model);
  return jsonb_build_object(
    'id', p_id,
    'model', v_s.ai_review_model,
    'criteria', v_s.ai_review_criteria,
    'conversation', jsonb_build_object('channel', v_c.channel, 'account', v_c.account, 'subject', v_c.subject,
      'contact_name', (select coalesce(k.name, k.handle) from public.ldo_support_contacts k where k.id = v_c.contact_id),
      'primeira_resposta', not exists (select 1 from public.ldo_support_messages m
        where m.conversation_id = v_c.id and m.kind = 'outbound' and m.deleted_at is null
          and coalesce(m.delivery, 'accepted') <> 'failed' and m.created_at >= ldo_private.support_lisbon_start('day'))),
    'visitor', case when v_c.channel = 'site' then (
      select jsonb_build_object('site', v.site, 'locale', v.locale, 'country', v.country, 'page_url', v.page_url)
      from public.ldo_support_site_visitors v where v.conversation_id = v_c.id order by v.last_seen_at desc limit 1) end,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('kind', m.kind, 'body', left(m.body, 2000), 'created_at', m.created_at,
        'attachments', case when jsonb_typeof(m.attachments) = 'array' then jsonb_array_length(m.attachments) else 0 end)
        order by m.created_at, m.inserted_at)
      from (select * from public.ldo_support_messages
            where conversation_id = v_c.id and kind in ('inbound', 'outbound') and deleted_at is null
              and coalesce(delivery, 'accepted') <> 'failed' and created_at >= ldo_private.support_history_from()
            order by created_at desc, inserted_at desc limit 15) m), '[]'::jsonb),
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('title', k.title, 'body', k.body) order by k.position, k.title, k.id)
      from public.ldo_support_knowledge k where btrim(k.body) <> ''), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'city', s.city, 'closed_weekdays', s.closed_weekdays) order by s.name)
      from public.ldo_app_stores s where s.active), '[]'::jsonb)
  );
end;
$$;

-- Resultado de uma revisão (só o servidor), gravado logo a seguir à chamada à IA. Uma revisão terminada nunca é
-- reescrita. Só hashes, nunca o texto da resposta nem da sugestão.
create function public.ldo_support_ai_review_finish(p_token text, p_id uuid, p_status text, p_veredicto text, p_criterios text[],
  p_original_hash text, p_sugestao_hash text, p_descartada text, p_model text, p_cost numeric, p_latency_ms integer, p_error text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_status is null or p_status not in ('done', 'error') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  update public.ldo_support_ai_reviews set
    status = p_status,
    veredicto = case when p_status = 'done' and p_veredicto in ('aprovada', 'melhorar') then p_veredicto end,
    criterios = coalesce((select array_agg(left(btrim(x), 60)) from (select x from unnest(p_criterios) as x
      where btrim(coalesce(x, '')) <> '' limit 8) c), '{}'),
    original_hash = case when p_original_hash ~ '^[0-9a-f]{64}$' then p_original_hash end,
    sugestao_hash = case when p_status = 'done' and p_sugestao_hash ~ '^[0-9a-f]{64}$' then p_sugestao_hash end,
    descartada = case when p_descartada in ('ligacao', 'dados_novos', 'compromisso', 'marca', 'dados_pessoais', 'pt_br') then p_descartada end,
    model = left(coalesce(p_model, model), 60),
    cost_usd = least(greatest(coalesce(p_cost, 0), 0), 99999),
    latency_ms = least(greatest(coalesce(p_latency_ms, 0), 0), 600000),
    error = left(p_error, 500),
    finished_at = now()
  where id = p_id and status = 'pending';
end;
$$;

-- Escolha feita ao enviar (só o servidor, a seguir a ldo_support_begin_send), uma vez e só pela pessoa da revisão. A
-- escolha é deduzida pelo hash do texto enviado: igual à sugestão = "sugestao", igual ao original = "propria", outro =
-- "editada". Do browser só se aceitam "sem_revisao", "timeout" e "erro". Devolve a escolha gravada (ou null).
create function public.ldo_support_ai_review_choice(p_token text, p_id uuid, p_user uuid, p_message_id uuid, p_body_hash text,
  p_client_choice text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.ldo_support_ai_reviews;
  v_choice text;
begin
  perform ldo_private.bi_check(p_token);
  if p_client_choice is not null and p_client_choice not in ('sem_revisao', 'timeout', 'erro') then
    raise exception 'Escolha inválida.' using errcode = '22023';
  end if;
  select * into v_r from public.ldo_support_ai_reviews where id = p_id for update;
  if v_r.id is null or v_r.user_id is distinct from p_user or v_r.choice is not null then
    return null;
  end if;
  if not exists (select 1 from public.ldo_support_messages m where m.id = p_message_id and m.conversation_id = v_r.conversation_id
      and m.author_user_id = p_user and m.kind = 'outbound') then
    return null;
  end if;
  v_choice := case
    when p_client_choice is not null then p_client_choice
    when v_r.status <> 'done' then 'erro'
    when p_body_hash is not null and p_body_hash = v_r.sugestao_hash then 'sugestao'
    when p_body_hash is not null and p_body_hash = v_r.original_hash then 'propria'
    else 'editada' end;
  update public.ldo_support_ai_reviews set choice = v_choice, message_id = p_message_id where id = p_id;
  return v_choice;
end;
$$;

-- Proposta da IA usada numa resposta enviada (só o servidor): só uma proposta da mesma pessoa, da mesma conversa, e uma vez.
create function public.ldo_support_ai_draft_used(p_token text, p_id uuid, p_user uuid, p_message_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_ai_messages a set used_message_id = p_message_id
  where a.id = p_id and a.user_id = p_user and a.kind = 'draft' and a.used_message_id is null
    and exists (select 1 from public.ldo_support_messages m where m.id = p_message_id and m.conversation_id = a.conversation_id
      and m.author_user_id = p_user and m.kind = 'outbound');
end;
$$;

-- Revisões com mais de 365 dias são apagadas (passagem diária).
create function public.ldo_support_ai_review_purge(p_token text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_n integer;
begin
  perform ldo_private.bi_check(p_token);
  delete from public.ldo_support_ai_reviews where created_at < now() - interval '365 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------- preferências de cada pessoa (sessão)

-- Preferência, modo em vigor e as revisões da própria pessoa este mês (cada pessoa vê só as suas).
create function public.ldo_support_user_prefs(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_check(p_session);
begin
  return jsonb_build_object(
    'ai_review', coalesce((select p.ai_review from public.ldo_support_user_prefs p where p.user_id = v_me), true),
    'review_mode', (select s.ai_review_mode from public.ldo_support_settings s where s.id = 1),
    'review_month', ldo_private.support_ai_review_stats(v_me, ldo_private.support_lisbon_start('month')));
end;
$$;

-- p_values: {"ai_review": true|false}.
create function public.ldo_support_user_prefs_save(p_session text, p_values jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_check(p_session);
begin
  if jsonb_typeof(p_values -> 'ai_review') is distinct from 'boolean' then
    raise exception 'Preferência inválida.' using errcode = '22023';
  end if;
  insert into public.ldo_support_user_prefs (user_id, ai_review) values (v_me, (p_values ->> 'ai_review')::boolean)
  on conflict (user_id) do update set ai_review = excluded.ai_review, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------- Super Admin (sessão)

-- Definições da revisão e os totais da equipa (nunca por pessoa): este mês e a aceitação das sugestões em 14 dias.
create function public.ldo_support_review_settings(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.ldo_support_settings;
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  select * into v_s from public.ldo_support_settings where id = 1;
  return jsonb_build_object(
    'mode', v_s.ai_review_mode,
    'model', v_s.ai_review_model,
    'monthly_budget', v_s.ai_review_monthly_budget,
    'criteria', v_s.ai_review_criteria,
    'month', ldo_private.support_ai_review_stats(null, ldo_private.support_lisbon_start('month')),
    'two_weeks', ldo_private.support_ai_review_stats(null, now() - interval '14 days'));
end;
$$;

-- p_values: {"mode", "model", "monthly_budget", "criteria"} (todos obrigatórios).
create function public.ldo_support_review_settings_save(p_session text, p_values jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_mode text := p_values ->> 'mode';
  v_model text := p_values ->> 'model';
  v_budget numeric;
  v_criteria text := btrim(coalesce(p_values ->> 'criteria', ''));
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if v_mode is null or v_mode not in ('desligada', 'opcional', 'obrigatoria') then
    raise exception 'Escolha o modo da revisão.' using errcode = '22023';
  end if;
  if v_model is null or v_model not in ('claude-haiku-5-5', 'claude-sonnet-5-5') then
    raise exception 'Escolha o modelo da revisão.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_values -> 'monthly_budget') is distinct from 'number' then
    raise exception 'Orçamento mensal entre 0 e 10000 dólares.' using errcode = '22023';
  end if;
  v_budget := round((p_values ->> 'monthly_budget')::numeric, 2);
  if v_budget < 0 or v_budget > 10000 then
    raise exception 'Orçamento mensal entre 0 e 10000 dólares.' using errcode = '22023';
  end if;
  if length(v_criteria) not between 1 and 4000 then
    raise exception 'Critérios entre 1 e 4000 caracteres.' using errcode = '22023';
  end if;
  update public.ldo_support_settings set ai_review_mode = v_mode, ai_review_model = v_model, ai_review_monthly_budget = v_budget,
    ai_review_criteria = v_criteria, updated_by = v_me, updated_at = now() where id = 1;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'ai.review.settings', jsonb_build_object('mode', v_mode, 'model', v_model, 'monthly_budget', v_budget,
    'criteria_length', length(v_criteria)));
end;
$$;

-- Custos de IA na configuração (texto em produção): mais a linha 'review' com os totais do mês da revisão.
create or replace function public.ldo_support_ai_admin(p_session text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_s public.ldo_support_settings;
  v_month timestamptz := ldo_private.support_lisbon_start('month');
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  select * into v_s from public.ldo_support_settings where id = 1;
  return jsonb_build_object(
    'settings', jsonb_build_object('ai_enabled', v_s.ai_enabled, 'ai_daily_limit', v_s.ai_daily_limit, 'ai_monthly_budget', v_s.ai_monthly_budget),
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'body', k.body, 'position', k.position, 'updated_at', k.updated_at,
        'updated_by_name', (select coalesce(full_name, username) from public.ldo_app_users where id = k.updated_by)) order by k.position, k.title, k.id)
      from public.ldo_support_knowledge k), '[]'::jsonb),
    'usage', jsonb_build_object(
      'month_cost', (select coalesce(sum(cost_usd), 0) from public.ldo_support_ai_messages where created_at >= v_month),
      'month_requests', (select count(*) from public.ldo_support_ai_messages where created_at >= v_month),
      'month_errors', (select count(*) from public.ldo_support_ai_messages where created_at >= v_month and status = 'error'),
      'by_user', coalesce((
        select jsonb_agg(jsonb_build_object('name', coalesce(u.full_name, u.username), 'requests', x.n, 'cost', x.cost) order by x.cost desc)
        from (select user_id, count(*) as n, sum(cost_usd) as cost from public.ldo_support_ai_messages
              where created_at >= v_month group by user_id) x join public.ldo_app_users u on u.id = x.user_id), '[]'::jsonb)),
    -- Revisão antes de enviar: só os totais da equipa.
    'review', jsonb_build_object(
      'mode', v_s.ai_review_mode,
      'model', v_s.ai_review_model,
      'monthly_budget', v_s.ai_review_monthly_budget,
      'month_cost', (select coalesce(sum(cost_usd), 0) from public.ldo_support_ai_reviews where created_at >= v_month),
      'month_reviews', (select count(*) from public.ldo_support_ai_reviews where created_at >= v_month),
      'month_errors', (select count(*) from public.ldo_support_ai_reviews where created_at >= v_month and status = 'error'))
  );
end;
$function$;

-- ---------------------------------------------------------------- acessos

revoke all on function
  ldo_private.support_ai_review_month_cost(),
  ldo_private.support_ai_review_stats(uuid, timestamptz)
from public, anon, authenticated;
revoke all on function
  public.ldo_support_ai_review_begin(text, uuid, uuid),
  public.ldo_support_ai_review_finish(text, uuid, text, text, text[], text, text, text, text, numeric, integer, text),
  public.ldo_support_ai_review_choice(text, uuid, uuid, uuid, text, text),
  public.ldo_support_ai_draft_used(text, uuid, uuid, uuid),
  public.ldo_support_ai_review_purge(text),
  public.ldo_support_user_prefs(text),
  public.ldo_support_user_prefs_save(text, jsonb),
  public.ldo_support_review_settings(text),
  public.ldo_support_review_settings_save(text, jsonb)
from public, authenticated;
grant execute on function
  public.ldo_support_ai_review_begin(text, uuid, uuid),
  public.ldo_support_ai_review_finish(text, uuid, text, text, text[], text, text, text, text, numeric, integer, text),
  public.ldo_support_ai_review_choice(text, uuid, uuid, uuid, text, text),
  public.ldo_support_ai_draft_used(text, uuid, uuid, uuid),
  public.ldo_support_ai_review_purge(text),
  public.ldo_support_user_prefs(text),
  public.ldo_support_user_prefs_save(text, jsonb),
  public.ldo_support_review_settings(text),
  public.ldo_support_review_settings_save(text, jsonb)
to anon;
