-- Redes sociais, terceira revisão:
-- * "Automáticas": guarda a hora da marca (auto_handled_at). Qualquer mensagem do cliente ou da equipa gravada
--   depois da marca traz a conversa de volta, mesmo que a hora da mensagem seja anterior (mensagem listada tarde).
-- * Claim: recusa quando a equipa respondeu depois da PRIMEIRA mensagem nova do cliente (p_since), não só depois
--   da última.

alter table public.ldo_support_conversations add column auto_handled_at timestamptz;

create or replace function public.ldo_support_social_mark_auto(p_token text, p_source text, p_conversation text, p_from timestamptz,
  p_through timestamptz) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_from is null or p_through is null or p_from > p_through then
    return false;
  end if;
  update public.ldo_support_conversations c
  set auto_handled_through = greatest(coalesce(c.auto_handled_through, '-infinity'::timestamptz), p_through),
    auto_handled_at = now()
  where c.source_id = p_source and c.external_id = p_conversation
    and c.assignee_id is null and c.status in ('novo', 'resolvido')
    and not exists (select 1 from public.ldo_support_messages m
      where m.conversation_id = c.id and m.kind = 'inbound' and m.deleted_at is null
        and (m.created_at < p_from or m.created_at > p_through));
  return found;
end;
$$;

-- Lista: a condição de "tratada automaticamente" também olha para a hora em que cada mensagem foi gravada.
do $$
declare v_def text := pg_get_functiondef('public.ldo_support_list(text,text,text,text,text)'::regprocedure);
  v_old text := 'm.created_at > c.auto_handled_through
              and (m.kind = ''inbound'' or m.author_user_id is not null)';
  v_old2 text := 'm.created_at > c.auto_handled_through
            and (m.kind = ''inbound'' or m.author_user_id is not null)';
  v_new text := '(m.created_at > c.auto_handled_through or m.inserted_at > coalesce(c.auto_handled_at, c.auto_handled_through))
              and (m.kind = ''inbound'' or m.author_user_id is not null)';
begin
  if position(v_old in v_def) = 0 or position(v_old2 in v_def) = 0 then
    raise exception 'ldo_support_list: condição de "Automáticas" não encontrada';
  end if;
  v_def := replace(replace(v_def, v_old, v_new), v_old2, v_new);
  execute v_def;
end;
$$;

drop function public.ldo_support_social_autoreply_claim(text, text, text, text, text, text);

create function public.ldo_support_social_autoreply_claim(p_token text, p_source text, p_conversation text, p_contact text,
  p_kind text, p_anchor text, p_since timestamptz default null) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_since timestamptz;
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
    -- Desde a primeira mensagem nova do cliente (ou, sem ela, desde a âncora).
    v_since := coalesce(p_since, (select m.created_at from public.ldo_support_messages m
      where m.conversation_id = v_conv and m.external_id = p_anchor), now() - interval '30 minutes');
    if exists (select 1 from public.ldo_support_messages m
        where m.conversation_id = v_conv and m.kind = 'outbound' and m.deleted_at is null
          and (m.delivery is null or m.delivery <> 'failed') and m.created_at > v_since) then
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
revoke all on function public.ldo_support_social_autoreply_claim(text, text, text, text, text, text, timestamptz) from public, authenticated;
grant execute on function public.ldo_support_social_autoreply_claim(text, text, text, text, text, text, timestamptz) to anon;
