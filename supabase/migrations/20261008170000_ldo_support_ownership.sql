-- Apoio ao Cliente: cada conversa tem um responsável e só ele responde ao cliente.
--
-- Regras (pedido do Luís, 8/10/2026):
-- * Responder ao cliente: só o responsável. Numa conversa sem responsável, quem responde primeiro fica
--   responsável (como antes). Notas internas: qualquer pessoa do apoio.
-- * Assumir: numa conversa sem responsável cada pessoa só se pode atribuir a si.
-- * Transferir: o responsável ou o Super Admin entregam a conversa a outro colega (o Super Admin também a
--   pode transferir para si). Deixar sem responsável: só o Super Admin.
-- * Estado: o responsável, o Super Admin ou qualquer pessoa enquanto não houver responsável.
-- * Chat do site: o cliente vê o primeiro nome de quem o atende e um aviso quando a conversa é transferida
--   ("A conversa foi transferida para Diana."). Os avisos vêm do registo (ldo_support_audit), não são
--   mensagens: não contam como respostas, não aparecem nas pré-visualizações nem na IA.

-- Primeiro nome do colaborador (o que o cliente vê). Nunca o nome de utilizador (é o login).
create or replace function ldo_private.support_first_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(split_part(btrim(coalesce(u.full_name, '')), ' ', 1), '') from public.ldo_app_users u where u.id = p_user;
$$;

create or replace function ldo_private.support_display_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(u.full_name), ''), u.username) from public.ldo_app_users u where u.id = p_user;
$$;

-- Estado e responsável das conversas em que o dashboard é a fonte de verdade (o Zendesk é tratado no
-- servidor, com as mesmas regras, porque a alteração é feita na API do Zendesk).
create or replace function public.ldo_support_set_local(p_session text, p_id uuid, p_set_status boolean, p_status text,
  p_set_assignee boolean, p_assignee uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_super boolean := ldo_private.support_super(p_session) is not null;
  v_c public.ldo_support_conversations;
  v_channel text;
  v_kind text;
begin
  select * into v_c from public.ldo_support_conversations where id = p_id for update;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  if v_c.source_id = 'zendesk' then
    raise exception 'Estado e responsável dos tickets Zendesk são alterados no Zendesk.' using errcode = '42501';
  end if;
  if p_set_status and p_status not in ('novo', 'em_atendimento', 'aguarda_cliente', 'resolvido') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  if p_set_status and p_status is distinct from v_c.status and not v_super
     and v_c.assignee_id is not null and v_c.assignee_id <> v_me then
    raise exception 'Esta conversa está com %. Só essa pessoa (ou o Super Admin) pode mudar o estado.',
      ldo_private.support_display_name(v_c.assignee_id) using errcode = '42501';
  end if;

  if p_set_assignee and p_assignee is distinct from v_c.assignee_id then
    if p_assignee is null then
      if not v_super then
        raise exception 'Só o Super Admin pode deixar uma conversa sem responsável. Para a passar a um colega, use Transferir.' using errcode = '42501';
      end if;
      v_kind := 'release';
    elsif v_c.assignee_id is null then
      if p_assignee <> v_me and not v_super then
        raise exception 'Só se pode atribuir a si próprio uma conversa sem responsável. Assuma-a e depois transfira-a.' using errcode = '42501';
      end if;
      v_kind := case when p_assignee = v_me then 'claim' else 'assign' end;
    else
      if v_c.assignee_id <> v_me and not v_super then
        raise exception 'Esta conversa está com %. Só essa pessoa (ou o Super Admin) a pode transferir.',
          ldo_private.support_display_name(v_c.assignee_id) using errcode = '42501';
      end if;
      v_kind := 'transfer';
    end if;
    if p_assignee is not null and not exists (
      select 1 from public.ldo_app_users where id = p_assignee and active and (support_access or is_super_admin)) then
      raise exception 'Este colaborador não tem acesso ao Apoio ao Cliente.' using errcode = '22023';
    end if;
  end if;

  update public.ldo_support_conversations set
    status = case when p_set_status then p_status else status end,
    assignee_id = case when p_set_assignee then p_assignee else assignee_id end,
    updated_at = now()
  where id = p_id;
  if p_set_status and p_status is distinct from v_c.status then
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (v_me, p_id, 'status', jsonb_build_object('from', v_c.status, 'to', p_status));
  end if;
  if v_kind is not null then
    select channel into v_channel from public.ldo_support_conversations where id = p_id;
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (v_me, p_id, 'assign', jsonb_build_object(
      'kind', v_kind,
      'from', v_c.assignee_id, 'from_name', ldo_private.support_display_name(v_c.assignee_id),
      'to', p_assignee, 'to_name', ldo_private.support_display_name(p_assignee),
      'to_first', ldo_private.support_first_name(p_assignee),
      -- Aviso ao cliente: só no chat do site e só quando a conversa passa de uma pessoa para outra.
      'notice', v_kind = 'transfer' and v_channel = 'site'));
  end if;
end;
$$;

-- Envio: igual ao anterior, com a regra do responsável. A conversa fica bloqueada durante o pedido para
-- duas pessoas não ficarem responsáveis pela mesma conversa ao mesmo tempo.
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
  select * into v_c from public.ldo_support_conversations where id = p_id for update;
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
    -- Só o responsável responde ao cliente (as notas internas são para toda a equipa).
    if p_kind = 'outbound' and v_c.assignee_id is not null and v_c.assignee_id <> v_me then
      raise exception 'Esta conversa está com %. Só essa pessoa pode responder ao cliente; peça-lhe que a transfira.',
        ldo_private.support_display_name(v_c.assignee_id) using errcode = '42501';
    end if;
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
  return jsonb_build_object('message', to_jsonb(v_m), 'existing', v_existing, 'platform', v_platform,
    'uploads', (select coalesce(jsonb_agg(u.id order by array_position(v_uploads, u.id)), '[]'::jsonb) from public.ldo_support_uploads u where u.message_id = v_m.id),
    'conversation', jsonb_build_object('id', v_c.id, 'source_id', v_c.source_id, 'channel', v_c.channel, 'account', v_c.account,
      'external_id', v_c.external_id, 'via', v_c.via, 'contact_external_id', v_k.external_id,
      'external_assignee_id', v_c.external_assignee_id, 'status', v_c.status));
end;
$$;

-- Chat do site: mensagens, avisos de transferência e o primeiro nome de quem está a atender ("agent").
create or replace function public.ldo_support_site_messages(p_token text, p_token_hash text, p_identity_email text, p_after timestamptz, p_open boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_list jsonb;
  v_notices jsonb;
  v_ids uuid[];
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
      'body', 'A conversa foi transferida para ' || coalesce(a.details ->> 'to_first', 'outra pessoa da equipa') || '.',
      'created_at', a.created_at, 'inserted_at', a.created_at) order by a.created_at), '[]'::jsonb)
  into v_notices
  from (select * from public.ldo_support_audit
        where conversation_id = v.conversation_id and action = 'assign' and (details ->> 'notice') = 'true'
          and (p_after is null or created_at > p_after)
        order by created_at desc limit 50) a;
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
    'messages', v_list || v_notices
  );
end;
$$;

-- Avisos por email ao visitante: como antes, mais "items" com o primeiro nome de quem respondeu.
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
            and m.inserted_at > coalesce(v.notified_until, '-infinity'::timestamptz)
          order by m.inserted_at limit 10) r;
    update public.ldo_support_site_visitors set notify_lease_until = now() + interval '2 minutes' where id = v.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('visitor', v.id, 'conversation', v.conversation_id, 'email', v.email,
      'name', v.name, 'until', v_until, 'replies', v_replies, 'items', v_items));
  end loop;
  return v_out;
end;
$$;

-- Email e nome de um colaborador para o aviso de transferência (só o servidor, com o token).
create or replace function public.ldo_support_staff_contact(p_token text, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select jsonb_build_object('email', u.email, 'name', ldo_private.support_display_name(u.id),
      'first_name', ldo_private.support_first_name(u.id))
    from public.ldo_app_users u where u.id = p_user and u.active and (u.support_access or u.is_super_admin));
end;
$$;

revoke all on function ldo_private.support_first_name(uuid), ldo_private.support_display_name(uuid) from public, anon, authenticated;
revoke all on function public.ldo_support_staff_contact(text, uuid) from public, authenticated;
grant execute on function public.ldo_support_staff_contact(text, uuid) to anon;
