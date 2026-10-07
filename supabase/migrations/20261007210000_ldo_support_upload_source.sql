-- Apoio ao Cliente: fotos de produtos anexadas guardam o endereço público de origem (CDN da Shopify).
-- No Facebook/Instagram a Meta vai buscar a foto diretamente à Shopify (sem o URL temporário do dashboard).

alter table public.ldo_support_uploads add column source_url text
  check (source_url is null or source_url ~ '^https://cdn\.shopify\.com/s/files/');

drop function public.ldo_support_upload_save(text, uuid, uuid, text, text, text);

create function public.ldo_support_upload_save(p_token text, p_user_id uuid, p_conversation uuid, p_name text,
  p_content_type text, p_data_b64 text, p_source_url text) returns jsonb
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
  if (select count(*) from public.ldo_support_uploads where user_id = p_user_id and conversation_id = p_conversation and message_id is null
      and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Demasiados anexos por enviar nesta conversa.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ldo_support_uploads'));
  if (select coalesce(sum(size), 0) from public.ldo_support_uploads where user_id = p_user_id and created_at > now() - interval '1 day')
      + octet_length(v_data) > 40 * 1024 * 1024 then
    raise exception 'Limite diário de anexos atingido.' using errcode = '22023';
  end if;
  if (select coalesce(sum(size), 0) from public.ldo_support_uploads where data is not null) + octet_length(v_data) > 150 * 1024 * 1024 then
    raise exception 'Espaço de anexos cheio. Tente mais tarde.' using errcode = '22023';
  end if;
  insert into public.ldo_support_uploads (conversation_id, user_id, name, content_type, size, data, source_url)
  values (p_conversation, p_user_id, left(btrim(p_name), 200), p_content_type, octet_length(v_data), v_data, nullif(p_source_url, ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', left(btrim(p_name), 200), 'type', p_content_type, 'size', octet_length(v_data));
end;
$$;

create or replace function public.ldo_support_upload_get(p_token text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select jsonb_build_object('id', u.id, 'conversation_id', u.conversation_id, 'user_id', u.user_id, 'name', u.name,
    'type', u.content_type, 'size', u.size, 'message_id', u.message_id, 'data', encode(u.data, 'base64'),
    'public_token', u.public_token, 'public_until', u.public_until, 'source_url', u.source_url)
    from public.ldo_support_uploads u where u.id = p_id and u.data is not null);
end;
$$;

revoke all on function public.ldo_support_upload_save(text, uuid, uuid, text, text, text, text) from public, authenticated;
grant execute on function public.ldo_support_upload_save(text, uuid, uuid, text, text, text, text) to anon;
