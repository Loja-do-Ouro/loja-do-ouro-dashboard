-- Apoio ao Cliente: pedido de avaliação depois de "Resolvido" e satisfação por colaborador.
--
-- Quando alguém resolve no dashboard uma conversa a que respondeu pelo dashboard, o cliente recebe um pedido para avaliar
-- o atendimento de 1 a 5: no Messenger e no Instagram (10 minutos depois, dentro da janela de 24 h da Meta), no email
-- (responde com um número) e no chat do site (estrelas no widget, logo). A nota conta para quem fez mais respostas pelo
-- dashboard nesse ciclo (empate: quem respondeu por último); o responsável e quem resolveu ficam registados, mas não são
-- avaliados. Uma nota de 1 ou 2 devolve a conversa a "Novo", sem responsável, para acompanhamento. Sem IA (custo zero).
-- Começa desligado (survey_mode 'desligado'): o Super Admin liga na configuração da IA do apoio.
-- * Definições próprias (modo, espera e canais), com funções próprias e só para o Super Admin; ldo_support_save_settings
--   não muda.
-- * ldo_support_messages.origin: mensagem automática ('survey' aqui; 'ai', 'handover' e 'rule' ficam para as respostas
--   automáticas). null = escrita por uma pessoa, no dashboard ou fora dele. Atividade da equipa = mensagem para o cliente
--   sem origin (ldo_private.support_team_outbound_since); resposta pelo dashboard = author_user_id e sem origin.
-- * ldo_support_system_send_begin: mensagem automática gravada antes de sair (sem pessoa e sem assumir a conversa); o envio
--   termina em ldo_support_finish_send. Um resultado incerto nunca é repetido.
-- * A nota é lida em ldo_support_ingest e em ldo_support_site_send (ldo_private.support_take_rating), antes da regra de
--   reabertura: só a nota, as estrelas ou «não» não reabrem a conversa. A sincronização reconhece as mensagens automáticas
--   até 60 minutos (não aparecem duplicadas como se fossem de uma pessoa), e um email automático (ausência, Auto-Submitted)
--   logo a seguir a um pedido fica guardado sem reabrir nem contar como nota.
-- * As respostas automáticas das redes sociais nunca respondem a uma nota.
-- * Chat do site: o pedido é um aviso no widget (ldo_support_site_messages), nunca um email. Um visitante por confirmar
--   nunca recebe por email uma mensagem automática (ldo_support_site_notify_claim).
-- * ldo_support_conversation: os acontecimentos do pedido aparecem sempre (fora do limite das 30 ações) e a nota só para
--   o Super Admin e para quem foi avaliado.
-- * Relatório "Satisfação e desempenho": cada pessoa vê só a sua linha; o Super Admin vê todas, os totais da equipa e as
--   notas de 1 e 2. Média e satisfeitos por pessoa só com 10 avaliações ou mais.
-- * O comentário de uma avaliação é apagado ao fim de 12 meses (a nota fica; passagem diária). Os pedidos saem com a
--   conversa ou o contacto (on delete cascade).
-- Funções alteradas, a partir do texto em produção a 30-10-2026 (pg_get_functiondef; md5 do prosrc igual ao do corpo da
-- migração indicada):
-- * cópia com as linhas assinaladas: ldo_support_site_send (88370fd3dbd45d8130bff6de669c1af0, 20261008150000),
--   ldo_support_site_notify_claim (360f3b21a1eba5c2964707607ffe23d9, 20261015120000), ldo_support_site_messages
--   (6ea15123173245bcd5a22134acb4478c, 20261015120000) e ldo_support_social_autoreply_claim
--   (f426f91c0926e25ed35ec76c10e8327d, 20261009150000);
-- * substituições ancoradas no texto em vigor ao aplicar (param com erro se uma âncora faltar ou se repetir):
--   ldo_support_ingest (246628003beab3ce0a50c26aca3e950f, 20261013100000) e ldo_support_ai_replies (só as mensagens
--   escritas por pessoas como exemplos para a IA; texto de 20261030100000);
-- * ldo_support_conversation parte de 20261030100000 (por aplicar quando isto foi escrito; aplica-se antes desta).
-- Os privilégios das funções alteradas mantêm-se (create or replace). Depende de 20261030100000.

-- ---------------------------------------------------------------- definições e colunas

alter table public.ldo_support_settings
  add column if not exists survey_mode text not null default 'desligado'
    check (survey_mode in ('desligado', 'perguntar', 'automatico')),
  add column if not exists survey_delay_minutes integer not null default 10
    check (survey_delay_minutes between 0 and 120),
  add column if not exists survey_channels text[] not null default '{facebook,instagram,email,site}'
    check (survey_channels <@ array['facebook', 'instagram', 'email', 'site']);

-- O cliente pediu para não receber pedidos de avaliação (respondeu «não», ou a equipa marcou no contacto).
alter table public.ldo_support_contacts add column if not exists no_surveys boolean not null default false;

-- Mensagem automática; null = escrita por uma pessoa (no dashboard ou fora dele).
alter table public.ldo_support_messages
  add column if not exists origin text check (origin in ('ai', 'handover', 'survey', 'rule'));

-- ---------------------------------------------------------------- pedidos de avaliação

create table public.ldo_support_surveys (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ldo_support_conversations (id) on delete cascade,
  contact_id uuid references public.ldo_support_contacts (id) on delete cascade,
  -- Avaliado: mais respostas pelo dashboard no ciclo. O responsável e quem resolveu ficam só registados.
  agent_id uuid not null references public.ldo_app_users (id),
  assignee_at_resolve uuid references public.ldo_app_users (id),
  resolved_by uuid references public.ldo_app_users (id),
  channel text not null check (channel in ('facebook', 'instagram', 'email', 'site')),
  site text check (site in ('ldo', 'gsp')),
  locale text check (locale in ('pt', 'en', 'es', 'fr', 'de')),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'rated', 'expired')),
  skip_reason text check (length(skip_reason) <= 40),
  send_after timestamptz not null,
  attempt_at timestamptz,
  sent_at timestamptz,
  message_id uuid references public.ldo_support_messages (id) on delete set null,
  expires_at timestamptz,
  detail text check (length(detail) <= 500),
  score smallint check (score between 1 and 5),
  comment varchar(500),
  rated_at timestamptz,
  rating_message_id uuid references public.ldo_support_messages (id) on delete set null,
  follow_up boolean not null default false,
  thanks_status text check (thanks_status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  thanks_at timestamptz,
  thanks_message_id uuid references public.ldo_support_messages (id) on delete set null
);
create index ldo_support_surveys_agent_idx on public.ldo_support_surveys (agent_id, rated_at);
create index ldo_support_surveys_contact_idx on public.ldo_support_surveys (contact_id, sent_at);
create index ldo_support_surveys_conversation_idx on public.ldo_support_surveys (conversation_id);
create index ldo_support_surveys_due_idx on public.ldo_support_surveys (send_after) where status = 'pending';
create index ldo_support_surveys_rating_idx on public.ldo_support_surveys (rating_message_id) where rating_message_id is not null;
alter table public.ldo_support_surveys enable row level security;
revoke all on public.ldo_support_surveys from anon, authenticated;

-- ---------------------------------------------------------------- auxiliares

-- A equipa escreveu ao cliente desde p_since: qualquer mensagem para o cliente que não seja automática (também as enviadas
-- fora do dashboard, no Meta Business Suite ou no Gmail).
create function ldo_private.support_team_outbound_since(p_conv uuid, p_since timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ldo_support_messages m
    where m.conversation_id = p_conv and m.kind = 'outbound' and m.origin is null and m.deleted_at is null
      and coalesce(m.delivery, 'accepted') <> 'failed' and m.created_at > coalesce(p_since, '-infinity'::timestamptz));
$$;

-- Resposta ao pedido sem o seletor de emoji, a assinatura do email ("-- ") nem "Enviado do meu iPhone" (espelha ratingText
-- em survey-rules.ts).
create function ldo_private.support_rating_text(p_body text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(replace(replace(coalesce(p_body, ''), chr(13), ''), chr(65039), ''), E'\\n--[ \\t]*\\n.*$', ''),
      E'\\n[ \\t]*(enviado do meu|enviado desde mi|sent from my|get outlook for|obter o outlook)[^\\n]*', '', 'gi'),
    '^\s+|\s+$', '', 'g');
$$;

-- Só a nota: "5", "5/5", "4 de 5", "5 estrelas", "5⭐", também com emoji ou pontuação a seguir ("5 😊", "4 :)"), sem
-- letras nem outros números; ou 1 a 5 estrelas sozinhas (espelha parseRating).
create function ldo_private.support_rating_score(p_body text) returns smallint
language sql immutable set search_path = '' as $$
  select case
    when t ~* '^([1-5])\s*(/\s*5|de\s*5|estrelas?|⭐+)?[^[:alpha:][:digit:]]*$' then substr(t, 1, 1)::smallint
    when t ~ '^([⭐🌟★]\s*){1,5}$' then length(regexp_replace(t, '[^⭐🌟★]', '', 'g'))::smallint
  end
  from (select ldo_private.support_rating_text(p_body) as t) x;
$$;

-- Nota seguida de texto ("5 obrigado", "2. Chegou partida"); "4,5" não conta.
create function ldo_private.support_rating_lead(p_body text) returns smallint
language sql immutable set search_path = '' as $$
  select case when ldo_private.support_rating_score(p_body) is null
      and t ~* '^[1-5](\s*(/\s*5|de\s*5|estrelas?|⭐+))?(\s*[.!,;:)–-]+\s*|\s+)\S' and t !~ '^[1-5]\s*[.,]\s*[0-9]'
    then substr(t, 1, 1)::smallint end
  from (select ldo_private.support_rating_text(p_body) as t) x;
$$;

-- O texto depois da nota (comentário).
create function ldo_private.support_rating_comment(p_body text) returns text
language sql immutable set search_path = '' as $$
  select left(regexp_replace(ldo_private.support_rating_text(p_body), '^[1-5](\s*(/\s*5|de\s*5|estrelas?|⭐+))?(\s*[.!,;:)–-]+\s*|\s+)', '', 'i'), 500);
$$;

-- «não», «nao», «parar» ou «stop», sozinhos: não quer mais pedidos.
create function ldo_private.support_rating_optout(p_body text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(translate(ldo_private.support_rating_text(p_body), 'ÃÁÂÀ', 'ãáâà')) ~ '^(não|nao|parar|stop)[.!]*$';
$$;

-- Início do ciclo de atendimento antes de p_before (null = agora): a última reabertura (de "Resolvido", por mensagem do
-- cliente, mudança de estado ou nota baixa) ou o último pedido de avaliação, o que for mais recente.
create function ldo_private.support_survey_cycle(p_conv uuid, p_before timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(
    (select max(a.created_at) from public.ldo_support_audit a
      where a.conversation_id = p_conv and a.created_at < coalesce(p_before, 'infinity'::timestamptz)
        and (a.action = 'survey.followup' or (a.action in ('reopen', 'status') and a.details ->> 'from' = 'resolvido'))),
    (select max(s.created_at) from public.ldo_support_surveys s
      where s.conversation_id = p_conv and s.created_at < coalesce(p_before, 'infinity'::timestamptz)));
$$;

-- Quem é avaliado: a pessoa com mais respostas pelo dashboard (author_user_id e sem origin) entre p_since e p_before;
-- empate, a que respondeu por último (espelha attributeAgent).
create function ldo_private.support_survey_agent(p_conv uuid, p_since timestamptz, p_before timestamptz) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.author_user_id from public.ldo_support_messages m
  where m.conversation_id = p_conv and m.kind = 'outbound' and m.author_user_id is not null and m.origin is null
    and m.deleted_at is null and coalesce(m.delivery, 'accepted') <> 'failed'
    and m.created_at > coalesce(p_since, '-infinity'::timestamptz) and m.created_at < coalesce(p_before, 'infinity'::timestamptz)
  group by m.author_user_id
  order by count(*) desc, max(m.created_at) desc
  limit 1;
$$;

-- Motivo para não pedir avaliação nesta conversa (null = pode pedir), pela ordem de surveyEligibility. p_before: o pedido
-- que vai sair (os pedidos criados antes dele contam; ele próprio não).
create function ldo_private.support_survey_block(p_conv uuid, p_before timestamptz) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.ldo_support_settings;
  v_c public.ldo_support_conversations;
  v_last text;
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
begin
  select * into v_s from public.ldo_support_settings where id = 1;
  if v_s.survey_mode is null or v_s.survey_mode not in ('perguntar', 'automatico') then
    return 'desligado';
  end if;
  select * into v_c from public.ldo_support_conversations where id = p_conv;
  if v_c.channel in ('facebook_comments', 'instagram_comments') then
    return 'comentario';
  end if;
  if v_c.channel is null or v_c.channel not in ('facebook', 'instagram', 'email', 'site') then
    return 'canal';
  end if;
  if not (v_c.channel = any (v_s.survey_channels)) then
    return 'canal_desligado';
  end if;
  if ldo_private.support_survey_agent(p_conv, ldo_private.support_survey_cycle(p_conv, p_before), p_before) is null then
    return 'sem_resposta';
  end if;
  select m.kind into v_last from public.ldo_support_messages m
  where m.conversation_id = p_conv and m.kind <> 'note' and m.deleted_at is null and coalesce(m.delivery, 'accepted') <> 'failed'
  order by m.created_at desc, m.inserted_at desc limit 1;
  if v_last = 'inbound' then
    return 'ultima_cliente';
  end if;
  if v_c.channel in ('facebook', 'instagram') and (v_c.last_inbound_at is null or v_c.last_inbound_at <= now() - interval '23 hours') then
    return 'janela_24h';
  end if;
  if v_c.channel = 'site' and not exists (select 1 from public.ldo_support_site_visitors x where x.conversation_id = p_conv and x.ended_at is null) then
    return 'chat_terminado';
  end if;
  if exists (select 1 from public.ldo_support_contacts k where k.id = v_c.contact_id and k.no_surveys) then
    return 'sem_pedidos';
  end if;
  -- Contam os pedidos por enviar, a enviar ou enviados (um pedido que nunca saiu não conta).
  if exists (select 1 from public.ldo_support_surveys s where s.conversation_id = p_conv and s.created_at < v_before
      and (s.status in ('pending', 'sending') or s.sent_at is not null) and coalesce(s.sent_at, s.created_at) > now() - interval '7 days') then
    return 'conversa_recente';
  end if;
  if exists (select 1 from public.ldo_support_surveys s where s.contact_id = v_c.contact_id and s.created_at < v_before
      and (s.status in ('pending', 'sending') or s.sent_at is not null) and coalesce(s.sent_at, s.created_at) > now() - interval '30 days') then
    return 'contacto_recente';
  end if;
  return null;
end;
$$;

-- Nota registada (mensagem do cliente ou estrelas do chat do site). p_with_text: a nota veio com texto (a conversa reabre
-- pela regra normal e não há agradecimento automático). Só a nota, de 1 ou 2: a conversa resolvida volta a "Novo", sem
-- responsável, para acompanhamento.
create function ldo_private.support_survey_rate(p_id uuid, p_score smallint, p_message uuid, p_comment text, p_with_text boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.ldo_support_surveys;
  v_c public.ldo_support_conversations;
begin
  update public.ldo_support_surveys set status = 'rated', score = p_score, rated_at = now(), rating_message_id = p_message,
    comment = nullif(left(btrim(coalesce(p_comment, '')), 500), ''), follow_up = p_score <= 2,
    thanks_status = case when not p_with_text and channel in ('facebook', 'instagram') then 'pending' end
  where id = p_id
  returning * into v_s;
  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  values (null, v_s.conversation_id, 'survey.rated', jsonb_build_object('survey_id', v_s.id, 'agent_id', v_s.agent_id,
    'agent_name', ldo_private.support_display_name(v_s.agent_id), 'score', p_score, 'channel', v_s.channel, 'with_text', p_with_text));
  if p_score <= 2 and not p_with_text then
    select * into v_c from public.ldo_support_conversations where id = v_s.conversation_id for update;
    if v_c.status = 'resolvido' then
      update public.ldo_support_conversations set status = 'novo', assignee_id = null, updated_at = now() where id = v_c.id;
      insert into public.ldo_support_audit (actor, conversation_id, action, details)
      values (null, v_c.id, 'survey.followup', jsonb_build_object('survey_id', v_s.id, 'agent_id', v_s.agent_id, 'score', p_score,
        'from', v_c.status, 'from_assignee', v_c.assignee_id, 'from_name', ldo_private.support_display_name(v_c.assignee_id)));
    end if;
  end if;
end;
$$;

-- Mensagem do cliente numa conversa com um pedido de avaliação enviado (ldo_support_ingest e ldo_support_site_send, logo
-- depois de a gravar). Só conta com o pedido por expirar, quando o pedido é a última mensagem para o cliente e esta é a
-- primeira do cliente depois dele (espelha ratingDecision). true = tratada aqui: a conversa não reabre (só a nota, as
-- estrelas ou «não»); false = segue como qualquer mensagem (uma nota com texto fica registada e a conversa reabre).
create function ldo_private.support_take_rating(p_conv uuid, p_message uuid, p_body text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.ldo_support_messages;
  v_s public.ldo_support_surveys;
  v_body text;
  v_score smallint;
begin
  select * into v_m from public.ldo_support_messages where id = p_message and conversation_id = p_conv and kind = 'inbound';
  if v_m.id is null then
    return false;
  end if;
  select * into v_s from public.ldo_support_surveys where conversation_id = p_conv and status = 'sent'
  order by sent_at desc limit 1 for update;
  if v_s.id is null then
    return false;
  end if;
  if v_s.expires_at <= now() then
    update public.ldo_support_surveys set status = 'expired', skip_reason = 'prazo' where id = v_s.id;
    return false;
  end if;
  -- Escrita antes do pedido (sincronização atrasada): não é resposta.
  if v_m.created_at < v_s.sent_at - interval '1 minute' then
    return false;
  end if;
  select m.body into v_body from public.ldo_support_messages m where m.id = v_s.message_id;
  -- A equipa escreveu depois do pedido (as cópias do próprio pedido vindas da sincronização não contam), ou o cliente já
  -- tinha escrito: o pedido fecha e a mensagem segue o caminho normal.
  if exists (select 1 from public.ldo_support_messages o
        where o.conversation_id = p_conv and o.kind = 'outbound' and o.deleted_at is null and coalesce(o.delivery, 'accepted') <> 'failed'
          and o.id is distinct from v_s.message_id and o.created_at > v_s.sent_at
          and (v_body is null or ldo_private.support_norm(o.body) <> ldo_private.support_norm(v_body)))
     or exists (select 1 from public.ldo_support_messages i
        where i.conversation_id = p_conv and i.kind = 'inbound' and i.deleted_at is null and i.id <> v_m.id
          and i.created_at >= v_s.sent_at - interval '1 minute' and i.created_at < v_m.created_at) then
    update public.ldo_support_surveys set status = 'expired', skip_reason = 'nova_mensagem' where id = v_s.id;
    return false;
  end if;
  v_score := ldo_private.support_rating_score(p_body);
  if v_score is not null then
    perform ldo_private.support_survey_rate(v_s.id, v_score, v_m.id, null, false);
    -- Nota de 1 ou 2: fica por ler, para a equipa a ver.
    if v_score >= 3 then
      perform ldo_private.support_read_all(p_conv);
    end if;
    return true;
  end if;
  if ldo_private.support_rating_optout(p_body) then
    update public.ldo_support_contacts set no_surveys = true, updated_at = now()
    where id = (select c.contact_id from public.ldo_support_conversations c where c.id = p_conv);
    update public.ldo_support_surveys set status = 'expired', skip_reason = 'recusou', rating_message_id = v_m.id where id = v_s.id;
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (null, p_conv, 'survey.optout', jsonb_build_object('survey_id', v_s.id, 'agent_id', v_s.agent_id));
    perform ldo_private.support_read_all(p_conv);
    return true;
  end if;
  v_score := ldo_private.support_rating_lead(p_body);
  if v_score is not null then
    perform ldo_private.support_survey_rate(v_s.id, v_score, v_m.id, ldo_private.support_rating_comment(p_body), true);
    return false;
  end if;
  update public.ldo_support_surveys set status = 'expired', skip_reason = 'outra_resposta' where id = v_s.id;
  return false;
end;
$$;

-- ---------------------------------------------------------------- envio de mensagens automáticas (servidor)

-- Mensagem automática para o cliente, gravada antes de sair (como ldo_support_begin_send, mas sem pessoa: não assume a
-- conversa nem muda o estado). Só mensagens privadas (nunca um comentário público). Depois do envio pelo canal:
-- ldo_support_finish_send. A mesma chave devolve a mesma mensagem (nunca outra).
create function public.ldo_support_system_send_begin(p_token text, p_conversation_id uuid, p_body text, p_origin text, p_client_key uuid)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c public.ldo_support_conversations;
  v_m public.ldo_support_messages;
  v_body text := btrim(coalesce(p_body, ''));
begin
  perform ldo_private.bi_check(p_token);
  if p_origin is null or p_origin not in ('ai', 'handover', 'survey', 'rule') or p_client_key is null then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  if v_body = '' or length(v_body) > 2000 then
    raise exception 'Mensagem automática vazia ou demasiado longa.' using errcode = '22023';
  end if;
  select * into v_c from public.ldo_support_conversations where id = p_conversation_id for update;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  if v_c.channel not in ('facebook', 'instagram', 'email', 'site') then
    raise exception 'Este canal não tem mensagens automáticas.' using errcode = '42501';
  end if;
  select * into v_m from public.ldo_support_messages where client_key = p_client_key;
  if v_m.id is not null then
    if v_m.conversation_id <> v_c.id or v_m.origin is distinct from p_origin or v_m.body <> v_body then
      raise exception 'Este pedido já foi usado para outra mensagem.' using errcode = '22023';
    end if;
    return v_m.id;
  end if;
  insert into public.ldo_support_messages (conversation_id, kind, body, created_at, delivery, client_key, origin)
  values (v_c.id, 'outbound', v_body, now(), 'sending', p_client_key, p_origin)
  returning * into v_m;
  perform ldo_private.support_summarize(v_c.id);
  return v_m.id;
end;
$$;

-- ---------------------------------------------------------------- funções alteradas

-- Mensagem do visitante (texto em produção; assinalado): uma resposta ao pedido de avaliação (só a nota ou «não») fica
-- registada e não reabre a conversa.
create or replace function public.ldo_support_site_send(p_token text, p_token_hash text, p_identity_email text, p_body text, p_client_key uuid,
  p_page text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_c public.ldo_support_conversations;
  v_body text := ldo_private.site_clean(p_body, 2000);
  v_m public.ldo_support_messages;
  v_rated boolean := false;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if p_client_key is null or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  if v_body = '' then
    raise exception 'Escreva a sua mensagem.' using errcode = '22023';
  end if;
  select * into v_m from public.ldo_support_messages where conversation_id = v.conversation_id and external_id = 'site:' || p_client_key;
  if v_m.id is not null then
    return jsonb_build_object('id', v_m.id, 'created_at', v_m.created_at, 'repeated', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ldo_site_conv:' || v.conversation_id::text, 0));
  if (select count(*) from public.ldo_support_messages where conversation_id = v.conversation_id and kind = 'inbound'
        and inserted_at > now() - interval '5 minutes') >= 20
     or (select count(*) from public.ldo_support_messages where conversation_id = v.conversation_id and kind = 'inbound'
        and inserted_at > now() - interval '1 day') >= 200
     or (select count(*) from public.ldo_support_messages m join public.ldo_support_site_visitors x on x.conversation_id = m.conversation_id
        where x.ip_hash = p_ip_hash and m.kind = 'inbound' and m.inserted_at > now() - interval '1 hour') >= 120
     or (select count(*) from public.ldo_support_messages m join public.ldo_support_conversations c on c.id = m.conversation_id
        where c.channel = 'site' and m.kind = 'inbound' and m.inserted_at > now() - interval '1 hour') >= 5000 then
    raise exception 'Enviou muitas mensagens seguidas. Aguarde um pouco.' using errcode = 'P0429';
  end if;
  insert into public.ldo_support_messages (conversation_id, external_id, kind, author_name, author_external_id, body, created_at)
  values (v.conversation_id, 'site:' || p_client_key, 'inbound', v.name, v.id::text, v_body, now())
  returning * into v_m;
  select * into v_c from public.ldo_support_conversations where id = v.conversation_id for update;
  -- Resposta a um pedido de avaliação (só a nota ou «não»): fica registada e a conversa não reabre.
  v_rated := ldo_private.support_take_rating(v_c.id, v_m.id, v_body);
  if not v_rated and v_c.status in ('resolvido', 'aguarda_cliente') then
    update public.ldo_support_conversations set
      status = case when v_c.status = 'resolvido' and assignee_id is null then 'novo' else 'em_atendimento' end, updated_at = now()
    where id = v_c.id;
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (null, v_c.id, 'reopen', jsonb_build_object('from', v_c.status, 'reason', 'Nova mensagem do cliente'));
  end if;
  update public.ldo_support_site_visitors set last_seen_at = now(), page_url = coalesce(left(p_page, 500), page_url) where id = v.id;
  perform ldo_private.support_summarize(v.conversation_id);
  return jsonb_build_object('id', v_m.id, 'created_at', v_m.created_at, 'repeated', false);
end;
$$;

-- Avisos por email ao visitante (texto em produção; assinalado): uma mensagem automática (origin) só segue por email
-- para um visitante com o email confirmado.
create or replace function public.ldo_support_site_notify_claim(p_token text, p_conversation uuid, p_idle_seconds integer, p_min_age_seconds integer, p_limit integer)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_out jsonb := '[]'::jsonb;
  v_replies jsonb;
  v_items jsonb;
  v_until timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  for v in
    select x.* from public.ldo_support_site_visitors x
    where (p_conversation is null or x.conversation_id = p_conversation)
      and x.last_seen_at < now() - make_interval(secs => greatest(p_idle_seconds, 0))
      and (x.notify_lease_until is null or x.notify_lease_until < now())
      and exists (select 1 from public.ldo_support_messages m where m.conversation_id = x.conversation_id and m.kind = 'outbound'
        and m.deleted_at is null and m.delivery = 'accepted' and m.inserted_at > coalesce(x.notified_until, '-infinity'::timestamptz)
        -- Mensagem automática (origin): por email só a um visitante com o email confirmado.
        and (m.origin is null or x.verified)
        and m.inserted_at < now() - make_interval(secs => greatest(p_min_age_seconds, 0)))
      and x.last_seen_at = (select max(y.last_seen_at) from public.ldo_support_site_visitors y where y.conversation_id = x.conversation_id)
    order by x.last_seen_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update of x skip locked
  loop
    select jsonb_agg(r.body order by r.inserted_at),
      jsonb_agg(jsonb_build_object('body', r.body, 'author', ldo_private.support_first_name(r.author_user_id)) order by r.inserted_at),
      max(r.inserted_at) into v_replies, v_items, v_until
    from (select m.body, m.author_user_id, m.inserted_at from public.ldo_support_messages m
          where m.conversation_id = v.conversation_id and m.kind = 'outbound' and m.deleted_at is null and m.delivery = 'accepted'
            and (m.origin is null or v.verified)
            and m.inserted_at > coalesce(v.notified_until, '-infinity'::timestamptz)
          order by m.inserted_at limit 10) r;
    update public.ldo_support_site_visitors set notify_lease_until = now() + interval '2 minutes' where id = v.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('visitor', v.id, 'conversation', v.conversation_id, 'email', v.email,
      'name', v.name, 'until', v_until, 'replies', v_replies, 'items', v_items,
      'locale', v.locale, 'site', v.site, 'country', v.country));
  end loop;
  return v_out;
end;
$$;

-- Mensagens do chat do site (texto em produção; assinalado): mais o pedido de avaliação, enviado e por expirar ou já
-- respondido (kind 'survey', o primeiro nome de quem atendeu e se já avaliou). O texto em português segue em body para os
-- widgets antigos (o visitante responde com o número).
create or replace function public.ldo_support_site_messages(p_token text, p_token_hash text, p_identity_email text, p_after timestamptz, p_open boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_list jsonb;
  v_notices jsonb;
  v_ids uuid[];
  v_surveys jsonb;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if v.last_seen_at < now() - interval '2 seconds' then
    update public.ldo_support_site_visitors set last_seen_at = now() where id = v.id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'from', case when m.kind = 'inbound' then 'visitor' else 'team' end,
      'author', case when m.kind = 'inbound' then null else ldo_private.support_first_name(m.author_user_id) end,
      'key', case when m.kind = 'inbound' and m.external_id like 'site:%' then substr(m.external_id, 6) end,
      'body', m.body, 'created_at', m.created_at, 'inserted_at', m.inserted_at) order by m.created_at, m.inserted_at), '[]'::jsonb),
    coalesce(array_agg(m.id) filter (where m.kind = 'outbound'), '{}')
  into v_list, v_ids
  from (select * from public.ldo_support_messages
        where conversation_id = v.conversation_id and deleted_at is null
          and (kind = 'inbound' or (kind = 'outbound' and delivery in ('accepted', 'delivered', 'read')))
          and (p_after is null or inserted_at > p_after)
        order by inserted_at desc limit 200) m;
  -- Avisos de transferência (só o primeiro nome de quem passa a atender).
  select coalesce(jsonb_agg(jsonb_build_object('id', 'n' || a.id, 'from', 'notice', 'author', null, 'key', null,
      'kind', 'transfer', 'to_first', a.details ->> 'to_first',
      'body', 'A conversa foi transferida para ' || coalesce(a.details ->> 'to_first', 'outra pessoa da equipa') || '.',
      'created_at', a.created_at, 'inserted_at', a.created_at) order by a.created_at), '[]'::jsonb)
  into v_notices
  from (select * from public.ldo_support_audit
        where conversation_id = v.conversation_id and action = 'assign' and (details ->> 'notice') = 'true'
          and (p_after is null or created_at > p_after)
        order by created_at desc limit 50) a;
  -- Pedido de avaliação: enviado e por expirar, ou já respondido (só o primeiro nome de quem atendeu).
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'from', 'notice', 'author', null, 'key', null,
      'kind', 'survey', 'agent_first', ldo_private.support_first_name(s.agent_id), 'rated', s.status = 'rated',
      'body', 'Obrigado por falar connosco! Como avalia o '
        || coalesce('atendimento de ' || ldo_private.support_first_name(s.agent_id), 'nosso atendimento')
        || '? Responda com um número de 1 (mau) a 5 (excelente).',
      'created_at', s.sent_at, 'inserted_at', greatest(s.sent_at, s.rated_at)) order by s.sent_at), '[]'::jsonb)
  into v_surveys
  from public.ldo_support_surveys s
  where s.conversation_id = v.conversation_id and s.channel = 'site' and s.sent_at is not null
    and (s.status = 'rated' or (s.status = 'sent' and s.expires_at > now()))
    and (p_after is null or greatest(s.sent_at, s.rated_at) > p_after);
  if cardinality(v_ids) > 0 then
    update public.ldo_support_messages set delivery = case when coalesce(p_open, false) then 'read' else 'delivered' end
    where id = any (v_ids) and (delivery = 'accepted' or (coalesce(p_open, false) and delivery = 'delivered'));
  end if;
  return jsonb_build_object(
    'name', v.name,
    'verified', v.verified,
    'agent', (select ldo_private.support_first_name(c.assignee_id) from public.ldo_support_conversations c where c.id = v.conversation_id),
    'typing', exists (select 1 from public.ldo_support_presence p where p.conversation_id = v.conversation_id
      and p.composing and p.seen_at > now() - interval '25 seconds'),
    'messages', v_list || v_notices || v_surveys
  );
end;
$$;

-- Respostas automáticas das redes sociais (texto em produção; assinalado): nunca a uma resposta a um pedido de avaliação.
create or replace function public.ldo_support_social_autoreply_claim(p_token text, p_source text, p_conversation text, p_contact text,
  p_kind text, p_anchor text, p_since timestamptz default null) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_since timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  if p_kind not in ('support', 'thanks') or coalesce(p_conversation, '') = '' or coalesce(p_anchor, '') = '' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('ldo_social_autoreply:' || p_source || ':' || p_conversation));
  if p_kind = 'thanks' then
    perform pg_advisory_xact_lock(hashtext('ldo_social_thanks:' || p_source || ':' || coalesce(p_contact, p_conversation)));
  end if;
  select c.id into v_conv from public.ldo_support_conversations c where c.source_id = p_source and c.external_id = p_conversation;
  -- Resposta a um pedido de avaliação (nota, estrelas ou «não»): nunca leva resposta automática.
  if v_conv is not null and exists (select 1 from public.ldo_support_messages m join public.ldo_support_surveys s on s.rating_message_id = m.id
      where m.conversation_id = v_conv and m.external_id = p_anchor) then
    return false;
  end if;
  if v_conv is not null then
    -- Desde a primeira mensagem nova do cliente (ou, sem ela, desde a âncora).
    v_since := coalesce(p_since, (select m.created_at from public.ldo_support_messages m
      where m.conversation_id = v_conv and m.external_id = p_anchor), now() - interval '30 minutes');
    if exists (select 1 from public.ldo_support_messages m
        where m.conversation_id = v_conv and m.kind = 'outbound' and m.deleted_at is null
          and (m.delivery is null or m.delivery <> 'failed') and m.created_at > v_since) then
      return false;
    end if;
  end if;
  if p_kind = 'support' and exists (select 1 from public.ldo_support_social_autoreplies
      where source_id = p_source and conversation_external_id = p_conversation and kind = 'support' and sent_at > now() - interval '24 hours') then
    return false;
  end if;
  if p_kind = 'thanks' and exists (select 1 from public.ldo_support_social_autoreplies
      where source_id = p_source and kind = 'thanks' and sent_at > now() - interval '7 days'
        and (contact_external_id = p_contact or conversation_external_id = p_conversation)) then
    return false;
  end if;
  insert into public.ldo_support_social_autoreplies (source_id, conversation_external_id, contact_external_id, kind, anchor)
  values (p_source, p_conversation, nullif(p_contact, ''), p_kind, p_anchor)
  on conflict (source_id, conversation_external_id, anchor) do nothing;
  return found;
end;
$$;

-- Conversa (texto de 20261030100000; assinalado): a origem de cada mensagem, os acontecimentos do pedido de avaliação fora
-- do limite das 30 ações, o modo e os pedidos desta conversa. A nota (e a resposta só com a nota) só para o Super Admin e
-- para quem foi avaliado; os outros veem que o cliente respondeu.
create or replace function public.ldo_support_conversation(p_session text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_c public.ldo_support_conversations;
  v_k public.ldo_support_contacts;
  v_from timestamptz := ldo_private.support_history_from();
  -- A nota do pedido de avaliação: só o Super Admin e quem foi avaliado.
  v_super boolean := ldo_private.support_super(p_session) is not null;
begin
  select * into v_c from public.ldo_support_conversations where id = p_id;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  select * into v_k from public.ldo_support_contacts where id = v_c.contact_id;
  return jsonb_build_object(
    'conversation', to_jsonb(v_c) || jsonb_build_object(
      'assignee_name', (select coalesce(full_name, username) from public.ldo_app_users where id = v_c.assignee_id),
      'platform', (select platform from public.ldo_support_sources where id = v_c.source_id),
      'source_label', (select label from public.ldo_support_sources where id = v_c.source_id),
      'source_status', (select status from public.ldo_support_sources where id = v_c.source_id),
      'read_at', (select read_at from public.ldo_support_reads where user_id = v_me and conversation_id = p_id),
      'last_inbound_inserted_at', (select max(inserted_at) from public.ldo_support_messages
        where conversation_id = p_id and kind = 'inbound' and deleted_at is null),
      'public_replies', ldo_private.support_public_replies(v_c.source_id, v_c.id)),
    'post', (select jsonb_build_object('kind', p.kind, 'product_type', p.product_type, 'link', p.link, 'caption', p.caption,
        'media', coalesce((select jsonb_agg(jsonb_build_object('index', x.n - 1, 'kind', x.e ->> 'kind') order by x.n)
          from jsonb_array_elements(p.media) with ordinality as x(e, n)), '[]'::jsonb),
        'comment_count', p.comment_count, 'reaction_count', p.reaction_count, 'owner_name', p.owner_name, 'seen_at', p.seen_at)
      from public.ldo_support_posts p where p.id = v_c.post_id),
    'contact', case when v_k.id is null then null else to_jsonb(v_k) || jsonb_build_object(
      'linked_by_name', (select coalesce(full_name, username) from public.ldo_app_users where id = v_k.linked_by)) end,
    -- Só contactos com uma conversa dentro do histórico visível (as outras estão ocultas na lista).
    'related', coalesce((
      select jsonb_agg(jsonb_build_object('contact_id', k.id, 'channel', k.channel, 'name', k.name, 'email', k.email, 'phone', k.phone,
        'conversation_id', r.id))
      from public.ldo_support_contacts k
      cross join lateral (select c2.id from public.ldo_support_conversations c2
        where c2.contact_id = k.id and (coalesce(c2.last_message_at, c2.created_at) >= v_from or c2.status <> 'resolvido')
        order by c2.last_message_at desc nulls last limit 1) r
      where k.id <> v_k.id and (
        (coalesce(v_k.email, v_k.linked_email) is not null and lower(coalesce(v_k.email, v_k.linked_email)) in (lower(k.email), lower(k.linked_email)))
        or (v_k.phone is not null and regexp_replace(v_k.phone, '\D', '', 'g') <> '' and regexp_replace(v_k.phone, '\D', '', 'g') = regexp_replace(coalesce(k.phone, ''), '\D', '', 'g')))
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'author_name', coalesce(au.full_name, au.username, m.author_name),
        'author_user_id', m.author_user_id, 'body', case when coalesce(rs.hidden, false) then '' else m.body end,
        'attachments', m.attachments, 'created_at', m.created_at,
        'inserted_at', m.inserted_at, 'deleted', m.deleted_at is not null,
        'delivery', m.delivery, 'delivery_detail', m.delivery_detail, 'external', m.external_id is not null,
        'origin', m.origin, 'rating', rs.survey_id is not null) order by m.created_at, m.inserted_at)
      from (select * from public.ldo_support_messages where conversation_id = p_id order by created_at desc, inserted_at desc limit 500) m
      left join public.ldo_app_users au on au.id = m.author_user_id
      -- Resposta a um pedido de avaliação; só com a nota, o texto fica escondido de quem não a pode ver.
      left join lateral (select s.id as survey_id,
          s.score is not null and ldo_private.support_rating_score(m.body) is not null and not v_super and s.agent_id is distinct from v_me as hidden
        from public.ldo_support_surveys s where s.rating_message_id = m.id limit 1) rs on true
    ), '[]'::jsonb),
    'presence', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', coalesce(u.full_name, u.username), 'composing', p.composing, 'seen_at', p.seen_at))
      from public.ldo_support_presence p join public.ldo_app_users u on u.id = p.user_id
      where p.conversation_id = p_id and p.user_id <> v_me and p.seen_at > now() - interval '60 seconds'
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object('action', l.action,
        'details', case when l.action like 'survey.%' and not v_super and (l.details ->> 'agent_id') is distinct from v_me::text
          then l.details - 'score' else l.details end,
        'created_at', l.created_at,
        'actor', coalesce((select coalesce(full_name, username) from public.ldo_app_users where id = l.actor), 'Sistema')) order by l.created_at desc)
      -- As últimas 30 ações e, fora desse limite, todos os acontecimentos do pedido de avaliação.
      from public.ldo_support_audit l
      where l.conversation_id = p_id and (l.action like 'survey.%'
        or l.id in (select a.id from public.ldo_support_audit a where a.conversation_id = p_id order by a.created_at desc limit 30))
    ), '[]'::jsonb),
    -- Pedido de avaliação: o modo em vigor e os últimos pedidos desta conversa (a nota e o comentário só para o Super
    -- Admin e para quem foi avaliado).
    'survey_mode', (select survey_mode from public.ldo_support_settings where id = 1),
    'surveys', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'skip_reason', s.skip_reason, 'channel', s.channel,
        'agent_id', s.agent_id, 'agent_name', ldo_private.support_display_name(s.agent_id), 'created_at', s.created_at,
        'send_after', s.send_after, 'sent_at', s.sent_at, 'expires_at', s.expires_at, 'rated_at', s.rated_at, 'follow_up', s.follow_up,
        'score', case when v_super or s.agent_id = v_me then s.score end,
        'comment', case when v_super or s.agent_id = v_me then s.comment end) order by s.created_at desc)
      from (select * from public.ldo_support_surveys where conversation_id = p_id order by created_at desc limit 5) s
    ), '[]'::jsonb),
    -- Mensagens anteriores a esta data: recolhidas na conversa e fora da IA (a conversa abre na mesma).
    'history_from', v_from
  );
end;
$$;

-- Sincronização (texto em vigor ao aplicar; substituições ancoradas, cada âncora uma única vez):
-- (a) a mensagem gravada devolve o id (v_mid);
-- (b) logo depois de contar a mensagem nova: um email automático a seguir a um pedido não reabre nem conta como nota; a
--     resposta a um pedido (só a nota, as estrelas ou «não») fica registada e não reabre (não conta como nova do cliente);
-- (c) uma mensagem automática nossa é reconhecida pelo texto até 60 minutos de diferença (as outras, 15).
do $$
declare
  v_def text := pg_get_functiondef('public.ldo_support_ingest(text,text,jsonb)'::regprocedure);
  v_old text[] := array[
    '  v_deleted boolean;',
    'on conflict (conversation_id, external_id) do nothing;',
    '        v_new_msgs := v_new_msgs + 1;',
    'and abs(extract(epoch from (created_at - (m ->> ''created_at'')::timestamptz))) < 900'
  ];
  v_new text[] := array[
    E'  v_deleted boolean;\n  v_mid uuid;',
    E'on conflict (conversation_id, external_id) do nothing\n      returning id into v_mid;',
    E'        v_new_msgs := v_new_msgs + 1;\n'
      || E'        -- Email automático (ausência, Auto-Submitted) logo a seguir a um pedido de avaliação: fica guardado, mas não reabre\n'
      || E'        -- a conversa nem conta como nota.\n'
      || E'        if m ->> ''kind'' = ''inbound'' and coalesce(m ->> ''auto_submitted'', '''') = ''true'' and exists (select 1 from public.ldo_support_surveys s\n'
      || E'            where s.conversation_id = v_conv.id and s.sent_at > now() - interval ''72 hours'') then\n'
      || E'          continue;\n'
      || E'        end if;\n'
      || E'        -- Resposta a um pedido de avaliação (só a nota, as estrelas ou «não»): fica registada e a conversa não reabre.\n'
      || E'        if m ->> ''kind'' = ''inbound'' and ldo_private.support_take_rating(v_conv.id, v_mid, m ->> ''body'') then\n'
      || E'          continue;\n'
      || E'        end if;',
    'and abs(extract(epoch from (created_at - (m ->> ''created_at'')::timestamptz))) < case when origin is not null then 3600 else 900 end'
  ];
  i integer;
begin
  for i in 1 .. cardinality(v_old) loop
    if length(v_def) - length(replace(v_def, v_old[i], '')) <> length(v_old[i]) then
      raise exception 'ldo_support_ingest: âncora % não encontrada ou repetida: %', i, v_old[i];
    end if;
    v_def := replace(v_def, v_old[i], v_new[i]);
  end loop;
  execute v_def;
end;
$$;

-- Exemplos de respostas anteriores para a IA (texto em vigor ao aplicar, de 20261030100000; uma substituição ancorada):
-- só mensagens escritas por pessoas (nunca o pedido de avaliação nem outras mensagens automáticas).
do $$
declare
  v_def text := pg_get_functiondef('public.ldo_support_ai_replies(text,text,uuid)'::regprocedure);
  v_old text := 'and m.created_at >= v_from and m.conversation_id is distinct from p_exclude';
begin
  if length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) then
    raise exception 'ldo_support_ai_replies: âncora não encontrada ou repetida (aplicar antes 20261030100000)';
  end if;
  execute replace(v_def, v_old, v_old || ' and m.origin is null');
end;
$$;

-- ---------------------------------------------------------------- pedido de avaliação (sessão)

-- Antes de resolver (modo "perguntar"): pode pedir-se avaliação? Motivo quando não, e quem seria avaliado.
create function public.ldo_support_survey_preview(p_session text, p_conv uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_reason text;
  v_agent uuid;
begin
  perform ldo_private.support_check(p_session);
  if not exists (select 1 from public.ldo_support_conversations where id = p_conv) then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  v_reason := ldo_private.support_survey_block(p_conv, null);
  v_agent := ldo_private.support_survey_agent(p_conv, ldo_private.support_survey_cycle(p_conv, null), null);
  return jsonb_build_object('mode', (select survey_mode from public.ldo_support_settings where id = 1),
    'eligible', v_reason is null, 'reason', v_reason,
    'agent_first', ldo_private.support_first_name(v_agent), 'agent_name', ldo_private.support_display_name(v_agent));
end;
$$;

-- Logo depois de a pessoa resolver a conversa no dashboard (ldo_support_set_local não muda): cria o pedido se a conversa
-- cumprir as regras. No modo "perguntar" só com p_request; no automático a pessoa não decide (só o Super Admin cancela).
-- Chat do site: o pedido aparece já no widget (enviado). Nos outros canais sai depois da espera (ldo_support_survey_due).
create function public.ldo_support_survey_create(p_session text, p_conv uuid, p_request boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_s public.ldo_support_settings;
  v_c public.ldo_support_conversations;
  v_a public.ldo_support_audit;
  v_v public.ldo_support_site_visitors;
  v_reason text;
  v_agent uuid;
  v_id uuid;
  v_site boolean;
begin
  select * into v_s from public.ldo_support_settings where id = 1;
  if v_s.survey_mode = 'desligado' then
    return jsonb_build_object('created', false, 'reason', 'desligado');
  end if;
  if v_s.survey_mode = 'perguntar' and p_request is not true then
    return jsonb_build_object('created', false, 'reason', 'nao_pedido');
  end if;
  select * into v_c from public.ldo_support_conversations where id = p_conv for update;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  -- Só quem acabou de resolver (a última mudança de estado, para Resolvido, há menos de 5 minutos).
  select * into v_a from public.ldo_support_audit
  where conversation_id = p_conv and action = 'status' order by created_at desc, id desc limit 1;
  if v_c.status <> 'resolvido' or v_a.actor is distinct from v_me or v_a.details ->> 'to' is distinct from 'resolvido'
     or v_a.created_at < now() - interval '5 minutes' then
    return jsonb_build_object('created', false, 'reason', 'nao_resolvida');
  end if;
  -- Pedido repetido (nova tentativa do browser): o mesmo pedido.
  select s.id into v_id from public.ldo_support_surveys s where s.conversation_id = p_conv and s.created_at >= v_a.created_at limit 1;
  if v_id is not null then
    return (select jsonb_build_object('created', true, 'survey_id', s.id, 'channel', s.channel,
        'agent_first', ldo_private.support_first_name(s.agent_id), 'agent_name', ldo_private.support_display_name(s.agent_id))
      from public.ldo_support_surveys s where s.id = v_id);
  end if;
  v_reason := ldo_private.support_survey_block(p_conv, null);
  v_agent := ldo_private.support_survey_agent(p_conv, ldo_private.support_survey_cycle(p_conv, null), null);
  if v_reason is not null or v_agent is null then
    return jsonb_build_object('created', false, 'reason', coalesce(v_reason, 'sem_resposta'));
  end if;
  v_site := v_c.channel = 'site';
  if v_site then
    select * into v_v from public.ldo_support_site_visitors where conversation_id = p_conv and ended_at is null
    order by last_seen_at desc limit 1;
  end if;
  insert into public.ldo_support_surveys (conversation_id, contact_id, agent_id, assignee_at_resolve, resolved_by, channel, site, locale,
    status, send_after, sent_at, expires_at)
  values (p_conv, v_c.contact_id, v_agent, v_c.assignee_id, v_me, v_c.channel, v_v.site,
    case when v_site then coalesce(v_v.locale, 'pt') end,
    case when v_site then 'sent' else 'pending' end,
    now() + make_interval(mins => case when v_site then 0 else v_s.survey_delay_minutes end),
    case when v_site then now() end, case when v_site then now() + interval '72 hours' end)
  returning id into v_id;
  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  values (v_me, p_conv, 'survey.created', jsonb_build_object('survey_id', v_id, 'agent_id', v_agent,
    'agent_name', ldo_private.support_display_name(v_agent), 'channel', v_c.channel,
    'send_after', now() + make_interval(mins => case when v_site then 0 else v_s.survey_delay_minutes end)));
  if v_site then
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (null, p_conv, 'survey.sent', jsonb_build_object('survey_id', v_id, 'agent_id', v_agent));
  end if;
  return jsonb_build_object('created', true, 'survey_id', v_id, 'channel', v_c.channel,
    'agent_first', ldo_private.support_first_name(v_agent), 'agent_name', ldo_private.support_display_name(v_agent));
end;
$$;

-- Só o Super Admin, com o motivo (fica na conversa): um pedido agendado deixa de sair; um enviado deixa de aceitar a nota.
create function public.ldo_support_survey_cancel(p_session text, p_id uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_s public.ldo_support_surveys;
begin
  if v_me is null then
    raise exception 'Só o Super Admin pode cancelar um pedido de avaliação.' using errcode = '42501';
  end if;
  if length(v_reason) not between 3 and 300 then
    raise exception 'Indique o motivo (entre 3 e 300 caracteres).' using errcode = '22023';
  end if;
  select * into v_s from public.ldo_support_surveys where id = p_id for update;
  if v_s.id is null then
    raise exception 'Pedido de avaliação não encontrado.' using errcode = 'P0002';
  end if;
  if v_s.status not in ('pending', 'sent') then
    raise exception 'Este pedido de avaliação já não pode ser cancelado.' using errcode = '22023';
  end if;
  update public.ldo_support_surveys set status = case when v_s.status = 'pending' then 'skipped' else 'expired' end,
    skip_reason = 'cancelado' where id = v_s.id;
  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  values (v_me, v_s.conversation_id, 'survey.cancelled', jsonb_build_object('survey_id', v_s.id, 'agent_id', v_s.agent_id,
    'reason', v_reason, 'was', v_s.status));
end;
$$;

-- O cliente não quer (ou volta a aceitar) pedidos de avaliação; qualquer pessoa do apoio. Os pedidos agendados deste
-- contacto deixam de sair.
create function public.ldo_support_contact_surveys_save(p_session text, p_contact uuid, p_no_surveys boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_check(p_session);
begin
  if p_no_surveys is null then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  update public.ldo_support_contacts set no_surveys = p_no_surveys, updated_at = now() where id = p_contact;
  if not found then
    raise exception 'Contacto não encontrado.' using errcode = 'P0002';
  end if;
  if p_no_surveys then
    with skipped as (
      update public.ldo_support_surveys set status = 'skipped', skip_reason = 'sem_pedidos'
      where contact_id = p_contact and status = 'pending'
      returning id, conversation_id, agent_id)
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    select null, x.conversation_id, 'survey.skipped', jsonb_build_object('survey_id', x.id, 'agent_id', x.agent_id, 'reason', 'sem_pedidos')
    from skipped x;
  end if;
  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  values (v_me, null, 'survey.contact', jsonb_build_object('contact_id', p_contact, 'no_surveys', p_no_surveys));
end;
$$;

-- ---------------------------------------------------------------- envio (servidor)

-- Pedidos por enviar (Messenger, Instagram e email; só o servidor), já na hora. Confirma tudo outra vez: conversa reaberta,
-- fora da janela de 24 h, cliente que não quer pedidos, modo ou canal desligado → não enviado. Cada pedido devolvido fica
-- "a enviar" e nunca volta a ser devolvido. Arruma também: um pedido enviado com o prazo passado, ou a que a equipa ou o
-- cliente já responderam, fecha; um envio sem resultado há mais de 30 minutos fica como falhado (não se repete).
create function public.ldo_support_survey_due(p_token text, p_limit integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_surveys;
  v_c public.ldo_support_conversations;
  v_k public.ldo_support_contacts;
  v_reason text;
  v_out jsonb := '[]'::jsonb;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_surveys set status = 'expired', skip_reason = 'prazo' where status = 'sent' and expires_at <= now();
  update public.ldo_support_surveys s set status = 'expired', skip_reason = 'nova_mensagem'
  where s.status = 'sent' and (
    exists (select 1 from public.ldo_support_conversations c where c.id = s.conversation_id and c.status <> 'resolvido')
    or exists (select 1 from public.ldo_support_messages o
      where o.conversation_id = s.conversation_id and o.kind = 'outbound' and o.origin is null and o.deleted_at is null
        and coalesce(o.delivery, 'accepted') <> 'failed' and o.created_at > s.sent_at
        and (s.message_id is null or ldo_private.support_norm(o.body)
          <> (select ldo_private.support_norm(x.body) from public.ldo_support_messages x where x.id = s.message_id))));
  update public.ldo_support_surveys set status = 'failed', detail = coalesce(detail, 'Sem resultado do envio; não foi repetido.')
  where status = 'sending' and attempt_at < now() - interval '30 minutes';
  update public.ldo_support_surveys set thanks_status = 'failed' where thanks_status = 'sending' and thanks_at < now() - interval '30 minutes';
  for v in
    select s.* from public.ldo_support_surveys s where s.status = 'pending' and s.send_after <= now()
    order by s.send_after limit least(greatest(coalesce(p_limit, 5), 1), 20)
    for update skip locked
  loop
    select * into v_c from public.ldo_support_conversations where id = v.conversation_id;
    v_reason := case
      when v_c.status <> 'resolvido' or exists (select 1 from public.ldo_support_audit a
          where a.conversation_id = v.conversation_id and a.created_at > v.created_at
            and (a.action = 'survey.followup' or (a.action in ('reopen', 'status') and a.details ->> 'from' = 'resolvido')))
        then 'reaberta'
      else ldo_private.support_survey_block(v.conversation_id, v.created_at) end;
    if v_reason is not null then
      update public.ldo_support_surveys set status = 'skipped', skip_reason = v_reason where id = v.id;
      insert into public.ldo_support_audit (actor, conversation_id, action, details)
      values (null, v.conversation_id, 'survey.skipped', jsonb_build_object('survey_id', v.id, 'agent_id', v.agent_id, 'reason', v_reason));
      continue;
    end if;
    select * into v_k from public.ldo_support_contacts where id = v_c.contact_id;
    update public.ldo_support_surveys set status = 'sending', attempt_at = now() where id = v.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v.id, 'conversation_id', v.conversation_id, 'channel', v.channel,
      'source_id', v_c.source_id, 'external_id', v_c.external_id, 'contact_external_id', v_k.external_id,
      'contact_name', coalesce(v_k.name, v_k.handle), 'agent_first', ldo_private.support_first_name(v.agent_id)));
  end loop;
  return v_out;
end;
$$;

-- Resultado do envio de um pedido (só o servidor, uma vez): aceite ou incerto = enviado (aceita a nota durante 72 h; o
-- incerto nunca se repete); falhado = não enviado.
create function public.ldo_support_survey_sent(p_token text, p_id uuid, p_outcome text, p_message_id uuid, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.ldo_support_surveys;
begin
  perform ldo_private.bi_check(p_token);
  if p_outcome is null or p_outcome not in ('accepted', 'failed', 'uncertain') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  update public.ldo_support_surveys s set
    status = case when p_outcome = 'failed' then 'failed' else 'sent' end,
    sent_at = case when p_outcome = 'failed' then null else now() end,
    expires_at = case when p_outcome = 'failed' then null else now() + interval '72 hours' end,
    message_id = (select m.id from public.ldo_support_messages m
      where m.id = p_message_id and m.conversation_id = s.conversation_id and m.origin = 'survey'),
    detail = left(p_detail, 500)
  where s.id = p_id and s.status = 'sending'
  returning * into v;
  if v.id is null then
    return;
  end if;
  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  values (null, v.conversation_id, case when p_outcome = 'failed' then 'survey.failed' else 'survey.sent' end,
    jsonb_build_object('survey_id', v.id, 'agent_id', v.agent_id, 'uncertain', p_outcome = 'uncertain', 'detail', left(p_detail, 200)));
end;
$$;

-- Agradecimentos por enviar (Messenger e Instagram, só depois de uma nota sozinha; só o servidor). Fora da janela da Meta,
-- ou com uma mensagem da equipa depois da nota, já não seguem.
create function public.ldo_support_survey_thanks_due(p_token text, p_limit integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_surveys;
  v_c public.ldo_support_conversations;
  v_k public.ldo_support_contacts;
  v_out jsonb := '[]'::jsonb;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_surveys s set thanks_status = 'skipped'
  where s.thanks_status = 'pending' and (s.rated_at < now() - interval '23 hours'
    or ldo_private.support_team_outbound_since(s.conversation_id, s.rated_at));
  for v in
    select s.* from public.ldo_support_surveys s where s.thanks_status = 'pending' and s.channel in ('facebook', 'instagram')
    order by s.rated_at limit least(greatest(coalesce(p_limit, 5), 1), 20)
    for update skip locked
  loop
    select * into v_c from public.ldo_support_conversations where id = v.conversation_id;
    select * into v_k from public.ldo_support_contacts where id = v_c.contact_id;
    update public.ldo_support_surveys set thanks_status = 'sending', thanks_at = now() where id = v.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v.id, 'conversation_id', v.conversation_id, 'channel', v.channel,
      'source_id', v_c.source_id, 'external_id', v_c.external_id, 'contact_external_id', v_k.external_id,
      'contact_name', coalesce(v_k.name, v_k.handle), 'score', v.score));
  end loop;
  return v_out;
end;
$$;

create function public.ldo_support_survey_thanks_sent(p_token text, p_id uuid, p_outcome text, p_message_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.ldo_support_surveys;
begin
  perform ldo_private.bi_check(p_token);
  if p_outcome is null or p_outcome not in ('accepted', 'failed', 'uncertain') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  update public.ldo_support_surveys s set thanks_status = case when p_outcome = 'failed' then 'failed' else 'sent' end,
    thanks_message_id = (select m.id from public.ldo_support_messages m
      where m.id = p_message_id and m.conversation_id = s.conversation_id and m.origin = 'survey')
  where s.id = p_id and s.thanks_status = 'sending'
  returning * into v;
  if v.id is not null then
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (null, v.conversation_id, 'survey.thanks', jsonb_build_object('survey_id', v.id, 'agent_id', v.agent_id, 'outcome', p_outcome));
  end if;
end;
$$;

-- Estrelas no chat do site (o visitante da conversa, pelo token do widget). A mesma nota outra vez não muda nada.
create function public.ldo_support_site_rate(p_token text, p_token_hash text, p_identity_email text, p_survey_id uuid, p_score integer,
  p_comment text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_s public.ldo_support_surveys;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if p_survey_id is null or p_score is null or p_score not between 1 and 5 then
    raise exception 'Escolha de 1 a 5 estrelas.' using errcode = '22023';
  end if;
  select * into v_s from public.ldo_support_surveys
  where id = p_survey_id and conversation_id = v.conversation_id and channel = 'site' for update;
  if v_s.status = 'rated' and v_s.score = p_score then
    return jsonb_build_object('ok', true, 'repeated', true);
  end if;
  if v_s.id is null or v_s.status <> 'sent' or v_s.expires_at <= now() then
    raise exception 'Esta avaliação já não está disponível.' using errcode = '22023';
  end if;
  perform ldo_private.support_survey_rate(v_s.id, p_score::smallint, null, ldo_private.site_clean(p_comment, 500), false);
  update public.ldo_support_site_visitors set last_seen_at = now() where id = v.id;
  return jsonb_build_object('ok', true, 'repeated', false);
end;
$$;

-- Comentários das avaliações com mais de 12 meses: apagados (a nota fica). Passagem diária.
create function public.ldo_support_survey_purge(p_token text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_n integer;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_surveys set comment = null where comment is not null and rated_at < now() - interval '12 months';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------- satisfação e desempenho (sessão)

-- Entre dois dias de Lisboa (p_to exclusivo). Cada pessoa vê só a sua linha; o Super Admin vê todas, os totais da equipa e
-- as notas de 1 e 2 ("A acompanhar"). Média e satisfeitos por pessoa só com 10 avaliações ou mais. Só conversas do
-- Messenger, do Instagram, do email e do chat do site, com resposta da equipa pelo dashboard.
-- * Pedidos enviados e clientes que avaliaram: pelos pedidos enviados no período; avaliações, média e satisfeitos: pelas
--   notas recebidas no período.
-- * Resolvidas com resposta: cada "Resolvido" dado por uma pessoa no período, atribuído como a nota (mais respostas pelo
--   dashboard no ciclo); sem pedido de avaliação = nenhum pedido criado nos 10 minutos seguintes.
-- * Tempo até responder (mediana): da primeira mensagem do cliente ainda sem resposta até à resposta pelo dashboard.
create function public.ldo_support_ratings_report(p_session text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_super boolean := ldo_private.support_super(p_session) is not null;
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 400 then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  v_from := p_from::timestamp at time zone 'Europe/Lisbon';
  v_to := p_to::timestamp at time zone 'Europe/Lisbon';
  return (
    with resolves as (
      select a.conversation_id, a.created_at,
        ldo_private.support_survey_agent(a.conversation_id, ldo_private.support_survey_cycle(a.conversation_id, a.created_at), a.created_at) as agent_id,
        exists (select 1 from public.ldo_support_surveys s where s.conversation_id = a.conversation_id
          and s.created_at >= a.created_at and s.created_at < a.created_at + interval '10 minutes') as asked
      from public.ldo_support_audit a join public.ldo_support_conversations c on c.id = a.conversation_id
      where a.action = 'status' and a.details ->> 'to' = 'resolvido' and a.actor is not null
        and a.created_at >= v_from and a.created_at < v_to and c.channel in ('facebook', 'instagram', 'email', 'site')
    ),
    replies as (
      select r.author_user_id as agent_id, extract(epoch from (r.created_at - q.first_in)) / 60 as minutes
      from public.ldo_support_messages r
      join public.ldo_support_conversations c on c.id = r.conversation_id
      cross join lateral (
        select min(i.created_at) as first_in from public.ldo_support_messages i
        where i.conversation_id = r.conversation_id and i.kind = 'inbound' and i.deleted_at is null and i.created_at < r.created_at
          and i.created_at > coalesce((select max(o.created_at) from public.ldo_support_messages o
            where o.conversation_id = r.conversation_id and o.kind = 'outbound' and o.deleted_at is null
              and coalesce(o.delivery, 'accepted') <> 'failed' and o.created_at < r.created_at), '-infinity'::timestamptz)) q
      where r.kind = 'outbound' and r.author_user_id is not null and r.origin is null and r.deleted_at is null
        and coalesce(r.delivery, 'accepted') <> 'failed' and r.created_at >= v_from and r.created_at < v_to
        and c.channel in ('facebook', 'instagram', 'email', 'site') and q.first_in is not null
    ),
    surveys as (
      select s.* from public.ldo_support_surveys s
      where (s.sent_at >= v_from and s.sent_at < v_to) or (s.rated_at >= v_from and s.rated_at < v_to)
    ),
    people as (
      select u.id, coalesce(nullif(btrim(u.full_name), ''), u.username) as name from public.ldo_app_users u
      where u.id = v_me or (v_super and (u.id in (select agent_id from resolves) or u.id in (select agent_id from replies)
        or u.id in (select agent_id from surveys)))
    ),
    stats as (
      select p.id, p.name,
        (select count(*) from surveys s where s.agent_id = p.id and s.sent_at >= v_from and s.sent_at < v_to) as sent,
        (select count(*) from surveys s where s.agent_id = p.id and s.sent_at >= v_from and s.sent_at < v_to and s.score is not null) as answered,
        (select count(*) from surveys s where s.agent_id = p.id and s.rated_at >= v_from and s.rated_at < v_to and s.score is not null) as ratings,
        (select avg(s.score) from surveys s where s.agent_id = p.id and s.rated_at >= v_from and s.rated_at < v_to) as average,
        (select count(*) from surveys s where s.agent_id = p.id and s.rated_at >= v_from and s.rated_at < v_to and s.score >= 4) as satisfied,
        (select count(*) from resolves r where r.agent_id = p.id) as resolved,
        (select count(*) from resolves r where r.agent_id = p.id and not r.asked) as resolved_no_survey,
        (select percentile_cont(0.5) within group (order by x.minutes) from replies x where x.agent_id = p.id) as median_minutes
      from people p
    )
    select jsonb_build_object(
      'super', v_super,
      'from', v_from,
      'to', v_to,
      'people', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'me', s.id = v_me,
          'sent', s.sent, 'answered', s.answered, 'ratings', s.ratings,
          'average', case when s.ratings >= 10 then round(s.average, 2) end,
          'satisfied', case when s.ratings >= 10 then s.satisfied end,
          'resolved', s.resolved, 'resolved_no_survey', s.resolved_no_survey,
          'median_minutes', round(s.median_minutes::numeric, 1)) order by s.ratings desc, s.name)
        from stats s), '[]'::jsonb),
      'team', case when v_super then (select jsonb_build_object(
          'sent', (select count(*) from surveys s where s.sent_at >= v_from and s.sent_at < v_to),
          'answered', (select count(*) from surveys s where s.sent_at >= v_from and s.sent_at < v_to and s.score is not null),
          'ratings', x.ratings,
          'average', case when x.ratings >= 10 then round(x.average, 2) end,
          'satisfied', case when x.ratings >= 10 then x.satisfied end,
          'resolved', (select count(*) from resolves r where r.agent_id is not null),
          'resolved_no_survey', (select count(*) from resolves r where r.agent_id is not null and not r.asked),
          'median_minutes', (select round((percentile_cont(0.5) within group (order by r.minutes))::numeric, 1) from replies r))
        from (select count(*) as ratings, avg(s.score) as average, count(*) filter (where s.score >= 4) as satisfied
              from surveys s where s.rated_at >= v_from and s.rated_at < v_to and s.score is not null) x) end,
      'follow_up', case when v_super then coalesce((select jsonb_agg(jsonb_build_object('survey_id', s.id, 'conversation_id', s.conversation_id,
          'rated_at', s.rated_at, 'score', s.score, 'comment', s.comment, 'channel', s.channel,
          'agent_name', ldo_private.support_display_name(s.agent_id),
          'contact', (select coalesce(k.name, k.handle, k.email) from public.ldo_support_contacts k where k.id = s.contact_id),
          'status', (select c.status from public.ldo_support_conversations c where c.id = s.conversation_id)) order by s.rated_at desc)
        from surveys s where s.score <= 2 and s.rated_at >= v_from and s.rated_at < v_to), '[]'::jsonb) end)
  );
end;
$$;

-- ---------------------------------------------------------------- definições (Super Admin)

create function public.ldo_support_survey_settings(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.ldo_support_settings;
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  select * into v_s from public.ldo_support_settings where id = 1;
  return jsonb_build_object('mode', v_s.survey_mode, 'delay_minutes', v_s.survey_delay_minutes, 'channels', to_jsonb(v_s.survey_channels),
    'month', (select jsonb_build_object('created', count(*), 'sent', count(*) filter (where sent_at is not null),
        'rated', count(*) filter (where score is not null), 'skipped', count(*) filter (where status = 'skipped'),
        'failed', count(*) filter (where status = 'failed'), 'follow_up', count(*) filter (where follow_up))
      from public.ldo_support_surveys where created_at >= ldo_private.support_lisbon_start('month')));
end;
$$;

-- p_values: {"mode", "delay_minutes", "channels"} (todos obrigatórios).
create function public.ldo_support_survey_settings_save(p_session text, p_values jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_mode text := p_values ->> 'mode';
  v_delay numeric;
  v_channels text[];
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if v_mode is null or v_mode not in ('desligado', 'perguntar', 'automatico') then
    raise exception 'Escolha o modo do pedido de avaliação.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_values -> 'delay_minutes') is distinct from 'number' then
    raise exception 'Espera entre 0 e 120 minutos.' using errcode = '22023';
  end if;
  v_delay := (p_values ->> 'delay_minutes')::numeric;
  if v_delay <> trunc(v_delay) or v_delay < 0 or v_delay > 120 then
    raise exception 'Espera entre 0 e 120 minutos.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_values -> 'channels') is distinct from 'array' then
    raise exception 'Canais inválidos.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_channels from jsonb_array_elements_text(p_values -> 'channels') as x;
  if not v_channels <@ array['facebook', 'instagram', 'email', 'site'] then
    raise exception 'Canais inválidos.' using errcode = '22023';
  end if;
  update public.ldo_support_settings set survey_mode = v_mode, survey_delay_minutes = v_delay::integer, survey_channels = v_channels,
    updated_by = v_me, updated_at = now() where id = 1;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'survey.settings', jsonb_build_object('mode', v_mode, 'delay_minutes', v_delay::integer, 'channels', to_jsonb(v_channels)));
end;
$$;

-- ---------------------------------------------------------------- acessos

revoke all on function
  ldo_private.support_team_outbound_since(uuid, timestamptz),
  ldo_private.support_rating_text(text),
  ldo_private.support_rating_score(text),
  ldo_private.support_rating_lead(text),
  ldo_private.support_rating_comment(text),
  ldo_private.support_rating_optout(text),
  ldo_private.support_survey_cycle(uuid, timestamptz),
  ldo_private.support_survey_agent(uuid, timestamptz, timestamptz),
  ldo_private.support_survey_block(uuid, timestamptz),
  ldo_private.support_survey_rate(uuid, smallint, uuid, text, boolean),
  ldo_private.support_take_rating(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function
  public.ldo_support_system_send_begin(text, uuid, text, text, uuid),
  public.ldo_support_survey_preview(text, uuid),
  public.ldo_support_survey_create(text, uuid, boolean),
  public.ldo_support_survey_cancel(text, uuid, text),
  public.ldo_support_contact_surveys_save(text, uuid, boolean),
  public.ldo_support_survey_due(text, integer),
  public.ldo_support_survey_sent(text, uuid, text, uuid, text),
  public.ldo_support_survey_thanks_due(text, integer),
  public.ldo_support_survey_thanks_sent(text, uuid, text, uuid),
  public.ldo_support_site_rate(text, text, text, uuid, integer, text),
  public.ldo_support_survey_purge(text),
  public.ldo_support_ratings_report(text, date, date),
  public.ldo_support_survey_settings(text),
  public.ldo_support_survey_settings_save(text, jsonb)
from public, authenticated;
grant execute on function
  public.ldo_support_system_send_begin(text, uuid, text, text, uuid),
  public.ldo_support_survey_preview(text, uuid),
  public.ldo_support_survey_create(text, uuid, boolean),
  public.ldo_support_survey_cancel(text, uuid, text),
  public.ldo_support_contact_surveys_save(text, uuid, boolean),
  public.ldo_support_survey_due(text, integer),
  public.ldo_support_survey_sent(text, uuid, text, uuid, text),
  public.ldo_support_survey_thanks_due(text, integer),
  public.ldo_support_survey_thanks_sent(text, uuid, text, uuid),
  public.ldo_support_site_rate(text, text, text, uuid, integer, text),
  public.ldo_support_survey_purge(text),
  public.ldo_support_ratings_report(text, date, date),
  public.ldo_support_survey_settings(text),
  public.ldo_support_survey_settings_save(text, jsonb)
to anon;
