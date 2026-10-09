-- Separador "Automáticas", correções da revisão (nenhum cliente por atender pode ficar escondido):
-- * A marca só é aceite se a conversa não tiver mensagens do cliente anteriores às reações vistas (p_from), não
--   estiver atribuída a ninguém e estiver como Novo ou Resolvido.
-- * Uma conversa marcada volta à lista principal quando o cliente escreve, quando alguém a atribui ou muda o estado
--   (Em atendimento, A aguardar cliente) e quando alguém da equipa escreve nela (resposta ou nota).
-- * A condição é escrita na própria consulta (sem função à parte), para a lista continuar rápida.

drop function public.ldo_support_social_mark_auto(text, text, text, timestamptz);
drop function ldo_private.support_auto_handled(uuid, timestamptz);

create function public.ldo_support_social_mark_auto(p_token text, p_source text, p_conversation text, p_from timestamptz,
  p_through timestamptz) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_from is null or p_through is null or p_from > p_through then
    return false;
  end if;
  update public.ldo_support_conversations c
  set auto_handled_through = greatest(coalesce(c.auto_handled_through, '-infinity'::timestamptz), p_through)
  where c.source_id = p_source and c.external_id = p_conversation
    and c.assignee_id is null and c.status in ('novo', 'resolvido')
    and not exists (select 1 from public.ldo_support_messages m
      where m.conversation_id = c.id and m.kind = 'inbound' and m.deleted_at is null
        and (m.created_at < p_from or m.created_at > p_through));
  return found;
end;
$$;
revoke all on function public.ldo_support_social_mark_auto(text, text, text, timestamptz, timestamptz) from public, authenticated;
grant execute on function public.ldo_support_social_mark_auto(text, text, text, timestamptz, timestamptz) to anon;

create or replace function public.ldo_support_list(p_session text, p_filter text, p_channel text, p_status text, p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_q text := lower(nullif(btrim(coalesce(p_q, '')), ''));
  v_status text := nullif(p_status, '');
  v_filter text := coalesce(nullif(p_filter, ''), 'all');
  v_today timestamptz := (date_trunc('day', now() at time zone 'Europe/Lisbon')) at time zone 'Europe/Lisbon';
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
            where m.conversation_id = c.id and m.deleted_at is null and m.created_at > c.auto_handled_through
              and (m.kind = 'inbound' or m.author_user_id is not null)) end as auto) h
        where (p_channel is null or p_channel = '' or c.channel = p_channel)
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
          where m.conversation_id = c.id and m.deleted_at is null and m.created_at > c.auto_handled_through
            and (m.kind = 'inbound' or m.author_user_id is not null)) end as auto) h
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
    'poll_seconds', (select poll_seconds from public.ldo_support_settings where id = 1)
  );
end;
$$;
