-- Apoio ao Cliente: anexos da equipa no chat do site.
--
-- As respostas no chat do site passam a levar até 5 imagens (JPEG, PNG ou WebP) ou PDF, como no email. Os ficheiros
-- ficam no dashboard (ldo_support_uploads, referência "upload:<id>" na mensagem; bytes apagados ao fim de 30 dias pela
-- limpeza de sempre) e o widget lê cada um em /api/chat/attachments, com o token do visitante no cabeçalho
-- Authorization (nunca num endereço). Só da equipa para o cliente e só nas respostas: as notas internas deste canal
-- continuam sem anexos e o cliente não envia ficheiros.
-- * ldo_private.site_files: posição, nome, tipo e tamanho dos anexos de uma resposta; o id do anexo só para o servidor
--   (avisos por email e cópia da conversa). Nunca a referência.
-- * ldo_support_begin_send: aceita anexos no chat do site (imagens e PDF, como no email); as notas internas e o limite
--   de 5 ficam iguais, e uma resposta só com anexos segue sem texto.
-- * ldo_support_site_messages: cada resposta da equipa traz "attachments" (sem ids nem referências).
-- * ldo_support_site_notify_claim e ldo_support_site_end: cada resposta traz "files" com o id do anexo, para o email ao
--   cliente que saiu do site e a cópia da conversa seguirem com os ficheiros em anexo (até 7 MB por email); site_end
--   devolve também a conversa, para o servidor confirmar os ficheiros, e notify_claim se a conversa já foi terminada
--   (os ficheiros que não cabem no email deixam de se ver no chat). Nada disto chega ao widget.
-- * ldo_support_site_attachment (nova): um ficheiro de uma resposta entregue na conversa do próprio visitante, enquanto
--   os bytes existirem; null quando já não está disponível. Limite por visitante: 60 ficheiros ou 60 MB em 10 minutos
--   (colunas novas file_reads, file_bytes e file_reads_since em ldo_support_site_visitors; erro P0429).
-- * ldo_support_upload_save: os ficheiros do chat do site ficam 30 dias no dashboard (os outros canais guardam a sua
--   cópia e a do dashboard sai na limpeza diária), por isso têm um espaço próprio de 100 MB e deixam de contar nos
--   150 MB dos outros canais.
-- Funções alteradas, a partir do texto em produção a 02-11-2026 (pg_get_functiondef; md5 do prosrc igual ao do corpo da
-- migração indicada): cópia com as linhas assinaladas: ldo_support_begin_send (c6515c635e40a584dae2eed5ad4a833e,
-- 20261013100000), ldo_support_site_messages (e32eaa7e483cd3be4250efc2856973ae, 20261030120000),
-- ldo_support_site_notify_claim (e7d97d254175ddd33a35fa81a1c83a7a, 20261030120000), ldo_support_site_end
-- (b8fd71533cbefbb709b3bc17a3e1de7b, 20261015120000) e ldo_support_upload_save (2473bf9187bb35a02804caf3586a2b0f,
-- 20261007210000).
-- Os privilégios mantêm-se (create or replace). Compatível com o dashboard em produção (campos novos ignorados).
-- Depende de 20261030120000.

-- ---------------------------------------------------------------- auxiliar

-- Anexos de uma resposta da equipa no chat do site (só os guardados no dashboard): posição, nome, tipo e tamanho;
-- p_with_ids junta o id do anexo (só para o servidor: avisos por email e cópia da conversa). Nunca a referência.
create function ldo_private.site_files(p_attachments jsonb, p_with_ids boolean) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('i', a.n - 1, 'name', left(coalesce(a.x ->> 'name', ''), 200),
      'type', a.x ->> 'type', 'size', a.x -> 'size')
    || case when p_with_ids then jsonb_build_object('id', substr(a.x ->> 'ref', 8)) else '{}'::jsonb end order by a.n), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_attachments) = 'array' then p_attachments else '[]'::jsonb end)
    with ordinality as a(x, n)
  where a.x ->> 'ref' ~ '^upload:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and a.x ->> 'type' in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf');
$$;
revoke all on function ldo_private.site_files(jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- envio

-- Anexos guardados (texto em produção; assinalado): o chat do site tem o seu espaço (100 MB) e os outros canais
-- continuam com os 150 MB, sem os ficheiros do chat do site.
create or replace function public.ldo_support_upload_save(p_token text, p_user_id uuid, p_conversation uuid, p_name text,
  p_content_type text, p_data_b64 text, p_source_url text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_data bytea := decode(p_data_b64, 'base64');
  v_id uuid;
  v_site boolean;
begin
  perform ldo_private.bi_check(p_token);
  if not exists (select 1 from public.ldo_app_users where id = p_user_id and active and (support_access or is_super_admin)) then
    raise exception 'Sem acesso ao Apoio ao Cliente.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ldo_support_conversations where id = p_conversation) then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.ldo_support_uploads where user_id = p_user_id and conversation_id = p_conversation and message_id is null
      and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Demasiados anexos por enviar nesta conversa.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ldo_support_uploads'));
  if (select coalesce(sum(size), 0) from public.ldo_support_uploads where user_id = p_user_id and created_at > now() - interval '1 day')
      + octet_length(v_data) > 40 * 1024 * 1024 then
    raise exception 'Limite diário de anexos atingido.' using errcode = '22023';
  end if;
  -- Espaço (bytes ainda guardados): os ficheiros do chat do site ficam 30 dias no dashboard (o widget lê-os daqui), por
  -- isso têm 100 MB à parte; os outros canais, que guardam a sua cópia, continuam com 150 MB só para eles.
  v_site := exists (select 1 from public.ldo_support_conversations where id = p_conversation and channel = 'site');
  if (select coalesce(sum(u.size), 0) from public.ldo_support_uploads u join public.ldo_support_conversations c on c.id = u.conversation_id
      where u.data is not null and (c.channel = 'site') = v_site) + octet_length(v_data) > (case when v_site then 100 else 150 end) * 1024 * 1024 then
    if v_site then
      raise exception 'Espaço de anexos do chat do site cheio (cada ficheiro fica 30 dias). Tente mais tarde.' using errcode = '22023';
    end if;
    raise exception 'Espaço de anexos cheio. Tente mais tarde.' using errcode = '22023';
  end if;
  insert into public.ldo_support_uploads (conversation_id, user_id, name, content_type, size, data, source_url)
  values (p_conversation, p_user_id, left(btrim(p_name), 200), p_content_type, octet_length(v_data), v_data, nullif(p_source_url, ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', left(btrim(p_name), 200), 'type', p_content_type, 'size', octet_length(v_data));
end;
$$;

-- Envio (texto em produção; assinalado): o chat do site aceita anexos nas respostas, com os mesmos tipos do email.
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
      -- Chat do site: os anexos das respostas ficam no dashboard e o widget lê-os (ldo_support_site_attachment).
      if v_platform not in ('zendesk', 'metricool', 'gmail', 'site') then
        raise exception 'Este canal ainda não aceita anexos.' using errcode = '22023';
      end if;
      if p_kind = 'note' and v_platform <> 'zendesk' then
        raise exception 'Notas internas sem anexos neste canal.' using errcode = '22023';
      end if;
      if (select count(*) from public.ldo_support_uploads u
          where u.id = any (v_uploads) and u.user_id = v_me and u.conversation_id = p_id and u.message_id is null and u.data is not null
            -- Email, Zendesk e chat do site: JPEG, PNG, WebP ou PDF; Facebook/Instagram: JPEG ou PNG.
            and (v_platform in ('zendesk', 'gmail', 'site') or u.content_type in ('image/jpeg', 'image/png'))) <> cardinality(v_uploads) then
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

-- ---------------------------------------------------------------- chat do site

-- Mensagens do chat do site (texto em produção; assinalado): as respostas da equipa trazem os anexos (posição, nome,
-- tipo e tamanho), que o widget vai buscar a /api/chat/attachments.
create or replace function public.ldo_support_site_messages(p_token text, p_token_hash text, p_identity_email text, p_after timestamptz, p_open boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_list jsonb;
  v_notices jsonb;
  v_ids uuid[];
  v_surveys jsonb;
  v_p public.ldo_support_surveys;
  v_reason text;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if v.last_seen_at < now() - interval '2 seconds' then
    update public.ldo_support_site_visitors set last_seen_at = now() where id = v.id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'from', case when m.kind = 'inbound' then 'visitor' else 'team' end,
      'author', case when m.kind = 'inbound' then null else ldo_private.support_first_name(m.author_user_id) end,
      'key', case when m.kind = 'inbound' and m.external_id like 'site:%' then substr(m.external_id, 6) end,
      'body', m.body, 'created_at', m.created_at, 'inserted_at', m.inserted_at,
      -- Anexos de uma resposta da equipa: posição, nome, tipo e tamanho (nunca a referência nem o id).
      'attachments', case when m.kind = 'outbound' then ldo_private.site_files(m.attachments, false) else '[]'::jsonb end)
      order by m.created_at, m.inserted_at), '[]'::jsonb),
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
  -- Pedido de avaliação por mostrar: com o chat aberto e as regras ainda cumpridas aparece agora e passa a enviado (aceita
  -- a nota durante 72 h); senão fica sem pedido.
  if coalesce(p_open, false) then
    for v_p in
      select s.* from public.ldo_support_surveys s
      where s.conversation_id = v.conversation_id and s.channel = 'site' and s.status = 'pending'
      for update skip locked
    loop
      v_reason := ldo_private.support_survey_hold(v_p.id);
      if v_reason is null then
        update public.ldo_support_surveys set status = 'sent', sent_at = now(), expires_at = now() + interval '72 hours' where id = v_p.id;
      else
        update public.ldo_support_surveys set status = 'skipped', skip_reason = v_reason where id = v_p.id;
      end if;
      insert into public.ldo_support_audit (actor, conversation_id, action, details)
      values (null, v_p.conversation_id, case when v_reason is null then 'survey.sent' else 'survey.skipped' end,
        jsonb_build_object('survey_id', v_p.id, 'agent_id', v_p.agent_id, 'channel', 'site', 'reason', v_reason));
    end loop;
  end if;
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
    and (s.status = 'rated' or (s.status = 'sent' and s.expires_at > now()
      and exists (select 1 from public.ldo_support_settings x where x.id = 1 and x.survey_mode <> 'desligado' and 'site' = any (x.survey_channels))))
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

-- Avisos por email ao visitante (texto em produção; assinalado): cada resposta traz os ficheiros, para seguirem em
-- anexo no email.
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
      -- Ficheiros de cada resposta, com o id do anexo (só para o servidor juntar ao email).
      jsonb_agg(jsonb_build_object('body', r.body, 'author', ldo_private.support_first_name(r.author_user_id),
        'files', ldo_private.site_files(r.attachments, true)) order by r.inserted_at),
      max(r.inserted_at) into v_replies, v_items, v_until
    from (select m.body, m.author_user_id, m.inserted_at, m.attachments from public.ldo_support_messages m
          where m.conversation_id = v.conversation_id and m.kind = 'outbound' and m.deleted_at is null and m.delivery = 'accepted'
            and (m.origin is null or v.verified)
            and m.inserted_at > coalesce(v.notified_until, '-infinity'::timestamptz)
          order by m.inserted_at limit 10) r;
    update public.ldo_support_site_visitors set notify_lease_until = now() + interval '2 minutes' where id = v.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('visitor', v.id, 'conversation', v.conversation_id, 'email', v.email,
      'name', v.name, 'until', v_until, 'replies', v_replies, 'items', v_items,
      -- ended: conversa terminada no widget (os ficheiros que não cabem no email já não se veem no chat).
      'locale', v.locale, 'site', v.site, 'country', v.country, 'ended', v.ended_at is not null));
  end loop;
  return v_out;
end;
$$;

-- Terminar a conversa (texto em produção; assinalado): as respostas da equipa na cópia trazem os ficheiros, que seguem
-- em anexo no email.
create or replace function public.ldo_support_site_end(p_token text, p_token_hash text, p_identity_email text, p_transcript boolean)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_items jsonb := '[]'::jsonb;
  v_copy boolean;
  v_reason text;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  update public.ldo_support_site_visitors set ended_at = now() where id = v.id and ended_at is null;
  if not found then
    raise exception 'Esta conversa já não está disponível. Inicie uma nova.' using errcode = 'P0401';
  end if;

  v_copy := coalesce(p_transcript, false) and v.email is not null;
  if v_copy and not v.verified and not exists (
      select 1 from public.ldo_support_messages m where m.conversation_id = v.conversation_id and m.kind = 'outbound'
        and m.deleted_at is null and m.delivery in ('accepted', 'delivered', 'read')) then
    v_copy := false;
    v_reason := 'sem resposta da equipa';
  end if;
  if v_copy and (select count(*) from public.ldo_support_audit a
      where a.action = 'visitor_end' and (a.details ->> 'transcript') = 'true' and a.details ->> 'email' = lower(v.email)
        and a.created_at > now() - interval '24 hours') >= 2 then
    v_copy := false;
    v_reason := 'limite diário de cópias';
  end if;

  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  values (null, v.conversation_id, 'visitor_end', jsonb_build_object('transcript', v_copy, 'requested', coalesce(p_transcript, false),
    'email', case when v_copy then lower(v.email) end, 'reason', v_reason));

  if v_copy then
    select coalesce(jsonb_agg(x.item order by x.at), '[]'::jsonb) into v_items
    from (
      select y.at, y.item from (
        select m.created_at as at,
          jsonb_build_object('from', case when m.kind = 'inbound' then 'visitor' else 'team' end,
            'author', case when m.kind = 'inbound' then null else ldo_private.support_first_name(m.author_user_id) end,
            'body', m.body, 'at', m.created_at,
            -- Ficheiros da equipa na cópia (depois de terminar, o cliente já não os vê no chat).
            'files', case when m.kind = 'outbound' then ldo_private.site_files(m.attachments, true) else '[]'::jsonb end) as item
        from public.ldo_support_messages m
        where m.conversation_id = v.conversation_id and m.deleted_at is null
          and (m.kind = 'inbound' or (m.kind = 'outbound' and m.delivery in ('accepted', 'delivered', 'read')))
        union all
        select a.created_at,
          jsonb_build_object('from', 'notice', 'author', null, 'kind', 'transfer', 'to_first', a.details ->> 'to_first',
            'body', 'A conversa foi transferida para ' || coalesce(a.details ->> 'to_first', 'outra pessoa da equipa') || '.', 'at', a.created_at)
        from public.ldo_support_audit a
        where a.conversation_id = v.conversation_id and a.action = 'assign' and (a.details ->> 'notice') = 'true'
      ) y
      order by y.at desc
      limit 300
    ) x;
  end if;
  -- conversation: só para o servidor confirmar os ficheiros da cópia (/api/chat/end devolve ao widget só ok, emailed e email).
  return jsonb_build_object('email', v.email, 'name', v.name, 'transcript', v_copy, 'messages', v_items, 'conversation', v.conversation_id,
    'locale', v.locale, 'site', v.site, 'country', v.country);
end;
$$;

-- Leituras de ficheiros por visitante, para o limite de ldo_support_site_attachment (janela de 10 minutos).
alter table public.ldo_support_site_visitors
  add column file_reads integer not null default 0,
  add column file_bytes bigint not null default 0,
  add column file_reads_since timestamptz;

-- Um ficheiro de uma resposta da equipa, para o widget do visitante: só na conversa dele, numa resposta já entregue
-- (não apagada) e com o anexo ligado a essa mensagem e ainda guardado (30 dias). null = já não está disponível.
-- Limite: 60 ficheiros ou 60 MB por visitante em 10 minutos (cada leitura traz até 4 MB; o widget pede cada ficheiro
-- uma vez por página e só as imagens perto do ecrã). Erro P0429 = aguardar.
create function public.ldo_support_site_attachment(p_token text, p_token_hash text, p_identity_email text, p_message uuid, p_index integer)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_ref text;
  v_file jsonb;
  v_new boolean;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if p_message is null or p_index is null or p_index not between 0 and 4 then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  select * into v from public.ldo_support_site_visitors where id = v.id for update;
  v_new := v.file_reads_since is null or v.file_reads_since < now() - interval '10 minutes';
  if not v_new and (v.file_reads >= 60 or v.file_bytes >= 60 * 1024 * 1024) then
    raise exception 'Demasiados pedidos de ficheiros. Aguarde um pouco.' using errcode = 'P0429';
  end if;
  select m.attachments -> p_index ->> 'ref' into v_ref
  from public.ldo_support_messages m
  where m.id = p_message and m.conversation_id = v.conversation_id and m.kind = 'outbound' and m.deleted_at is null
    and m.delivery in ('accepted', 'delivered', 'read');
  if v_ref ~ '^upload:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select jsonb_build_object('name', u.name, 'type', u.content_type, 'size', u.size, 'data', encode(u.data, 'base64')) into v_file
    from public.ldo_support_uploads u
    where u.id = substr(v_ref, 8)::uuid and u.conversation_id = v.conversation_id and u.message_id = p_message
      and u.data is not null;
  end if;
  -- Cada pedido conta (também os de um ficheiro que já não existe), com os bytes do que é entregue.
  update public.ldo_support_site_visitors set
    file_reads = case when v_new then 1 else file_reads + 1 end,
    file_bytes = case when v_new then 0 else file_bytes end + coalesce((v_file ->> 'size')::bigint, 0),
    file_reads_since = case when v_new then now() else file_reads_since end
  where id = v.id;
  return v_file;
end;
$$;

-- Só o servidor (anon com o token do servidor), como as outras funções do chat.
revoke all on function public.ldo_support_site_attachment(text, text, text, uuid, integer) from public, authenticated;
grant execute on function public.ldo_support_site_attachment(text, text, text, uuid, integer) to anon;
