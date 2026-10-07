-- Apoio ao Cliente: imagens anexadas pelas colaboradoras às respostas.
--
-- O browser reduz a imagem antes de a enviar (≤ 3 MB). Os bytes ficam aqui:
--   - Zendesk: o servidor carrega-os no Zendesk ao responder (/api/v2/uploads) e o Zendesk passa a
--     guardar o anexo do comentário.
--   - Facebook/Instagram: a Metricool só aceita um URL público; durante 1 hora a imagem é servida em
--     /api/support/media/<public_token> (token aleatório de 32 bytes), para a Meta a ir buscar.
-- Os bytes são apagados ao fim de 30 dias (a mensagem continua a mostrar o nome do anexo).
-- Só funções: tabela sem acesso direto.

create table public.ldo_support_uploads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ldo_support_conversations (id) on delete cascade,
  user_id uuid not null references public.ldo_app_users (id),
  name text not null check (length(name) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size integer not null check (size between 1 and 4194304),
  data bytea,
  public_token text unique,
  public_until timestamptz,
  message_id uuid references public.ldo_support_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  purged_at timestamptz
);
create index ldo_support_uploads_conv_idx on public.ldo_support_uploads (conversation_id);
alter table public.ldo_support_uploads enable row level security;
revoke all on public.ldo_support_uploads from anon, authenticated;

-- Grava uma imagem de uma colaboradora para uma conversa (o servidor já validou o ficheiro).
create function public.ldo_support_upload_save(p_token text, p_user_id uuid, p_conversation uuid, p_name text,
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
  insert into public.ldo_support_uploads (conversation_id, user_id, name, content_type, size, data)
  values (p_conversation, p_user_id, left(btrim(p_name), 200), p_content_type, octet_length(v_data), v_data)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', left(btrim(p_name), 200), 'type', p_content_type, 'size', octet_length(v_data));
end;
$$;

-- Bytes de um anexo (servidor): para o carregar no Zendesk ou mostrar no dashboard.
create function public.ldo_support_upload_get(p_token text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select jsonb_build_object('id', u.id, 'conversation_id', u.conversation_id, 'user_id', u.user_id, 'name', u.name,
    'type', u.content_type, 'size', u.size, 'message_id', u.message_id, 'data', encode(u.data, 'base64'),
    'public_token', u.public_token, 'public_until', u.public_until)
    from public.ldo_support_uploads u where u.id = p_id and u.data is not null);
end;
$$;

-- Torna um anexo acessível publicamente durante 1 hora (para a Meta o ir buscar). Devolve o token.
create function public.ldo_support_upload_publish(p_token text, p_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_public text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_uploads set public_token = v_public, public_until = now() + interval '1 hour'
  where id = p_id and data is not null and content_type in ('image/jpeg', 'image/png');
  if not found then
    raise exception 'Anexo indisponível.' using errcode = 'P0002';
  end if;
  return v_public;
end;
$$;

-- Imagem pública pelo token, só dentro do prazo (rota sem sessão, usada pela Meta).
create function public.ldo_support_media_public(p_token text, p_public text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_public !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  return (select jsonb_build_object('type', u.content_type, 'data', encode(u.data, 'base64'), 'size', u.size)
    from public.ldo_support_uploads u where u.public_token = p_public and u.public_until > now() and u.data is not null);
end;
$$;

-- Apaga os bytes de anexos com mais de 30 dias e anexos nunca enviados com mais de 1 dia.
create function public.ldo_support_uploads_purge(p_token text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_uploads set data = null, public_token = null, public_until = null, purged_at = now()
  where data is not null and (created_at < now() - interval '30 days' or (message_id is null and created_at < now() - interval '1 day'));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Envio com anexos: os anexos têm de ser da mesma pessoa e conversa e ainda não usados. Uma resposta
-- só com imagem (sem texto) é aceite. Substitui a versão de 5 argumentos.
drop function public.ldo_support_begin_send(text, uuid, text, text, uuid);

create function public.ldo_support_begin_send(p_session text, p_id uuid, p_kind text, p_body text, p_client_key uuid, p_uploads uuid[])
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

revoke all on function public.ldo_support_upload_save(text, uuid, uuid, text, text, text),
  public.ldo_support_upload_get(text, uuid), public.ldo_support_upload_publish(text, uuid),
  public.ldo_support_media_public(text, text), public.ldo_support_uploads_purge(text),
  public.ldo_support_begin_send(text, uuid, text, text, uuid, uuid[]) from public, authenticated;
grant execute on function public.ldo_support_upload_save(text, uuid, uuid, text, text, text),
  public.ldo_support_upload_get(text, uuid), public.ldo_support_upload_publish(text, uuid),
  public.ldo_support_media_public(text, text), public.ldo_support_uploads_purge(text),
  public.ldo_support_begin_send(text, uuid, text, text, uuid, uuid[]) to anon;
