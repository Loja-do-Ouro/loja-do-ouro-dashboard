-- Apoio ao Cliente: respostas automáticas no Facebook e no Instagram, em vez da "mensagem de ausência" do Meta
-- (que responde a tudo, também às reações às stories e às mensagens só com emoji).
-- * Pedido de apoio: mensagem automática fora do horário (e dentro, se houver texto), uma vez por conversa em 24 h.
-- * Reação sozinha (story, gosto, emoji, elogio curto): agradecimento curto, uma vez por pessoa em 7 dias.
-- Começa desligado: só se liga depois de desligar a mensagem de ausência no Meta Business Suite.
-- O horário por omissão (07:00-21:00 todos os dias) é o que a mensagem de ausência do Meta usa hoje.

alter table public.ldo_support_settings
  add column social_autoreply_enabled boolean not null default false,
  add column social_autoreply_text text not null default '' check (length(social_autoreply_text) <= 1000),
  add column social_autoreply_offhours_text text not null
    default 'Olá {nome} 😊, obrigado pela sua mensagem. De momento não estamos disponíveis, responderemos o mais brevemente possível. Gratos pela preferência ❤'
    check (length(social_autoreply_offhours_text) <= 1000),
  add column social_thanks_text text not null default 'Obrigado! 💛' check (length(social_thanks_text) <= 300),
  add column social_hours jsonb not null
    default '{"weekdays": "07:00-21:00", "saturday": "07:00-21:00", "sunday": "07:00-21:00"}'
    check (jsonb_typeof(social_hours) = 'object');

create table public.ldo_support_social_autoreplies (
  id bigint generated always as identity primary key,
  source_id text not null references public.ldo_support_sources (id) on delete cascade,
  conversation_external_id text not null check (length(conversation_external_id) <= 200),
  contact_external_id text check (length(contact_external_id) <= 200),
  kind text not null check (kind in ('support', 'thanks')),
  anchor text not null check (length(anchor) <= 200),
  sent_at timestamptz not null default now(),
  unique (source_id, conversation_external_id, anchor)
);
create index ldo_support_social_autoreplies_conv_idx on public.ldo_support_social_autoreplies (source_id, conversation_external_id, kind, sent_at desc);
create index ldo_support_social_autoreplies_contact_idx on public.ldo_support_social_autoreplies (source_id, contact_external_id, kind, sent_at desc);
alter table public.ldo_support_social_autoreplies enable row level security;
revoke all on public.ldo_support_social_autoreplies from anon, authenticated;

-- ---------------------------------------------------------------- Super Admin (sessão)

create function public.ldo_support_social_save_settings(p_session text, p_enabled boolean, p_text text, p_offhours_text text,
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

-- ---------------------------------------------------------------- servidor (token)

create function public.ldo_support_social_settings(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select jsonb_build_object('enabled', s.social_autoreply_enabled, 'text', s.social_autoreply_text,
      'offhours_text', s.social_autoreply_offhours_text, 'thanks_text', s.social_thanks_text, 'hours', s.social_hours)
    from public.ldo_support_settings s where s.id = 1);
end;
$$;

-- Antes de enviar: uma vez por mensagem do cliente (âncora), o pedido de apoio no máximo uma vez por conversa em
-- 24 h e o agradecimento no máximo uma vez por pessoa em 7 dias. Regista o acontecimento na conversa.
create function public.ldo_support_social_autoreply_claim(p_token text, p_source text, p_conversation text, p_contact text,
  p_kind text, p_anchor text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_conv uuid;
begin
  perform ldo_private.bi_check(p_token);
  if p_kind not in ('support', 'thanks') or coalesce(p_conversation, '') = '' or coalesce(p_anchor, '') = '' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('ldo_social_autoreply:' || p_source || ':' || p_conversation));
  if p_kind = 'thanks' then
    perform pg_advisory_xact_lock(hashtext('ldo_social_thanks:' || p_source || ':' || coalesce(p_contact, p_conversation)));
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
  if not found then
    return false;
  end if;
  select id into v_conv from public.ldo_support_conversations where source_id = p_source and external_id = p_conversation;
  if v_conv is not null then
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (null, v_conv, 'social.autoreply', jsonb_build_object('kind', p_kind));
  end if;
  return true;
end;
$$;

-- Envio recusado (nada saiu): a mensagem volta a poder receber a resposta automática.
create function public.ldo_support_social_autoreply_release(p_token text, p_source text, p_conversation text, p_anchor text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_sent timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  delete from public.ldo_support_social_autoreplies
  where source_id = p_source and conversation_external_id = p_conversation and anchor = p_anchor
  returning sent_at into v_sent;
  if v_sent is not null then
    delete from public.ldo_support_audit a using public.ldo_support_conversations c
    where c.source_id = p_source and c.external_id = p_conversation and a.conversation_id = c.id
      and a.action = 'social.autoreply' and a.created_at >= v_sent - interval '5 seconds';
  end if;
end;
$$;

revoke all on function
  public.ldo_support_social_save_settings(text, boolean, text, text, text, jsonb),
  public.ldo_support_social_settings(text),
  public.ldo_support_social_autoreply_claim(text, text, text, text, text, text),
  public.ldo_support_social_autoreply_release(text, text, text, text)
from public, authenticated;
grant execute on function
  public.ldo_support_social_save_settings(text, boolean, text, text, text, jsonb),
  public.ldo_support_social_settings(text),
  public.ldo_support_social_autoreply_claim(text, text, text, text, text, text),
  public.ldo_support_social_autoreply_release(text, text, text, text)
to anon;
