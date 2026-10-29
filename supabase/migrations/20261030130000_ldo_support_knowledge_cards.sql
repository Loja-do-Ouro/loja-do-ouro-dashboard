-- Apoio ao Cliente: base de conhecimento aprendida (cartões).
--
-- Nenhum modelo é treinado com as conversas. A IA (Claude Sonnet 5.5) lê uma conversa já respondida pela equipa e
-- propõe um cartão: uma pergunta genérica e a resposta da empresa, sem nomes, contactos nem números de encomenda. O
-- Super Admin aprova, corrige, junta ou arquiva; só os cartões aprovados E publicados entram no bloco da base de
-- conhecimento das propostas de resposta (ldo_support_ai_begin), e o texto publicado só muda quando se publica (a cache
-- de 1 h da IA é reescrita uma vez por publicação; arquivar retira logo).
-- * As mensagens nunca são copiadas: as fontes contam-se (fontes: um por contacto identificável, nunca o chat do site
--   anónimo). amostras: até 3 conversas de origem de uma proposta, para o Super Admin a confirmar; apagadas ao aprovar ou
--   arquivar. No registo de pedidos, a conversa e a mensagem de origem de um cartão apagam-se quando o cartão é
--   aprovado, arquivado ou junto a outro, ou ao fim de 30 dias. Para contar cada contacto uma vez fica, em cada pedido
--   que contou, uma chave pseudónima do contacto: HMAC-SHA256 do id do contacto com um segredo aleatório de 32 bytes
--   gerado nesta migração e guardado só em ldo_private.support_knowledge_secret (sem acesso para public, anon,
--   authenticated nem service_role). A chave é a mesma em todos os cartões (as respostas juntas continuam a contar cada
--   contacto uma vez) e sem o segredo não se chega ao contacto; apaga-se com o pedido, ao fim de 365 dias. Para cada
--   resposta só ser proposta uma vez pelo botão fica uma chave do mesmo tipo da mensagem e o dia, sem o cartão nem a
--   conversa (ldo_support_knowledge_used), também 365 dias. Os pedidos sem cartão guardam a conversa (sem texto) 180
--   dias, para não a ler outra vez; as conversas vistas guardam até que resposta da equipa foram lidas, não a hora do
--   pedido.
-- * Duas origens: o botão "Guardar como resposta aprovada" numa resposta enviada pelo dashboard (a própria pessoa ou o
--   Super Admin; funciona sempre, com orçamento) e a passagem diária (support-sync), só com "Propostas automáticas a
--   partir das conversas" ligada (desligada por omissão): conversas com resposta da equipa pelo dashboard desde o
--   histórico visível (e nos últimos 170 dias, dentro dos 180 em que as conversas vistas ficam registadas), resolvidas ou
--   sem atividade há 72 h, ainda não lidas com êxito (ou com respostas novas desde então). Uma conversa só fica vista
--   quando o pedido acaba bem; com erro tenta-se outra vez no dia seguinte, no máximo duas vezes por resposta nova.
-- * Recusas na BD ao gravar um cartão: emails fora dos domínios da empresa, IBAN/NIF e números de encomenda. O resto
--   (nomes, telefones, moradas, perfis, códigos, factos que a equipa não escreveu) é verificado no servidor
--   (lib/support/knowledge-rules.ts), também nas correções do Super Admin antes de aprovar e de publicar.
-- * "Permitir em respostas automáticas" (auto_ok) só marca o cartão para as respostas automáticas futuras: nada aqui
--   envia mensagens. Só 7 dias depois de aprovado ou da última correção do texto (texto_em), revisto há menos de 90 dias,
--   publicado tal como está, com a loja nos temas de uma loja e sem outro cartão automático para a mesma loja. Qualquer
--   correção ou junção tira a marca; a limpeza diária tira-a aos cartões expirados ou por rever há mais de 90 dias.
-- * Orçamento próprio (US$ 8 por omissão), 30 propostas pelo botão por pessoa e por dia, 300 propostas por rever.
-- * Limpeza diária: registo de pedidos e respostas já guardadas ao fim de 365 dias, conversas vistas ao fim de 180,
--   propostas sem novas fontes ao fim de 180 dias e cartões arquivados ao fim de 365.
-- Funções alteradas, a partir do texto em produção a 30-10-2026 (pg_get_functiondef):
-- * ldo_support_ai_admin (md5 adc9e6bb1fb5ded3040b60f127147471, já com o bloco 'review' de 20261030110000): cópia
--   igual, mais o bloco 'cards' com os totais do mês.
-- * ldo_support_ai_begin (md5 1170ee82f3b205e00a4ba8caa1bfe249): alteração ancorada (replace no texto em produção, que
--   falha se a âncora não existir) que acrescenta 'cards' (as respostas publicadas) ao que devolve.
-- Ambas mantêm os privilégios (create or replace). Depende de 20261030100000 e 20261030110000.

-- ---------------------------------------------------------------- definições

alter table public.ldo_support_settings
  add column if not exists knowledge_auto_proposals boolean not null default false,
  add column if not exists knowledge_monthly_budget numeric(10, 2) not null default 8
    check (knowledge_monthly_budget between 0 and 10000);

-- ---------------------------------------------------------------- tabelas

create table public.ldo_support_knowledge_cards (
  id uuid primary key default gen_random_uuid(),
  intent text not null check (intent in ('saudacao', 'horario_loja', 'morada_loja', 'contactos', 'envios_gerais', 'pagamentos_gerais',
    'trocas_devolucoes', 'garantia_reparacoes', 'gravacoes', 'medidas_tamanhos', 'materiais_cuidados', 'compra_ouro', 'encomendas',
    'produtos', 'outro')),
  brand text not null default 'ldo' check (brand in ('ldo', 'gsp', 'ambas')),
  loja_id uuid references public.ldo_app_stores (id) on delete set null,
  pergunta text not null check (length(btrim(pergunta)) between 5 and 300),
  variantes text[] not null default '{}' check (cardinality(variantes) <= 5 and length(array_to_string(variantes, '|')) <= 1004),
  resposta text not null check (length(btrim(resposta)) between 1 and 1500),
  estado text not null default 'proposta' check (estado in ('proposta', 'aprovada', 'arquivada')),
  auto_ok boolean not null default false,
  auto_ok_em timestamptz,
  fontes integer not null default 0 check (fontes >= 0),
  ultima_vez timestamptz not null default now(),
  amostras uuid[] not null default '{}' check (cardinality(amostras) <= 3),
  -- Cartões juntos a este ("Juntar a…", também os que já tinham sido juntos a esses): as fontes deles contam como deste
  -- (o mesmo contacto conta uma vez).
  juntadas uuid[] not null default '{}',
  valido_ate date,
  revisto_em date,
  criada_por text not null default 'ia' check (criada_por in ('ia', 'pessoa')),
  aprovada_por uuid references public.ldo_app_users (id) on delete set null,
  aprovada_em timestamptz,
  -- Aprovação ou última correção do texto de uma resposta aprovada (os 7 dias de "Permitir em respostas automáticas").
  texto_em timestamptz,
  publicada_em timestamptz,
  -- Texto em uso pela IA desde a última publicação (tema, marca, loja, pergunta, variantes, resposta e validade); null =
  -- não publicado.
  publicado jsonb,
  -- Pesquisa (cartões parecidos e procura na configuração), mantida pelo gatilho: array_to_string não é immutable.
  fts tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id) on delete set null,
  check (estado = 'proposta' or cardinality(amostras) = 0),
  check (estado <> 'aprovada' or (aprovada_em is not null and texto_em is not null)),
  check (not auto_ok or (estado = 'aprovada' and auto_ok_em is not null)),
  check (not auto_ok or intent not in ('horario_loja', 'morada_loja', 'contactos') or loja_id is not null)
);
create index ldo_support_knowledge_cards_fts_idx on public.ldo_support_knowledge_cards using gin (fts);
create index ldo_support_knowledge_cards_estado_idx on public.ldo_support_knowledge_cards (estado, ultima_vez desc);
-- Nunca duas respostas automáticas para o mesmo tema de uma loja (e a mesma marca).
create unique index ldo_support_knowledge_cards_auto_loja_idx on public.ldo_support_knowledge_cards (intent, loja_id, brand)
  where auto_ok and estado = 'aprovada' and intent in ('horario_loja', 'morada_loja', 'contactos');
alter table public.ldo_support_knowledge_cards enable row level security;
revoke all on public.ldo_support_knowledge_cards from anon, authenticated;

-- Conversas já lidas pela passagem diária: o id e até que resposta da equipa foram lidas (processed_at = a hora da última
-- resposta da equipa lida, não a hora do pedido, que ligaria a conversa ao pedido e ao cartão).
create table public.ldo_support_knowledge_seen (
  conversation_id uuid primary key references public.ldo_support_conversations (id) on delete cascade,
  processed_at timestamptz not null default now()
);
alter table public.ldo_support_knowledge_seen enable row level security;
revoke all on public.ldo_support_knowledge_seen from anon, authenticated;

-- Segredo das chaves pseudónimas (contactos que confirmaram uma resposta e respostas já guardadas pelo botão): 32 bytes
-- aleatórios gerados aqui, que não saem da BD. Ninguém da API o lê (nem service_role); só as funções desta migração.
create table ldo_private.support_knowledge_secret (
  id integer primary key check (id = 1),
  secret bytea not null check (length(secret) = 32)
);
insert into ldo_private.support_knowledge_secret (id, secret) values (1, extensions.gen_random_bytes(32));
alter table ldo_private.support_knowledge_secret enable row level security;
revoke all on ldo_private.support_knowledge_secret from public, anon, authenticated, service_role;

-- Respostas já guardadas pelo botão "Guardar como resposta aprovada" (uma proposta por resposta, mesmo depois de a
-- ligação do pedido à mensagem se apagar): só a chave pseudónima da mensagem e o dia, sem o cartão nem a conversa.
-- Apagadas ao fim de 365 dias.
create table public.ldo_support_knowledge_used (
  message_key text primary key check (message_key ~ '^[0-9a-f]{64}$'),
  used_on date not null default ((now() at time zone 'Europe/Lisbon')::date)
);
alter table public.ldo_support_knowledge_used enable row level security;
revoke all on public.ldo_support_knowledge_used from anon, authenticated;

-- Pedidos à IA (custo, resultado e o cartão), sem texto: o motivo de uma proposta retirada é só um código. A conversa e
-- a mensagem de origem só ficam enquanto são precisas (proposta por decidir, até 30 dias). contact_key: chave
-- pseudónima do contacto (HMAC-SHA256 com o segredo acima, igual em todos os cartões), só nos pedidos que contaram uma
-- fonte, para não contar o mesmo contacto duas vezes; sem o segredo não se chega ao contacto. Apagada com o pedido.
create table public.ldo_support_knowledge_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('botao', 'diaria')),
  user_id uuid references public.ldo_app_users (id) on delete set null,
  conversation_id uuid references public.ldo_support_conversations (id) on delete set null,
  message_id uuid references public.ldo_support_messages (id) on delete set null,
  contact_key text check (contact_key ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  resultado text check (resultado in ('novo', 'existente', 'nao_aproveitavel', 'descartado')),
  descartado text check (descartado in ('dados_pessoais', 'numero_novo', 'ligacao_nova', 'politica_nova', 'contacto_novo', 'copia_cliente',
    'marca', 'formato', 'limite')),
  card_id uuid references public.ldo_support_knowledge_cards (id) on delete set null,
  model text check (length(model) <= 60),
  cost_usd numeric(10, 5) not null default 0 check (cost_usd >= 0),
  latency_ms integer check (latency_ms >= 0),
  error text check (length(error) <= 500)
);
create index ldo_support_knowledge_runs_created_idx on public.ldo_support_knowledge_runs (created_at);
create index ldo_support_knowledge_runs_user_idx on public.ldo_support_knowledge_runs (user_id, created_at);
create index ldo_support_knowledge_runs_message_idx on public.ldo_support_knowledge_runs (message_id);
create index ldo_support_knowledge_runs_card_idx on public.ldo_support_knowledge_runs (card_id, contact_key);
create index ldo_support_knowledge_runs_conversation_idx on public.ldo_support_knowledge_runs (conversation_id, created_at);
alter table public.ldo_support_knowledge_runs enable row level security;
revoke all on public.ldo_support_knowledge_runs from anon, authenticated;

-- ---------------------------------------------------------------- auxiliares

-- Chave pseudónima (64 algarismos hexadecimais) de um contacto ('contacto') ou de uma mensagem ('mensagem'):
-- HMAC-SHA256 com o segredo de ldo_private.support_knowledge_secret (pgcrypto, no esquema extensions). Igual para o mesmo
-- id, seja qual for o cartão; null sem id ou sem segredo (quem a usa decide: não contar, ou recusar o pedido).
create function ldo_private.support_knowledge_key(p_kind text, p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(convert_to(p_kind || ':' || p_id::text, 'UTF8'), s.secret, 'sha256'), 'hex')
  from ldo_private.support_knowledge_secret s
  where s.id = 1 and p_id is not null and p_kind in ('contacto', 'mensagem');
$$;

create function ldo_private.support_card_fts() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.fts := to_tsvector('portuguese'::regconfig,
    new.pergunta || ' ' || array_to_string(coalesce(new.variantes, '{}'), ' ') || ' ' || new.resposta);
  return new;
end;
$$;
create trigger ldo_support_knowledge_cards_fts before insert or update of pergunta, variantes, resposta
  on public.ldo_support_knowledge_cards for each row execute function ldo_private.support_card_fts();

-- Texto de um cartão como fica publicado (comparado com publicado para saber o que falta publicar).
create function ldo_private.support_card_content(c public.ldo_support_knowledge_cards) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('intent', c.intent, 'brand', c.brand, 'loja_id', c.loja_id, 'pergunta', c.pergunta,
    'variantes', to_jsonb(c.variantes), 'resposta', c.resposta, 'valido_ate', c.valido_ate);
$$;

-- Dados que nunca ficam num cartão (mesmas regras no servidor, com mais algumas): emails fora dos domínios da empresa,
-- IBAN ou NIF e números de encomenda (logo a seguir, com palavras pelo meio e "nº" ou "#", ou com letras: "LDO12345").
-- Devolve o motivo (ou null).
create function ldo_private.support_card_problem(p_text text) returns text
language sql immutable set search_path = '' as $$
  select case
    when exists (select 1 from regexp_matches(coalesce(p_text, ''), '[[:alnum:]._%+-]+@([[:alnum:].-]+\.[[:alpha:]]{2,})', 'g') as m(g)
        where lower(m.g[1]) !~ '(^|\.)(lojadoouro\.pt|goldstorepremium\.com)$')
      then 'O texto tem um email que não é da empresa.'
    when coalesce(p_text, '') ~* '\m(nif|nipc|contribuinte)\M[^0-9]{0,20}[0-9]{9}' or coalesce(p_text, '') ~ '\m[A-Z]{2}[0-9]{2}( ?[A-Z0-9]{4}){4,7}'
      then 'O texto tem um IBAN ou um NIF.'
    when coalesce(p_text, '') ~* '\m(encomenda|pedido|order|fatura|factura)s?\M[[:space:]]*(n\.?[[:space:]]*[ºo°]|nº|n\.|número|numero|nr\.?|no\.)?[[:space:]]*:?[[:space:]]*#?[[:space:]]*[0-9]{3,}'
      or coalesce(p_text, '') ~ '#[[:space:]]?[0-9]{4,}'
      or coalesce(p_text, '') ~* '\m(encomenda|pedido|order|fatura|factura)s?\M[^0-9]{0,25}(n\.?[[:space:]]*[ºo°]|nº|número|numero|nr\.?|#)[[:space:]]*:?[[:space:]]*#?[[:space:]]*[a-z]{0,4}-?[0-9]{3,}'
      or coalesce(p_text, '') ~* '\m(encomenda|pedido|order|fatura|factura)s?[[:space:]]+#?[a-z]{2,4}-?[0-9]{3,}'
      or coalesce(p_text, '') ~* '#[a-z]{2,4}-?[0-9]{3,}'
      then 'O texto tem um número de encomenda.'
  end;
$$;

-- Variantes de uma pergunta: sem espaços a mais, sem vazias, sem repetidas (maiúsculas à parte) nem iguais à pergunta.
create function ldo_private.support_card_variants(p_values jsonb, p_pergunta text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(d.v order by d.pos), '{}') from (
    select distinct on (lower(a.v)) a.v, a.pos from (
      select regexp_replace(btrim(e.x), '\s+', ' ', 'g') as v, e.pos
      from jsonb_array_elements_text(case when jsonb_typeof(p_values) = 'array' then p_values else '[]'::jsonb end) with ordinality as e(x, pos)
    ) a
    where a.v <> '' and lower(a.v) <> lower(regexp_replace(btrim(coalesce(p_pergunta, '')), '\s+', ' ', 'g'))
    order by lower(a.v), a.pos
  ) d;
$$;

-- Validação de um cartão (null = válido): tema, marca, loja, limites, validade e dados que nunca ficam num cartão.
create function ldo_private.support_card_invalid(p_intent text, p_brand text, p_loja uuid, p_pergunta text, p_variantes text[],
  p_resposta text, p_valido_ate date) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_intent is null or p_intent not in ('saudacao', 'horario_loja', 'morada_loja', 'contactos', 'envios_gerais', 'pagamentos_gerais',
      'trocas_devolucoes', 'garantia_reparacoes', 'gravacoes', 'medidas_tamanhos', 'materiais_cuidados', 'compra_ouro', 'encomendas',
      'produtos', 'outro') then
    return 'Escolha o tema.';
  end if;
  if p_brand is null or p_brand not in ('ldo', 'gsp', 'ambas') then
    return 'Escolha a marca.';
  end if;
  if p_loja is not null and not exists (select 1 from public.ldo_app_stores s where s.id = p_loja) then
    return 'Loja desconhecida.';
  end if;
  if length(btrim(coalesce(p_pergunta, ''))) not between 5 and 300 then
    return 'A pergunta tem de ter entre 5 e 300 caracteres.';
  end if;
  if cardinality(coalesce(p_variantes, '{}')) > 5 or exists (select 1 from unnest(p_variantes) v where length(btrim(v)) not between 1 and 200) then
    return 'No máximo 5 outras formas da pergunta, cada uma com até 200 caracteres.';
  end if;
  if length(btrim(coalesce(p_resposta, ''))) not between 1 and 1500 then
    return 'A resposta tem de ter entre 1 e 1500 caracteres.';
  end if;
  if p_valido_ate is not null and p_valido_ate < (now() at time zone 'Europe/Lisbon')::date then
    return 'A data de validade já passou.';
  end if;
  return ldo_private.support_card_problem(concat_ws(E'\n', p_pergunta, array_to_string(p_variantes, E'\n'), p_resposta));
end;
$$;

-- Custo do mês das propostas: os pedidos em curso reservam US$ 0,05 durante 15 minutos; depois contam pelo custo gravado.
create function ldo_private.support_knowledge_month_cost() returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when status = 'pending' and created_at > now() - interval '15 minutes'
    then greatest(cost_usd, 0.05) else cost_usd end), 0)
  from public.ldo_support_knowledge_runs
  where created_at >= ldo_private.support_lisbon_start('month');
$$;

-- Respostas aprovadas e publicadas, ainda válidas, com o nome da loja (para ldo_support_ai_begin).
create function ldo_private.support_knowledge_published() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(c.publicado || jsonb_build_object('id', c.id,
      'loja', (select s.name from public.ldo_app_stores s where s.id = (c.publicado ->> 'loja_id')::uuid)) order by c.id), '[]'::jsonb)
  from public.ldo_support_knowledge_cards c
  where c.estado = 'aprovada' and c.publicado is not null
    and (c.publicado ->> 'valido_ate' is null or (c.publicado ->> 'valido_ate')::date >= (now() at time zone 'Europe/Lisbon')::date);
$$;

-- O que o servidor precisa para pedir uma proposta: a conversa (últimas 30 mensagens desde o histórico visível e até à
-- resposta escolhida, sem notas internas nem envios falhados), a base de conhecimento e as lojas (lista de dados da
-- empresa aceites num cartão), os nomes da equipa (nunca num cartão), os contactos do apoio e até 5 cartões parecidos.
create function ldo_private.support_knowledge_payload(p_run uuid, p_conv uuid, p_until timestamptz, p_focus uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.ldo_support_conversations;
  v_from timestamptz := ldo_private.support_history_from();
  v_terms text;
  v_query tsquery;
begin
  select * into v_c from public.ldo_support_conversations where id = p_conv;
  -- Cartões parecidos: pesquisa com as palavras das últimas respostas da equipa (só palavras, sem números nem contactos).
  select string_agg(w.w, ' or ') into v_terms from (
    select distinct x.w from regexp_split_to_table(lower(regexp_replace(coalesce((
        select string_agg(m.body, ' ') from (select body from public.ldo_support_messages
          where conversation_id = p_conv and kind = 'outbound' and author_user_id is not null and deleted_at is null
            and created_at >= v_from and created_at <= p_until
          order by created_at desc limit 10) m), ''),
      '[^[:alpha:][:space:]]+', ' ', 'g')), '\s+') as x(w)
    where length(x.w) >= 4
    limit 40) w;
  v_query := case when v_terms is null then null else websearch_to_tsquery('portuguese'::regconfig, v_terms) end;
  return jsonb_build_object(
    'id', p_run,
    'model', 'claude-sonnet-5-5',
    'conversation', jsonb_build_object('id', v_c.id, 'channel', v_c.channel, 'account', v_c.account,
      'site', case when v_c.channel = 'site' then (select v.site from public.ldo_support_site_visitors v
        where v.conversation_id = v_c.id order by v.last_seen_at desc limit 1) end,
      'contact_name', (select k.name from public.ldo_support_contacts k where k.id = v_c.contact_id),
      'contact_handle', (select k.handle from public.ldo_support_contacts k where k.id = v_c.contact_id)),
    'focus', p_focus,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'dashboard', m.author_user_id is not null, 'body', left(m.body, 1500),
        'created_at', m.created_at) order by m.created_at, m.inserted_at)
      from (select * from public.ldo_support_messages
            where conversation_id = p_conv and kind in ('inbound', 'outbound') and deleted_at is null
              and coalesce(delivery, 'accepted') not in ('failed', 'sending', 'uncertain')
              and created_at >= v_from and created_at <= p_until
            order by created_at desc, inserted_at desc limit 30) m), '[]'::jsonb),
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('title', k.title, 'body', k.body) order by k.position, k.title, k.id)
      from public.ldo_support_knowledge k where btrim(k.body) <> ''), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'city', s.city) order by s.name)
      from public.ldo_app_stores s where s.active), '[]'::jsonb),
    'staff_names', coalesce((
      select jsonb_agg(distinct n.n) from (
        select u.full_name as n from public.ldo_app_users u where (u.support_access or u.is_super_admin) and u.full_name is not null
        union select u.username from public.ldo_app_users u where (u.support_access or u.is_super_admin) and u.username is not null
        union select m.author_name from public.ldo_support_messages m where m.conversation_id = p_conv and m.author_name is not null) n), '[]'::jsonb),
    'company', coalesce((
      select jsonb_agg(x.t) from (
        select distinct c.account as t from public.ldo_support_conversations c where c.channel = 'email' and c.account like '%@%'
        union select s.email_signature from public.ldo_support_settings s where s.id = 1) x where x.t is not null), '[]'::jsonb),
    'similar', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'intent', k.intent, 'estado', k.estado, 'pergunta', k.pergunta,
        'resposta', left(k.resposta, 600)) order by k.r desc, k.id)
      from (select c.id, c.intent, c.estado, c.pergunta, c.resposta, ts_rank(c.fts, v_query) as r
            from public.ldo_support_knowledge_cards c
            where v_query is not null and numnode(v_query) > 0 and c.estado <> 'arquivada' and c.fts @@ v_query
            order by r desc, c.id limit 5) k), '[]'::jsonb),
    'today', to_char((now() at time zone 'Europe/Lisbon')::date, 'YYYY-MM-DD')
  );
end;
$$;

-- ---------------------------------------------------------------- propostas (sessão e servidor)

-- Botão "Guardar como resposta aprovada" numa resposta enviada pelo dashboard: a própria pessoa ou o Super Admin. Funciona
-- com as propostas automáticas desligadas; conta para o orçamento e para o limite de 30 por pessoa e por dia. Cada
-- resposta dá no máximo uma proposta (nova ou confirmação de uma que já existe); depois de um erro, de uma proposta
-- retirada ou sem pergunta geral pode tentar-se outra vez.
create function public.ldo_support_knowledge_from_message(p_session text, p_message_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_super boolean := ldo_private.support_super(p_session) is not null;
  v_s public.ldo_support_settings;
  v_m public.ldo_support_messages;
  v_key text;
  v_id uuid;
begin
  select * into v_m from public.ldo_support_messages where id = p_message_id;
  if v_m.id is null or v_m.kind <> 'outbound' or v_m.author_user_id is null or v_m.deleted_at is not null then
    raise exception 'Só uma resposta enviada pelo dashboard pode ser guardada como resposta aprovada.' using errcode = '22023';
  end if;
  if v_m.author_user_id <> v_me and not v_super then
    raise exception 'Só pode guardar as suas próprias respostas.' using errcode = '42501';
  end if;
  if coalesce(v_m.delivery, 'accepted') in ('failed', 'sending', 'uncertain') then
    raise exception 'Esta resposta ainda não está confirmada como enviada.' using errcode = '22023';
  end if;
  if v_m.created_at < ldo_private.support_history_from() then
    raise exception 'Esta resposta é anterior ao histórico visível do apoio.' using errcode = '22023';
  end if;
  if length(btrim(v_m.body)) < 20 then
    raise exception 'Resposta demasiado curta para guardar como resposta aprovada.' using errcode = '22023';
  end if;
  select * into v_s from public.ldo_support_settings where id = 1;
  v_key := ldo_private.support_knowledge_key('mensagem', v_m.id);
  if v_key is null then
    raise exception 'Falta o segredo da base de conhecimento aprendida (migração incompleta).' using errcode = '55000';
  end if;
  -- Um pedido de cada vez por pessoa na contagem e por resposta (dois cliques seguidos, da pessoa e do Super Admin, não
  -- passam ambos).
  perform pg_advisory_xact_lock(hashtextextended('ldo_support_knowledge:' || v_me::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('ldo_support_knowledge_msg:' || v_m.id::text, 0));
  -- Uma proposta por resposta: as já guardadas ficam em ldo_support_knowledge_used (só a chave, sem o cartão), porque a
  -- ligação do pedido à mensagem apaga-se ao aprovar, arquivar ou juntar o cartão e ao fim de 30 dias.
  if exists (select 1 from public.ldo_support_knowledge_used u where u.message_key = v_key)
     or exists (select 1 from public.ldo_support_knowledge_runs r where r.message_id = v_m.id
       and r.status = 'pending' and r.created_at > now() - interval '2 minutes') then
    raise exception 'Esta resposta já foi guardada (ou está a ser preparada).' using errcode = '22023';
  end if;
  if (select count(*) from public.ldo_support_knowledge_runs r
      where r.user_id = v_me and r.trigger = 'botao' and r.created_at >= ldo_private.support_lisbon_start('day')) >= 30 then
    raise exception 'Atingiu o limite diário de 30 respostas guardadas.' using errcode = '42501';
  end if;
  if ldo_private.support_knowledge_month_cost() >= v_s.knowledge_monthly_budget then
    raise exception 'Orçamento mensal da base de conhecimento aprendida esgotado: US$ %', v_s.knowledge_monthly_budget using errcode = '42501';
  end if;
  insert into public.ldo_support_knowledge_runs (trigger, user_id, conversation_id, message_id, model)
  values ('botao', v_me, v_m.conversation_id, v_m.id, 'claude-sonnet-5-5') returning id into v_id;
  return ldo_private.support_knowledge_payload(v_id, v_m.conversation_id, v_m.created_at, v_m.id);
end;
$$;

-- Passagem diária: conversas a ler (vazia com as propostas automáticas desligadas, sem orçamento ou com 300 propostas
-- por rever). Com resposta da equipa pelo dashboard desde o histórico visível e nos últimos 170 dias (as conversas vistas
-- ficam registadas 180 dias: uma conversa já lida nunca volta à lista por a limpeza a esquecer), resolvidas ou sem
-- atividade há 72 h, e não lidas com êxito desde a última dessas respostas. Sem as que falharam nas últimas 20 h (a
-- passagem é diária: tenta-se outra vez no dia seguinte) nem as que já falharam duas vezes desde essa resposta. As mais
-- recentes primeiro.
create function public.ldo_support_knowledge_candidates(p_token text, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.ldo_support_settings;
  v_from timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_s from public.ldo_support_settings where id = 1;
  if not v_s.knowledge_auto_proposals or ldo_private.support_knowledge_month_cost() >= v_s.knowledge_monthly_budget
     or (select count(*) from public.ldo_support_knowledge_cards where estado = 'proposta') >= 300 then
    return '[]'::jsonb;
  end if;
  v_from := greatest(ldo_private.support_history_from(), now() - interval '170 days');
  return coalesce((select jsonb_agg(x.id order by x.last_reply desc) from (
    select c.id, r.last_reply
    from public.ldo_support_conversations c
    cross join lateral (select max(m.created_at) as last_reply from public.ldo_support_messages m
      where m.conversation_id = c.id and m.kind = 'outbound' and m.author_user_id is not null and m.deleted_at is null
        and coalesce(m.delivery, 'accepted') not in ('failed', 'sending', 'uncertain') and m.created_at >= v_from) r
    left join public.ldo_support_knowledge_seen s on s.conversation_id = c.id
    where r.last_reply is not null
      and (c.status = 'resolvido' or coalesce(c.last_message_at, c.created_at) < now() - interval '72 hours')
      and (s.conversation_id is null or s.processed_at < r.last_reply)
      -- Falhas: erro ou pedido que ficou a meio (a função terminou antes de gravar o resultado).
      and not exists (select 1 from public.ldo_support_knowledge_runs e where e.conversation_id = c.id and e.trigger = 'diaria'
        and (e.status = 'error' or (e.status = 'pending' and e.created_at < now() - interval '15 minutes'))
        and e.created_at > now() - interval '20 hours')
      and (select count(*) from public.ldo_support_knowledge_runs e where e.conversation_id = c.id and e.trigger = 'diaria'
        and (e.status = 'error' or (e.status = 'pending' and e.created_at < now() - interval '15 minutes'))
        and e.created_at >= r.last_reply) < 2
    order by r.last_reply desc
    limit least(greatest(coalesce(p_limit, 12), 1), 12)) x), '[]'::jsonb);
end;
$$;

-- Passagem diária, uma conversa: confirma de novo a definição e o orçamento (null = parar) e regista o pedido antes de
-- chamar a IA. A conversa só fica vista quando o pedido acaba bem (ldo_support_knowledge_propose).
create function public.ldo_support_knowledge_begin(p_token text, p_conversation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.ldo_support_settings;
  v_id uuid;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_s from public.ldo_support_settings where id = 1;
  if not v_s.knowledge_auto_proposals or ldo_private.support_knowledge_month_cost() >= v_s.knowledge_monthly_budget
     or not exists (select 1 from public.ldo_support_conversations where id = p_conversation_id) then
    return null;
  end if;
  insert into public.ldo_support_knowledge_runs (trigger, conversation_id, model)
  values ('diaria', p_conversation_id, 'claude-sonnet-5-5') returning id into v_id;
  return ldo_private.support_knowledge_payload(v_id, p_conversation_id, now(), null);
end;
$$;

-- Resultado de um pedido (só o servidor), gravado logo a seguir à chamada à IA, uma vez. p_values: status ('done' ou
-- 'error'), resultado ('novo', 'existente', 'nao_aproveitavel', 'descartado'), descartado (código), cost, model,
-- latency_ms, error, card_id (cartão existente) e card (tema, marca, loja_id, pergunta, variantes, resposta, valido_ate).
-- Um cartão que a BD recusa fica como proposta retirada, sem perder o custo. Uma fonte conta uma vez por contacto e só
-- se o contacto for identificável (no chat do site, sessão confirmada na loja ou email associado pela equipa); para isso
-- fica no pedido a chave pseudónima do contacto (support_knowledge_key), não o contacto, e conta-se contra o cartão e os
-- que lhe foram juntos. Um cartão existente que entretanto foi junto a outro conta para esse outro. Uma resposta
-- guardada pelo botão fica em ldo_support_knowledge_used (só a chave da mensagem). Na passagem diária, um pedido acabado
-- (status 'done') marca a conversa como vista até à última resposta da equipa lida.
create function public.ldo_support_knowledge_propose(p_token text, p_run uuid, p_values jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.ldo_support_knowledge_runs;
  v_conv public.ldo_support_conversations;
  v_target public.ldo_support_knowledge_cards;
  v_status text := p_values ->> 'status';
  v_res text := p_values ->> 'resultado';
  v_desc text := p_values ->> 'descartado';
  v_card jsonb := coalesce(p_values -> 'card', '{}'::jsonb);
  v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_existing uuid;
  v_loja uuid;
  v_valido date;
  v_variantes text[];
  v_problem text;
  v_counts boolean := false;
  v_key text;
  v_card_id uuid;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_r from public.ldo_support_knowledge_runs where id = p_run for update;
  if v_r.id is null or v_r.status <> 'pending' then
    return jsonb_build_object('resultado', null);
  end if;
  if v_status is null or v_status not in ('done', 'error') then
    v_status := 'error';
  end if;
  if v_status = 'error' or v_res is null or v_res not in ('novo', 'existente', 'nao_aproveitavel', 'descartado') then
    v_res := case when v_status = 'error' then null else 'descartado' end;
    v_desc := case when v_res = 'descartado' then 'formato' end;
  end if;
  select * into v_conv from public.ldo_support_conversations where id = v_r.conversation_id;
  if v_res = 'existente' then
    v_existing := case when coalesce(p_values ->> 'card_id', '') ~* v_uuid then (p_values ->> 'card_id')::uuid end;
    select * into v_target from public.ldo_support_knowledge_cards where id = v_existing and estado <> 'arquivada' for update;
    -- Junto a outro entre o pedido e a resposta da IA: conta para a resposta a que foi junto.
    if v_target.id is null and v_existing is not null then
      select * into v_target from public.ldo_support_knowledge_cards
      where v_existing = any (juntadas) and estado <> 'arquivada' order by updated_at desc limit 1 for update;
    end if;
    if v_target.id is null then
      v_res := 'descartado';
      v_desc := 'formato';
    end if;
  elsif v_res = 'novo' then
    v_loja := case when coalesce(v_card ->> 'loja_id', '') ~* v_uuid then (v_card ->> 'loja_id')::uuid end;
    -- Uma data impossível ("2026-02-31") fica sem validade, sem perder o registo do custo.
    begin
      v_valido := case when coalesce(v_card ->> 'valido_ate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_card ->> 'valido_ate')::date end;
    exception when others then
      v_valido := null;
    end;
    v_variantes := ldo_private.support_card_variants(v_card -> 'variantes', v_card ->> 'pergunta');
    v_problem := ldo_private.support_card_invalid(v_card ->> 'intent', coalesce(v_card ->> 'brand', 'ldo'), v_loja, btrim(v_card ->> 'pergunta'),
      v_variantes, btrim(v_card ->> 'resposta'), v_valido);
    if v_problem is not null then
      v_res := 'descartado';
      v_desc := case when ldo_private.support_card_problem(concat_ws(E'\n', v_card ->> 'pergunta', array_to_string(v_variantes, E'\n'),
        v_card ->> 'resposta')) is not null then 'dados_pessoais' else 'formato' end;
    elsif (select count(*) from public.ldo_support_knowledge_cards where estado = 'proposta') >= 300 then
      v_res := 'descartado';
      v_desc := 'limite';
    end if;
  end if;
  if v_res in ('novo', 'existente') and v_conv.id is not null and v_conv.contact_id is not null then
    v_counts := not (v_conv.channel = 'site'
      and not exists (select 1 from public.ldo_support_site_visitors v where v.conversation_id = v_conv.id and v.verified)
      and not exists (select 1 from public.ldo_support_contacts k where k.id = v_conv.contact_id and k.linked_email is not null));
    v_key := ldo_private.support_knowledge_key('contacto', v_conv.contact_id);
    -- Sem chave (sem segredo) não se conta: nunca a mesma pessoa duas vezes.
    v_counts := v_counts and v_key is not null;
    if v_counts and v_res = 'existente' then
      v_counts := not exists (select 1 from public.ldo_support_knowledge_runs r
        where r.id <> p_run and r.contact_key = v_key and (r.card_id = v_target.id or r.card_id = any (v_target.juntadas)));
    end if;
  end if;
  if v_res = 'novo' then
    insert into public.ldo_support_knowledge_cards (intent, brand, loja_id, pergunta, variantes, resposta, valido_ate, fontes, amostras, criada_por)
    values (v_card ->> 'intent', coalesce(v_card ->> 'brand', 'ldo'), v_loja, btrim(v_card ->> 'pergunta'), v_variantes, btrim(v_card ->> 'resposta'),
      v_valido, case when v_counts then 1 else 0 end, case when v_conv.id is null then '{}'::uuid[] else array[v_conv.id] end, 'ia')
    returning id into v_card_id;
  elsif v_res = 'existente' then
    update public.ldo_support_knowledge_cards set
      fontes = fontes + case when v_counts then 1 else 0 end,
      ultima_vez = now(),
      amostras = case when estado = 'proposta' and v_conv.id is not null and not (v_conv.id = any (amostras)) and cardinality(amostras) < 3
        then amostras || v_conv.id else amostras end
    where id = v_target.id;
    v_card_id := v_target.id;
  end if;
  update public.ldo_support_knowledge_runs set
    status = v_status,
    resultado = v_res,
    descartado = case when v_res = 'descartado' then coalesce(case when v_desc in ('dados_pessoais', 'numero_novo', 'ligacao_nova', 'politica_nova',
      'contacto_novo', 'copia_cliente', 'marca', 'formato', 'limite') then v_desc end, 'formato') end,
    card_id = v_card_id,
    contact_key = case when v_counts then v_key end,
    model = left(coalesce(p_values ->> 'model', model), 60),
    cost_usd = case when jsonb_typeof(p_values -> 'cost') = 'number' then least(greatest((p_values ->> 'cost')::numeric, 0), 99999) else 0 end,
    latency_ms = case when jsonb_typeof(p_values -> 'latency_ms') = 'number' then least(greatest(round((p_values ->> 'latency_ms')::numeric), 0), 600000)::integer end,
    error = left(p_values ->> 'error', 500),
    finished_at = now()
  where id = p_run;
  -- Botão: a resposta fica guardada (uma proposta por resposta), só pela chave da mensagem e o dia.
  if v_res in ('novo', 'existente') and v_r.message_id is not null then
    insert into public.ldo_support_knowledge_used (message_key)
    select k from (select ldo_private.support_knowledge_key('mensagem', v_r.message_id) as k) x where x.k is not null
    on conflict (message_key) do nothing;
  end if;
  -- Passagem diária: só com o pedido acabado (um erro tenta-se outra vez), a conversa fica vista até à última resposta da
  -- equipa que a IA leu (não à hora do pedido, que ligaria a conversa ao pedido e ao cartão).
  if v_status = 'done' and v_r.trigger = 'diaria' and v_conv.id is not null then
    insert into public.ldo_support_knowledge_seen (conversation_id, processed_at)
    select v_conv.id, coalesce(max(m.created_at), date_trunc('day', v_r.created_at))
    from public.ldo_support_messages m
    where m.conversation_id = v_conv.id and m.kind = 'outbound' and m.author_user_id is not null and m.deleted_at is null
      and coalesce(m.delivery, 'accepted') not in ('failed', 'sending', 'uncertain') and m.created_at <= v_r.created_at
    on conflict (conversation_id) do update set processed_at = greatest(public.ldo_support_knowledge_seen.processed_at, excluded.processed_at);
  end if;
  if v_res in ('novo', 'existente') then
    insert into public.ldo_support_audit (actor, action, details)
    values (v_r.user_id, 'ai.knowledge.proposta', jsonb_build_object('card_id', v_card_id, 'resultado', v_res, 'origem', v_r.trigger, 'conta', v_counts));
  end if;
  return jsonb_build_object('resultado', v_res, 'card_id', v_card_id,
    'descartado', case when v_res = 'descartado' then v_desc end,
    'estado', (select c.estado from public.ldo_support_knowledge_cards c where c.id = v_card_id));
end;
$$;

-- Limpeza diária (só o servidor): pedidos com mais de 365 dias (com as chaves dos contactos; a conversa e a mensagem de
-- origem ao fim de 30), respostas já guardadas há mais de 365, conversas vistas há mais de 180, propostas sem novas
-- fontes há 180 dias e cartões arquivados há 365. As respostas marcadas para respostas automáticas que expiraram ou não
-- são revistas há mais de 90 dias perdem a marca.
create function public.ldo_support_knowledge_purge(p_token text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
  v_total integer := 0;
  v_today date := (now() at time zone 'Europe/Lisbon')::date;
begin
  perform ldo_private.bi_check(p_token);
  with x as (
    update public.ldo_support_knowledge_cards set auto_ok = false, auto_ok_em = null, updated_at = now()
    where auto_ok and ((valido_ate is not null and valido_ate < v_today) or revisto_em is null or revisto_em < v_today - 90)
    returning id)
  insert into public.ldo_support_audit (actor, action, details)
  select null, 'ai.knowledge.card', jsonb_build_object('id', x.id, 'acao', 'auto_expirada') from x;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  -- Ligação de um cartão às conversas de origem: 30 dias no máximo; os pedidos sem cartão (erros, sem pergunta geral,
  -- retirados) guardam a conversa enquanto ela pode voltar à passagem diária (180 dias), para não a ler outra vez.
  update public.ldo_support_knowledge_runs set conversation_id = null, message_id = null
  where (conversation_id is not null or message_id is not null)
    and ((card_id is not null and created_at < now() - interval '30 days') or created_at < now() - interval '180 days');
  delete from public.ldo_support_knowledge_runs where created_at < now() - interval '365 days';
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  delete from public.ldo_support_knowledge_used where used_on < v_today - 365;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  delete from public.ldo_support_knowledge_seen where processed_at < now() - interval '180 days';
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  delete from public.ldo_support_knowledge_cards
  where (estado = 'proposta' and ultima_vez < now() - interval '180 days') or (estado = 'arquivada' and updated_at < now() - interval '365 days');
  get diagnostics v_n = row_count;
  return v_total + v_n;
end;
$$;

-- ---------------------------------------------------------------- Super Admin (sessão)

-- Definições, totais do mês (custo próprio) e contagens dos cartões.
create function public.ldo_support_knowledge_settings(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.ldo_support_settings;
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  select * into v_s from public.ldo_support_settings where id = 1;
  return jsonb_build_object(
    'auto_proposals', v_s.knowledge_auto_proposals,
    'monthly_budget', v_s.knowledge_monthly_budget,
    'month', (select jsonb_build_object('custo', coalesce(sum(r.cost_usd), 0), 'pedidos', count(*), 'erros', count(*) filter (where r.status = 'error'),
        'novos', count(*) filter (where r.resultado = 'novo'), 'existentes', count(*) filter (where r.resultado = 'existente'),
        'nao_aproveitaveis', count(*) filter (where r.resultado = 'nao_aproveitavel'), 'descartados', count(*) filter (where r.resultado = 'descartado'))
      from public.ldo_support_knowledge_runs r where r.created_at >= ldo_private.support_lisbon_start('month')),
    'counts', (select jsonb_build_object('proposta', count(*) filter (where c.estado = 'proposta'),
        'aprovada', count(*) filter (where c.estado = 'aprovada'), 'arquivada', count(*) filter (where c.estado = 'arquivada'),
        -- Em uso pela IA: publicadas e ainda válidas (como em support_knowledge_published).
        'publicadas', count(*) filter (where c.estado = 'aprovada' and c.publicado is not null
          and (c.publicado ->> 'valido_ate' is null or (c.publicado ->> 'valido_ate')::date >= (now() at time zone 'Europe/Lisbon')::date)),
        'por_publicar', count(*) filter (where c.estado = 'aprovada' and c.publicado is distinct from ldo_private.support_card_content(c)),
        'auto_ok', count(*) filter (where c.auto_ok))
      from public.ldo_support_knowledge_cards c),
    'published_at', (select max(c.publicada_em) from public.ldo_support_knowledge_cards c where c.estado = 'aprovada'));
end;
$$;

-- p_values: {"auto_proposals": true|false, "monthly_budget": número} (ambos obrigatórios).
create function public.ldo_support_knowledge_settings_save(p_session text, p_values jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_budget numeric;
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_values -> 'auto_proposals') is distinct from 'boolean' then
    raise exception 'Indique se as propostas automáticas ficam ligadas.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_values -> 'monthly_budget') is distinct from 'number' then
    raise exception 'Orçamento mensal entre 0 e 10000 dólares.' using errcode = '22023';
  end if;
  v_budget := round((p_values ->> 'monthly_budget')::numeric, 2);
  if v_budget < 0 or v_budget > 10000 then
    raise exception 'Orçamento mensal entre 0 e 10000 dólares.' using errcode = '22023';
  end if;
  update public.ldo_support_settings set knowledge_auto_proposals = (p_values ->> 'auto_proposals')::boolean,
    knowledge_monthly_budget = v_budget, updated_by = v_me, updated_at = now() where id = 1;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'ai.knowledge.settings', jsonb_build_object('auto_proposals', (p_values ->> 'auto_proposals')::boolean, 'monthly_budget', v_budget));
end;
$$;

-- Cartões de um estado (até 300), com pesquisa; as lojas; os cartões não arquivados (para "Juntar a…" e para os
-- conflitos das respostas automáticas); a base de conhecimento, os contactos do apoio e os nomes da equipa (verificações
-- do texto no servidor, também nas correções do Super Admin).
create function public.ldo_support_knowledge_cards(p_session text, p_estado text, p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_estado text := case when p_estado in ('proposta', 'aprovada', 'arquivada') then p_estado else 'proposta' end;
  v_q tsquery := case when nullif(btrim(coalesce(p_q, '')), '') is null then null
    else websearch_to_tsquery('portuguese'::regconfig, left(p_q, 200)) end;
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'intent', x.intent, 'brand', x.brand, 'loja_id', x.loja_id,
        'loja', (select s.name from public.ldo_app_stores s where s.id = x.loja_id),
        'pergunta', x.pergunta, 'variantes', to_jsonb(x.variantes), 'resposta', x.resposta, 'estado', x.estado,
        'auto_ok', x.auto_ok, 'auto_ok_em', x.auto_ok_em, 'fontes', x.fontes, 'ultima_vez', x.ultima_vez, 'amostras', to_jsonb(x.amostras),
        'valido_ate', x.valido_ate, 'revisto_em', x.revisto_em, 'criada_por', x.criada_por,
        'aprovada_por', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = x.aprovada_por),
        'aprovada_em', x.aprovada_em, 'texto_em', x.texto_em, 'publicada_em', x.publicada_em, 'publicado', x.publicado is not null,
        'por_publicar', x.estado = 'aprovada' and x.dif, 'updated_at', x.updated_at) order by x.n)
      from (select c.*, c.publicado is distinct from ldo_private.support_card_content(c) as dif,
              row_number() over (order by case when v_estado = 'proposta' then c.fontes end desc nulls last,
                case when v_estado = 'aprovada' then c.intent end, c.ultima_vez desc, c.id) as n
            from public.ldo_support_knowledge_cards c
            where c.estado = v_estado and (v_q is null or numnode(v_q) = 0 or c.fts @@ v_q)
            order by n limit 300) x), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'city', s.city) order by s.name)
      from public.ldo_app_stores s where s.active), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'intent', c.intent, 'brand', c.brand, 'loja_id', c.loja_id, 'estado', c.estado,
        'auto_ok', c.auto_ok, 'pergunta', left(c.pergunta, 120)) order by c.intent, c.pergunta, c.id)
      from public.ldo_support_knowledge_cards c where c.estado <> 'arquivada'), '[]'::jsonb),
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('title', k.title, 'body', k.body) order by k.position, k.title, k.id)
      from public.ldo_support_knowledge k where btrim(k.body) <> ''), '[]'::jsonb),
    'company', coalesce((
      select jsonb_agg(x.t) from (
        select distinct c.account as t from public.ldo_support_conversations c where c.channel = 'email' and c.account like '%@%'
        union select s.email_signature from public.ldo_support_settings s where s.id = 1) x where x.t is not null), '[]'::jsonb),
    'staff_names', coalesce((
      select jsonb_agg(distinct n.n) from (
        select u.full_name as n from public.ldo_app_users u where (u.support_access or u.is_super_admin) and u.full_name is not null
        union select u.username from public.ldo_app_users u where (u.support_access or u.is_super_admin) and u.username is not null) n), '[]'::jsonb));
end;
$$;

-- Cria (p_id null: proposta escrita pelo Super Admin) ou corrige um cartão. p_values: {"intent", "brand", "loja_id",
-- "pergunta", "variantes": [...], "resposta", "valido_ate"}. Corrigir uma resposta aprovada conta como revista e recomeça
-- os 7 dias (texto_em); qualquer correção tira a marca de resposta automática. Devolve {id, estado, alterada,
-- auto_retirada}.
create function public.ldo_support_knowledge_card_save(p_session text, p_id uuid, p_values jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_c public.ldo_support_knowledge_cards;
  v_intent text := p_values ->> 'intent';
  v_brand text := coalesce(nullif(p_values ->> 'brand', ''), 'ldo');
  v_pergunta text := regexp_replace(btrim(coalesce(p_values ->> 'pergunta', '')), '\s+', ' ', 'g');
  v_resposta text := btrim(coalesce(p_values ->> 'resposta', ''));
  v_loja uuid;
  v_variantes text[];
  v_valido date;
  v_problem text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if coalesce(p_values ->> 'loja_id', '') <> '' then
    if p_values ->> 'loja_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Loja desconhecida.' using errcode = '22023';
    end if;
    v_loja := (p_values ->> 'loja_id')::uuid;
  end if;
  if coalesce(p_values ->> 'valido_ate', '') <> '' then
    begin
      v_valido := (p_values ->> 'valido_ate')::date;
    exception when others then
      raise exception 'Data de validade inválida.' using errcode = '22023';
    end;
  end if;
  v_variantes := ldo_private.support_card_variants(p_values -> 'variantes', v_pergunta);
  v_problem := ldo_private.support_card_invalid(v_intent, v_brand, v_loja, v_pergunta, v_variantes, v_resposta, v_valido);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.ldo_support_knowledge_cards (intent, brand, loja_id, pergunta, variantes, resposta, valido_ate, criada_por, updated_by)
    values (v_intent, v_brand, v_loja, v_pergunta, v_variantes, v_resposta, v_valido, 'pessoa', v_me) returning id into v_id;
    insert into public.ldo_support_audit (actor, action, details) values (v_me, 'ai.knowledge.card', jsonb_build_object('id', v_id, 'acao', 'criada'));
    return jsonb_build_object('id', v_id, 'estado', 'proposta', 'alterada', true, 'auto_retirada', false);
  end if;
  select * into v_c from public.ldo_support_knowledge_cards where id = p_id for update;
  if v_c.id is null then
    raise exception 'Resposta não encontrada.' using errcode = 'P0002';
  end if;
  if (v_c.intent, v_c.brand, v_c.loja_id, v_c.pergunta, v_c.variantes, v_c.resposta, v_c.valido_ate)
      is not distinct from (v_intent, v_brand, v_loja, v_pergunta, v_variantes, v_resposta, v_valido) then
    return jsonb_build_object('id', p_id, 'estado', v_c.estado, 'alterada', false, 'auto_retirada', false);
  end if;
  -- Qualquer correção (também da pergunta e das variantes, que escolhem a resposta nas respostas automáticas) tira a marca
  -- de resposta automática; numa aprovada, os 7 dias contam de novo.
  update public.ldo_support_knowledge_cards set
    intent = v_intent, brand = v_brand, loja_id = v_loja, pergunta = v_pergunta, variantes = v_variantes, resposta = v_resposta, valido_ate = v_valido,
    revisto_em = case when estado = 'aprovada' then (now() at time zone 'Europe/Lisbon')::date else revisto_em end,
    texto_em = case when estado = 'aprovada' then now() else texto_em end,
    auto_ok = false, auto_ok_em = null,
    updated_at = now(), updated_by = v_me
  where id = p_id;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'ai.knowledge.card', jsonb_build_object('id', p_id, 'acao', 'editada', 'estado', v_c.estado, 'auto_retirada', v_c.auto_ok));
  return jsonb_build_object('id', p_id, 'estado', v_c.estado, 'alterada', true, 'auto_retirada', v_c.auto_ok);
end;
$$;

-- Aprovar (de uma proposta ou de arquivada; numa resposta já aprovada, confirma que continua certa: revisto_em) ou
-- arquivar (sai logo da IA e das respostas automáticas). As amostras e a ligação dos pedidos às conversas e mensagens de
-- origem apagam-se nos dois casos (das fontes ficam a contagem e as chaves pseudónimas dos contactos; a regra de uma
-- proposta por resposta continua em ldo_support_knowledge_used).
create function public.ldo_support_knowledge_card_state(p_session text, p_id uuid, p_estado text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_c public.ldo_support_knowledge_cards;
  v_problem text;
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('aprovada', 'arquivada') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  select * into v_c from public.ldo_support_knowledge_cards where id = p_id for update;
  if v_c.id is null then
    raise exception 'Resposta não encontrada.' using errcode = 'P0002';
  end if;
  if p_estado = 'aprovada' then
    v_problem := ldo_private.support_card_invalid(v_c.intent, v_c.brand, v_c.loja_id, v_c.pergunta, v_c.variantes, v_c.resposta, v_c.valido_ate);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
    update public.ldo_support_knowledge_cards set
      estado = 'aprovada',
      aprovada_por = case when estado = 'aprovada' then aprovada_por else v_me end,
      aprovada_em = case when estado = 'aprovada' then aprovada_em else now() end,
      texto_em = case when estado = 'aprovada' then texto_em else now() end,
      revisto_em = (now() at time zone 'Europe/Lisbon')::date,
      amostras = '{}', updated_at = now(), updated_by = v_me
    where id = p_id;
  else
    update public.ldo_support_knowledge_cards set estado = 'arquivada', auto_ok = false, auto_ok_em = null, publicado = null,
      amostras = '{}', updated_at = now(), updated_by = v_me
    where id = p_id;
  end if;
  update public.ldo_support_knowledge_runs set conversation_id = null, message_id = null
  where card_id = p_id and (conversation_id is not null or message_id is not null);
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'ai.knowledge.card', jsonb_build_object('id', p_id,
    'acao', case when p_estado = 'arquivada' then 'arquivada' when v_c.estado = 'aprovada' then 'revista' else 'aprovada' end));
end;
$$;

-- "Permitir em respostas automáticas" (só marca o cartão; nada é enviado aqui). Ligar exige: aprovada (ou corrigida)
-- há 7 dias ou mais (texto_em), revista nos últimos 90 dias, publicada tal como está, a loja nos temas de uma loja e
-- nenhuma outra resposta automática para o mesmo tema, loja e marca. O texto (português do Brasil, ligações, marca, base
-- de conhecimento) é visto no servidor.
create function public.ldo_support_knowledge_card_auto(p_session text, p_id uuid, p_auto_ok boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_c public.ldo_support_knowledge_cards;
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  select * into v_c from public.ldo_support_knowledge_cards where id = p_id for update;
  if v_c.id is null then
    raise exception 'Resposta não encontrada.' using errcode = 'P0002';
  end if;
  if coalesce(p_auto_ok, false) then
    if v_c.estado <> 'aprovada' then
      raise exception 'Só uma resposta aprovada pode ser usada em respostas automáticas.' using errcode = '22023';
    end if;
    if v_c.texto_em is null or v_c.texto_em > now() - interval '7 days' then
      raise exception 'Só pode ser usada em respostas automáticas 7 dias depois de aprovada ou da última correção do texto.' using errcode = '22023';
    end if;
    if v_c.revisto_em is null or v_c.revisto_em < (now() at time zone 'Europe/Lisbon')::date - 90 then
      raise exception 'Confirme que a resposta continua certa (a última revisão foi há mais de 90 dias).' using errcode = '22023';
    end if;
    if v_c.publicado is distinct from ldo_private.support_card_content(v_c) then
      raise exception 'Publique primeiro as alterações desta resposta.' using errcode = '22023';
    end if;
    if v_c.intent in ('horario_loja', 'morada_loja', 'contactos') then
      if v_c.loja_id is null then
        raise exception 'Indique a loja: as respostas sobre horários, moradas e contactos só podem ser automáticas para uma loja.' using errcode = '22023';
      end if;
      if exists (select 1 from public.ldo_support_knowledge_cards o where o.id <> v_c.id and o.auto_ok and o.estado = 'aprovada'
          and o.intent = v_c.intent and o.loja_id = v_c.loja_id and (o.brand = v_c.brand or o.brand = 'ambas' or v_c.brand = 'ambas')) then
        raise exception 'Há outra resposta automática sobre esta loja; junte-as primeiro.' using errcode = '22023';
      end if;
    end if;
    update public.ldo_support_knowledge_cards set auto_ok = true, auto_ok_em = now(), updated_at = now(), updated_by = v_me where id = p_id;
  else
    update public.ldo_support_knowledge_cards set auto_ok = false, auto_ok_em = null, updated_at = now(), updated_by = v_me where id = p_id;
  end if;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'ai.knowledge.card', jsonb_build_object('id', p_id, 'acao', case when coalesce(p_auto_ok, false) then 'auto' else 'auto_retirada' end));
end;
$$;

-- "Juntar a…": a pergunta e as variantes de p_id passam a variantes de p_into (até 5), as fontes somam-se (um contacto
-- que confirmou as duas conta uma vez, pela chave pseudónima) e p_id fica arquivado e em p_into.juntadas, com os que já
-- lhe tinham sido juntos (os pedidos que o confirmaram passam a contar para p_into, sem a ligação às conversas, e uma
-- confirmação nova do mesmo contacto não conta outra vez). Recusa quando a
-- pergunta de p_id não cabe (p_into já tem 5 formas ou a pergunta passa de 200 caracteres), em vez de a perder. Se as
-- variantes de p_into mudarem, perde a marca de resposta automática e, se estiver aprovada, os 7 dias contam de novo.
-- Devolve {estado (de p_into), alterada, auto_retirada}.
create function public.ldo_support_knowledge_card_merge(p_session text, p_id uuid, p_into uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_from public.ldo_support_knowledge_cards;
  v_into public.ldo_support_knowledge_cards;
  v_variantes text[];
  v_changed boolean;
  v_both integer;
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if p_id is null or p_into is null or p_id = p_into then
    raise exception 'Escolha outra resposta para juntar.' using errcode = '22023';
  end if;
  -- Sempre pela mesma ordem (dois pedidos cruzados não ficam à espera um do outro).
  perform 1 from public.ldo_support_knowledge_cards where id in (p_id, p_into) order by id for update;
  select * into v_from from public.ldo_support_knowledge_cards where id = p_id;
  select * into v_into from public.ldo_support_knowledge_cards where id = p_into;
  if v_from.id is null or v_into.id is null then
    raise exception 'Resposta não encontrada.' using errcode = 'P0002';
  end if;
  if v_into.estado = 'arquivada' then
    raise exception 'Junte a uma resposta proposta ou aprovada.' using errcode = '22023';
  end if;
  v_variantes := ldo_private.support_card_variants(to_jsonb(v_into.variantes) || to_jsonb(array[v_from.pergunta]) || to_jsonb(v_from.variantes),
    v_into.pergunta);
  select coalesce(array_agg(v order by o), '{}') into v_variantes
  from (select v, o from unnest(v_variantes) with ordinality as u(v, o) where length(v) <= 200 order by o limit 5) x;
  if lower(regexp_replace(btrim(v_from.pergunta), '\s+', ' ', 'g')) <> lower(v_into.pergunta)
     and not exists (select 1 from unnest(v_variantes) v where lower(v) = lower(regexp_replace(btrim(v_from.pergunta), '\s+', ' ', 'g'))) then
    raise exception 'A outra resposta já tem 5 formas da pergunta (ou esta pergunta passa de 200 caracteres): encurte ou retire uma primeiro.' using errcode = '22023';
  end if;
  v_changed := v_variantes is distinct from v_into.variantes;
  -- Contactos que já confirmaram as duas respostas (a mesma chave pseudónima): contam uma vez.
  select count(distinct a.contact_key) into v_both
  from public.ldo_support_knowledge_runs a
  where a.contact_key is not null and a.card_id is distinct from p_id and (a.card_id = p_into or a.card_id = any (v_into.juntadas))
    and exists (select 1 from public.ldo_support_knowledge_runs b
      where b.contact_key = a.contact_key and b.card_id is distinct from p_into and (b.card_id = p_id or b.card_id = any (v_from.juntadas)));
  update public.ldo_support_knowledge_cards set
    variantes = v_variantes,
    fontes = greatest(fontes + v_from.fontes - v_both, 0),
    juntadas = (select coalesce(array_agg(distinct j), '{}') from unnest(juntadas || p_id || v_from.juntadas) as j where j <> p_into),
    ultima_vez = greatest(ultima_vez, v_from.ultima_vez),
    amostras = case when estado = 'proposta' then (select coalesce(array_agg(a), '{}') from (
      select distinct a from unnest(amostras || v_from.amostras) as a limit 3) y) else '{}' end,
    texto_em = case when estado = 'aprovada' and v_changed then now() else texto_em end,
    auto_ok = auto_ok and not v_changed,
    auto_ok_em = case when auto_ok and not v_changed then auto_ok_em end,
    updated_at = now(), updated_by = v_me
  where id = p_into;
  -- As fontes de p_id passam para p_into (com os pedidos que as contaram).
  update public.ldo_support_knowledge_cards set estado = 'arquivada', auto_ok = false, auto_ok_em = null, publicado = null, amostras = '{}',
    fontes = 0, updated_at = now(), updated_by = v_me
  where id = p_id;
  update public.ldo_support_knowledge_runs set card_id = p_into, conversation_id = null, message_id = null where card_id = p_id;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'ai.knowledge.card', jsonb_build_object('id', p_id, 'acao', 'juntada', 'em', p_into, 'auto_retirada', v_into.auto_ok and v_changed));
  return jsonb_build_object('estado', v_into.estado, 'alterada', v_changed, 'auto_retirada', v_into.auto_ok and v_changed);
end;
$$;

-- "Publicar alterações": o texto das respostas aprovadas passa a ser o que a IA usa (uma reescrita da cache por
-- publicação). No máximo 200 respostas em uso e 80 000 caracteres.
create function public.ldo_support_knowledge_publish(p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_n integer;
  v_chars integer;
  v_changed integer;
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  select count(*), coalesce(sum(length(pergunta) + length(array_to_string(variantes, ' ')) + length(resposta)), 0) into v_n, v_chars
  from public.ldo_support_knowledge_cards
  where estado = 'aprovada' and (valido_ate is null or valido_ate >= (now() at time zone 'Europe/Lisbon')::date);
  if v_n > 200 then
    raise exception 'No máximo 200 respostas aprovadas em uso pela IA (há %): arquive as que já não são precisas.', v_n using errcode = '22023';
  end if;
  if v_chars > 80000 then
    raise exception 'As respostas aprovadas passam de 80 000 caracteres (%): arquive ou encurte algumas.', v_chars using errcode = '22023';
  end if;
  update public.ldo_support_knowledge_cards c set publicado = ldo_private.support_card_content(c), publicada_em = now()
  where c.estado = 'aprovada' and c.publicado is distinct from ldo_private.support_card_content(c);
  get diagnostics v_changed = row_count;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'ai.knowledge.publish', jsonb_build_object('alteradas', v_changed, 'em_uso', v_n, 'caracteres', v_chars));
  return jsonb_build_object('alteradas', v_changed, 'em_uso', v_n);
end;
$$;

-- ---------------------------------------------------------------- funções alteradas

-- Custos de IA na configuração (texto em produção): mais a linha 'cards' com os totais do mês das propostas.
CREATE OR REPLACE FUNCTION public.ldo_support_ai_admin(p_session text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'month_errors', (select count(*) from public.ldo_support_ai_reviews where created_at >= v_month and status = 'error')),
    -- Base de conhecimento aprendida: propostas do mês (orçamento próprio) e respostas em uso.
    'cards', jsonb_build_object(
      'auto_proposals', v_s.knowledge_auto_proposals,
      'monthly_budget', v_s.knowledge_monthly_budget,
      'month_cost', (select coalesce(sum(cost_usd), 0) from public.ldo_support_knowledge_runs where created_at >= v_month),
      'month_runs', (select count(*) from public.ldo_support_knowledge_runs where created_at >= v_month),
      'month_errors', (select count(*) from public.ldo_support_knowledge_runs where created_at >= v_month and status = 'error'),
      'proposals', (select count(*) from public.ldo_support_knowledge_cards where estado = 'proposta'),
      'published', (select count(*) from public.ldo_support_knowledge_cards where estado = 'aprovada' and publicado is not null
        and (publicado ->> 'valido_ate' is null or (publicado ->> 'valido_ate')::date >= (now() at time zone 'Europe/Lisbon')::date)))
  );
end;
$function$;

-- Propostas de resposta: a base de conhecimento passa a incluir as respostas aprovadas e publicadas ('cards'). Alteração
-- ancorada no texto em produção (o resto da função fica igual); falha se a âncora não existir ou não for única. A âncora e
-- o texto novo perdem os \r: com este ficheiro em CRLF (core.autocrlf) a âncora continua a coincidir com o texto em
-- produção, que só tem \n.
do $do$
declare
  v_anchor text := replace($a$      from public.ldo_app_stores s where s.active), '[]'::jsonb)
  );$a$, E'\r', '');
  v_with text := replace($a$      from public.ldo_app_stores s where s.active), '[]'::jsonb),
    -- Respostas aprovadas e publicadas da base de conhecimento aprendida (o texto só muda ao publicar).
    'cards', ldo_private.support_knowledge_published()
  );$a$, E'\r', '');
  v_old text := pg_get_functiondef('public.ldo_support_ai_begin(text, uuid, text, text)'::regprocedure);
  v_new text;
begin
  if (length(v_old) - length(replace(v_old, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'anchor not found';
  end if;
  v_new := replace(v_old, v_anchor, v_with);
  if v_new = v_old then
    raise exception 'anchor not found';
  end if;
  execute v_new;
end;
$do$;

-- ---------------------------------------------------------------- acessos

revoke all on function
  ldo_private.support_card_fts(),
  ldo_private.support_knowledge_key(text, uuid),
  ldo_private.support_card_content(public.ldo_support_knowledge_cards),
  ldo_private.support_card_problem(text),
  ldo_private.support_card_variants(jsonb, text),
  ldo_private.support_card_invalid(text, text, uuid, text, text[], text, date),
  ldo_private.support_knowledge_month_cost(),
  ldo_private.support_knowledge_published(),
  ldo_private.support_knowledge_payload(uuid, uuid, timestamptz, uuid)
from public, anon, authenticated;
revoke all on function
  public.ldo_support_knowledge_from_message(text, uuid),
  public.ldo_support_knowledge_candidates(text, integer),
  public.ldo_support_knowledge_begin(text, uuid),
  public.ldo_support_knowledge_propose(text, uuid, jsonb),
  public.ldo_support_knowledge_purge(text),
  public.ldo_support_knowledge_settings(text),
  public.ldo_support_knowledge_settings_save(text, jsonb),
  public.ldo_support_knowledge_cards(text, text, text),
  public.ldo_support_knowledge_card_save(text, uuid, jsonb),
  public.ldo_support_knowledge_card_state(text, uuid, text),
  public.ldo_support_knowledge_card_auto(text, uuid, boolean),
  public.ldo_support_knowledge_card_merge(text, uuid, uuid),
  public.ldo_support_knowledge_publish(text)
from public, authenticated;
grant execute on function
  public.ldo_support_knowledge_from_message(text, uuid),
  public.ldo_support_knowledge_candidates(text, integer),
  public.ldo_support_knowledge_begin(text, uuid),
  public.ldo_support_knowledge_propose(text, uuid, jsonb),
  public.ldo_support_knowledge_purge(text),
  public.ldo_support_knowledge_settings(text),
  public.ldo_support_knowledge_settings_save(text, jsonb),
  public.ldo_support_knowledge_cards(text, text, text),
  public.ldo_support_knowledge_card_save(text, uuid, jsonb),
  public.ldo_support_knowledge_card_state(text, uuid, text),
  public.ldo_support_knowledge_card_auto(text, uuid, boolean),
  public.ldo_support_knowledge_card_merge(text, uuid, uuid),
  public.ldo_support_knowledge_publish(text)
to anon;
