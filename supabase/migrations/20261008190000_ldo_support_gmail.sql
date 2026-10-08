-- Apoio ao Cliente: email direto pela caixa Gmail do apoio (apoiocliente@lojadoouro.pt), para substituir o Zendesk.
--
-- * Ligação OAuth da caixa partilhada (uma só, feita pelo Super Admin): chaves cifradas no servidor
--   (AES-256-GCM, SUPPORT_ENCRYPTION_KEY), como as do Zendesk; nunca chegam ao browser.
-- * Fonte "gmail" (canal "email"): o dashboard é a fonte de verdade do estado e do responsável.
-- * Assinatura automática em todas as respostas e resposta automática ("recebemos o seu email") com texto
--   dentro e fora do horário. A resposta automática começa desligada: o Super Admin revê os textos e liga-a.
-- * Resposta automática no máximo uma vez por conversa e uma vez por dia por remetente (tabela própria).

alter table public.ldo_support_sources drop constraint ldo_support_sources_platform_check;
alter table public.ldo_support_sources add constraint ldo_support_sources_platform_check
  check (platform in ('zendesk', 'metricool', 'whatsapp', 'site', 'gmail'));
alter table public.ldo_support_sources drop constraint ldo_support_sources_channel_check;
alter table public.ldo_support_sources add constraint ldo_support_sources_channel_check
  check (channel in ('zendesk', 'facebook', 'instagram', 'whatsapp', 'site', 'email'));

insert into public.ldo_support_sources (id, platform, channel, account, label, status, status_detail, config)
values ('gmail', 'gmail', 'email', 'apoiocliente@lojadoouro.pt', 'Email', 'not_configured', 'Gmail por ligar (Configuração do Apoio ao Cliente).', '{}')
on conflict (id) do nothing;

create table public.ldo_support_gmail (
  id integer primary key default 1 check (id = 1),
  email text not null check (length(email) <= 254),
  scope text,
  refresh_ct text,
  access_ct text,
  access_expires_at timestamptz,
  version integer not null default 1,
  refresh_lease_until timestamptz,
  status text not null default 'active' check (status in ('active', 'reconnect')),
  status_detail text,
  watch_expires_at timestamptz,
  connected_by uuid references public.ldo_app_users (id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ldo_support_gmail_autoreplies (
  thread_id text primary key check (length(thread_id) <= 200),
  email text not null check (length(email) <= 254),
  sent_at timestamptz not null default now()
);
create index ldo_support_gmail_autoreplies_email_idx on public.ldo_support_gmail_autoreplies (lower(email), sent_at desc);

alter table public.ldo_support_gmail enable row level security;
alter table public.ldo_support_gmail_autoreplies enable row level security;
revoke all on public.ldo_support_gmail, public.ldo_support_gmail_autoreplies from anon, authenticated;

alter table public.ldo_support_settings
  add column email_signature text not null
    default E'Com os melhores cumprimentos,\n{nome}\nApoio ao Cliente · Loja do Ouro\nwww.lojadoouro.pt'
    check (length(email_signature) <= 2000),
  add column email_autoreply_enabled boolean not null default false,
  add column email_autoreply_text text not null
    default E'Olá,\n\nRecebemos o seu email e agradecemos o contacto. A nossa equipa vai responder com a maior brevidade possível.\n\nSe a mensagem for sobre uma encomenda, indique-nos o número (por exemplo #12345) para o podermos ajudar mais depressa.'
    check (length(email_autoreply_text) <= 4000),
  add column email_autoreply_offhours_text text not null
    default E'Olá,\n\nRecebemos o seu email e agradecemos o contacto. Neste momento estamos fora do horário de atendimento; vamos responder assim que possível, no próximo dia útil.\n\nSe a mensagem for sobre uma encomenda, indique-nos o número (por exemplo #12345) para o podermos ajudar mais depressa.'
    check (length(email_autoreply_offhours_text) <= 4000),
  add column email_hours jsonb not null
    default '{"weekdays": "09:30-13:00, 14:00-18:30", "saturday": "10:00-13:00", "sunday": ""}'
    check (jsonb_typeof(email_hours) = 'object');

-- ---------------------------------------------------------------- Super Admin (sessão)

create function public.ldo_support_email_save_settings(p_session text, p_signature text, p_autoreply_enabled boolean,
  p_autoreply_text text, p_autoreply_offhours_text text, p_hours jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_hours jsonb;
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if length(coalesce(p_signature, '')) > 2000 then
    raise exception 'Assinatura demasiado longa (máximo 2000 caracteres).' using errcode = '22023';
  end if;
  if length(coalesce(p_autoreply_text, '')) > 4000 or length(coalesce(p_autoreply_offhours_text, '')) > 4000 then
    raise exception 'Texto da resposta automática demasiado longo (máximo 4000 caracteres).' using errcode = '22023';
  end if;
  if coalesce(p_autoreply_enabled, false) and (btrim(coalesce(p_autoreply_text, '')) = '' or btrim(coalesce(p_autoreply_offhours_text, '')) = '') then
    raise exception 'Para ligar a resposta automática, escreva os dois textos.' using errcode = '22023';
  end if;
  v_hours := jsonb_build_object(
    'weekdays', left(btrim(coalesce(p_hours ->> 'weekdays', '')), 80),
    'saturday', left(btrim(coalesce(p_hours ->> 'saturday', '')), 80),
    'sunday', left(btrim(coalesce(p_hours ->> 'sunday', '')), 80));
  update public.ldo_support_settings set
    email_signature = btrim(coalesce(p_signature, '')),
    email_autoreply_enabled = coalesce(p_autoreply_enabled, false),
    email_autoreply_text = btrim(coalesce(p_autoreply_text, '')),
    email_autoreply_offhours_text = btrim(coalesce(p_autoreply_offhours_text, '')),
    email_hours = v_hours,
    updated_by = v_me, updated_at = now()
  where id = 1;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'email.settings', jsonb_build_object('autoreply', coalesce(p_autoreply_enabled, false)));
end;
$$;

-- Estado da ligação para a página de configuração (sem chaves).
create function public.ldo_support_gmail_status(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('email', g.email, 'status', g.status, 'status_detail', g.status_detail,
      'scope', g.scope, 'watch_expires_at', g.watch_expires_at, 'connected_at', g.connected_at,
      'connected_by', ldo_private.support_display_name(g.connected_by))
    from public.ldo_support_gmail g where g.id = 1);
end;
$$;

-- Guarda a ligação feita pelo Super Admin (depois de o servidor confirmar que é a caixa do apoio).
create function public.ldo_support_gmail_save(p_session text, p_email text, p_scope text, p_refresh_ct text,
  p_access_ct text, p_access_expires_at timestamptz) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin pode ligar a caixa de email.' using errcode = '42501';
  end if;
  if p_refresh_ct is null or p_refresh_ct !~ '^v1\.' or p_access_ct is null or p_access_ct !~ '^v1\.' then
    raise exception 'Ligação inválida.' using errcode = '22023';
  end if;
  insert into public.ldo_support_gmail as g (id, email, scope, refresh_ct, access_ct, access_expires_at, version, status, status_detail,
    connected_by, connected_at, updated_at)
  values (1, lower(p_email), p_scope, p_refresh_ct, p_access_ct, p_access_expires_at, 1, 'active', null, v_me, now(), now())
  on conflict (id) do update set email = excluded.email, scope = excluded.scope, refresh_ct = excluded.refresh_ct,
    access_ct = excluded.access_ct, access_expires_at = excluded.access_expires_at, version = g.version + 1,
    refresh_lease_until = null, status = 'active', status_detail = null, watch_expires_at = null,
    connected_by = v_me, connected_at = now(), updated_at = now();
  update public.ldo_support_sources set status = 'pending', status_detail = 'Caixa ligada; a preparar a primeira sincronização.',
    next_attempt_at = now(), failures = 0 where id = 'gmail';
  insert into public.ldo_support_audit (actor, action, details) values (v_me, 'gmail.connect', jsonb_build_object('email', lower(p_email)));
end;
$$;

create function public.ldo_support_gmail_disconnect(p_session text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin pode desligar a caixa de email.' using errcode = '42501';
  end if;
  delete from public.ldo_support_gmail where id = 1;
  update public.ldo_support_sources set status = 'not_configured', status_detail = 'Gmail desligado.', cursor = '{}'::jsonb
  where id = 'gmail';
  insert into public.ldo_support_audit (actor, action, details) values (v_me, 'gmail.disconnect', '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- servidor (token)

-- Ligação (com as chaves cifradas) e definições de email, só para o servidor.
create function public.ldo_support_gmail_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return jsonb_build_object(
    'account', (select to_jsonb(g) from public.ldo_support_gmail g where g.id = 1),
    'settings', (select jsonb_build_object('signature', s.email_signature, 'autoreply_enabled', s.email_autoreply_enabled,
        'autoreply_text', s.email_autoreply_text, 'autoreply_offhours_text', s.email_autoreply_offhours_text, 'hours', s.email_hours)
      from public.ldo_support_settings s where s.id = 1));
end;
$$;

-- Renovação da chave de acesso: só um pedido de cada vez (30 s), pela versão lida.
create function public.ldo_support_gmail_claim(p_token text, p_version integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_gmail set refresh_lease_until = now() + interval '30 seconds'
  where id = 1 and version = p_version and status = 'active' and (refresh_lease_until is null or refresh_lease_until < now());
  return found;
end;
$$;

-- A Google só às vezes devolve uma nova chave de renovação: sem ela fica a anterior.
create function public.ldo_support_gmail_rotate(p_token text, p_version integer, p_access_ct text, p_access_expires_at timestamptz,
  p_refresh_ct text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_gmail set access_ct = p_access_ct, access_expires_at = p_access_expires_at,
    refresh_ct = coalesce(p_refresh_ct, refresh_ct), version = version + 1, refresh_lease_until = null, updated_at = now()
  where id = 1 and version = p_version;
  return found;
end;
$$;

-- A Google recusou a ligação (ex.: acesso revogado): é preciso voltar a ligar.
create function public.ldo_support_gmail_fail(p_token text, p_version integer, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_gmail set status = 'reconnect', status_detail = left(p_detail, 300), access_ct = null, refresh_ct = null,
    refresh_lease_until = null, version = version + 1, updated_at = now()
  where id = 1 and version = p_version;
  if found then
    update public.ldo_support_sources set status = 'error', status_detail = 'Gmail: é preciso voltar a ligar a caixa.' where id = 'gmail';
  end if;
end;
$$;

create function public.ldo_support_gmail_watch(p_token text, p_expires_at timestamptz) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_gmail set watch_expires_at = p_expires_at, updated_at = now() where id = 1;
end;
$$;

-- Resposta automática: uma vez por conversa e no máximo uma vez por dia para o mesmo remetente.
create function public.ldo_support_gmail_autoreply_claim(p_token text, p_thread text, p_email text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_conv uuid;
begin
  perform ldo_private.bi_check(p_token);
  -- Dois emails do mesmo remetente ao mesmo tempo: só um passa a verificação abaixo.
  perform pg_advisory_xact_lock(hashtext('ldo_gmail_autoreply:' || lower(p_email)));
  if exists (select 1 from public.ldo_support_gmail_autoreplies where lower(email) = lower(p_email) and sent_at > now() - interval '24 hours') then
    return false;
  end if;
  insert into public.ldo_support_gmail_autoreplies (thread_id, email) values (p_thread, lower(p_email)) on conflict do nothing;
  if not found then
    return false;
  end if;
  select id into v_conv from public.ldo_support_conversations where source_id = 'gmail' and external_id = p_thread;
  if v_conv is not null then
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (null, v_conv, 'email.autoreply', jsonb_build_object('email', lower(p_email)));
  end if;
  return true;
end;
$$;

-- Envio falhado: a conversa volta a poder receber a resposta automática.
create function public.ldo_support_gmail_autoreply_release(p_token text, p_thread text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  delete from public.ldo_support_gmail_autoreplies where thread_id = p_thread;
  delete from public.ldo_support_audit a using public.ldo_support_conversations c
  where c.source_id = 'gmail' and c.external_id = p_thread and a.conversation_id = c.id and a.action = 'email.autoreply';
end;
$$;

-- ---------------------------------------------------------------- envio com anexos também no email

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
      'external_id', v_c.external_id, 'via', v_c.via, 'contact_external_id', v_k.external_id, 'contact_email', v_k.email,
      'subject', v_c.subject,
      'assignee_id', v_c.assignee_id, 'external_assignee_id', v_c.external_assignee_id, 'status', v_c.status));
end;
$$;

revoke all on function
  public.ldo_support_email_save_settings(text, text, boolean, text, text, jsonb),
  public.ldo_support_gmail_status(text),
  public.ldo_support_gmail_save(text, text, text, text, text, timestamptz),
  public.ldo_support_gmail_disconnect(text),
  public.ldo_support_gmail_get(text),
  public.ldo_support_gmail_claim(text, integer),
  public.ldo_support_gmail_rotate(text, integer, text, timestamptz, text),
  public.ldo_support_gmail_fail(text, integer, text),
  public.ldo_support_gmail_watch(text, timestamptz),
  public.ldo_support_gmail_autoreply_claim(text, text, text),
  public.ldo_support_gmail_autoreply_release(text, text)
from public, authenticated;
grant execute on function
  public.ldo_support_email_save_settings(text, text, boolean, text, text, jsonb),
  public.ldo_support_gmail_status(text),
  public.ldo_support_gmail_save(text, text, text, text, text, timestamptz),
  public.ldo_support_gmail_disconnect(text),
  public.ldo_support_gmail_get(text),
  public.ldo_support_gmail_claim(text, integer),
  public.ldo_support_gmail_rotate(text, integer, text, timestamptz, text),
  public.ldo_support_gmail_fail(text, integer, text),
  public.ldo_support_gmail_watch(text, timestamptz),
  public.ldo_support_gmail_autoreply_claim(text, text, text),
  public.ldo_support_gmail_autoreply_release(text, text)
to anon;
