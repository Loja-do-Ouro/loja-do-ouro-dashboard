-- Apoio ao Cliente: histórico visível a partir de uma data (por omissão 1 de setembro de 2026, hora de Lisboa).
-- Nada é apagado. Uma conversa resolvida e sem atividade desde essa data (última mensagem; created_at é a hora da
-- importação, todas de 7-10-2026 em diante) fica fora:
-- * da lista, das contagens dos separadores e da pesquisa (ldo_support_list);
-- * das sugestões de outros contactos do mesmo cliente (ldo_support_conversation.related);
-- * da IA: outras conversas do cliente e respostas anteriores da equipa (só mensagens desde a data).
-- Uma conversa por resolver nunca fica oculta (mudar a data não esconde trabalho em curso), e um ticket Zendesk
-- antigo continua a aparecer pesquisando o número exato (#1234), como diz o README.
-- Uma conversa antiga em que o cliente volte a escrever reaparece (a ingestão atualiza last_message_at); as mensagens
-- anteriores à data ficam recolhidas na conversa e fora do contexto da IA (a data vai em ldo_support_conversation).
-- ldo_support_conversation nunca recusa uma conversa antiga: é também a verificação de acesso do envio, dos anexos,
-- da IA e das ligações /apoio?conversa=.
-- As quatro funções alteradas partem do texto em produção a 30-10-2026 (pg_get_functiondef, já com as alterações
-- feitas no lugar em 20261008150000 e 20261009150000); fora das linhas da data, ficam iguais. Os privilégios
-- mantêm-se (create or replace). O Super Admin muda a data na configuração do apoio.

alter table public.ldo_support_settings
  add column if not exists history_from timestamptz not null default '2026-09-01 00:00:00+01';

-- Data a partir da qual o histórico do apoio é visível.
create or replace function ldo_private.support_history_from()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select history_from from public.ldo_support_settings where id = 1), '-infinity'::timestamptz);
$$;
revoke all on function ldo_private.support_history_from() from public, anon, authenticated;

-- ---------------------------------------------------------------- lista, conversa e IA

create or replace function public.ldo_support_list(p_session text, p_filter text, p_channel text, p_status text, p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_q text := lower(nullif(btrim(coalesce(p_q, '')), ''));
  v_status text := nullif(p_status, '');
  v_filter text := coalesce(nullif(p_filter, ''), 'all');
  v_today timestamptz := (date_trunc('day', now() at time zone 'Europe/Lisbon')) at time zone 'Europe/Lisbon';
  v_from timestamptz := ldo_private.support_history_from();
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(x.item order by x.sort_at desc)
      from (
        select jsonb_build_object(
          'id', c.id, 'channel', c.channel, 'subject', c.subject, 'status', c.status, 'platform_status', c.platform_status,
          'contact_name', coalesce(k.name, k.handle, k.email, 'Cliente'), 'contact_handle', k.handle,
          'assignee_id', c.assignee_id, 'assignee_name', coalesce(a.full_name, a.username, c.external_assignee_name),
          'last_message_at', coalesce(c.last_message_at, c.created_at), 'last_preview', c.last_preview, 'last_direction', c.last_direction,
          'unread', u.unread, 'auto', h.auto,
          'attention', exists (select 1 from public.ldo_support_messages m where m.conversation_id = c.id and m.delivery in ('failed', 'uncertain', 'sending'))
        ) as item, coalesce(c.last_message_at, c.created_at) as sort_at
        from public.ldo_support_conversations c
        left join public.ldo_support_contacts k on k.id = c.contact_id
        left join public.ldo_app_users a on a.id = c.assignee_id
        left join public.ldo_support_reads r on r.conversation_id = c.id and r.user_id = v_me
        cross join lateral (
          select count(*)::int as unread from public.ldo_support_messages m
          where m.conversation_id = c.id and m.kind = 'inbound' and m.deleted_at is null
            and m.inserted_at > coalesce(r.read_at, '-infinity'::timestamptz)
        ) u
        -- Tratada automaticamente: marcada, sem responsável, Novo/Resolvido, e nada depois da marca (cliente ou equipa).
        cross join lateral (select case when c.auto_handled_through is null or c.assignee_id is not null
            or c.status not in ('novo', 'resolvido') then false
          else not exists (select 1 from public.ldo_support_messages m
            where m.conversation_id = c.id and m.deleted_at is null and (m.created_at > c.auto_handled_through or m.inserted_at > coalesce(c.auto_handled_at, c.auto_handled_through))
              and (m.kind = 'inbound' or m.author_user_id is not null)) end as auto) h
        -- Histórico visível: resolvida e sem atividade desde a data da configuração, fica fora da lista e da pesquisa
        -- (por resolver fica sempre); um ticket Zendesk antigo aparece pesquisando o número exato (#1234).
        where (coalesce(c.last_message_at, c.created_at) >= v_from or c.status <> 'resolvido'
            or (v_q ~ '^#?[0-9]{1,12}$' and c.channel = 'zendesk' and c.external_id = ltrim(v_q, '#')))
          and (p_channel is null or p_channel = '' or c.channel = p_channel)
          and (v_status is null or c.status = v_status)
          and (case when v_filter = 'auto' then h.auto else (v_q is not null or not h.auto) end)
          and (v_filter in ('all', 'unread', 'auto')
            or (v_filter = 'mine' and c.assignee_id = v_me and (v_status is not null or c.status <> 'resolvido'))
            or (v_filter = 'unassigned' and c.assignee_id is null and c.external_assignee_id is null and (v_status is not null or c.status <> 'resolvido')))
          and (v_filter <> 'unread' or u.unread > 0)
          and (v_q is null
            or position(v_q in lower(coalesce(k.name, '') || ' ' || coalesce(k.email, '') || ' ' || coalesce(k.claimed_email, '') || ' ' || coalesce(k.handle, '') || ' '
              || coalesce(k.phone, '') || ' ' || coalesce(c.subject, '') || ' ' || coalesce(c.external_id, ''))) > 0
            or exists (select 1 from public.ldo_support_messages m where m.conversation_id = c.id and m.kind <> 'note' and position(v_q in lower(m.body)) > 0))
        order by sort_at desc
        limit 300
      ) x
    ), '[]'::jsonb),
    -- Mesmas regras dos filtros (sem canal, estado nem pesquisa); as tratadas automaticamente só contam em "auto".
    -- Só o histórico visível, como a lista.
    'counts', (
      select jsonb_build_object(
        'all', count(*) filter (where not h.auto),
        'mine', count(*) filter (where not h.auto and c.assignee_id = v_me and c.status <> 'resolvido'),
        'unassigned', count(*) filter (where not h.auto and c.assignee_id is null and c.external_assignee_id is null and c.status <> 'resolvido'),
        'unread', count(*) filter (where not h.auto and exists (
          select 1 from public.ldo_support_messages m
          left join public.ldo_support_reads r on r.conversation_id = c.id and r.user_id = v_me
          where m.conversation_id = c.id and m.kind = 'inbound' and m.deleted_at is null
            and m.inserted_at > coalesce(r.read_at, '-infinity'::timestamptz))),
        'auto', count(*) filter (where h.auto))
      from public.ldo_support_conversations c
      cross join lateral (select case when c.auto_handled_through is null or c.assignee_id is not null
          or c.status not in ('novo', 'resolvido') then false
        else not exists (select 1 from public.ldo_support_messages m
          where m.conversation_id = c.id and m.deleted_at is null and (m.created_at > c.auto_handled_through or m.inserted_at > coalesce(c.auto_handled_at, c.auto_handled_through))
              and (m.kind = 'inbound' or m.author_user_id is not null)) end as auto) h
      where (coalesce(c.last_message_at, c.created_at) >= v_from or c.status <> 'resolvido')
    ),
    -- Respostas automáticas enviadas: hoje (Lisboa) e nos últimos 7 dias.
    'automatic', jsonb_build_object(
      'today', jsonb_build_object(
        'support', (select count(*) from public.ldo_support_social_autoreplies where kind = 'support' and sent_at >= v_today),
        'thanks', (select count(*) from public.ldo_support_social_autoreplies where kind = 'thanks' and sent_at >= v_today),
        'email', (select count(*) from public.ldo_support_gmail_autoreplies where sent_at >= v_today)),
      'week', jsonb_build_object(
        'support', (select count(*) from public.ldo_support_social_autoreplies where kind = 'support' and sent_at >= now() - interval '7 days'),
        'thanks', (select count(*) from public.ldo_support_social_autoreplies where kind = 'thanks' and sent_at >= now() - interval '7 days'),
        'email', (select count(*) from public.ldo_support_gmail_autoreplies where sent_at >= now() - interval '7 days'))),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'platform', s.platform, 'channel', s.channel, 'label', s.label, 'status', s.status,
        'status_detail', s.status_detail, 'last_success_at', s.last_success_at, 'last_attempt_at', s.last_attempt_at, 'last_error', s.last_error,
        'next_attempt_at', s.next_attempt_at) order by s.id)
      from public.ldo_support_sources s
    ), '[]'::jsonb),
    'poll_seconds', (select poll_seconds from public.ldo_support_settings where id = 1),
    'history_from', v_from
  );
end;
$$;

create or replace function public.ldo_support_conversation(p_session text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_c public.ldo_support_conversations;
  v_k public.ldo_support_contacts;
  v_from timestamptz := ldo_private.support_history_from();
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
    ), '[]'::jsonb),
    -- Mensagens anteriores a esta data: recolhidas na conversa e fora da IA (a conversa abre na mesma).
    'history_from', v_from
  );
end;
$$;

create or replace function public.ldo_support_ai_customer_history(p_token text, p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_k public.ldo_support_contacts;
  v_email text;
  v_phone text;
  v_from timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  v_from := ldo_private.support_history_from();
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
        from (select * from public.ldo_support_messages where conversation_id = c.id and deleted_at is null and created_at >= v_from
              order by created_at desc limit 6) m), '[]'::jsonb)) order by c.last_message_at desc nulls last)
    from (
      select c.* from public.ldo_support_conversations c join public.ldo_support_contacts k on k.id = c.contact_id
      where c.id <> p_conversation and (coalesce(c.last_message_at, c.created_at) >= v_from or c.status <> 'resolvido') and (
        k.id = v_k.id
        or (v_email is not null and v_email in (lower(k.email), lower(k.linked_email)))
        or (v_phone is not null and v_phone = regexp_replace(coalesce(k.phone, ''), '\D', '', 'g')))
      order by c.last_message_at desc nulls last
      limit 4
    ) c), '[]'::jsonb);
end;
$$;

create or replace function public.ldo_support_ai_replies(p_token text, p_query text, p_exclude uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  -- Só palavras: sem emails, @perfis nem números (a pesquisa não pode visar uma encomenda ou pessoa).
  v_terms text := btrim(regexp_replace(regexp_replace(regexp_replace(left(coalesce(p_query, ''), 200),
    '[^[:space:]]*@[^[:space:]]*', ' ', 'g'), '[0-9]+', ' ', 'g'), '[^[:alpha:][:space:]-]+', ' ', 'g'));
  v_query tsquery;
  v_from timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  v_from := ldo_private.support_history_from();
  if v_terms = '' then
    return '[]'::jsonb;
  end if;
  v_query := websearch_to_tsquery('portuguese'::regconfig, array_to_string(regexp_split_to_array(v_terms, '\s+'), ' or '));
  if v_query is null or numnode(v_query) = 0 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('channel', r.channel, 'created_at', r.created_at,
      'reply', left(ldo_private.support_redact(r.body), 1200),
      'customer_message', (select left(ldo_private.support_redact(i.body), 300) from public.ldo_support_messages i
        where i.conversation_id = r.conversation_id and i.kind = 'inbound' and i.deleted_at is null and i.created_at >= v_from and i.created_at <= r.created_at
        order by i.created_at desc limit 1)) order by r.rank desc, r.created_at desc)
    from (
      select m.conversation_id, m.body, m.created_at, c.channel,
        ts_rank(to_tsvector('portuguese'::regconfig, m.body), v_query) as rank
      from public.ldo_support_messages m join public.ldo_support_conversations c on c.id = m.conversation_id
      where m.kind = 'outbound' and m.deleted_at is null and m.created_at >= v_from and m.conversation_id is distinct from p_exclude
        and coalesce(m.delivery, 'accepted') not in ('failed', 'sending', 'uncertain')
        and to_tsvector('portuguese'::regconfig, m.body) @@ v_query
      order by rank desc, m.created_at desc
      limit 6
    ) r), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- Super Admin (sessão)

-- Data em vigor (e o dia de Lisboa, para o campo da configuração) e quantas conversas estão ocultas.
create function public.ldo_support_history_settings(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz;
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  v_from := ldo_private.support_history_from();
  return jsonb_build_object(
    'history_from', v_from,
    'history_date', (v_from at time zone 'Europe/Lisbon')::date,
    'hidden', (select count(*) from public.ldo_support_conversations c
      where coalesce(c.last_message_at, c.created_at) < v_from and c.status = 'resolvido'));
end;
$$;

-- Novo dia (hora de Lisboa, 00:00). Até hoje: uma data no futuro esconderia todas as conversas resolvidas.
create function public.ldo_support_history_settings_save(p_session text, p_history_from date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_from timestamptz;
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if p_history_from is null or p_history_from > (now() at time zone 'Europe/Lisbon')::date then
    raise exception 'Escolha uma data até hoje.' using errcode = '22023';
  end if;
  v_from := p_history_from::timestamp at time zone 'Europe/Lisbon';
  update public.ldo_support_settings set history_from = v_from, updated_by = v_me, updated_at = now() where id = 1;
  insert into public.ldo_support_audit (actor, action, details) values (v_me, 'settings', jsonb_build_object('history_from', v_from));
end;
$$;

revoke all on function
  public.ldo_support_history_settings(text),
  public.ldo_support_history_settings_save(text, date)
from public, authenticated;
grant execute on function
  public.ldo_support_history_settings(text),
  public.ldo_support_history_settings_save(text, date)
to anon;
