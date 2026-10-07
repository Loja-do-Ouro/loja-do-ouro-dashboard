-- Apoio ao Cliente: a leitura fica marcada até à última mensagem do cliente que a pessoa viu no ecrã
-- (hora de chegada ao dashboard), nunca além: uma mensagem que chegue durante a leitura continua não lida.
-- Ler noutra janela nunca faz recuar a leitura; "marcar como não lida" sim.

drop function public.ldo_support_mark_read(text, uuid, boolean);

create function public.ldo_support_mark_read(p_session text, p_id uuid, p_unread boolean, p_seen timestamptz) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_last timestamptz := (select max(inserted_at) from public.ldo_support_messages
    where conversation_id = p_id and kind = 'inbound' and deleted_at is null);
  v_at timestamptz;
begin
  if not exists (select 1 from public.ldo_support_conversations where id = p_id) then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  v_at := case when coalesce(p_unread, false) then coalesce(v_last, now()) - interval '1 millisecond'
    else least(coalesce(p_seen, v_last, now()), coalesce(v_last, now())) end;
  insert into public.ldo_support_reads (user_id, conversation_id, read_at) values (v_me, p_id, v_at)
  on conflict (user_id, conversation_id) do update set read_at = case when coalesce(p_unread, false)
    then excluded.read_at else greatest(public.ldo_support_reads.read_at, excluded.read_at) end;
end;
$$;

revoke all on function public.ldo_support_mark_read(text, uuid, boolean, timestamptz) from public, authenticated;
grant execute on function public.ldo_support_mark_read(text, uuid, boolean, timestamptz) to anon;
