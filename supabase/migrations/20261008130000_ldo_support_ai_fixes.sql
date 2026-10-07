-- Assistente de IA: correções da revisão.
--
-- 1. Respostas anteriores: servem de exemplo de tom, nunca de fonte de dados de outro cliente. A
--    pesquisa ignora números, emails e @perfis (não pode procurar uma encomenda ou pessoa concreta) e
--    o texto devolvido sai sem emails, ligações, telefones, números de encomenda, códigos de
--    seguimento nem o nome da saudação.
-- 2. Orçamento: o custo de cada pedido é gravado à medida que a IA trabalha; um pedido interrompido
--    conta pelo que já gastou (no mínimo a reserva de US$ 0,25), em vez de deixar de contar.

-- Texto de outra conversa sem dados pessoais identificáveis (melhor esforço; nomes no meio do texto
-- podem ficar, por isso a IA é instruída a não os usar).
create function ldo_private.support_redact(p_text text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    coalesce(p_text, ''),
    '^(\s*(olá|ola|bom dia|boa tarde|boa noite|caro|cara|estimado|estimada|exmo\.?|exma\.?|sr\.?|sra\.?|dear|hello|hi|hola)\M)[^\n,!:]*', '\1 [nome]', 'i'),
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[email]', 'g'),
    '(https?://|www\.)[^[:space:]]+', '[ligação]', 'gi'),
    '\m[A-Z]{2}[0-9]{9}[A-Z]{2}\M', '[seguimento]', 'g'),
    '\+?[0-9][0-9 .-]{7,}[0-9]', '[número]', 'g'),
    '#?[0-9]{3,}', '[número]', 'g'),
    '@[[:alnum:]._]+', '[perfil]', 'g');
$$;

create or replace function public.ldo_support_ai_replies(p_token text, p_query text, p_exclude uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  -- Só palavras: sem emails, @perfis nem números (a pesquisa não pode visar uma encomenda ou pessoa).
  v_terms text := btrim(regexp_replace(regexp_replace(regexp_replace(left(coalesce(p_query, ''), 200),
    '[^[:space:]]*@[^[:space:]]*', ' ', 'g'), '[0-9]+', ' ', 'g'), '[^[:alpha:][:space:]-]+', ' ', 'g'));
  v_query tsquery;
begin
  perform ldo_private.bi_check(p_token);
  if v_terms = '' then
    return '[]'::jsonb;
  end if;
  v_query := websearch_to_tsquery('portuguese'::regconfig, array_to_string(regexp_split_to_array(v_terms, '\s+'), ' or '));
  if v_query is null or numnode(v_query) = 0 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('channel', r.channel, 'created_at', r.created_at,
      'reply', left(ldo_private.support_redact(r.body), 1200),
      'customer_message', (select left(ldo_private.support_redact(i.body), 300) from public.ldo_support_messages i
        where i.conversation_id = r.conversation_id and i.kind = 'inbound' and i.deleted_at is null and i.created_at <= r.created_at
        order by i.created_at desc limit 1)) order by r.rank desc, r.created_at desc)
    from (
      select m.conversation_id, m.body, m.created_at, c.channel,
        ts_rank(to_tsvector('portuguese'::regconfig, m.body), v_query) as rank
      from public.ldo_support_messages m join public.ldo_support_conversations c on c.id = m.conversation_id
      where m.kind = 'outbound' and m.deleted_at is null and m.conversation_id is distinct from p_exclude
        and coalesce(m.delivery, 'accepted') not in ('failed', 'sending', 'uncertain')
        and to_tsvector('portuguese'::regconfig, m.body) @@ v_query
      order by rank desc, m.created_at desc
      limit 6
    ) r), '[]'::jsonb);
end;
$$;

create or replace function ldo_private.support_ai_month_cost() returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when status = 'pending' then greatest(cost_usd, 0.25) else cost_usd end), 0)
  from public.ldo_support_ai_messages
  where created_at >= ldo_private.support_lisbon_start('month');
$$;

-- Custo e uso acumulados de um pedido em curso (o servidor grava depois de cada volta da IA).
create function public.ldo_support_ai_progress(p_token text, p_id uuid, p_cost numeric, p_usage jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_ai_messages
  set cost_usd = least(greatest(coalesce(p_cost, 0), cost_usd), 99999), usage = p_usage
  where id = p_id and status = 'pending';
end;
$$;

revoke all on function ldo_private.support_redact(text) from public, anon, authenticated;
revoke all on function public.ldo_support_ai_progress(text, uuid, numeric, jsonb) from public, authenticated;
grant execute on function public.ldo_support_ai_progress(text, uuid, numeric, jsonb) to anon;
