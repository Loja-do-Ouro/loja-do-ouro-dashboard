-- Chat do site: o cliente termina a conversa no próprio chat (em vez da janela do browser).
-- * O visitante fica terminado (ended_at): o token deixa de dar acesso e o widget volta ao início.
-- * A equipa vê na conversa "O cliente terminou a conversa no site" (registo 'visitor_end').
-- * Se o cliente pedir, o servidor envia-lhe uma cópia da conversa para o email que indicou (uma vez:
--   depois de terminada, a conversa já não responde a este token).
-- As respostas da equipa depois disso continuam a seguir por email (avisos ao visitante, como antes).

alter table public.ldo_support_site_visitors add column if not exists ended_at timestamptz;

-- Visitante pelo hash do token. Conversa terminada ou confirmada com outro email: deixa de estar disponível.
create or replace function ldo_private.site_visitor(p_token_hash text, p_identity_email text) returns public.ldo_support_site_visitors
language plpgsql stable security definer set search_path = '' as $$
declare v public.ldo_support_site_visitors;
begin
  select * into v from public.ldo_support_site_visitors where token_hash = p_token_hash;
  if v.id is null or v.ended_at is not null or (v.verified and lower(coalesce(p_identity_email, '')) <> v.email) then
    raise exception 'Esta conversa já não está disponível. Inicie uma nova.' using errcode = 'P0401';
  end if;
  return v;
end;
$$;

-- Terminar a conversa. Devolve o email e, se pedido, a conversa para a cópia por email.
create or replace function public.ldo_support_site_end(p_token text, p_token_hash text, p_identity_email text, p_transcript boolean)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_items jsonb := '[]'::jsonb;
  v_copy boolean := coalesce(p_transcript, false);
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  update public.ldo_support_site_visitors set ended_at = now() where id = v.id;
  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  values (null, v.conversation_id, 'visitor_end', jsonb_build_object('transcript', v_copy));
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

revoke all on function public.ldo_support_site_end(text, text, text, boolean) from public, authenticated;
grant execute on function public.ldo_support_site_end(text, text, text, boolean) to anon;
