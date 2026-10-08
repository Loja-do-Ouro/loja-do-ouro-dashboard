-- Correções da revisão do "terminar conversa" no chat do site:
-- * A cópia por email só segue quando o email é de confiança: confirmado pela sessão da loja, ou a equipa já
--   respondeu nesta conversa. E no máximo 2 cópias por destinatário em 24 horas. (Sem isto, qualquer pessoa
--   podia iniciar uma conversa com o email de outra e mandar-lhe o próprio texto com a marca da loja.)
-- * Terminar é atómico: pedidos em paralelo com o mesmo token não geram várias cópias nem vários registos.

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
            'body', m.body, 'at', m.created_at) as item
        from public.ldo_support_messages m
        where m.conversation_id = v.conversation_id and m.deleted_at is null
          and (m.kind = 'inbound' or (m.kind = 'outbound' and m.delivery in ('accepted', 'delivered', 'read')))
        union all
        select a.created_at,
          jsonb_build_object('from', 'notice', 'author', null,
            'body', 'A conversa foi transferida para ' || coalesce(a.details ->> 'to_first', 'outra pessoa da equipa') || '.', 'at', a.created_at)
        from public.ldo_support_audit a
        where a.conversation_id = v.conversation_id and a.action = 'assign' and (a.details ->> 'notice') = 'true'
      ) y
      order by y.at desc
      limit 300
    ) x;
  end if;
  return jsonb_build_object('email', v.email, 'name', v.name, 'transcript', v_copy, 'messages', v_items);
end;
$$;
