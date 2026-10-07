-- Apoio ao Cliente: assistente de IA (Claude, da Anthropic) para ajudar a responder.
--
-- A IA nunca envia nada ao cliente: propõe texto que a colaboradora revê e envia pelo caminho normal.
-- A chamada à Anthropic é feita só no servidor (ANTHROPIC_API_KEY nas variáveis da Vercel).
-- Cada pedido fica registado (pergunta, resposta, fontes consultadas, custo estimado) e só é visível
-- a quem o fez; o Super Admin vê os totais. Limite diário por pessoa e orçamento mensal.
-- A base de conhecimento (políticas, lojas, tom de voz) é escrita pelo Super Admin e lida pela IA.

alter table public.ldo_support_settings
  add column ai_enabled boolean not null default true,
  add column ai_daily_limit integer not null default 80 check (ai_daily_limit between 0 and 1000),
  add column ai_monthly_budget numeric(10, 2) not null default 30 check (ai_monthly_budget between 0 and 10000);

create table public.ldo_support_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null default '' check (length(body) <= 20000),
  position integer not null default 0 check (position between 0 and 10000),
  updated_by uuid references public.ldo_app_users (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.ldo_support_knowledge enable row level security;
revoke all on public.ldo_support_knowledge from anon, authenticated;

-- Secções por preencher: sem texto, a IA não as lê.
insert into public.ldo_support_knowledge (title, position) values
  ('Sobre a Loja do Ouro', 10),
  ('Lojas físicas: moradas, horários e contactos', 20),
  ('Envios e prazos de entrega', 30),
  ('Trocas, devoluções e reembolsos', 40),
  ('Garantias e reparações', 50),
  ('Pagamentos', 60),
  ('Medidas de anéis, gravações e personalizações', 70),
  ('Compra de ouro usado e contratos', 80),
  ('Tom de voz e assinatura', 90),
  ('Perguntas frequentes', 100);

create table public.ldo_support_ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ldo_support_conversations (id) on delete cascade,
  user_id uuid not null references public.ldo_app_users (id),
  kind text not null check (kind in ('draft', 'chat')),
  question text check (length(question) <= 4000),
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  answer text,
  draft text,
  checks jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  model text,
  usage jsonb,
  cost_usd numeric(10, 5) not null default 0 check (cost_usd >= 0),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ldo_support_ai_messages_conv_idx on public.ldo_support_ai_messages (conversation_id, user_id, created_at desc);
create index ldo_support_ai_messages_user_idx on public.ldo_support_ai_messages (user_id, created_at desc);
create index ldo_support_ai_messages_created_idx on public.ldo_support_ai_messages (created_at);
alter table public.ldo_support_ai_messages enable row level security;
revoke all on public.ldo_support_ai_messages from anon, authenticated;

-- Pesquisa nas respostas já enviadas pela equipa (exemplos para a IA).
create index ldo_support_messages_outbound_fts_idx on public.ldo_support_messages
  using gin (to_tsvector('portuguese'::regconfig, body)) where kind = 'outbound';

-- ---------------------------------------------------------------- auxiliares

-- Início do dia e do mês em Lisboa.
create function ldo_private.support_lisbon_start(p_unit text) returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc(p_unit, now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon';
$$;

-- Custo do mês para o orçamento: pedidos terminados pelo custo estimado; pedidos em curso reservam
-- US$ 0,25 (um pedido interrompido há mais de 5 minutos deixa de reservar).
create function ldo_private.support_ai_month_cost() returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when status = 'pending' then 0.25 else cost_usd end), 0)
  from public.ldo_support_ai_messages
  where created_at >= ldo_private.support_lisbon_start('month')
    and not (status = 'pending' and created_at < now() - interval '5 minutes');
$$;

-- ---------------------------------------------------------------- pedidos à IA

-- Regista um pedido (antes de chamar a IA) depois de confirmar acesso, interruptor, limite diário,
-- pedidos em curso e orçamento. Devolve o que o servidor precisa para preparar o pedido: as últimas
-- trocas desta pessoa nesta conversa, a base de conhecimento e as lojas físicas.
create function public.ldo_support_ai_begin(p_session text, p_conversation uuid, p_kind text, p_question text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_s public.ldo_support_settings;
  v_q text := nullif(btrim(coalesce(p_question, '')), '');
  v_today integer;
  v_running integer;
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('draft', 'chat') then
    raise exception 'Pedido à IA inválido.' using errcode = '22023';
  end if;
  if p_kind = 'chat' and v_q is null then
    raise exception 'Escreva a pergunta para a IA.' using errcode = '22023';
  end if;
  if length(v_q) > 4000 then
    raise exception 'Pergunta demasiado longa (máximo 4000 caracteres).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ldo_support_conversations where id = p_conversation) then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  select * into v_s from public.ldo_support_settings where id = 1;
  if not v_s.ai_enabled then
    raise exception 'O assistente de IA está desligado na configuração do apoio.' using errcode = '42501';
  end if;
  -- Um pedido de cada vez por pessoa na contagem (dois cliques seguidos não passam ambos o limite).
  perform pg_advisory_xact_lock(hashtextextended('ldo_support_ai:' || v_me::text, 0));
  select count(*) filter (where created_at >= ldo_private.support_lisbon_start('day')),
         count(*) filter (where status = 'pending' and created_at > now() - interval '5 minutes')
    into v_today, v_running
  from public.ldo_support_ai_messages where user_id = v_me and created_at > now() - interval '2 days';
  if v_today >= v_s.ai_daily_limit then
    raise exception 'Atingiu o limite diário de % pedidos à IA. O Super Admin pode alterá-lo na configuração do apoio.', v_s.ai_daily_limit
      using errcode = '42501';
  end if;
  if v_running >= 2 then
    raise exception 'Já tem dois pedidos à IA em curso. Aguarde que terminem.' using errcode = '42501';
  end if;
  if ldo_private.support_ai_month_cost() >= v_s.ai_monthly_budget then
    raise exception 'Orçamento mensal da IA esgotado (US$ %). O Super Admin pode alterá-lo na configuração do apoio.', v_s.ai_monthly_budget
      using errcode = '42501';
  end if;
  insert into public.ldo_support_ai_messages (conversation_id, user_id, kind, question)
  values (p_conversation, v_me, p_kind, v_q) returning id into v_id;
  return jsonb_build_object(
    'id', v_id,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('kind', h.kind, 'question', h.question, 'answer', h.answer, 'draft', h.draft) order by h.created_at)
      from (select * from public.ldo_support_ai_messages
            where conversation_id = p_conversation and user_id = v_me and status = 'done' and id <> v_id
            order by created_at desc limit 6) h), '[]'::jsonb),
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('title', k.title, 'body', k.body) order by k.position, k.title, k.id)
      from public.ldo_support_knowledge k where btrim(k.body) <> ''), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'city', s.city, 'closed_weekdays', s.closed_weekdays) order by s.name)
      from public.ldo_app_stores s where s.active), '[]'::jsonb)
  );
end;
$$;

-- Resultado de um pedido (só o servidor). Um pedido já terminado nunca é reescrito.
create function public.ldo_support_ai_finish(p_token text, p_id uuid, p_status text, p_answer text, p_draft text,
  p_checks jsonb, p_sources jsonb, p_model text, p_usage jsonb, p_cost numeric, p_error text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_status is null or p_status not in ('done', 'error') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  update public.ldo_support_ai_messages set
    status = p_status,
    answer = left(p_answer, 8000),
    draft = left(p_draft, 8000),
    checks = case when jsonb_typeof(p_checks) = 'array' then p_checks else '[]'::jsonb end,
    sources = case when jsonb_typeof(p_sources) = 'array' then p_sources else '[]'::jsonb end,
    model = left(p_model, 60),
    usage = p_usage,
    cost_usd = least(greatest(coalesce(p_cost, 0), 0), 99999),
    error = left(p_error, 500),
    finished_at = now()
  where id = p_id and status = 'pending';
end;
$$;

-- Histórico da pessoa com a IA nesta conversa e o uso de hoje.
create function public.ldo_support_ai_history(p_session text, p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_s public.ldo_support_settings;
begin
  select * into v_s from public.ldo_support_settings where id = 1;
  return jsonb_build_object(
    'enabled', v_s.ai_enabled,
    'daily_limit', v_s.ai_daily_limit,
    'used_today', (select count(*) from public.ldo_support_ai_messages
      where user_id = v_me and created_at >= ldo_private.support_lisbon_start('day')),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'question', a.question,
        'status', case when a.status = 'pending' and a.created_at < now() - interval '5 minutes' then 'error' else a.status end,
        'error', case when a.status = 'pending' and a.created_at < now() - interval '5 minutes'
          then 'Pedido interrompido antes de terminar.' else a.error end,
        'answer', a.answer, 'draft', a.draft, 'checks', a.checks, 'sources', a.sources,
        'cost_usd', a.cost_usd, 'created_at', a.created_at) order by a.created_at)
      from (select * from public.ldo_support_ai_messages
            where conversation_id = p_conversation and user_id = v_me order by created_at desc limit 30) a), '[]'::jsonb)
  );
end;
$$;

-- Respostas já enviadas pela equipa noutras conversas, com a mensagem do cliente que as antecedeu.
-- Termos ligados por "ou" (basta um); ordenadas pela relevância e pela data.
create function public.ldo_support_ai_replies(p_token text, p_query text, p_exclude uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_terms text := btrim(regexp_replace(left(coalesce(p_query, ''), 200), '[^[:alnum:][:space:]-]+', ' ', 'g'));
  v_query tsquery;
begin
  perform ldo_private.bi_check(p_token);
  if v_terms = '' then
    return '[]'::jsonb;
  end if;
  v_query := websearch_to_tsquery('portuguese'::regconfig, array_to_string(regexp_split_to_array(v_terms, '\s+'), ' or '));
  if v_query is null or numnode(v_query) = 0 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('channel', r.channel, 'created_at', r.created_at, 'reply', left(r.body, 1200),
      'customer_message', (select left(i.body, 600) from public.ldo_support_messages i
        where i.conversation_id = r.conversation_id and i.kind = 'inbound' and i.deleted_at is null and i.created_at <= r.created_at
        order by i.created_at desc limit 1)) order by r.rank desc, r.created_at desc)
    from (
      select m.conversation_id, m.body, m.created_at, c.channel,
        ts_rank(to_tsvector('portuguese'::regconfig, m.body), v_query) as rank
      from public.ldo_support_messages m join public.ldo_support_conversations c on c.id = m.conversation_id
      where m.kind = 'outbound' and m.deleted_at is null and m.conversation_id is distinct from p_exclude
        and coalesce(m.delivery, 'accepted') not in ('failed', 'sending', 'uncertain')
        and to_tsvector('portuguese'::regconfig, m.body) @@ v_query
      order by rank desc, m.created_at desc
      limit 6
    ) r), '[]'::jsonb);
end;
$$;

-- Outras conversas do mesmo cliente (o mesmo contacto ou o mesmo email/telefone noutro canal),
-- com as últimas mensagens de cada uma.
create function public.ldo_support_ai_customer_history(p_token text, p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_k public.ldo_support_contacts;
  v_email text;
  v_phone text;
begin
  perform ldo_private.bi_check(p_token);
  select k.* into v_k from public.ldo_support_conversations c join public.ldo_support_contacts k on k.id = c.contact_id
  where c.id = p_conversation;
  if v_k.id is null then
    return '[]'::jsonb;
  end if;
  v_email := lower(coalesce(v_k.linked_email, v_k.email));
  v_phone := nullif(regexp_replace(coalesce(v_k.phone, ''), '\D', '', 'g'), '');
  return coalesce((
    select jsonb_agg(jsonb_build_object('channel', c.channel, 'subject', c.subject, 'status', c.status,
      'last_message_at', c.last_message_at,
      'messages', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'author', m.author_name,
          'body', left(m.body, 800), 'created_at', m.created_at) order by m.created_at)
        from (select * from public.ldo_support_messages where conversation_id = c.id and deleted_at is null
              order by created_at desc limit 6) m), '[]'::jsonb)) order by c.last_message_at desc nulls last)
    from (
      select c.* from public.ldo_support_conversations c join public.ldo_support_contacts k on k.id = c.contact_id
      where c.id <> p_conversation and (
        k.id = v_k.id
        or (v_email is not null and v_email in (lower(k.email), lower(k.linked_email)))
        or (v_phone is not null and v_phone = regexp_replace(coalesce(k.phone, ''), '\D', '', 'g')))
      order by c.last_message_at desc nulls last
      limit 4
    ) c), '[]'::jsonb);
end;
$$;

-- Pedidos à IA com mais de 180 dias são apagados (corre na passagem diária).
create function public.ldo_support_ai_purge(p_token text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_n integer;
begin
  perform ldo_private.bi_check(p_token);
  delete from public.ldo_support_ai_messages where created_at < now() - interval '180 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------- administração (Super Admin)

create function public.ldo_support_ai_admin(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
              where created_at >= v_month group by user_id) x join public.ldo_app_users u on u.id = x.user_id), '[]'::jsonb))
  );
end;
$$;

create function public.ldo_support_ai_save_settings(p_session text, p_enabled boolean, p_daily_limit integer, p_monthly_budget numeric) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if p_daily_limit is null or p_daily_limit not between 0 and 1000 then
    raise exception 'Limite diário entre 0 e 1000 pedidos por pessoa.' using errcode = '22023';
  end if;
  if p_monthly_budget is null or p_monthly_budget < 0 or p_monthly_budget > 10000 then
    raise exception 'Orçamento mensal entre 0 e 10000 dólares.' using errcode = '22023';
  end if;
  update public.ldo_support_settings set ai_enabled = coalesce(p_enabled, false), ai_daily_limit = p_daily_limit,
    ai_monthly_budget = round(p_monthly_budget, 2), updated_by = v_me, updated_at = now() where id = 1;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'ai.settings', jsonb_build_object('enabled', coalesce(p_enabled, false), 'daily_limit', p_daily_limit, 'monthly_budget', round(p_monthly_budget, 2)));
end;
$$;

-- Cria (p_id nulo) ou altera uma secção da base de conhecimento. Devolve o id.
create function public.ldo_support_knowledge_save(p_session text, p_id uuid, p_title text, p_body text, p_position integer) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Só o Super Admin edita a base de conhecimento.' using errcode = '42501';
  end if;
  if length(v_title) not between 1 and 120 then
    raise exception 'Título entre 1 e 120 caracteres.' using errcode = '22023';
  end if;
  if length(v_body) > 20000 then
    raise exception 'Texto demasiado longo (máximo 20 000 caracteres por secção).' using errcode = '22023';
  end if;
  if coalesce(p_position, 0) not between 0 and 10000 then
    raise exception 'Ordem entre 0 e 10000.' using errcode = '22023';
  end if;
  if (select coalesce(sum(length(body)), 0) from public.ldo_support_knowledge where id is distinct from p_id) + length(v_body) > 150000 then
    raise exception 'A base de conhecimento ultrapassa 150 000 caracteres no total. Resuma ou apague secções.' using errcode = '22023';
  end if;
  if p_id is null then
    if (select count(*) from public.ldo_support_knowledge) >= 60 then
      raise exception 'Máximo de 60 secções.' using errcode = '22023';
    end if;
    insert into public.ldo_support_knowledge (title, body, position, updated_by)
    values (v_title, v_body, coalesce(p_position, 0), v_me) returning id into v_id;
  else
    update public.ldo_support_knowledge set title = v_title, body = v_body, position = coalesce(p_position, position),
      updated_by = v_me, updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Secção não encontrada.' using errcode = 'P0002';
    end if;
  end if;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'ai.knowledge', jsonb_build_object('id', v_id, 'title', v_title, 'length', length(v_body)));
  return v_id;
end;
$$;

create function public.ldo_support_knowledge_delete(p_session text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_title text;
begin
  if v_me is null then
    raise exception 'Só o Super Admin edita a base de conhecimento.' using errcode = '42501';
  end if;
  delete from public.ldo_support_knowledge where id = p_id returning title into v_title;
  if v_title is not null then
    insert into public.ldo_support_audit (actor, action, details)
    values (v_me, 'ai.knowledge_delete', jsonb_build_object('id', p_id, 'title', v_title));
  end if;
end;
$$;

-- ---------------------------------------------------------------- acessos

revoke all on function ldo_private.support_lisbon_start(text), ldo_private.support_ai_month_cost() from public, anon, authenticated;
revoke all on function
  public.ldo_support_ai_begin(text, uuid, text, text),
  public.ldo_support_ai_finish(text, uuid, text, text, text, jsonb, jsonb, text, jsonb, numeric, text),
  public.ldo_support_ai_history(text, uuid),
  public.ldo_support_ai_replies(text, text, uuid),
  public.ldo_support_ai_customer_history(text, uuid),
  public.ldo_support_ai_purge(text),
  public.ldo_support_ai_admin(text),
  public.ldo_support_ai_save_settings(text, boolean, integer, numeric),
  public.ldo_support_knowledge_save(text, uuid, text, text, integer),
  public.ldo_support_knowledge_delete(text, uuid)
from public, authenticated;
grant execute on function
  public.ldo_support_ai_begin(text, uuid, text, text),
  public.ldo_support_ai_finish(text, uuid, text, text, text, jsonb, jsonb, text, jsonb, numeric, text),
  public.ldo_support_ai_history(text, uuid),
  public.ldo_support_ai_replies(text, text, uuid),
  public.ldo_support_ai_customer_history(text, uuid),
  public.ldo_support_ai_purge(text),
  public.ldo_support_ai_admin(text),
  public.ldo_support_ai_save_settings(text, boolean, integer, numeric),
  public.ldo_support_knowledge_save(text, uuid, text, text, integer),
  public.ldo_support_knowledge_delete(text, uuid)
to anon;
