-- Email (Gmail), segunda revisão:
-- * Formulário de contacto: o contacto não confirmado tem a sua própria linha (external_id "formulario:<email>",
--   sem email, com claimed_email). Nunca partilha a linha (nem o nome, nem as encomendas) com quem escreveu
--   diretamente desse endereço.
-- * Ponto de partida da sincronização fixado no momento da ligação (historyId do perfil), na mesma transação que
--   guarda a ligação: nenhum email que chegue depois de ligar fica de fora.
-- * Envios do dashboard encontrados nos Enviados do Gmail: confirmados (também depois de marcados como não
--   enviados) e com os anexos a apontar para o Gmail, para libertar a cópia do dashboard.

drop function public.ldo_support_gmail_save(text, text, text, text, text, timestamptz);

create function public.ldo_support_gmail_save(p_session text, p_email text, p_scope text, p_refresh_ct text,
  p_access_ct text, p_access_expires_at timestamptz, p_history_id text) returns void
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
  -- Primeira ligação (ou depois de desligar): começa aqui. Ao voltar a ligar, continua de onde estava.
  update public.ldo_support_sources set status = 'pending', status_detail = 'Caixa ligada; a preparar a primeira sincronização.',
    next_attempt_at = now(), failures = 0,
    cursor = case
      when cursor ? 'historyId' then cursor
      when coalesce(p_history_id, '') ~ '^[0-9]{1,30}$'
        then jsonb_build_object('historyId', p_history_id, 'syncedAt', floor(extract(epoch from now()))::bigint, 'pending', '[]'::jsonb)
      else cursor end
  where id = 'gmail';
  insert into public.ldo_support_audit (actor, action, details) values (v_me, 'gmail.connect', jsonb_build_object('email', lower(p_email)));
end;
$$;

create or replace function public.ldo_support_gmail_claimed(p_token text, p_addresses text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_contacts k set claimed_email = substr(k.external_id, 12), updated_at = now()
  from public.ldo_support_sources s
  where s.id = 'gmail' and k.channel = s.channel and k.account = s.account
    and k.external_id = any (select 'formulario:' || lower(a) from unnest(coalesce(p_addresses, '{}')) a where length(a) <= 254)
    and k.email is null and k.claimed_email is distinct from substr(k.external_id, 12);
end;
$$;

-- p_items: [{id (mensagem do dashboard), thread, external_id (mensagem do Gmail), attachments}]. Devolve quantas mudaram.
create function public.ldo_support_gmail_confirm_sent(p_token text, p_items jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  i jsonb;
  v_m public.ldo_support_messages;
  v_ext text;
  v_att jsonb;
  n integer := 0;
begin
  perform ldo_private.bi_check(p_token);
  for i in select value from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) loop
    v_ext := nullif(i ->> 'external_id', '');
    if v_ext is null or coalesce(i ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      continue;
    end if;
    select m.* into v_m from public.ldo_support_messages m
      join public.ldo_support_conversations c on c.id = m.conversation_id
    where m.id = (i ->> 'id')::uuid and c.source_id = 'gmail' and c.external_id = i ->> 'thread'
      and m.kind = 'outbound' and m.client_key is not null
    for update of m;
    if v_m.id is null or (v_m.external_id is not null and v_m.external_id <> v_ext) then
      continue;
    end if;
    -- Cópia gravada antes pela sincronização (sem client_key) com o mesmo id do Gmail.
    delete from public.ldo_support_messages
    where conversation_id = v_m.conversation_id and external_id = v_ext and id <> v_m.id and client_key is null;
    v_att := case when jsonb_typeof(i -> 'attachments') = 'array' and jsonb_array_length(i -> 'attachments') > 0
        and v_m.attachments::text like '%"upload:%' then i -> 'attachments' else v_m.attachments end;
    update public.ldo_support_messages set
      external_id = v_ext,
      delivery = case when delivery in ('sending', 'uncertain', 'failed') then 'accepted' else delivery end,
      delivery_detail = case
        when delivery = 'failed' then 'O Gmail enviou esta mensagem (estava marcada como não enviada): o cliente recebeu-a.'
        when delivery in ('sending', 'uncertain') then 'Confirmado nos Enviados do Gmail.'
        else delivery_detail end,
      attachments = v_att
    where id = v_m.id
      and (external_id is null or delivery in ('sending', 'uncertain', 'failed') or attachments is distinct from v_att);
    if found then
      n := n + 1;
      perform ldo_private.support_summarize(v_m.conversation_id);
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function
  public.ldo_support_gmail_save(text, text, text, text, text, timestamptz, text),
  public.ldo_support_gmail_claimed(text, text[]),
  public.ldo_support_gmail_confirm_sent(text, jsonb)
from public, authenticated;
grant execute on function
  public.ldo_support_gmail_save(text, text, text, text, text, timestamptz, text),
  public.ldo_support_gmail_claimed(text, text[]),
  public.ldo_support_gmail_confirm_sent(text, jsonb)
to anon;
