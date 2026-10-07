-- Apoio ao Cliente: correções da segunda revisão (anexos enviados).
-- - Envio falhado liberta os anexos (podem voltar a ser enviados) e retira o URL público.
-- - Limites de espaço: 40 MB por pessoa por dia, 150 MB no total; limpeza mais cedo dos bytes que a
--   plataforma já guarda e dos URLs públicos expirados.
-- - Resposta Zendesk só com anexo: o texto "Segue em anexo." fica guardado tal como é enviado.
-- - Uma imagem sem texto vinda da sincronização não se junta a um envio de texto sem anexo.

create or replace function public.ldo_support_finish_send(p_token text, p_message uuid, p_delivery text, p_detail text, p_external_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.ldo_support_messages;
  v_ext text := nullif(p_external_id, '');
begin
  perform ldo_private.bi_check(p_token);
  if p_delivery is not null and p_delivery not in ('accepted', 'delivered', 'read', 'failed', 'uncertain') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  select * into v_m from public.ldo_support_messages where id = p_message for update;
  if v_m.id is null or v_m.delivery is null or v_m.delivery not in ('sending', 'uncertain') then
    return;
  end if;
  if v_ext is not null and v_m.external_id is null then
    delete from public.ldo_support_messages
    where conversation_id = v_m.conversation_id and external_id = v_ext and id <> v_m.id and client_key is null;
    if exists (select 1 from public.ldo_support_messages where conversation_id = v_m.conversation_id and external_id = v_ext and id <> v_m.id) then
      v_ext := null;
    end if;
  end if;
  update public.ldo_support_messages set
    delivery = case when kind = 'note' and p_delivery = 'accepted' then null else p_delivery end,
    delivery_detail = left(p_detail, 500),
    external_id = coalesce(external_id, v_ext)
  where id = v_m.id;
  -- Envio falhado: os anexos ficam livres para voltar a enviar (e deixam de estar públicos).
  if p_delivery = 'failed' then
    update public.ldo_support_uploads set message_id = null, public_token = null, public_until = null
    where message_id = v_m.id and data is not null;
  end if;
  perform ldo_private.support_summarize(v_m.conversation_id);
end;
$$;

create or replace function public.ldo_support_upload_save(p_token text, p_user_id uuid, p_conversation uuid, p_name text,
  p_content_type text, p_data_b64 text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_data bytea := decode(p_data_b64, 'base64');
  v_id uuid;
begin
  perform ldo_private.bi_check(p_token);
  if not exists (select 1 from public.ldo_app_users where id = p_user_id and active and (support_access or is_super_admin)) then
    raise exception 'Sem acesso ao Apoio ao Cliente.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ldo_support_conversations where id = p_conversation) then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  -- Limite por pessoa e conversa: no máximo 20 anexos por enviar ao mesmo tempo.
  if (select count(*) from public.ldo_support_uploads where user_id = p_user_id and conversation_id = p_conversation and message_id is null
      and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Demasiados anexos por enviar nesta conversa.' using errcode = '22023';
  end if;
  -- Limites de espaço (os bytes ficam na base de dados): 40 MB por pessoa por dia e 150 MB no total.
  perform pg_advisory_xact_lock(hashtext('ldo_support_uploads'));
  if (select coalesce(sum(size), 0) from public.ldo_support_uploads where user_id = p_user_id and created_at > now() - interval '1 day')
      + octet_length(v_data) > 40 * 1024 * 1024 then
    raise exception 'Limite diário de anexos atingido.' using errcode = '22023';
  end if;
  if (select coalesce(sum(size), 0) from public.ldo_support_uploads where data is not null) + octet_length(v_data) > 150 * 1024 * 1024 then
    raise exception 'Espaço de anexos cheio. Tente mais tarde.' using errcode = '22023';
  end if;
  insert into public.ldo_support_uploads (conversation_id, user_id, name, content_type, size, data)
  values (p_conversation, p_user_id, left(btrim(p_name), 200), p_content_type, octet_length(v_data), v_data)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', left(btrim(p_name), 200), 'type', p_content_type, 'size', octet_length(v_data));
end;
$$;

create or replace function public.ldo_support_uploads_purge(p_token text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  perform ldo_private.bi_check(p_token);
  -- Bytes apagados: ao fim de 30 dias; anexos nunca enviados ao fim de 1 dia; e logo que a mensagem passa a
  -- mostrar o anexo guardado na plataforma (Zendesk/Metricool), já sem referência à cópia do dashboard.
  update public.ldo_support_uploads u set data = null, public_token = null, public_until = null, purged_at = now()
  where u.data is not null and (u.created_at < now() - interval '30 days'
    or (u.message_id is null and u.created_at < now() - interval '1 day')
    or (u.message_id is not null and u.public_until is distinct from null and u.public_until < now() - interval '1 day'
      and not exists (select 1 from public.ldo_support_messages m where m.id = u.message_id and m.attachments::text like '%upload:' || u.id || '%'))
    or (u.message_id is not null and u.public_until is null
      and not exists (select 1 from public.ldo_support_messages m where m.id = u.message_id and m.attachments::text like '%upload:' || u.id || '%')));
  get diagnostics n = row_count;
  update public.ldo_support_uploads set public_token = null, public_until = null where public_until < now();
  return n;
end;
$$;

create or replace function public.ldo_support_begin_send(p_session text, p_id uuid, p_kind text, p_body text, p_client_key uuid, p_uploads uuid[])
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
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
  select * into v_c from public.ldo_support_conversations where id = p_id;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  select platform into v_platform from public.ldo_support_sources where id = v_c.source_id;
  -- Zendesk não aceita comentários vazios: o texto enviado com um anexo sozinho fica guardado tal como sai.
  if v_body = '' and cardinality(v_uploads) > 0 and v_platform = 'zendesk' then
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
    if cardinality(v_uploads) > 0 then
      if v_platform = 'metricool' and cardinality(v_uploads) > 1 then
        raise exception 'O Facebook e o Instagram aceitam uma imagem por mensagem.' using errcode = '22023';
      end if;
      if v_platform not in ('zendesk', 'metricool') then
        raise exception 'Este canal ainda não aceita anexos.' using errcode = '22023';
      end if;
      if p_kind = 'note' and v_platform <> 'zendesk' then
        raise exception 'Notas internas sem anexos neste canal.' using errcode = '22023';
      end if;
      if (select count(*) from public.ldo_support_uploads u
          where u.id = any (v_uploads) and u.user_id = v_me and u.conversation_id = p_id and u.message_id is null and u.data is not null
            and (v_platform = 'zendesk' or u.content_type in ('image/jpeg', 'image/png'))) <> cardinality(v_uploads) then
        raise exception 'Anexo inválido ou já enviado.' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('name', u.name, 'type', u.content_type, 'size', u.size, 'ref', 'upload:' || u.id)
        order by array_position(v_uploads, u.id)), '[]'::jsonb)
      into v_attachments from public.ldo_support_uploads u where u.id = any (v_uploads);
    end if;
    insert into public.ldo_support_messages (conversation_id, kind, author_user_id, body, attachments, created_at, delivery, client_key)
    values (p_id, p_kind, v_me, v_body, v_attachments, now(),
      case when p_kind = 'outbound' or v_platform = 'zendesk' then 'sending' end, p_client_key)
    returning * into v_m;
    update public.ldo_support_uploads set message_id = v_m.id where id = any (v_uploads);
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (v_me, p_id, case when p_kind = 'note' then 'note' else 'reply' end,
      jsonb_build_object('message_id', v_m.id, 'attachments', cardinality(v_uploads)));
    if p_kind = 'outbound' and v_platform <> 'zendesk' then
      update public.ldo_support_conversations set
        assignee_id = coalesce(assignee_id, v_me),
        status = case when status = 'novo' then 'em_atendimento' else status end, updated_at = now()
      where id = p_id;
      perform ldo_private.support_summarize(p_id);
    end if;
  end if;
  return jsonb_build_object('message', to_jsonb(v_m), 'existing', v_existing, 'platform', v_platform,
    'uploads', (select coalesce(jsonb_agg(u.id order by array_position(v_uploads, u.id)), '[]'::jsonb) from public.ldo_support_uploads u where u.message_id = v_m.id),
    'conversation', jsonb_build_object('id', v_c.id, 'source_id', v_c.source_id, 'channel', v_c.channel, 'account', v_c.account,
      'external_id', v_c.external_id, 'via', v_c.via, 'contact_external_id', v_k.external_id,
      'external_assignee_id', v_c.external_assignee_id, 'status', v_c.status));
end;
$$;

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
