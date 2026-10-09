-- Respostas automáticas nas redes sociais, correções da revisão:
-- * pg_net: tentativa de retirar a anon/authenticated o acesso ao esquema net. As permissões de origem foram dadas
--   pelo supabase_admin e não mudam com esta conta; o esquema net não está exposto pela API (só public e
--   graphql_public), por isso anon/authenticated não lhe chegam. Ficam aqui para quando for possível.
-- * Ligação registada (social_autoreply_enabled_at): nunca se responde a mensagens anteriores a ela.
-- * O claim recusa quando a equipa já respondeu depois da mensagem do cliente (gravado no dashboard).
-- * O acontecimento na conversa só é escrito depois do envio, com o resultado (enviada ou sem confirmação).

revoke all on all tables in schema net from public, anon, authenticated;
revoke execute on all functions in schema net from public, anon, authenticated;
revoke usage on schema net from public, anon, authenticated;

alter table public.ldo_support_settings add column social_autoreply_enabled_at timestamptz;
update public.ldo_support_settings set social_autoreply_enabled_at = now() where id = 1 and social_autoreply_enabled;

create or replace function public.ldo_support_social_save_settings(p_session text, p_enabled boolean, p_text text, p_offhours_text text,
  p_thanks_text text, p_hours jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if length(coalesce(p_text, '')) > 1000 or length(coalesce(p_offhours_text, '')) > 1000 then
    raise exception 'Texto da resposta automática demasiado longo (máximo 1000 caracteres).' using errcode = '22023';
  end if;
  if length(coalesce(p_thanks_text, '')) > 300 then
    raise exception 'Agradecimento demasiado longo (máximo 300 caracteres).' using errcode = '22023';
  end if;
  if coalesce(p_enabled, false) and btrim(coalesce(p_text, '')) = '' and btrim(coalesce(p_offhours_text, '')) = '' and btrim(coalesce(p_thanks_text, '')) = '' then
    raise exception 'Para ligar as respostas automáticas, escreva pelo menos um dos textos.' using errcode = '22023';
  end if;
  update public.ldo_support_settings set
    -- Ao ligar (de desligado para ligado) fica registada a hora: mensagens anteriores nunca recebem resposta automática.
    social_autoreply_enabled_at = case when coalesce(p_enabled, false) and not social_autoreply_enabled then now()
      when coalesce(p_enabled, false) then coalesce(social_autoreply_enabled_at, now()) else null end,
    social_autoreply_enabled = coalesce(p_enabled, false),
    social_autoreply_text = btrim(coalesce(p_text, '')),
    social_autoreply_offhours_text = btrim(coalesce(p_offhours_text, '')),
    social_thanks_text = btrim(coalesce(p_thanks_text, '')),
    social_hours = jsonb_build_object(
      'weekdays', left(btrim(coalesce(p_hours ->> 'weekdays', '')), 80),
      'saturday', left(btrim(coalesce(p_hours ->> 'saturday', '')), 80),
      'sunday', left(btrim(coalesce(p_hours ->> 'sunday', '')), 80)),
    updated_by = v_me, updated_at = now()
  where id = 1;
  insert into public.ldo_support_audit (actor, action, details)
  values (v_me, 'social.settings', jsonb_build_object('enabled', coalesce(p_enabled, false)));
end;
$$;

create or replace function public.ldo_support_social_settings(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select jsonb_build_object('enabled', s.social_autoreply_enabled, 'enabled_at', s.social_autoreply_enabled_at,
      'text', s.social_autoreply_text, 'offhours_text', s.social_autoreply_offhours_text, 'thanks_text', s.social_thanks_text,
      'hours', s.social_hours)
    from public.ldo_support_settings s where s.id = 1);
end;
$$;

-- Antes de enviar: uma vez por mensagem do cliente (âncora), o pedido de apoio no máximo uma vez por conversa em
-- 24 h, o agradecimento no máximo uma vez por pessoa em 7 dias, e nunca depois de a equipa já ter respondido
-- (resposta gravada no dashboard depois da mensagem do cliente, mesmo que a Metricool ainda não a mostre).
create or replace function public.ldo_support_social_autoreply_claim(p_token text, p_source text, p_conversation text, p_contact text,
  p_kind text, p_anchor text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_anchor_at timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  if p_kind not in ('support', 'thanks') or coalesce(p_conversation, '') = '' or coalesce(p_anchor, '') = '' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('ldo_social_autoreply:' || p_source || ':' || p_conversation));
  if p_kind = 'thanks' then
    perform pg_advisory_xact_lock(hashtext('ldo_social_thanks:' || p_source || ':' || coalesce(p_contact, p_conversation)));
  end if;
  select c.id into v_conv from public.ldo_support_conversations c where c.source_id = p_source and c.external_id = p_conversation;
  if v_conv is not null then
    select m.created_at into v_anchor_at from public.ldo_support_messages m
    where m.conversation_id = v_conv and m.external_id = p_anchor;
    if exists (select 1 from public.ldo_support_messages m
        where m.conversation_id = v_conv and m.kind = 'outbound' and m.deleted_at is null
          and (m.delivery is null or m.delivery <> 'failed')
          and m.created_at > coalesce(v_anchor_at, now() - interval '30 minutes')) then
      return false;
    end if;
  end if;
  if p_kind = 'support' and exists (select 1 from public.ldo_support_social_autoreplies
      where source_id = p_source and conversation_external_id = p_conversation and kind = 'support' and sent_at > now() - interval '24 hours') then
    return false;
  end if;
  if p_kind = 'thanks' and exists (select 1 from public.ldo_support_social_autoreplies
      where source_id = p_source and kind = 'thanks' and sent_at > now() - interval '7 days'
        and (contact_external_id = p_contact or conversation_external_id = p_conversation)) then
    return false;
  end if;
  insert into public.ldo_support_social_autoreplies (source_id, conversation_external_id, contact_external_id, kind, anchor)
  values (p_source, p_conversation, nullif(p_contact, ''), p_kind, p_anchor)
  on conflict (source_id, conversation_external_id, anchor) do nothing;
  return found;
end;
$$;

-- Depois do envio: "failed" liberta o registo (nada saiu); "accepted" ou "uncertain" escrevem o acontecimento na
-- conversa (o incerto fica registado e nunca se repete, porque pode ter chegado).
create function public.ldo_support_social_autoreply_result(p_token text, p_source text, p_conversation text, p_anchor text,
  p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_kind text;
  v_conv uuid;
begin
  perform ldo_private.bi_check(p_token);
  if p_outcome = 'failed' then
    delete from public.ldo_support_social_autoreplies
    where source_id = p_source and conversation_external_id = p_conversation and anchor = p_anchor;
    return;
  end if;
  select kind into v_kind from public.ldo_support_social_autoreplies
  where source_id = p_source and conversation_external_id = p_conversation and anchor = p_anchor;
  select id into v_conv from public.ldo_support_conversations where source_id = p_source and external_id = p_conversation;
  if v_kind is not null and v_conv is not null then
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (null, v_conv, 'social.autoreply', jsonb_build_object('kind', v_kind, 'outcome', case when p_outcome = 'accepted' then 'accepted' else 'uncertain' end));
  end if;
end;
$$;

revoke all on function public.ldo_support_social_autoreply_result(text, text, text, text, text) from public, authenticated;
grant execute on function public.ldo_support_social_autoreply_result(text, text, text, text, text) to anon;
