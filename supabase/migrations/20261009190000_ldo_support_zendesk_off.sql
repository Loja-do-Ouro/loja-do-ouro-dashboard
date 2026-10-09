-- Apoio ao Cliente: desligar o Zendesk do dashboard (o email passa a entrar só pelo Gmail).
-- * A fonte 'zendesk' pode ficar 'disabled': não sincroniza (o claim recusa, o finish não a reativa) e não aceita
--   novas ligações de agentes.
-- * Os tickets já importados ficam como histórico: nada sai para o cliente (begin_send recusa); notas internas,
--   estado e responsável passam a ser só do dashboard.
-- * Só o Super Admin desliga ou volta a ligar (ldo_support_zendesk_set_enabled). Desligar apaga as ligações dos
--   agentes (o servidor revoga-as na Zendesk antes); o responsável de cada ticket mantém-se.

alter table public.ldo_support_sources drop constraint ldo_support_sources_status_check;
alter table public.ldo_support_sources add constraint ldo_support_sources_status_check
  check (status in ('not_configured', 'pending', 'active', 'error', 'blocked', 'disabled'));

create function ldo_private.zendesk_off() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ldo_support_sources where id = 'zendesk' and status = 'disabled');
$$;
revoke all on function ldo_private.zendesk_off() from public, anon, authenticated;

-- Para o servidor (páginas e rotas): o Zendesk está desligado?
create function public.ldo_support_zendesk_is_off(p_token text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return ldo_private.zendesk_off();
end;
$$;
revoke all on function public.ldo_support_zendesk_is_off(text) from public, authenticated;
grant execute on function public.ldo_support_zendesk_is_off(text) to anon;

-- Desligar / voltar a ligar (Super Admin). Ao desligar, as ligações dos agentes são apagadas aqui.
create function public.ldo_support_zendesk_set_enabled(p_session text, p_enabled boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin liga ou desliga o Zendesk.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  if not p_enabled then
    update public.ldo_support_sources set status = 'disabled', status_detail = 'Desligado no dashboard: os tickets ficam como histórico.',
      lease_until = null, next_attempt_at = null, failures = 0, last_error = null
    where id = 'zendesk';
    delete from public.ldo_support_zendesk_connections;
  else
    update public.ldo_support_sources set status = 'pending', status_detail = null, next_attempt_at = now(), failures = 0, last_error = null
    where id = 'zendesk' and status = 'disabled';
  end if;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, case when p_enabled then 'zendesk.enable' else 'zendesk.disable' end, '{}'::jsonb);
end;
$$;
revoke all on function public.ldo_support_zendesk_set_enabled(text, boolean) from public, authenticated;
grant execute on function public.ldo_support_zendesk_set_enabled(text, boolean) to anon;



create or replace function public.ldo_support_sync_claim(p_token text, p_source text, p_force boolean, p_override boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.ldo_support_sources;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_sources set lease_until = now() + interval '150 seconds', last_attempt_at = now()
  where id = p_source and status <> 'disabled' and (lease_until is null or lease_until < now())
    and (last_attempt_at is null or last_attempt_at < now() - interval '15 seconds')
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
    when v_s.last_attempt_at >= now() - interval '15 seconds' then 'recent'
    when v_s.failures > 0 then 'backoff'
    else 'not_due' end);
end;
$$;

create or replace function public.ldo_support_sync_finish(p_token text, p_source text, p_outcome text, p_status text, p_detail text,
  p_error text, p_cursor jsonb, p_retry_after integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_poll integer := (select poll_seconds from public.ldo_support_settings where id = 1);
begin
  perform ldo_private.bi_check(p_token);
  if p_outcome in ('ok', 'more') then
    update public.ldo_support_sources set lease_until = null, failures = 0, last_error = null, last_success_at = now(),
      next_attempt_at = case when p_outcome = 'more' then now() else now() + make_interval(secs => v_poll) end,
      status = case when status = 'disabled' then status else coalesce(p_status, 'active') end,
      status_detail = case when status = 'disabled' then status_detail else p_detail end, cursor = coalesce(p_cursor, cursor)
    where id = p_source;
  elsif p_outcome = 'skipped' then
    update public.ldo_support_sources set lease_until = null, failures = 0, last_error = null,
      next_attempt_at = now() + make_interval(secs => v_poll),
      status = case when status = 'disabled' then status else coalesce(p_status, 'pending') end,
      status_detail = case when status = 'disabled' then status_detail else p_detail end
    where id = p_source;
  else
    update public.ldo_support_sources set lease_until = null, failures = failures + 1, last_error = left(p_error, 500),
      next_attempt_at = now() + make_interval(secs => greatest(least(v_poll * power(2, least(failures + 1, 6)), 1800), coalesce(p_retry_after, 0))),
      status = case when status = 'disabled' then status else coalesce(p_status, 'error') end,
      status_detail = case when status = 'disabled' then status_detail else coalesce(p_detail, status_detail) end, cursor = coalesce(p_cursor, cursor)
    where id = p_source;
  end if;
end;
$$;

create or replace function public.ldo_support_zendesk_save(p_token text, p_user_id uuid, p_data jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_other text;
begin
  perform ldo_private.bi_check(p_token);
  if ldo_private.zendesk_off() then
    raise exception 'O Zendesk está desligado do dashboard.' using errcode = '42501';
  end if;
  select coalesce(u.full_name, u.username) into v_other
  from public.ldo_support_zendesk_connections z join public.ldo_app_users u on u.id = z.user_id
  where z.subdomain = p_data->>'subdomain' and z.zendesk_user_id = p_data->>'zendesk_user_id' and z.user_id <> p_user_id;
  if v_other is not null then
    raise exception 'Esta conta Zendesk já está ligada a %. Cada colaborador liga a sua própria conta de agente.', v_other
      using errcode = '23505';
  end if;
  insert into public.ldo_support_zendesk_connections (user_id, subdomain, zendesk_user_id, zendesk_name, zendesk_email, zendesk_role, scope,
    access_ct, refresh_ct, access_expires_at, refresh_expires_at, status, status_detail, connected_at, updated_at)
  values (p_user_id, p_data->>'subdomain', p_data->>'zendesk_user_id', p_data->>'zendesk_name', p_data->>'zendesk_email',
    p_data->>'zendesk_role', p_data->>'scope', p_data->>'access_ct', p_data->>'refresh_ct',
    (p_data->>'access_expires_at')::timestamptz, (p_data->>'refresh_expires_at')::timestamptz, 'active', null, now(), now())
  on conflict (user_id) do update set subdomain = excluded.subdomain, zendesk_user_id = excluded.zendesk_user_id,
    zendesk_name = excluded.zendesk_name, zendesk_email = excluded.zendesk_email, zendesk_role = excluded.zendesk_role,
    scope = excluded.scope, access_ct = excluded.access_ct, refresh_ct = excluded.refresh_ct,
    access_expires_at = excluded.access_expires_at, refresh_expires_at = excluded.refresh_expires_at,
    version = public.ldo_support_zendesk_connections.version + 1, refresh_lease_until = null,
    status = 'active', status_detail = null, connected_at = now(), updated_at = now();
  -- Tickets e mensagens já guardados deste agente passam a ser desta pessoa.
  update public.ldo_support_conversations set assignee_id = p_user_id
  where source_id = 'zendesk' and external_assignee_id = p_data->>'zendesk_user_id' and assignee_id is distinct from p_user_id;
  update public.ldo_support_messages m set author_user_id = p_user_id
  from public.ldo_support_conversations c
  where c.id = m.conversation_id and c.source_id = 'zendesk' and m.author_user_id is null
    and m.author_external_id = p_data->>'zendesk_user_id';
  insert into public.ldo_support_audit (actor, action, details)
  values (p_user_id, 'zendesk.connect', jsonb_build_object('zendesk_user_id', p_data->>'zendesk_user_id', 'role', p_data->>'zendesk_role'));
end;
$$;

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
  -- Com o Zendesk desligado, os tickets antigos ficam só no dashboard: estado e responsável passam a ser daqui.
  if v_c.source_id = 'zendesk' and not ldo_private.zendesk_off() then
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
