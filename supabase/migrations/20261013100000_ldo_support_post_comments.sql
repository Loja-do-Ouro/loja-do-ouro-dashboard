-- Apoio ao Cliente: comentários das publicações do Facebook e do Instagram (Inbox "post-comments" da Metricool).
--
-- * Duas fontes novas, com plataforma e canais próprios ("metricool_comments", "facebook_comments",
--   "instagram_comments"): nenhum caminho das mensagens privadas (sincronização, envio, respostas automáticas)
--   trata um comentário como mensagem privada, e a resposta pública nunca sai pelo Messenger/Direct.
-- * Uma conversa por comentário principal (tópico), com a publicação comentada (ldo_support_posts). Os endereços
--   das imagens da publicação (CDN da Meta, temporários) ficam só no servidor: o detalhe da conversa devolve o
--   tipo e a posição de cada imagem, e o proxy do dashboard vai buscá-las (ldo_support_post_media).
-- * Importação sem ruído: um tópico novo já respondido pela marca (ou sem atividade há mais de 7 dias) entra
--   como Resolvido e lido para toda a equipa. Um tópico em "Novo", sem responsável, que a marca respondeu fora
--   do dashboard (Instagram, Facebook, Metricool) passa também a Resolvido. Uma nova mensagem de quem comenta
--   reabre-o, como nos outros canais.
-- * Correção: uma nota interna nunca é confundida com uma resposta sincronizada com o mesmo texto (fora do
--   Zendesk, a correspondência pelo texto passa a ser só entre respostas).
-- * Intervalo mínimo entre passagens por fonte (config.min_interval_seconds; comentários: 120 s), salvo num pedido
--   explícito (override: Verificar, Sincronizar agora), que só respeita os 15 s de sempre.
-- * Respostas públicas desligadas até serem validadas num comentário de teste: config.replies_enabled = true liga-as;
--   config.reply_test_conversations (lista de ids de conversas) permite-as só nessas conversas. A BD recusa a resposta
--   antes de a gravar; uma fonte desligada ou bloqueada também não publica.
-- * Nos comentários públicos não se associa o email de cliente da loja ao contacto (no Instagram quem comenta é
--   identificado pelo nome de utilizador, que pode passar para outra pessoa).
--
-- Bloqueio das duas tabelas pela mesma ordem das leituras do dashboard (conversas, depois fontes), com espera curta:
-- se houver uma sincronização a meio, a migração falha sem efeito e volta-se a aplicar.
set local lock_timeout = '5s';
lock table public.ldo_support_conversations, public.ldo_support_sources in access exclusive mode;

alter table public.ldo_support_sources drop constraint ldo_support_sources_platform_check;
alter table public.ldo_support_sources add constraint ldo_support_sources_platform_check
  check (platform in ('zendesk', 'metricool', 'metricool_comments', 'whatsapp', 'site', 'gmail'));
alter table public.ldo_support_sources drop constraint ldo_support_sources_channel_check;
alter table public.ldo_support_sources add constraint ldo_support_sources_channel_check
  check (channel in ('zendesk', 'facebook', 'instagram', 'facebook_comments', 'instagram_comments', 'whatsapp', 'site', 'email'));

insert into public.ldo_support_sources (id, platform, channel, account, label, status, status_detail, config)
values
  ('metricool-facebook-comments', 'metricool_comments', 'facebook_comments', '2912472', 'Comentários Facebook', 'pending',
    'A aguardar a primeira sincronização.', '{"provider": "FACEBOOK", "min_interval_seconds": 120, "replies_enabled": false, "reply_test_conversations": []}'),
  ('metricool-instagram-comments', 'metricool_comments', 'instagram_comments', '2912472', 'Comentários Instagram', 'pending',
    'A aguardar a primeira sincronização.', '{"provider": "INSTAGRAM", "min_interval_seconds": 120, "replies_enabled": false, "reply_test_conversations": []}')
on conflict (id) do nothing;

-- Publicação comentada (uma por publicação e fonte; vários tópicos apontam para a mesma).
create table public.ldo_support_posts (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.ldo_support_sources (id) on delete cascade,
  external_id text not null check (length(external_id) between 1 and 200),
  link text check (link is null or (length(link) <= 1000 and link ~ '^https://')),
  kind text not null default 'other' check (kind in ('post', 'reel', 'video', 'photo', 'story', 'ad', 'other')),
  product_type text check (product_type is null or product_type ~ '^[A-Za-z_]{1,30}$'),
  caption text check (caption is null or length(caption) <= 2200),
  -- [{url, kind: image|video}], só https em servidores da Meta (nunca devolvido ao browser).
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 10 and pg_column_size(media) <= 24000),
  comment_count integer check (comment_count is null or comment_count >= 0),
  reaction_count integer check (reaction_count is null or reaction_count >= 0),
  owner_name text check (owner_name is null or length(owner_name) <= 200),
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);
alter table public.ldo_support_posts enable row level security;
revoke all on public.ldo_support_posts from public, anon, authenticated;

alter table public.ldo_support_conversations add column post_id uuid references public.ldo_support_posts (id) on delete set null;
create index ldo_support_conversations_post_idx on public.ldo_support_conversations (post_id) where post_id is not null;

-- Lida para toda a equipa do apoio (quem tem acesso hoje), sem nunca recuar uma leitura mais recente.
create or replace function ldo_private.support_read_all(p_conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ldo_support_reads (user_id, conversation_id, read_at)
  select u.id, p_conversation, now() from public.ldo_app_users u where u.active and (u.support_access or u.is_super_admin)
  on conflict (user_id, conversation_id) do update set read_at = greatest(public.ldo_support_reads.read_at, excluded.read_at);
$$;
revoke all on function ldo_private.support_read_all(uuid) from public, anon, authenticated;

-- Intervalo mínimo entre passagens de uma fonte: config.min_interval_seconds (15 s a 1 hora), por omissão 15 s.
create or replace function ldo_private.support_min_interval(p_config jsonb)
returns interval
language sql
immutable
set search_path = ''
as $$
  select make_interval(secs => case when p_config ->> 'min_interval_seconds' ~ '^\d{1,4}$'
    then least(greatest((p_config ->> 'min_interval_seconds')::integer, 15), 3600) else 15 end);
$$;
revoke all on function ldo_private.support_min_interval(jsonb) from public, anon, authenticated;

-- Respostas públicas permitidas nesta conversa de comentários: fonte ativa e respostas ligadas (ou conversa de teste).
create or replace function ldo_private.support_public_replies(p_source text, p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.status not in ('disabled', 'blocked')
      and (s.config ->> 'replies_enabled' = 'true' or coalesce(s.config -> 'reply_test_conversations', '[]'::jsonb) ? p_conversation::text)
    from public.ldo_support_sources s where s.id = p_source and s.platform = 'metricool_comments'), false);
$$;
revoke all on function ldo_private.support_public_replies(text, uuid) from public, anon, authenticated;

create or replace function public.ldo_support_sync_claim(p_token text, p_source text, p_force boolean, p_override boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.ldo_support_sources;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_sources set lease_until = now() + interval '150 seconds', last_attempt_at = now()
  where id = p_source and status <> 'disabled' and (lease_until is null or lease_until < now())
    and (last_attempt_at is null or last_attempt_at < now()
      - case when coalesce(p_override, false) then interval '15 seconds' else ldo_private.support_min_interval(config) end)
    and (next_attempt_at is null or next_attempt_at <= now() or coalesce(p_override, false)
      or (coalesce(p_force, false) and failures = 0))
  returning * into v_s;
  if v_s.id is not null then
    return jsonb_build_object('claimed', true, 'source', to_jsonb(v_s));
  end if;
  select * into v_s from public.ldo_support_sources where id = p_source;
  return jsonb_build_object('claimed', false, 'next_attempt_at', v_s.next_attempt_at, 'reason', case
    when v_s.id is null then 'unknown'
    when v_s.status = 'disabled' then 'disabled'
    when v_s.lease_until > now() then 'running'
    when v_s.last_attempt_at >= now()
      - case when coalesce(p_override, false) then interval '15 seconds' else ldo_private.support_min_interval(v_s.config) end then 'recent'
    when v_s.failures > 0 then 'backoff'
    else 'not_due' end);
end;
$$;

-- Ingest (versão de 20261009190000) com: a publicação dos comentários, o estado inicial dos tópicos importados,
-- o tópico respondido fora do dashboard e a correspondência pelo texto só entre respostas fora do Zendesk.
create or replace function public.ldo_support_ingest(p_token text, p_source text, p_conversations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.ldo_support_sources;
  c jsonb;
  m jsonb;
  v_contact uuid;
  v_conv public.ldo_support_conversations;
  v_is_new boolean;
  v_fresh boolean;
  v_new_inbound integer;
  v_new_outbound integer;
  v_match uuid;
  v_assignee uuid;
  v_author uuid;
  v_status text;
  v_incoming_at timestamptz;
  v_new_conv integer := 0;
  v_new_msgs integer := 0;
  v_reopened integer := 0;
  v_platform_truth boolean;
  v_comments boolean;
  v_resolved text;
  v_post uuid;
  v_deleted boolean;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_src from public.ldo_support_sources where id = p_source;
  if v_src.id is null then
    raise exception 'Fonte desconhecida.' using errcode = '22023';
  end if;
  -- Zendesk desligado: um lote tardio (sincronização ou leitura de ticket já em curso) não escreve nada; o responsável
  -- e o estado locais mantêm-se. O lock espera por um desligar em curso (e o desligar espera por um ingest em curso).
  if v_src.platform = 'zendesk' then
    select * into v_src from public.ldo_support_sources where id = p_source for share;
    if v_src.status = 'disabled' then
      return jsonb_build_object('conversations', 0, 'new_conversations', 0, 'new_messages', 0, 'reopened', 0);
    end if;
  end if;
  v_platform_truth := v_src.platform = 'zendesk';
  v_comments := v_src.platform = 'metricool_comments';
  for c in select value from jsonb_array_elements(coalesce(p_conversations, '[]'::jsonb)) loop
    insert into public.ldo_support_contacts (channel, account, external_id, name, email, phone, handle, avatar_url)
    values (v_src.channel, v_src.account, coalesce(nullif(c #>> '{contact,external_id}', ''), 'conversa:' || (c ->> 'external_id')),
      left(nullif(c #>> '{contact,name}', ''), 200), left(lower(nullif(c #>> '{contact,email}', '')), 254),
      left(nullif(c #>> '{contact,phone}', ''), 40), left(nullif(c #>> '{contact,handle}', ''), 120), left(nullif(c #>> '{contact,avatar_url}', ''), 1000))
    on conflict (channel, account, external_id) do update set
      name = coalesce(excluded.name, public.ldo_support_contacts.name), email = coalesce(excluded.email, public.ldo_support_contacts.email),
      phone = coalesce(excluded.phone, public.ldo_support_contacts.phone), handle = coalesce(excluded.handle, public.ldo_support_contacts.handle),
      avatar_url = coalesce(excluded.avatar_url, public.ldo_support_contacts.avatar_url), updated_at = now()
    returning id into v_contact;

    v_assignee := null;
    if v_platform_truth and nullif(c ->> 'external_assignee_id', '') is not null then
      select z.user_id into v_assignee from public.ldo_support_zendesk_connections z
      where z.zendesk_user_id = c ->> 'external_assignee_id' order by (z.status = 'active') desc, z.updated_at desc limit 1;
    end if;
    v_status := case when c ->> 'status' in ('novo', 'em_atendimento', 'aguarda_cliente', 'resolvido') then c ->> 'status' end;
    v_incoming_at := nullif(c ->> 'external_updated_at', '')::timestamptz;
    -- Comentários: "answered" = a última mensagem do tópico é da marca; "stale" = sem atividade há mais de 7 dias.
    v_resolved := case when v_comments and c ->> 'resolved' in ('answered', 'stale') then c ->> 'resolved' end;

    -- Publicação comentada: só ligações https da Meta e imagens dos servidores da Meta; o resto fica de fora.
    v_post := null;
    if v_comments and jsonb_typeof(c -> 'post') = 'object' and nullif(c #>> '{post,external_id}', '') is not null then
      insert into public.ldo_support_posts as p (source_id, external_id, link, kind, product_type, caption, media, comment_count, reaction_count, owner_name, seen_at)
      values (v_src.id, left(c #>> '{post,external_id}', 200),
        case when length(c #>> '{post,link}') <= 1000
          and c #>> '{post,link}' ~ '^https://([a-z0-9-]+\.)*(facebook\.com|instagram\.com|fb\.com|fb\.watch)(/|$)' then c #>> '{post,link}' end,
        case when c #>> '{post,kind}' in ('post', 'reel', 'video', 'photo', 'story', 'ad', 'other') then c #>> '{post,kind}' else 'other' end,
        case when c #>> '{post,product_type}' ~ '^[A-Za-z_]{1,30}$' then c #>> '{post,product_type}' end,
        left(nullif(c #>> '{post,caption}', ''), 2200),
        (select coalesce(jsonb_agg(jsonb_build_object('url', x.e ->> 'url', 'kind', case when x.e ->> 'kind' = 'video' then 'video' else 'image' end) order by x.n), '[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(c #> '{post,media}') = 'array' then c #> '{post,media}' else '[]'::jsonb end) with ordinality as x(e, n)
          where x.n <= 10 and jsonb_typeof(x.e) = 'object' and length(x.e ->> 'url') <= 2000
            and x.e ->> 'url' ~ '^https://(lookaside\.fbsbx\.com|lookaside\.facebook\.com|[a-z0-9.-]+\.fbcdn\.net|[a-z0-9.-]+\.cdninstagram\.com)/'),
        case when c #>> '{post,comment_count}' ~ '^\d{1,9}$' then (c #>> '{post,comment_count}')::integer end,
        case when c #>> '{post,reaction_count}' ~ '^\d{1,9}$' then (c #>> '{post,reaction_count}')::integer end,
        left(nullif(c #>> '{post,owner_name}', ''), 200), now())
      on conflict (source_id, external_id) do update set
        link = coalesce(excluded.link, p.link), kind = case when excluded.kind = 'other' then p.kind else excluded.kind end,
        product_type = coalesce(excluded.product_type, p.product_type),
        caption = coalesce(excluded.caption, p.caption),
        media = case when jsonb_array_length(excluded.media) > 0 then excluded.media else p.media end,
        comment_count = coalesce(excluded.comment_count, p.comment_count), reaction_count = coalesce(excluded.reaction_count, p.reaction_count),
        owner_name = coalesce(excluded.owner_name, p.owner_name), seen_at = now()
      returning p.id into v_post;
    end if;

    select * into v_conv from public.ldo_support_conversations
    where channel = v_src.channel and account = v_src.account and external_id = c ->> 'external_id' for update;
    v_is_new := v_conv.id is null;
    if v_is_new then
      insert into public.ldo_support_conversations (source_id, channel, account, external_id, contact_id, subject, status, platform_status,
        assignee_id, external_assignee_id, external_assignee_name, via, external_updated_at, post_id)
      values (v_src.id, v_src.channel, v_src.account, c ->> 'external_id', v_contact, left(c ->> 'subject', 300),
        case when v_platform_truth then coalesce(v_status, 'novo') when v_resolved is not null then 'resolvido' else 'novo' end, c ->> 'platform_status',
        v_assignee, nullif(c ->> 'external_assignee_id', ''), nullif(c ->> 'external_assignee_name', ''), c ->> 'via', v_incoming_at, v_post)
      returning * into v_conv;
      v_new_conv := v_new_conv + 1;
      if v_resolved is not null then
        insert into public.ldo_support_audit (actor, conversation_id, action, details)
        values (null, v_conv.id, 'status', jsonb_build_object('from', null, 'to', 'resolvido', 'reason', case when v_resolved = 'answered'
          then 'Importado: já respondido na publicação' else 'Importado: sem atividade há mais de 7 dias' end));
      end if;
    else
      -- Um retrato mais antigo do ticket (sincronização lenta) não desfaz uma alteração mais recente.
      v_fresh := v_incoming_at is null or v_conv.external_updated_at is null or v_incoming_at >= v_conv.external_updated_at;
      update public.ldo_support_conversations set
        contact_id = case when v_fresh then v_contact else contact_id end,
        subject = case when v_fresh then coalesce(left(c ->> 'subject', 300), subject) else subject end,
        platform_status = case when v_fresh then coalesce(c ->> 'platform_status', platform_status) else platform_status end,
        via = coalesce(via, c ->> 'via'),
        external_updated_at = greatest(external_updated_at, v_incoming_at),
        status = case when v_platform_truth and v_fresh and v_status is not null then v_status else status end,
        assignee_id = case when v_platform_truth and v_fresh then v_assignee else assignee_id end,
        external_assignee_id = case when v_platform_truth and v_fresh then nullif(c ->> 'external_assignee_id', '') else external_assignee_id end,
        external_assignee_name = case when v_platform_truth and v_fresh then nullif(c ->> 'external_assignee_name', '') else external_assignee_name end,
        post_id = coalesce(v_post, post_id),
        updated_at = now()
      where id = v_conv.id
      returning * into v_conv;
    end if;

    v_new_inbound := 0;
    v_new_outbound := 0;
    for m in select value from jsonb_array_elements(coalesce(c -> 'messages', '[]'::jsonb)) loop
      if m ->> 'kind' not in ('inbound', 'outbound', 'note') or nullif(m ->> 'external_id', '') is null then
        continue;
      end if;
      v_deleted := coalesce((m ->> 'deleted')::boolean, false);
      if exists (select 1 from public.ldo_support_messages where conversation_id = v_conv.id and external_id = m ->> 'external_id') then
        update public.ldo_support_messages set
          -- Apagada pelo cliente: fica marcada e sem conteúdo.
          deleted_at = case when v_deleted then coalesce(deleted_at, now()) else deleted_at end,
          body = case when v_deleted then '' else body end,
          -- Anexo confirmado pela plataforma substitui a cópia temporária do dashboard.
          attachments = case when v_deleted then '[]'::jsonb
            when jsonb_array_length(coalesce(m -> 'attachments', '[]'::jsonb)) > 0 then m -> 'attachments' else attachments end,
          -- O Zendesk pode gravar como privado um comentário enviado como público.
          kind = case when m ->> 'kind' in ('outbound', 'note') and kind in ('outbound', 'note') then m ->> 'kind' else kind end,
          delivery = case
            when m ->> 'delivery' in ('delivered', 'read') and kind = 'outbound' then m ->> 'delivery'
            when kind = 'outbound' and m ->> 'kind' = 'outbound' and delivery in ('sending', 'uncertain') then 'accepted'
            else delivery end
        where conversation_id = v_conv.id and external_id = m ->> 'external_id';
        continue;
      end if;
      if v_deleted then
        continue;
      end if;
      v_author := null;
      if v_platform_truth and nullif(m ->> 'author_external_id', '') is not null then
        select z.user_id into v_author from public.ldo_support_zendesk_connections z
        where z.zendesk_user_id = m ->> 'author_external_id' order by (z.status = 'active') desc, z.updated_at desc limit 1;
      end if;
      -- Uma resposta ou nota enviada pelo dashboard (ainda sem id externo) é reconhecida pelo texto
      -- normalizado, até 15 minutos de diferença, em vez de aparecer duplicada. Fora do Zendesk as notas
      -- internas ficam só no dashboard: nunca correspondem a uma mensagem da plataforma.
      v_match := null;
      if m ->> 'kind' in ('outbound', 'note') then
        select id into v_match from public.ldo_support_messages
        where conversation_id = v_conv.id and external_id is null and client_key is not null
          and (kind = 'outbound' or (v_platform_truth and kind = 'note'))
          and (delivery is null or delivery in ('sending', 'uncertain', 'accepted'))
          and (v_author is null or author_user_id = v_author)
          and ldo_private.support_norm(body) = ldo_private.support_norm(m ->> 'body')
          -- Uma imagem sem texto só corresponde a um envio com anexo (e não a um texto sem anexo).
          and (ldo_private.support_norm(m ->> 'body') <> '' or jsonb_array_length(attachments) > 0)
          and abs(extract(epoch from (created_at - (m ->> 'created_at')::timestamptz))) < 900
        order by created_at limit 1;
      end if;
      if v_match is not null then
        update public.ldo_support_messages set external_id = m ->> 'external_id', kind = m ->> 'kind',
          delivery = case when m ->> 'kind' = 'outbound' then
              case when delivery in ('delivered', 'read') then delivery else coalesce(nullif(m ->> 'delivery', ''), 'accepted') end
            else case when kind = 'outbound' then 'failed' else null end end,
          delivery_detail = case when m ->> 'kind' = 'note' and kind = 'outbound'
            then 'O Zendesk gravou esta resposta como nota interna: o cliente não a recebeu.'
            else coalesce(delivery_detail, 'Confirmado pela sincronização.') end,
          attachments = case when jsonb_array_length(coalesce(m -> 'attachments', '[]'::jsonb)) > 0 then m -> 'attachments' else attachments end
        where id = v_match;
        continue;
      end if;
      insert into public.ldo_support_messages (conversation_id, external_id, kind, author_name, author_external_id, author_user_id, body,
        attachments, created_at, delivery)
      values (v_conv.id, m ->> 'external_id', m ->> 'kind', left(m ->> 'author_name', 200), m ->> 'author_external_id', v_author,
        left(coalesce(m ->> 'body', ''), 65000), coalesce(m -> 'attachments', '[]'::jsonb), (m ->> 'created_at')::timestamptz,
        case when m ->> 'kind' = 'outbound' then coalesce(nullif(m ->> 'delivery', ''), 'accepted') end)
      on conflict (conversation_id, external_id) do nothing;
      if found then
        v_new_msgs := v_new_msgs + 1;
        if m ->> 'kind' = 'inbound' and (m ->> 'created_at')::timestamptz > coalesce(v_conv.last_inbound_at, '-infinity'::timestamptz) then
          v_new_inbound := v_new_inbound + 1;
        end if;
        if m ->> 'kind' = 'outbound' then
          v_new_outbound := v_new_outbound + 1;
        end if;
      end if;
    end loop;

    if not v_platform_truth and not v_is_new and v_new_inbound > 0 and v_conv.status in ('resolvido', 'aguarda_cliente') then
      update public.ldo_support_conversations set
        status = case when v_conv.status = 'resolvido' and assignee_id is null then 'novo' else 'em_atendimento' end
      where id = v_conv.id;
      insert into public.ldo_support_audit (actor, conversation_id, action, details)
      values (null, v_conv.id, 'reopen', jsonb_build_object('from', v_conv.status, 'reason', 'Nova mensagem do cliente'));
      v_reopened := v_reopened + 1;
    end if;
    -- Comentários: tópico em "Novo", sem responsável, a que a marca acabou de responder fora do dashboard
    -- (Instagram, Facebook, Metricool) e em que a última mensagem é da marca.
    if v_comments and not v_is_new and v_resolved = 'answered' and v_new_outbound > 0 then
      update public.ldo_support_conversations set status = 'resolvido', updated_at = now()
      where id = v_conv.id and status = 'novo' and assignee_id is null;
      if found then
        insert into public.ldo_support_audit (actor, conversation_id, action, details)
        values (null, v_conv.id, 'status', jsonb_build_object('from', 'novo', 'to', 'resolvido', 'reason', 'Respondido fora do dashboard'));
        perform ldo_private.support_read_all(v_conv.id);
      end if;
    end if;
    if v_is_new and v_resolved is not null then
      perform ldo_private.support_read_all(v_conv.id);
    end if;
    perform ldo_private.support_summarize(v_conv.id);
  end loop;
  return jsonb_build_object('conversations', jsonb_array_length(coalesce(p_conversations, '[]'::jsonb)),
    'new_conversations', v_new_conv, 'new_messages', v_new_msgs, 'reopened', v_reopened);
end;
$$;

-- Detalhe da conversa (versão de 20261007160000) com a publicação comentada: tipo, ligação, legenda, contagens
-- e a posição/tipo de cada imagem (os endereços ficam no servidor).
create or replace function public.ldo_support_conversation(p_session text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_c public.ldo_support_conversations;
  v_k public.ldo_support_contacts;
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
    'related', coalesce((
      select jsonb_agg(jsonb_build_object('contact_id', k.id, 'channel', k.channel, 'name', k.name, 'email', k.email, 'phone', k.phone,
        'conversation_id', (select c2.id from public.ldo_support_conversations c2 where c2.contact_id = k.id order by c2.last_message_at desc nulls last limit 1)))
      from public.ldo_support_contacts k
      where k.id <> v_k.id and (
        (coalesce(v_k.email, v_k.linked_email) is not null and lower(coalesce(v_k.email, v_k.linked_email)) in (lower(k.email), lower(k.linked_email)))
        or (v_k.phone is not null and regexp_replace(v_k.phone, '\D', '', 'g') <> '' and regexp_replace(v_k.phone, '\D', '', 'g') = regexp_replace(coalesce(k.phone, ''), '\D', '', 'g')))
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'author_name', coalesce(au.full_name, au.username, m.author_name),
        'author_user_id', m.author_user_id, 'body', m.body, 'attachments', m.attachments, 'created_at', m.created_at,
        'inserted_at', m.inserted_at, 'deleted', m.deleted_at is not null,
        'delivery', m.delivery, 'delivery_detail', m.delivery_detail, 'external', m.external_id is not null) order by m.created_at, m.inserted_at)
      from (select * from public.ldo_support_messages where conversation_id = p_id order by created_at desc, inserted_at desc limit 500) m
      left join public.ldo_app_users au on au.id = m.author_user_id
    ), '[]'::jsonb),
    'presence', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', coalesce(u.full_name, u.username), 'composing', p.composing, 'seen_at', p.seen_at))
      from public.ldo_support_presence p join public.ldo_app_users u on u.id = p.user_id
      where p.conversation_id = p_id and p.user_id <> v_me and p.seen_at > now() - interval '60 seconds'
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object('action', l.action, 'details', l.details, 'created_at', l.created_at,
        'actor', coalesce((select coalesce(full_name, username) from public.ldo_app_users where id = l.actor), 'Sistema')) order by l.created_at desc)
      from (select * from public.ldo_support_audit where conversation_id = p_id order by created_at desc limit 30) l
    ), '[]'::jsonb)
  );
end;
$$;

-- Endereço de uma imagem da publicação, para o proxy do dashboard (sessão com acesso ao apoio). Nunca chega ao
-- browser: o servidor vai buscar a imagem e devolve só os bytes confirmados.
create or replace function public.ldo_support_post_media(p_session text, p_conversation uuid, p_index integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
begin
  if p_index is null or p_index < 0 or p_index > 9 then
    return null;
  end if;
  return (select p.media -> p_index from public.ldo_support_conversations c join public.ldo_support_posts p on p.id = c.post_id
    where c.id = p_conversation);
end;
$$;

-- Envio (versão de 20261009190000) com o interruptor das respostas públicas aos comentários, verificado antes de
-- gravar a mensagem (as notas internas continuam livres e nunca são publicadas).
create or replace function public.ldo_support_begin_send(p_session text, p_id uuid, p_kind text, p_body text, p_client_key uuid, p_uploads uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_c public.ldo_support_conversations;
  v_k public.ldo_support_contacts;
  v_m public.ldo_support_messages;
  v_platform text;
  v_existing boolean := false;
  v_body text := btrim(coalesce(p_body, ''));
  v_uploads uuid[] := coalesce(p_uploads, '{}');
  v_attachments jsonb := '[]'::jsonb;
  v_off boolean := false;
begin
  if p_kind not in ('outbound', 'note') then
    raise exception 'Tipo de mensagem inválido.' using errcode = '22023';
  end if;
  if v_body = '' and cardinality(v_uploads) = 0 then
    raise exception 'Escreva a mensagem ou anexe uma imagem.' using errcode = '22023';
  end if;
  if length(v_body) > 20000 then
    raise exception 'Mensagem demasiado longa.' using errcode = '22023';
  end if;
  if cardinality(v_uploads) > 5 then
    raise exception 'No máximo 5 anexos por mensagem.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  select * into v_c from public.ldo_support_conversations where id = p_id for update;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  select platform into v_platform from public.ldo_support_sources where id = v_c.source_id;
  -- Zendesk desligado: os tickets ficam como histórico. Nada sai para o cliente; as notas internas ficam só no
  -- dashboard (sem anexos).
  if v_platform = 'zendesk' and ldo_private.zendesk_off() then
    v_off := true;
    if p_kind = 'outbound' then
      raise exception 'O Zendesk foi desligado do dashboard: esta conversa fica como histórico. Responda no Zendesk.' using errcode = '42501';
    end if;
    if cardinality(v_uploads) > 0 then
      raise exception 'Com o Zendesk desligado, as notas destes tickets não levam anexos.' using errcode = '22023';
    end if;
  end if;
  -- Zendesk não aceita comentários vazios: o texto enviado com um anexo sozinho fica guardado tal como sai.
  if v_body = '' and cardinality(v_uploads) > 0 and v_platform = 'zendesk' and not v_off then
    v_body := 'Segue em anexo.';
  end if;
  select * into v_k from public.ldo_support_contacts where id = v_c.contact_id;

  select * into v_m from public.ldo_support_messages where client_key = p_client_key;
  if v_m.id is not null then
    if v_m.conversation_id <> p_id or v_m.author_user_id is distinct from v_me or v_m.kind <> p_kind or v_m.body <> v_body then
      raise exception 'Este pedido já foi usado para outra mensagem. Volte a carregar em Enviar.' using errcode = '22023';
    end if;
    v_existing := true;
  else
    -- Só o responsável responde ao cliente (as notas internas são para toda a equipa).
    if p_kind = 'outbound' and v_c.assignee_id is not null and v_c.assignee_id <> v_me then
      raise exception 'Esta conversa está com %. Só essa pessoa pode responder ao cliente; peça-lhe que a transfira.',
        ldo_private.support_display_name(v_c.assignee_id) using errcode = '42501';
    end if;
    -- Comentários: resposta pública só com as respostas ligadas (ou numa conversa de teste) e a fonte ativa.
    if p_kind = 'outbound' and v_platform = 'metricool_comments' and not ldo_private.support_public_replies(v_c.source_id, p_id) then
      raise exception 'As respostas públicas aos comentários ainda estão desligadas (falta validar a publicação num comentário de teste). Pode deixar uma nota interna.'
        using errcode = '42501';
    end if;
    if cardinality(v_uploads) > 0 then
      if v_platform = 'metricool' and cardinality(v_uploads) > 1 then
        raise exception 'O Facebook e o Instagram aceitam uma imagem por mensagem.' using errcode = '22023';
      end if;
      if v_platform not in ('zendesk', 'metricool', 'gmail') then
        raise exception 'Este canal ainda não aceita anexos.' using errcode = '22023';
      end if;
      if p_kind = 'note' and v_platform <> 'zendesk' then
        raise exception 'Notas internas sem anexos neste canal.' using errcode = '22023';
      end if;
      if (select count(*) from public.ldo_support_uploads u
          where u.id = any (v_uploads) and u.user_id = v_me and u.conversation_id = p_id and u.message_id is null and u.data is not null
            and (v_platform in ('zendesk', 'gmail') or u.content_type in ('image/jpeg', 'image/png'))) <> cardinality(v_uploads) then
        raise exception 'Anexo inválido ou já enviado.' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('name', u.name, 'type', u.content_type, 'size', u.size, 'ref', 'upload:' || u.id)
        order by array_position(v_uploads, u.id)), '[]'::jsonb)
      into v_attachments from public.ldo_support_uploads u where u.id = any (v_uploads);
    end if;
    insert into public.ldo_support_messages (conversation_id, kind, author_user_id, body, attachments, created_at, delivery, client_key)
    values (p_id, p_kind, v_me, v_body, v_attachments, now(),
      case when p_kind = 'outbound' or (v_platform = 'zendesk' and not v_off) then 'sending' end, p_client_key)
    returning * into v_m;
    update public.ldo_support_uploads set message_id = v_m.id where id = any (v_uploads);
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (v_me, p_id, case when p_kind = 'note' then 'note' else 'reply' end,
      jsonb_build_object('message_id', v_m.id, 'attachments', cardinality(v_uploads)));
    if p_kind = 'outbound' and v_platform <> 'zendesk' then
      if v_c.assignee_id is null then
        insert into public.ldo_support_audit (actor, conversation_id, action, details)
        values (v_me, p_id, 'assign', jsonb_build_object('kind', 'claim', 'from', null, 'from_name', null,
          'to', v_me, 'to_name', ldo_private.support_display_name(v_me), 'to_first', ldo_private.support_first_name(v_me),
          'notice', false));
      end if;
      update public.ldo_support_conversations set
        assignee_id = coalesce(assignee_id, v_me),
        status = case when status = 'novo' then 'em_atendimento' else status end, updated_at = now()
      where id = p_id;
      perform ldo_private.support_summarize(p_id);
    end if;
  end if;
  return jsonb_build_object('message', to_jsonb(v_m), 'existing', v_existing, 'platform', v_platform, 'zendesk_off', v_off,
    'uploads', (select coalesce(jsonb_agg(u.id order by array_position(v_uploads, u.id)), '[]'::jsonb) from public.ldo_support_uploads u where u.message_id = v_m.id),
    'conversation', jsonb_build_object('id', v_c.id, 'source_id', v_c.source_id, 'channel', v_c.channel, 'account', v_c.account,
      'external_id', v_c.external_id, 'via', v_c.via, 'contact_external_id', v_k.external_id, 'contact_email', v_k.email,
      'subject', v_c.subject,
      'assignee_id', v_c.assignee_id, 'external_assignee_id', v_c.external_assignee_id, 'status', v_c.status));
end;
$$;

-- Associação manual do cliente da loja (versão em produção) sem email nos comentários públicos.
create or replace function public.ldo_support_link_contact(p_session text, p_contact uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_old text;
  v_channel text;
begin
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email inválido.' using errcode = '22023';
  end if;
  select linked_email, channel into v_old, v_channel from public.ldo_support_contacts where id = p_contact for update;
  if not found then
    raise exception 'Contacto não encontrado.' using errcode = 'P0002';
  end if;
  if v_email is not null and v_channel in ('facebook_comments', 'instagram_comments') then
    raise exception 'Nos comentários públicos não se associa o cliente da loja: para tratar de encomendas, convide-o a enviar mensagem privada.'
      using errcode = '22023';
  end if;
  update public.ldo_support_contacts set linked_email = v_email,
    linked_by = case when v_email is null then null else v_me end,
    linked_at = case when v_email is null then null else now() end, updated_at = now()
  where id = p_contact;
  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  select v_me, c.id, 'link_customer', jsonb_build_object('from', v_old, 'to', v_email)
  from public.ldo_support_conversations c where c.contact_id = p_contact;
end;
$$;

revoke all on function public.ldo_support_begin_send(text, uuid, text, text, uuid, uuid[]) from public, authenticated;
grant execute on function public.ldo_support_begin_send(text, uuid, text, text, uuid, uuid[]) to anon;
revoke all on function public.ldo_support_link_contact(text, uuid, text) from public, authenticated;
grant execute on function public.ldo_support_link_contact(text, uuid, text) to anon;
revoke all on function public.ldo_support_sync_claim(text, text, boolean, boolean) from public, authenticated;
grant execute on function public.ldo_support_sync_claim(text, text, boolean, boolean) to anon;
revoke all on function public.ldo_support_ingest(text, text, jsonb) from public, authenticated;
grant execute on function public.ldo_support_ingest(text, text, jsonb) to anon;
revoke all on function public.ldo_support_conversation(text, uuid) from public, authenticated;
grant execute on function public.ldo_support_conversation(text, uuid) to anon;
revoke all on function public.ldo_support_post_media(text, uuid, integer) from public, authenticated;
grant execute on function public.ldo_support_post_media(text, uuid, integer) to anon;
