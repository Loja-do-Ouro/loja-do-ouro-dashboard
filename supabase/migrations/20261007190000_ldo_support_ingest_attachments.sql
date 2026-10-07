-- Apoio ao Cliente: quando a plataforma confirma uma mensagem enviada pelo dashboard com anexos, passa a
-- valer o anexo guardado na plataforma (permanente) em vez da cópia temporária do dashboard (30 dias).

create or replace function public.ldo_support_ingest(p_token text, p_source text, p_conversations jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_src public.ldo_support_sources;
  c jsonb;
  m jsonb;
  v_contact uuid;
  v_conv public.ldo_support_conversations;
  v_is_new boolean;
  v_fresh boolean;
  v_new_inbound integer;
  v_match uuid;
  v_assignee uuid;
  v_author uuid;
  v_status text;
  v_incoming_at timestamptz;
  v_new_conv integer := 0;
  v_new_msgs integer := 0;
  v_reopened integer := 0;
  v_platform_truth boolean;
  v_deleted boolean;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_src from public.ldo_support_sources where id = p_source;
  if v_src.id is null then
    raise exception 'Fonte desconhecida.' using errcode = '22023';
  end if;
  v_platform_truth := v_src.platform = 'zendesk';
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

    select * into v_conv from public.ldo_support_conversations
    where channel = v_src.channel and account = v_src.account and external_id = c ->> 'external_id' for update;
    v_is_new := v_conv.id is null;
    if v_is_new then
      insert into public.ldo_support_conversations (source_id, channel, account, external_id, contact_id, subject, status, platform_status,
        assignee_id, external_assignee_id, external_assignee_name, via, external_updated_at)
      values (v_src.id, v_src.channel, v_src.account, c ->> 'external_id', v_contact, left(c ->> 'subject', 300),
        case when v_platform_truth then coalesce(v_status, 'novo') else 'novo' end, c ->> 'platform_status',
        v_assignee, nullif(c ->> 'external_assignee_id', ''), nullif(c ->> 'external_assignee_name', ''), c ->> 'via', v_incoming_at)
      returning * into v_conv;
      v_new_conv := v_new_conv + 1;
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
        updated_at = now()
      where id = v_conv.id
      returning * into v_conv;
    end if;

    v_new_inbound := 0;
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
      -- normalizado, até 15 minutos de diferença, em vez de aparecer duplicada.
      v_match := null;
      if m ->> 'kind' in ('outbound', 'note') then
        select id into v_match from public.ldo_support_messages
        where conversation_id = v_conv.id and external_id is null and client_key is not null
          and kind in ('outbound', 'note')
          and (delivery is null or delivery in ('sending', 'uncertain', 'accepted'))
          and (v_author is null or author_user_id = v_author)
          and ldo_private.support_norm(body) = ldo_private.support_norm(m ->> 'body')
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
    perform ldo_private.support_summarize(v_conv.id);
  end loop;
  return jsonb_build_object('conversations', jsonb_array_length(coalesce(p_conversations, '[]'::jsonb)),
    'new_conversations', v_new_conv, 'new_messages', v_new_msgs, 'reopened', v_reopened);
end;
$$;
