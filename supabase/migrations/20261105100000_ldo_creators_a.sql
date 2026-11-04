-- =====================================================================================================
-- Plataforma de criadores (criadores.lojadoouro.pt + área Influenciadores do dashboard) — fase 1 (migração A).
-- Acessos da equipa, contas próprias dos criadores (como o leilão: sessão própria, só o hash na BD), perfil,
-- contactos, lojas, redes declaradas («não verificado»), dados fiscais e IBAN cifrados, documentos legais
-- versionados, consentimentos append-only, mensagens, notas internas, fila de emails, auditoria, pedidos RGPD,
-- exportação, apagamento e limpeza por prazos.
--
-- Só funções security definer (search_path ''):
--   site     → p_token (CREATORS_SERVER_TOKEN; ldo_private.cr_server_check, NÃO o bi_check do leilão) + p_session do criador;
--   equipa   → p_session do dashboard; nível em ldo_app_users.creators_access (none/view/manage) e
--              creators_finance (IBAN completo e pagamentos);
--   servidor → p_token (fila de emails, tick).
-- Cifra na aplicação (AES-256-GCM, anel CREATORS_ENCRYPTION_KEY, AAD '<finalidade>:<id>', prefixo cN.): a BD guarda
-- só *_ct e, do IBAN, os 4 últimos caracteres. Nenhuma tabela tem privilégios para anon/authenticated.
-- Os valores de esquema da camada pública da Meta ('public' em verification e no índice, 'platform_public',
-- 'public_proof') entram já aqui, sem comportamento [rev. META-15].
-- Fonte: especificação final de 04-11-2026, §2.1 e §2.4 (as etiquetas [rev. …] remetem para o §11 dela).
-- =====================================================================================================

-- ---------------------------------------------------------------- 1. acessos da equipa

-- creators_access: none (não vê), view (consulta), manage (decide e altera). O Super Admin é sempre manage.
-- creators_finance: IBAN e dados fiscais completos e registo de pagamentos. NUNCA implícito, nem para o Super
-- Admin (atribui-o a si próprio; fica em ldo_app_audit).
alter table public.ldo_app_users
  add column creators_access text not null default 'none' check (creators_access in ('none', 'view', 'manage')),
  add column creators_finance boolean not null default false;

-- ---------------------------------------------------------------- 2. definições

create table public.ldo_cr_settings (
  id integer primary key check (id = 1),
  -- Identificação do responsável pelo tratamento (rodapé, Política, Termos); dados do advogado.
  company_name text not null default '' check (length(company_name) <= 200),
  company_nif text not null default '' check (company_nif = '' or company_nif ~ '^[0-9]{9}$'),
  company_address text not null default '' check (length(company_address) <= 400),
  company_registry text not null default '' check (length(company_registry) <= 200),
  contact_email text not null default 'criadores@lojadoouro.pt' check (length(contact_email) <= 254),
  privacy_email text not null default 'privacidade@lojadoouro.pt' check (length(privacy_email) <= 254),
  -- Inscrições fechadas até haver Termos e Política publicados E o Super Admin abrir (pré-lançamento).
  registrations_open boolean not null default false,
  session_days integer not null default 14 check (session_days between 1 and 30),
  -- [rev. S-A1] Antifraude: durante estas horas depois de o titular confirmar um IBAN novo, ldo_cr_finance_reveal só o
  -- revela com a confirmação por outro canal (p_oob_confirmed).
  iban_hold_hours integer not null default 72 check (iban_hold_hours between 0 and 336),
  -- Prazos de conservação (§7). Valores iniciais; o advogado valida.
  -- audit_decisions_years [rev. R-M3]: decisões sobre perfis, publicações legais, definições e respostas RGPD.
  -- proof_years [rev. R-M10]; licence_files_years_after_end, rejected_submissions_days, declared_metrics_months,
  -- evidence_months, requests_months, blob_deletions_days, meta_requests_years e meta_requests_id_days [rev. R-M11].
  retention jsonb not null default '{
    "unverified_days": 30, "attempts_days": 30, "inactive_warn_months": 22, "inactive_months": 24,
    "captions_months": 12, "platform_months": 24, "hourly_snapshots_days": 30, "ai_months": 12,
    "address_months": 12, "applications_months": 24, "messages_months": 24, "audit_months": 12,
    "audit_decisions_years": 5, "outbox_days": 90, "payments_years": 10, "consents_years_after_end": 5,
    "sync_log_days": 30, "privacy_requests_years": 5, "pending_files_hours": 24,
    "proof_years": 3, "licence_files_years_after_end": 3, "rejected_submissions_days": 90,
    "declared_metrics_months": 24, "evidence_months": 12, "requests_months": 24, "blob_deletions_days": 30,
    "meta_requests_years": 5, "meta_requests_id_days": 90
  }'::jsonb check (jsonb_typeof(retention) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id) on delete set null
);
insert into public.ldo_cr_settings (id) values (1);

-- ---------------------------------------------------------------- 3. contas (como ldo_auc_customers/logins/tokens/attempts)

create table public.ldo_cr_creators (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (length(email) <= 254 and email = lower(email)),
  email_verified_at timestamptz,
  password_hash text,
  password_changed_at timestamptz,
  -- draft: a preencher; pending_review: submetido; approved; rejected; suspended (entra, não age);
  -- restricted: limitação do tratamento (RGPD art. 18.º: congela sincronização, IA e candidaturas);
  -- deleted: anonimizado.
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'restricted', 'deleted')),
  status_reason text check (status_reason is null or length(status_reason) <= 1000),
  status_at timestamptz,
  status_by uuid references public.ldo_app_users (id) on delete set null,
  -- O perfil aprovado mudou (nome, redes, lojas): a equipa vê o aviso; não perde a aprovação.
  changed_since_review boolean not null default false,
  -- Minimização: só a declaração de maioridade, nunca a data de nascimento.
  adult_declared_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  inactivity_warned_at timestamptz,
  deleted_at timestamptz,
  delete_reason text check (delete_reason is null or delete_reason in ('self', 'inactivity', 'staff', 'unverified', 'minor'))   -- minor [rev. R-B3]
);
create index ldo_cr_creators_status_idx on public.ldo_cr_creators (status, created_at desc);

create table public.ldo_cr_logins (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  creator_id uuid not null references public.ldo_cr_creators (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);
create index ldo_cr_logins_creator_idx on public.ldo_cr_logins (creator_id) where revoked_at is null;

create table public.ldo_cr_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  creator_id uuid not null references public.ldo_cr_creators (id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset', 'iban_confirm')),     -- iban_confirm [rev. S-A1]
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index ldo_cr_tokens_creator_idx on public.ldo_cr_tokens (creator_id, kind);

create table public.ldo_cr_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('login_fail', 'register', 'reset', 'reauth_fail', 'upload', 'request', 'message', 'export', 'iban_resend', 'public_proof')),   -- iban_resend [rev. S-A1]; public_proof: validações e provas da camada pública, 5 por dia (C1) [rev. META-3]
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  creator_id uuid references public.ldo_cr_creators (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index ldo_cr_attempts_idx on public.ldo_cr_attempts (kind, created_at);

-- ---------------------------------------------------------------- 4. perfil, contactos, lojas, redes declaradas

create table public.ldo_cr_profiles (
  creator_id uuid primary key references public.ldo_cr_creators (id) on delete cascade,
  -- nome civil; [rev. S-B3] sem algarismos nem caracteres de URL e email, e sem ponto colado a letras («exemplo.pt»)
  full_name text check (full_name is null or (length(btrim(full_name)) between 1 and 120
    and full_name !~ '[0-9@/:<>_=?&#%+|{}"]' and full_name !~ '\.[^[:space:]]')),
  display_name text check (display_name is null or length(btrim(display_name)) between 1 and 80), -- nome artístico
  city text check (city is null or length(city) <= 100),
  district text check (district is null or length(district) <= 60),
  country text not null default 'PT' check (country ~ '^[A-Z]{2}$'),
  bio text check (bio is null or length(bio) <= 1500),
  -- Listas fechadas em lib/criadores-rules.ts (CATEGORIES, FORMATS, LANGUAGES); a BD só limita o tamanho.
  categories text[] not null default '{}' check (cardinality(categories) <= 12),
  formats text[] not null default '{}' check (cardinality(formats) <= 10),
  languages text[] not null default '{pt}' check (cardinality(languages) between 1 and 6),
  travel_radius_km integer check (travel_radius_km is null or travel_radius_km between 0 and 500),
  portfolio_url text check (portfolio_url is null or (portfolio_url ~ '^https://[^\s]+$' and length(portfolio_url) <= 300)),
  avatar_file_id uuid,                -- FK para ldo_cr_files na migração B
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.ldo_cr_contacts (
  creator_id uuid primary key references public.ldo_cr_creators (id) on delete cascade,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  whatsapp boolean not null default false,
  preferred text not null default 'email' check (preferred in ('email', 'telefone', 'whatsapp')),
  updated_at timestamptz not null default now()
);

create table public.ldo_cr_creator_stores (
  creator_id uuid not null references public.ldo_cr_creators (id) on delete cascade,
  store_id uuid not null references public.ldo_app_stores (id) on delete cascade,
  primary key (creator_id, store_id)
);

-- Uma conta por rede e por criador. verified: ligação da camada ligada (migração C2). public: camada pública com a
-- posse provada (código na biografia ou ligação; migração C1). O criador não muda o handle nem a plataforma de uma
-- conta verified; numa public, mudar o @ volta a declared (corrige o defeito do protótipo) [rev. META-3]. Os dois
-- valores entram já no PR1, sem comportamento, para o check e o índice não mudarem depois [rev. META-15].
create table public.ldo_cr_social_accounts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.ldo_cr_creators (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube', 'facebook', 'pinterest', 'outra')),
  handle text not null check (handle ~ '^[A-Za-z0-9._-]{1,60}$'),
  profile_url text check (profile_url is null or (profile_url ~ '^https://[^\s]+$' and length(profile_url) <= 300)),
  verification text not null default 'declared' check (verification in ('declared', 'public', 'verified', 'revoked')),
  connection_id uuid,                 -- FK para ldo_cr_connections na migração C2
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, platform)
);
-- Duas pessoas podem DECLARAR o mesmo @ (a equipa vê o aviso); só uma o pode ter com a posse provada.
create unique index ldo_cr_social_verified_uniq on public.ldo_cr_social_accounts (platform, lower(handle))
  where verification in ('public', 'verified');
create index ldo_cr_social_handle_idx on public.ldo_cr_social_accounts (platform, lower(handle));

-- Números declarados («não verificado»). Um registo por conta e por dia (reenviar não acumula).
-- validated_*: a equipa confirmou com capturas das estatísticas (fonte «validada»; conta nas sugestões).
create table public.ldo_cr_declared_metrics (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.ldo_cr_social_accounts (id) on delete cascade,
  declared_on date not null default ((now() at time zone 'Europe/Lisbon')::date),
  followers integer check (followers is null or followers between 0 and 1000000000),
  avg_views integer check (avg_views is null or avg_views >= 0),
  avg_likes integer check (avg_likes is null or avg_likes >= 0),
  avg_comments integer check (avg_comments is null or avg_comments >= 0),
  pt_audience_pct numeric(5,2) check (pt_audience_pct is null or pt_audience_pct between 0 and 100),
  -- [rev. R-M2] Interação média declarada (% dos seguidores), validável com captura como os restantes: sem isto,
  -- min_engagement só se cumpria com a API e o consentimento para ligar o Instagram deixava de ser livre.
  engagement_pct numeric(5,2) check (engagement_pct is null or engagement_pct between 0 and 100),
  evidence_file_id uuid,              -- FK para ldo_cr_files na migração B (captura das estatísticas)
  validated_by uuid references public.ldo_app_users (id) on delete set null,
  validated_at timestamptz,
  unique (account_id, declared_on)
);

-- ---------------------------------------------------------------- 5. dados fiscais e IBAN (cifrados)

-- Sem grants e sem nenhuma função que devolva iban_ct à equipa exceto ldo_cr_finance_reveal (finanças, auditada).
-- fiscal_ct = seal(JSON {fiscal_name, nif, fiscal_address, tax_country, vat_regime: 'art53'|'normal'|'outro',
--                        withholding_waiver: bool, activity_code}, 'fiscal:<creator>')
-- iban_ct   = seal(JSON {iban, holder}, 'iban:<creator>')
-- [rev. S-A1] Um IBAN novo (também o primeiro) fica em iban_pending_* até o titular o confirmar pela ligação
-- iban_confirm enviada para o email da conta. Só o confirmado é revelado e usado em pagamentos.
-- iban_holder_mismatch: a aplicação comparou o titular com o nome fiscal (normalizados) e são diferentes.
create table public.ldo_cr_finance (
  creator_id uuid primary key references public.ldo_cr_creators (id) on delete cascade,
  fiscal_ct text check (fiscal_ct is null or (fiscal_ct ~ '^c[0-9]+\.' and length(fiscal_ct) <= 4000)),
  fiscal_complete boolean not null default false,       -- validado pela aplicação antes de cifrar
  iban_ct text check (iban_ct is null or (iban_ct ~ '^c[0-9]+\.' and length(iban_ct) <= 2000)),
  iban_last4 text check (iban_last4 is null or iban_last4 ~ '^[0-9A-Z]{4}$'),
  iban_country text check (iban_country is null or iban_country ~ '^[A-Z]{2}$'),
  iban_holder_mismatch boolean not null default false,
  iban_changed_at timestamptz,
  iban_hold_until timestamptz,
  iban_pending_ct text check (iban_pending_ct is null or (iban_pending_ct ~ '^c[0-9]+\.' and length(iban_pending_ct) <= 2000)),
  iban_pending_last4 text check (iban_pending_last4 is null or iban_pending_last4 ~ '^[0-9A-Z]{4}$'),
  iban_pending_country text check (iban_pending_country is null or iban_pending_country ~ '^[A-Z]{2}$'),
  iban_pending_holder_mismatch boolean not null default false,
  iban_pending_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((iban_ct is null) = (iban_last4 is null)),
  check ((iban_pending_ct is null) = (iban_pending_last4 is null) and (iban_pending_ct is null) = (iban_pending_at is null))
);

-- ---------------------------------------------------------------- 6. documentos legais e consentimentos

create table public.ldo_cr_legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms', 'privacy', 'cookies', 'meta_data', 'campaign_conditions')),
  version text not null check (version ~ '^[0-9]{1,3}\.[0-9]{1,3}$'),
  campaign_id uuid,                   -- só campaign_conditions; FK na migração B
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null default '' check (length(body) <= 200000),   -- Markdown simples (render próprio, escapado)
  changes_summary text not null default '' check (length(changes_summary) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  -- Alteração substancial dos Termos: os criadores têm de aceitar de novo (bloqueia ações até aceitarem). Só em 'terms':
  -- a Política é informação e não se aceita [rev. R-M6].
  requires_reacceptance boolean not null default false,
  published_at timestamptz,
  published_by uuid references public.ldo_app_users (id) on delete set null,
  created_by uuid references public.ldo_app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (kind, version, campaign_id),
  check (kind = 'terms' or not requires_reacceptance),   -- [rev. R-M6]
  check ((kind = 'campaign_conditions') = (campaign_id is not null))
);
create unique index ldo_cr_legal_one_published on public.ldo_cr_legal_documents (kind)
  where status = 'published' and campaign_id is null;

-- Consentimentos e declarações: só se acrescenta (trigger). Revogar = nova linha com granted = false.
-- context = {} nas finalidades gerais; {"application_id"}, {"request_id"}, {"submission_id"} nas pontuais.
-- A origem de uma revogação (Meta, sistema) vai no text_shown, nunca no context: cr_consent_state só lê context = {}
-- [rev. R-M5].
-- text_shown = texto exato da caixa (lib/criadores-rules.ts CONSENT_TEXT), para prova.
create table public.ldo_cr_consents (
  id bigint generated always as identity primary key,
  creator_id uuid not null references public.ldo_cr_creators (id) on delete restrict,
  purpose text not null check (purpose in (
    'terms', 'privacy_notice', 'adult', 'marketing', 'campaign_news', 'data_truth', 'platform_instagram', 'platform_public', 'ai_analysis',
    'ad_disclosure', 'product_disclosure', 'address_use', 'campaign_conditions', 'paid_ads', 'partnership_ads',
    'image_voice', 'iban_owner', 'vat_exempt', 'withholding_waiver', 'content_declaration')),
  granted boolean not null,
  document_id uuid references public.ldo_cr_legal_documents (id) on delete restrict,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  text_shown text not null check (length(text_shown) between 1 and 2000),
  text_hash text generated always as (encode(extensions.digest(text_shown, 'sha256'), 'hex')) stored,   -- [rev. R-B1] versão do texto
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index ldo_cr_consents_creator_idx on public.ldo_cr_consents (creator_id, purpose, id desc);

-- ---------------------------------------------------------------- 7. mensagens, notas, emails, auditoria, RGPD

-- Conversa única por criador, com referência opcional (campanha, candidatura, pedido, entrega, pagamento).
create table public.ldo_cr_messages (
  id bigint generated always as identity primary key,
  creator_id uuid not null references public.ldo_cr_creators (id) on delete cascade,
  ref_kind text not null default 'geral' check (ref_kind in ('geral', 'campanha', 'candidatura', 'pedido', 'entrega', 'pagamento')),
  ref_id uuid,
  author_kind text not null check (author_kind in ('creator', 'staff', 'system')),
  author_staff uuid references public.ldo_app_users (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_by_creator_at timestamptz,
  read_by_staff_at timestamptz
);
create index ldo_cr_messages_creator_idx on public.ldo_cr_messages (creator_id, id desc);
create index ldo_cr_messages_unread_staff_idx on public.ldo_cr_messages (created_at)
  where author_kind = 'creator' and read_by_staff_at is null;

-- Notas internas (o titular tem-lhes acesso pelo direito de acesso; a página avisa a equipa).
create table public.ldo_cr_notes (
  id bigint generated always as identity primary key,
  creator_id uuid not null references public.ldo_cr_creators (id) on delete cascade,
  author uuid not null references public.ldo_app_users (id),
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index ldo_cr_notes_creator_idx on public.ldo_cr_notes (creator_id, id desc);

-- Fila de emails (como ldo_auc_outbox). kind livre: os textos estão em lib/criadores-rules.ts e um kind
-- desconhecido falha com registo.
create table public.ldo_cr_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  creator_id uuid not null references public.ldo_cr_creators (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  due_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  lease_until timestamptz,
  detail text,
  created_at timestamptz not null default now()
);
create index ldo_cr_outbox_due_idx on public.ldo_cr_outbox (due_at) where sent_at is null;
create index ldo_cr_outbox_creator_idx on public.ldo_cr_outbox (creator_id, id desc);

-- ldo_app_audit exige ator da equipa; aqui o ator pode ser criador, sistema ou Meta.
-- Só de acrescento [rev. R-M3]: trigger ldo_cr_audit_append_only (secção 9). As decisões sobre perfis só existem
-- aqui (status_reason é sobrescrito), por isso ficam audit_decisions_years (cr_retention).
-- Minimização [rev. R-A1]: details nunca leva dados obtidos da Meta (username, números); só ids e motivos.
create table public.ldo_cr_audit (
  id bigint generated always as identity primary key,
  actor_kind text not null check (actor_kind in ('staff', 'creator', 'system', 'meta')),
  staff_id uuid references public.ldo_app_users (id) on delete set null,
  creator_id uuid references public.ldo_cr_creators (id) on delete set null,   -- titular dos dados
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$' and length(action) <= 80),
  target uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ldo_cr_audit_creator_idx on public.ldo_cr_audit (creator_id, id desc);
create index ldo_cr_audit_created_idx on public.ldo_cr_audit (created_at);
create index ldo_cr_audit_action_idx on public.ldo_cr_audit (action, created_at);

-- Pedidos dos titulares (art. 5.º, n.º 2: responsabilização). Os de self-service ficam logo como done.
create table public.ldo_cr_privacy_requests (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.ldo_cr_creators (id) on delete set null,
  kind text not null check (kind in ('access', 'portability', 'rectification', 'erasure', 'objection', 'restriction',
    'human_review', 'withdrawal', 'other')),
  channel text not null check (channel in ('self_service', 'email', 'meta_callback', 'staff')),
  status text not null default 'open' check (status in ('open', 'done', 'refused')),
  received_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '1 month'),
  details text not null default '' check (length(details) <= 4000),
  response text not null default '' check (length(response) <= 4000),
  -- [rev. R-B2] Pedidos recebidos fora do site (também de terceiros), identidade e prorrogação (art. 12.º, n.os 3 e 6).
  requester text not null default '' check (length(requester) <= 300),     -- nome e contacto de um terceiro
  identity_checked boolean not null default false,
  extended_until timestamptz,
  extension_reason text check (extension_reason is null or length(extension_reason) <= 1000),
  check (extended_until is null or (extension_reason is not null and extended_until <= received_at + interval '3 months')),
  handled_by uuid references public.ldo_app_users (id) on delete set null,
  handled_at timestamptz
);
create index ldo_cr_privacy_open_idx on public.ldo_cr_privacy_requests ((coalesce(extended_until, due_at))) where status = 'open';
create index ldo_cr_privacy_creator_idx on public.ldo_cr_privacy_requests (creator_id, kind, status);

-- ---------------------------------------------------------------- 8. RLS e privilégios (no mesmo ficheiro)

alter table public.ldo_cr_settings enable row level security;
alter table public.ldo_cr_creators enable row level security;
alter table public.ldo_cr_logins enable row level security;
alter table public.ldo_cr_tokens enable row level security;
alter table public.ldo_cr_attempts enable row level security;
alter table public.ldo_cr_profiles enable row level security;
alter table public.ldo_cr_contacts enable row level security;
alter table public.ldo_cr_creator_stores enable row level security;
alter table public.ldo_cr_social_accounts enable row level security;
alter table public.ldo_cr_declared_metrics enable row level security;
alter table public.ldo_cr_finance enable row level security;
alter table public.ldo_cr_legal_documents enable row level security;
alter table public.ldo_cr_consents enable row level security;
alter table public.ldo_cr_messages enable row level security;
alter table public.ldo_cr_notes enable row level security;
alter table public.ldo_cr_outbox enable row level security;
alter table public.ldo_cr_audit enable row level security;
alter table public.ldo_cr_privacy_requests enable row level security;
revoke all on public.ldo_cr_settings, public.ldo_cr_creators, public.ldo_cr_logins, public.ldo_cr_tokens,
  public.ldo_cr_attempts, public.ldo_cr_profiles, public.ldo_cr_contacts, public.ldo_cr_creator_stores,
  public.ldo_cr_social_accounts, public.ldo_cr_declared_metrics, public.ldo_cr_finance, public.ldo_cr_legal_documents,
  public.ldo_cr_consents, public.ldo_cr_messages, public.ldo_cr_notes, public.ldo_cr_outbox, public.ldo_cr_audit,
  public.ldo_cr_privacy_requests
  from anon, authenticated;

-- ---------------------------------------------------------------- 9. auxiliares (ldo_private)

-- [rev. S-M3] Token de servidor PRÓPRIO da plataforma de criadores (CREATORS_SERVER_TOKEN), não o BI_INGEST_TOKEN.
-- Só o hash. Depois do merge, uma vez, com autorização do dono, colando só o SHA-256 calculado localmente
-- (o token em claro nunca passa pelo SQL nem pelos registos do Supabase):
--   insert into ldo_private.cr_token values (1, decode('<sha256 hex do CREATORS_SERVER_TOKEN>', 'hex'));
-- Enquanto a linha não existir, todas as funções de site e de servidor recusam (falha fechada).
-- RLS ligado sem políticas, como ldo_private.bi_token e report_token (20261104113406): só as funções do dono a leem.
create table ldo_private.cr_token (id integer primary key check (id = 1), token_hash bytea not null);
alter table ldo_private.cr_token enable row level security;
revoke all on ldo_private.cr_token from public, anon, authenticated;

create function ldo_private.cr_server_check(p_token text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from ldo_private.cr_token where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
end;
$$;

-- Nível da equipa: 'none' | 'view' | 'manage' (Super Admin = manage); null sem sessão válida.
create function ldo_private.cr_level(p_session text) returns text
language sql stable security definer set search_path = '' as $$
  select case when u.is_super_admin then 'manage' else u.creators_access end
  from public.ldo_app_users u where u.id = ldo_private.session_user_id(p_session) and u.active;
$$;

create function ldo_private.cr_require(p_session text, p_level text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid := ldo_private.session_user_id(p_session);
  v_level text := ldo_private.cr_level(p_session);
begin
  if v_id is null or coalesce(v_level, 'none') = 'none' then
    raise exception 'Sem acesso à área Influenciadores.' using errcode = '42501';
  end if;
  if p_level = 'manage' and v_level <> 'manage' then
    raise exception 'Só pode consultar: peça o acesso «Gerir» ao Super Admin.' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

-- Finanças: marca explícita + acesso à área (o Super Admin tem a área por inerência).
create function ldo_private.cr_finance(p_session text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session) and u.active and u.creators_finance
    and (u.is_super_admin or u.creators_access <> 'none');
$$;

-- Criador da sessão do site: sessão válida, email confirmado, conta não apagada, sessão posterior à última
-- mudança de palavra-passe.
create function ldo_private.cr_creator(p_session text) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.ldo_cr_logins s join public.ldo_cr_creators c on c.id = s.creator_id
  where s.token_hash = extensions.digest(coalesce(p_session, ''), 'sha256') and s.revoked_at is null
    and s.expires_at > now() and c.deleted_at is null and c.email_verified_at is not null
    and s.created_at >= coalesce(c.password_changed_at, '-infinity'::timestamptz);
$$;

-- Termos cuja versão publicada exige nova aceitação e que este criador ainda não aceitou. A Política não entra: é
-- informação (art. 13.º) e avisa-se sem bloquear (cr_privacy_pending) [rev. R-M6].
create function ldo_private.cr_reaccept(p_creator uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(d.kind), '[]'::jsonb)
  from public.ldo_cr_legal_documents d
  where d.status = 'published' and d.campaign_id is null and d.requires_reacceptance and d.kind = 'terms'
    and not exists (select 1 from public.ldo_cr_consents c where c.creator_id = p_creator and c.document_id = d.id and c.granted);
$$;

-- [rev. R-M6] Política publicada de que este criador ainda não tomou conhecimento (aviso que não bloqueia nada).
create function ldo_private.cr_privacy_pending(p_creator uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'version', d.version, 'changes_summary', d.changes_summary)
  from public.ldo_cr_legal_documents d
  where d.kind = 'privacy' and d.status = 'published' and d.campaign_id is null
    and not exists (select 1 from public.ldo_cr_consents c where c.creator_id = p_creator
                    and c.purpose = 'privacy_notice' and c.document_id = d.id);
$$;

-- Criador ou erro. p_act: ação que cria obrigações (candidatar, pedir, entregar). Não é possível em suspended nem
-- em restricted, nem com Termos por voltar a aceitar.
create function ldo_private.cr_creator_require(p_session text, p_act boolean) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid := ldo_private.cr_creator(p_session);
  v_status text;
begin
  if v_id is null then
    raise exception 'A sua sessão terminou. Entre de novo.' using errcode = '42501';
  end if;
  if p_act then
    select status into v_status from public.ldo_cr_creators where id = v_id;
    if v_status = 'suspended' then
      raise exception 'A sua conta está suspensa. Fale connosco em Mensagens.' using errcode = '42501';
    elsif v_status = 'restricted' then
      raise exception 'Pediu a limitação do tratamento dos seus dados: enquanto durar, não é possível fazer isto.' using errcode = '42501';
    elsif jsonb_array_length(ldo_private.cr_reaccept(v_id)) > 0 then
      raise exception 'Atualizámos os Termos. Leia e aceite a nova versão para continuar.' using errcode = '42501';
    end if;
  end if;
  return v_id;
end;
$$;

create function ldo_private.cr_hash(p text) returns text
language sql immutable set search_path = '' as $$ select encode(extensions.digest(lower(btrim(coalesce(p, ''))), 'sha256'), 'hex'); $$;

-- Hash do IP como veio da aplicação (HMAC próprio, ipHash() em lib/criadores/site.ts) ou null se não tiver o formato:
-- um valor fora do formato não faz falhar o check de ldo_cr_attempts/ldo_cr_consents (correção própria).
create function ldo_private.cr_ip(p text) returns text
language sql immutable set search_path = '' as $$ select case when p ~ '^[0-9a-f]{64}$' then p end; $$;

-- 10 a 128 caracteres, letras e números (igual ao leilão). A verificação contra palavras-passe expostas
-- (HIBP, k-anonimato, 5 primeiros hex do SHA-1) faz-se na aplicação antes de chamar a BD; se falhar, deixa passar.
create function ldo_private.cr_check_password(p text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or length(p) < 10 or length(p) > 128 or p !~ '[A-Za-zÀ-ÿ]' or p !~ '[0-9]' then
    raise exception 'A palavra-passe tem de ter pelo menos 10 caracteres, com letras e números.' using errcode = '22023';
  end if;
end;
$$;

create function ldo_private.cr_new_token(p_creator uuid, p_kind text, p_hours integer) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  update public.ldo_cr_tokens set used_at = now() where creator_id = p_creator and kind = p_kind and used_at is null;
  insert into public.ldo_cr_tokens (token_hash, creator_id, kind, expires_at)
  values (extensions.digest(v, 'sha256'), p_creator, p_kind, now() + make_interval(hours => p_hours));
  return v;
end;
$$;

create function ldo_private.cr_log(p_actor_kind text, p_staff uuid, p_creator uuid, p_action text, p_target uuid, p_details jsonb)
returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.ldo_cr_audit (actor_kind, staff_id, creator_id, action, target, details)
  values (p_actor_kind, p_staff, p_creator, p_action, p_target, coalesce(p_details, '{}'::jsonb));
$$;

create function ldo_private.cr_outbox(p_creator uuid, p_kind text, p_payload jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.ldo_cr_outbox (kind, creator_id, payload) values (p_kind, p_creator, coalesce(p_payload, '{}'::jsonb));
$$;

-- [rev. S-M2] Limites da entrada (também na confirmação do email, que conta as falhas como login_fail):
-- 'ip' = 5 falhas por email e ligação em 15 min ou 30 por ligação numa hora (os do leilão);
-- 'account' = 20 falhas numa hora para o mesmo email, venham de onde vierem. null = pode tentar.
create function ldo_private.cr_login_locked(p_email_hash text, p_ip_hash text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when (select count(*) from public.ldo_cr_attempts where kind = 'login_fail' and email_hash = p_email_hash
            and ip_hash = p_ip_hash and created_at > now() - interval '15 minutes') >= 5
      or (select count(*) from public.ldo_cr_attempts where kind = 'login_fail' and ip_hash = p_ip_hash
            and created_at > now() - interval '1 hour') >= 30 then 'ip'
    when (select count(*) from public.ldo_cr_attempts where kind = 'login_fail' and email_hash = p_email_hash
            and created_at > now() - interval '1 hour') >= 20 then 'account'
  end;
$$;

-- [rev. S-M2] Aviso 'login_locked' ao titular, no máximo uma vez por hora.
create function ldo_private.cr_lock_notice(p_creator uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.ldo_cr_outbox (kind, creator_id, payload)
  select 'login_locked', p_creator, '{}'::jsonb
  where p_creator is not null
    and exists (select 1 from public.ldo_cr_creators where id = p_creator and deleted_at is null)
    and not exists (select 1 from public.ldo_cr_outbox where creator_id = p_creator and kind = 'login_locked'
                    and created_at > now() - interval '1 hour');
$$;

-- [rev. S-B4] Posse de um id recebido do browser. Toda a função de site que recebe o uuid de um objeto do criador
-- chama isto antes de o usar (teste estático em tests/criadores-sql.cjs). «Não existe» e «é de outra pessoa» dão o
-- mesmo erro, para não revelar ids. A migração B junta ficheiros, candidaturas, pedidos, entregas, pagamentos e
-- campanhas (create or replace).
create function ldo_private.cr_own(p_creator uuid, p_kind text, p_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_id is null or not (case p_kind
      when 'social_account' then exists (select 1 from public.ldo_cr_social_accounts where id = p_id and creator_id = p_creator)
      else false end) then
    raise exception 'Não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

-- Documento publicado (geral) de um tipo.
create function ldo_private.cr_doc(p_kind text) returns public.ldo_cr_legal_documents
language sql stable security definer set search_path = '' as $$
  select * from public.ldo_cr_legal_documents where kind = p_kind and status = 'published' and campaign_id is null;
$$;

-- [rev. R-B1] O texto é obrigatório e vem SEMPRE de CONSENT_TEXT no servidor (a server action monta p_texts; o
-- formulário só diz que caixas foram marcadas). Sem texto, falha: um registo sem o texto mostrado não prova nada.
create function ldo_private.cr_consent(p_creator uuid, p_purpose text, p_granted boolean, p_doc uuid, p_context jsonb,
  p_text text, p_ip_hash text) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  if coalesce(btrim(p_text), '') = '' then
    raise exception 'Falta o texto do consentimento (%).', p_purpose using errcode = '22023';
  end if;
  insert into public.ldo_cr_consents (creator_id, purpose, granted, document_id, context, text_shown, ip_hash)
  values (p_creator, p_purpose, p_granted, p_doc, coalesce(p_context, '{}'::jsonb), left(btrim(p_text), 2000),
    case when p_ip_hash ~ '^[0-9a-f]{64}$' then p_ip_hash end)
  returning id into v_id;
  return v_id;
end;
$$;

-- Estado atual das finalidades gerais (o último registo de cada uma, sem contexto).
create function ldo_private.cr_consent_state(p_creator uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(purpose, jsonb_build_object('granted', granted, 'at', created_at, 'document_id', document_id)), '{}'::jsonb)
  from (select distinct on (purpose) purpose, granted, created_at, document_id from public.ldo_cr_consents
        where creator_id = p_creator and context = '{}'::jsonb order by purpose, id desc) s;
$$;

-- Registo só de acrescento. Exceções, todas estreitas:
--   1) DELETE pela limpeza de prazos (cr_retention), com ldo.cr_retention = on posto por ela na transação;
--   2) UPDATE que só põe a null as chaves estrangeiras creator_id/staff_id/reviewer: é o «on delete set null» das
--      FK, que é um UPDATE e dispara este trigger (correção própria: sem isto, apagar um utilizador da equipa ou um
--      criador falhava em ldo_cr_audit, ldo_cr_application_events e ldo_cr_submission_reviews). Só vale dentro da
--      ação referencial: o UPDATE do RI_FKey_setnull corre dentro do trigger da FK (pg_trigger_depth() = 2); um
--      UPDATE manual ou de uma função corre com profundidade 1 e é recusado;
--   3) [rev. R-A1] UPDATE só da coluna suggestion de ldo_cr_application_events, com ldo.cr_purge = on, posto por
--      cr_purge_platform, para tirar os dados derivados da Meta quando a ligação é desligada ou apagada.
-- TRUNCATE é sempre recusado (trigger por instrução, ldo_cr_*_no_truncate).
create function ldo_private.cr_append_only() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_fk text[] := array['creator_id', 'staff_id', 'reviewer'];
begin
  if tg_op = 'TRUNCATE' then
    null;  -- nunca: cai no raise
  elsif tg_op = 'DELETE' then
    if current_setting('ldo.cr_retention', true) = 'on' then
      return old;
    end if;
  else
    if pg_trigger_depth() > 1 and (to_jsonb(new) - v_fk) = (to_jsonb(old) - v_fk) and not exists (
         select 1 from unnest(v_fk) k
         where to_jsonb(new) -> k is distinct from to_jsonb(old) -> k and to_jsonb(new) -> k <> 'null'::jsonb) then
      return new;
    end if;
    if tg_table_name = 'ldo_cr_application_events' and current_setting('ldo.cr_purge', true) = 'on'
       and (to_jsonb(new) - 'suggestion') = (to_jsonb(old) - 'suggestion') then
      return new;
    end if;
  end if;
  raise exception 'Registo só de acrescento (%): não pode ser alterado nem apagado.', tg_table_name using errcode = '42501';
end;
$$;
create trigger ldo_cr_consents_append_only before update or delete on public.ldo_cr_consents
  for each row execute function ldo_private.cr_append_only();
-- [rev. R-M3] A auditoria passa a ser só de acrescento (prova das decisões humanas, art. 5.º, n.º 2).
create trigger ldo_cr_audit_append_only before update or delete on public.ldo_cr_audit
  for each row execute function ldo_private.cr_append_only();
-- Os triggers por linha não apanham TRUNCATE: um trigger por instrução em cada tabela de prova.
create trigger ldo_cr_consents_no_truncate before truncate on public.ldo_cr_consents
  for each statement execute function ldo_private.cr_append_only();
create trigger ldo_cr_audit_no_truncate before truncate on public.ldo_cr_audit
  for each statement execute function ldo_private.cr_append_only();

-- Um documento publicado não muda (só passa a retired); um rascunho pode ser apagado.
create function ldo_private.cr_legal_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Só um rascunho pode ser apagado.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (new.kind, new.version, new.title, new.body, new.campaign_id)
     is distinct from (old.kind, old.version, old.title, old.body, old.campaign_id) then
    raise exception 'Um documento publicado não muda: crie uma versão nova.' using errcode = '42501';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'Um documento retirado não volta a ser publicado.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger ldo_cr_legal_guard before update or delete on public.ldo_cr_legal_documents
  for each row execute function ldo_private.cr_legal_guard();

-- Anonimização (apagamento a pedido, inatividade, equipa, conta por confirmar). As migrações B e C fazem
-- «create or replace» para juntar candidaturas, pedidos, ficheiros, ligações e dados Meta. Os consentimentos ficam
-- (prova; prazo próprio no §7), salvo nas contas nunca confirmadas [rev. R-M11].
create function ldo_private.cr_anonymize(p_creator uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.ldo_cr_creators set email = 'apagado-' || id || '@apagado.invalid', password_hash = null, status = 'deleted',
    status_reason = null, changed_since_review = false, deleted_at = now(), delete_reason = p_reason
  where id = p_creator and deleted_at is null;
  update public.ldo_cr_logins set revoked_at = now() where creator_id = p_creator and revoked_at is null;
  delete from public.ldo_cr_tokens where creator_id = p_creator;
  delete from public.ldo_cr_profiles where creator_id = p_creator;
  delete from public.ldo_cr_contacts where creator_id = p_creator;
  delete from public.ldo_cr_creator_stores where creator_id = p_creator;
  delete from public.ldo_cr_social_accounts where creator_id = p_creator;   -- e as métricas declaradas (cascade)
  delete from public.ldo_cr_finance where creator_id = p_creator;           -- o fiscal necessário fica em payments.payee_ct
  delete from public.ldo_cr_messages where creator_id = p_creator;
  delete from public.ldo_cr_notes where creator_id = p_creator;
  delete from public.ldo_cr_outbox where creator_id = p_creator and sent_at is null;
  -- [rev. R-M11] Conta nunca confirmada: os consentimentos não provam nenhuma relação (e podem ter sido dados por
  -- outra pessoa, S-M1). Só corre dentro de cr_retention, que liga ldo.cr_retention (o trigger deixa apagar).
  if p_reason = 'unverified' then
    delete from public.ldo_cr_consents where creator_id = p_creator;
  end if;
  perform ldo_private.cr_log('system', null, p_creator, 'creator.anonymized', p_creator, jsonb_build_object('reason', p_reason));
end;
$$;

-- O que impede apagar a conta: devolve o motivo, ou null. Migração A: nada. Migração B (create or replace):
-- candidaturas accepted, pedidos approved/address_confirmed/shipped e pagamentos scheduled → «Tem uma colaboração a
-- decorrer: fale connosco em Mensagens para a concluir ou cancelar.» [rev. R-M7: sem raise, para o pedido ficar]
create function ldo_private.cr_delete_blocker(p_creator uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  return null;
end;
$$;

-- Invólucro com erro, para a limpeza (inatividade) e para ldo_cr_admin_delete.
create function ldo_private.cr_delete_blockers(p_creator uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v text := ldo_private.cr_delete_blocker(p_creator);
begin
  if v is not null then
    raise exception '%', v using errcode = '22023';
  end if;
end;
$$;

-- [rev. R-M7] Apagamento pedido com uma colaboração a decorrer: apaga já o que só existe por consentimento e não
-- serve a colaboração (art. 17.º, n.º 1, al. b)). Migração C1 (create or replace): + purga da camada pública e
-- platform_public = false. Migração C2: + purga da ligação Meta e platform_instagram = false; delete de
-- ldo_cr_ai_analyses e ai_analysis = false.
create function ldo_private.cr_erase_optional(p_creator uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if coalesce((ldo_private.cr_consent_state(p_creator) -> 'campaign_news' ->> 'granted')::boolean, false) then
    perform ldo_private.cr_consent(p_creator, 'campaign_news', false, null, null,
      'Retirado ao pedir o apagamento da conta (colaboração a decorrer).', null);
  end if;
end;
$$;

-- Passos do onboarding (o mesmo critério para ldo_cr_me, ldo_cr_profile_get e ldo_cr_profile_submit, e o de
-- onboardingSteps em lib/criadores-rules.ts):
--   about    → nome civil (válido pelo check da tabela), cidade, país e pelo menos um idioma (o nome artístico é opcional);
--   contacts → telemóvel (E.164, pelo check da tabela);
--   content  → pelo menos uma categoria e um formato (as lojas e o raio são opcionais);
--   networks → pelo menos uma conta declarada.
create function ldo_private.cr_steps(p_creator uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('about', s.about, 'contacts', s.contacts, 'content', s.content, 'networks', s.networks,
    'complete', s.about and s.contacts and s.content and s.networks)
  from (select
    coalesce((select p.full_name is not null and coalesce(btrim(p.city), '') <> '' and p.country is not null
              and cardinality(p.languages) >= 1
              from public.ldo_cr_profiles p where p.creator_id = p_creator), false) as about,
    coalesce((select k.phone is not null
              from public.ldo_cr_contacts k where k.creator_id = p_creator), false) as contacts,
    coalesce((select cardinality(p.categories) >= 1 and cardinality(p.formats) >= 1
              from public.ldo_cr_profiles p where p.creator_id = p_creator), false) as content,
    exists (select 1 from public.ldo_cr_social_accounts a where a.creator_id = p_creator) as networks) s;
$$;

-- Lista fechada recebida da aplicação (categorias, formatos, idiomas): a BD confirma só o formato e o tamanho.
create function ldo_private.cr_list(p_value jsonb, p_label text, p_max integer) returns text[]
language plpgsql immutable set search_path = '' as $$
declare v text[];
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return '{}'::text[];
  end if;
  if jsonb_typeof(p_value) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string' or e #>> '{}' !~ '^[a-z0-9_-]{1,40}$') then
    raise exception 'Escolha % da lista.', p_label using errcode = '22023';
  end if;
  v := array(select distinct e from jsonb_array_elements_text(p_value) e order by e);
  if cardinality(v) > p_max then
    raise exception 'Escolha no máximo % %.', p_max, p_label using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Conta social declarada pelo criador (cria ou edita) e os números do dia. Usada por ldo_cr_social_save e pelo passo
-- «networks» de ldo_cr_profile_save. [rev. S-B4] Um id recebido passa por cr_own. Uma conta verified não muda de
-- handle nem de plataforma; numa public, mudar o @ volta a declared [rev. META-3] (a migração C1 junta a
-- revalidação da conta pública). Num perfil aprovado, uma conta nova ou um @ mudado liga changed_since_review.
create function ldo_private.cr_social_upsert(p_creator uuid, p_data jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_raw_id text := nullif(btrim(coalesce(p_data ->> 'id', '')), '');
  v_platform text := lower(btrim(coalesce(p_data ->> 'platform', '')));
  v_handle text := regexp_replace(btrim(coalesce(p_data ->> 'handle', '')), '^@+', '');
  v_url text := nullif(btrim(coalesce(p_data ->> 'profile_url', '')), '');
  v_m jsonb := p_data -> 'metrics';
  v_old public.ldo_cr_social_accounts;
  v_id uuid;
  v_changed boolean := false;
  v_followers integer;
  v_views integer;
  v_likes integer;
  v_comments integer;
  v_pt numeric;
  v_eng numeric;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Dados da conta inválidos.' using errcode = '22023';
  end if;
  if v_platform not in ('instagram', 'tiktok', 'youtube', 'facebook', 'pinterest', 'outra') then
    raise exception 'Escolha a rede social.' using errcode = '22023';
  end if;
  if v_handle !~ '^[A-Za-z0-9._-]{1,60}$' then
    raise exception 'Escreva o nome de utilizador sem espaços (letras, números, ponto, hífen ou _).' using errcode = '22023';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s]+$' or length(v_url) > 300) then
    raise exception 'O endereço do perfil tem de começar por https://.' using errcode = '22023';
  end if;
  if v_raw_id is not null then
    if v_raw_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Não encontrado.' using errcode = 'P0002';
    end if;
    v_id := v_raw_id::uuid;
    perform ldo_private.cr_own(p_creator, 'social_account', v_id);
    select * into v_old from public.ldo_cr_social_accounts where id = v_id for update;
  else
    select * into v_old from public.ldo_cr_social_accounts where creator_id = p_creator and platform = v_platform for update;
  end if;
  if v_m is not null and jsonb_typeof(v_m) = 'object' then
    begin
      v_followers := nullif(btrim(coalesce(v_m ->> 'followers', '')), '')::integer;
      v_views := nullif(btrim(coalesce(v_m ->> 'avg_views', '')), '')::integer;
      v_likes := nullif(btrim(coalesce(v_m ->> 'avg_likes', '')), '')::integer;
      v_comments := nullif(btrim(coalesce(v_m ->> 'avg_comments', '')), '')::integer;
      v_pt := round(nullif(btrim(coalesce(v_m ->> 'pt_audience_pct', '')), '')::numeric, 2);
      v_eng := round(nullif(btrim(coalesce(v_m ->> 'engagement_pct', '')), '')::numeric, 2);
    exception when others then
      raise exception 'Os números têm de ser números inteiros (as percentagens podem ter casas decimais).' using errcode = '22023';
    end;
    if v_followers not between 0 and 1000000000 or v_views < 0 or v_likes < 0 or v_comments < 0
       or v_pt not between 0 and 100 or v_eng not between 0 and 100 then
      raise exception 'Verifique os números: não podem ser negativos e as percentagens vão de 0 a 100.' using errcode = '22023';
    end if;
  end if;
  if v_old.id is not null then
    if v_old.verification = 'verified' and (v_platform <> v_old.platform or lower(v_handle) <> lower(v_old.handle)) then
      raise exception 'Esta conta está verificada pela ligação ao Instagram: para a mudar, desligue-a primeiro em Redes.' using errcode = '22023';
    end if;
    v_changed := v_platform <> v_old.platform or lower(v_handle) <> lower(v_old.handle);
    begin
      update public.ldo_cr_social_accounts set platform = v_platform, handle = v_handle, profile_url = v_url,
        verification = case when verification = 'public' and lower(v_handle) <> lower(v_old.handle) then 'declared'
                            else verification end,
        updated_at = now()
      where id = v_old.id;
    exception when unique_violation then
      raise exception 'Já tem uma conta declarada nesta rede.' using errcode = '22023';
    end;
    v_id := v_old.id;
  else
    begin
      insert into public.ldo_cr_social_accounts (creator_id, platform, handle, profile_url)
      values (p_creator, v_platform, v_handle, v_url)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Já tem uma conta declarada nesta rede.' using errcode = '22023';
    end;
    v_changed := true;
  end if;
  if coalesce(v_followers, v_views, v_likes, v_comments) is not null or coalesce(v_pt, v_eng) is not null then
    -- Números novos voltam a precisar de validação.
    insert into public.ldo_cr_declared_metrics (account_id, followers, avg_views, avg_likes, avg_comments, pt_audience_pct, engagement_pct)
    values (v_id, v_followers, v_views, v_likes, v_comments, v_pt, v_eng)
    on conflict (account_id, declared_on) do update set followers = excluded.followers, avg_views = excluded.avg_views,
      avg_likes = excluded.avg_likes, avg_comments = excluded.avg_comments, pt_audience_pct = excluded.pt_audience_pct,
      engagement_pct = excluded.engagement_pct, validated_by = null, validated_at = null;
  end if;
  if v_changed then
    update public.ldo_cr_creators set changed_since_review = true where id = p_creator and status = 'approved';
  end if;
  return v_id;
end;
$$;

-- Exportação comum ao próprio (ldo_cr_export) e à equipa (ldo_cr_admin_export): tudo menos os dados financeiros, que
-- cada uma junta à sua maneira (o próprio recebe os cifrados para a rota decifrar; a equipa só o resumo)
-- [rev. S-M8, R-M9]. As migrações B e C fazem «create or replace» para juntar as secções novas.
create function ldo_private.cr_export_common(p_creator uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select to_jsonb(c) - 'password_hash' from public.ldo_cr_creators c where c.id = p_creator),
    'profile', (select to_jsonb(p) from public.ldo_cr_profiles p where p.creator_id = p_creator),
    'contacts', (select to_jsonb(k) from public.ldo_cr_contacts k where k.creator_id = p_creator),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name) order by s.name)
      from public.ldo_cr_creator_stores cs join public.ldo_app_stores s on s.id = cs.store_id
      where cs.creator_id = p_creator), '[]'::jsonb),
    'social_accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.platform)
      from public.ldo_cr_social_accounts a where a.creator_id = p_creator), '[]'::jsonb),
    'declared_metrics', coalesce((select jsonb_agg(jsonb_build_object('platform', a.platform, 'handle', a.handle,
        'declared_on', m.declared_on, 'followers', m.followers, 'avg_views', m.avg_views, 'avg_likes', m.avg_likes,
        'avg_comments', m.avg_comments, 'pt_audience_pct', m.pt_audience_pct, 'engagement_pct', m.engagement_pct,
        'validated_at', m.validated_at) order by a.platform, m.declared_on)
      from public.ldo_cr_declared_metrics m join public.ldo_cr_social_accounts a on a.id = m.account_id
      where a.creator_id = p_creator), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('purpose', c.purpose, 'granted', c.granted,
        'document', case when d.id is null then null else jsonb_build_object('kind', d.kind, 'version', d.version, 'title', d.title) end,
        'context', c.context, 'text_shown', c.text_shown, 'text_hash', c.text_hash, 'created_at', c.created_at) order by c.id)
      from public.ldo_cr_consents c left join public.ldo_cr_legal_documents d on d.id = c.document_id
      where c.creator_id = p_creator), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('author', m.author_kind, 'body', m.body, 'ref_kind', m.ref_kind,
        'ref_id', m.ref_id, 'created_at', m.created_at, 'read_by_creator_at', m.read_by_creator_at) order by m.id)
      from public.ldo_cr_messages m where m.creator_id = p_creator), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'created_at', n.created_at) order by n.id)
      from public.ldo_cr_notes n where n.creator_id = p_creator), '[]'::jsonb),
    'privacy_requests', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'channel', r.channel, 'status', r.status,
        'received_at', r.received_at, 'due_at', r.due_at, 'extended_until', r.extended_until,
        'extension_reason', r.extension_reason, 'details', r.details, 'response', r.response, 'handled_at', r.handled_at)
        order by r.received_at)
      from public.ldo_cr_privacy_requests r where r.creator_id = p_creator), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('actor', a.actor_kind, 'action', a.action, 'details', a.details,
        'created_at', a.created_at) order by a.id)
      from public.ldo_cr_audit a where a.creator_id = p_creator), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------- 10. funções de utilizadores (alteradas)

-- ldo_me: igual a 20261007120000_ldo_support.sql:248, mais creators_access e creators_finance.
create or replace function public.ldo_me(p_session text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'full_name', u.full_name,
    'is_super_admin', u.is_super_admin,
    'online_access', u.online_access or u.is_super_admin,
    'support_access', u.support_access or u.is_super_admin,
    'creators_access', case when u.is_super_admin then 'manage' else u.creators_access end,
    'creators_finance', u.creators_finance and (u.is_super_admin or u.creators_access <> 'none'),
    'must_change_password', u.must_change_password,
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'level', l.level,
        'ads_keyword', s.ads_keyword, 'closed_weekdays', s.closed_weekdays) order by s.sort_order, s.name)
      from public.ldo_app_stores s
      cross join lateral (select case when u.is_super_admin then 'manager' else u.store_access ->> s.id::text end as level) l
      where s.active and l.level is not null
    ), '[]'::jsonb)
  )
  from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session);
$$;

-- ldo_list_users: igual a 20261007120000_ldo_support.sql:1034, mais os dois campos e a regra «editable»
-- (um Gestor não edita quem tem acesso à área Influenciadores).
create or replace function public.ldo_list_users(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_super boolean;
  v_managed uuid[];
begin
  if v_me is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  select is_super_admin into v_super from public.ldo_app_users where id = v_me;
  v_managed := ldo_private.managed_stores(v_me);
  if not v_super and cardinality(v_managed) = 0 then
    raise exception 'Sem permissão para gerir utilizadores.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'username', u.username, 'full_name', u.full_name,
      'email', case when v_super or u.id = v_me then u.email end,
      'receive_reports', u.receive_reports, 'is_super_admin', u.is_super_admin, 'online_access', u.online_access,
      'support_access', u.support_access, 'creators_access', u.creators_access, 'creators_finance', u.creators_finance,
      'active', u.active,
      'store_access', case when v_super then u.store_access else (
        select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(u.store_access) a(k, v)
        where k::uuid = any (v_managed)) end,
      'editable', v_super or (
        u.id <> v_me and not u.is_super_admin and not u.online_access and not u.support_access
        and u.creators_access = 'none' and not u.creators_finance
        and not exists (select 1 from jsonb_each_text(u.store_access) a(k, v) where v <> 'store' or not (k::uuid = any (v_managed)))),
      'has_password', u.password_hash is not null, 'must_change_password', u.must_change_password,
      'locked', coalesce(u.locked_until > now(), false), 'last_login_at', u.last_login_at
    ) order by u.active desc, coalesce(u.full_name, u.username))
    from public.ldo_app_users u
    where u.username is not null and (v_super or u.id = v_me or exists (
      select 1 from jsonb_object_keys(u.store_access) k where k::uuid = any (v_managed)))
  ), '[]'::jsonb);
end;
$$;

-- ldo_save_user: cópia integral de 20261012160000_ldo_user_access_email.sql:32-140; só muda a guarda do Gestor
-- (um Gestor de lojas não edita quem tem qualquer acesso à área Influenciadores).
create or replace function public.ldo_save_user(p_session text, p_user_id uuid, p_username text, p_full_name text,
  p_is_super_admin boolean, p_online_access boolean, p_active boolean, p_stores jsonb, p_password text, p_must_change boolean)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_super boolean;
  v_managed uuid[];
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_password text := coalesce(p_password, '');
  v_target public.ldo_app_users;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  select is_super_admin into v_super from public.ldo_app_users where id = v_me;
  v_managed := ldo_private.managed_stores(v_me);
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then
    raise exception 'Nome de utilizador inválido: 3 a 40 letras minúsculas, números, ponto, hífen ou _.' using errcode = '22023';
  end if;
  p_stores := coalesce(p_stores, '{}'::jsonb);
  if jsonb_typeof(p_stores) <> 'object' or exists (
    select 1 from jsonb_each_text(p_stores) a(k, v)
    where v not in ('manager', 'store')
      or not exists (select 1 from public.ldo_app_stores s where s.id::text = k)
  ) then
    raise exception 'Loja ou nível inválido.' using errcode = '22023';
  end if;
  if v_password <> '' and length(v_password) < 8 then
    raise exception 'A palavra-passe tem de ter pelo menos 8 caracteres.' using errcode = '22023';
  end if;

  if p_user_id is null then
    if v_password = '' and not coalesce(v_super, false) then
      raise exception 'Indique uma palavra-passe inicial.' using errcode = '22023';
    end if;
  else
    select * into v_target from public.ldo_app_users where id = p_user_id;
    if v_target.id is null then
      raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
    end if;
  end if;
  if exists (select 1 from public.ldo_app_users where username = v_username and id is distinct from p_user_id) then
    raise exception 'Já existe um utilizador com este nome.' using errcode = '23505';
  end if;

  if not v_super then
    if cardinality(v_managed) = 0 then
      raise exception 'Sem permissão para gerir utilizadores.' using errcode = '42501';
    end if;
    if coalesce(p_is_super_admin, false) or coalesce(p_online_access, false) then
      raise exception 'Só o Super Admin pode dar acesso Super Admin ou Loja Online.' using errcode = '42501';
    end if;
    if p_stores = '{}'::jsonb then
      raise exception 'Escolha pelo menos uma loja.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each_text(p_stores) a(k, v) where v <> 'store' or not (k::uuid = any (v_managed))) then
      raise exception 'Um Gestor só pode dar o nível Loja nas lojas que gere.' using errcode = '42501';
    end if;
    if p_user_id is not null and (p_user_id = v_me or v_target.is_super_admin or v_target.online_access
       or v_target.support_access or v_target.creators_access <> 'none' or v_target.creators_finance or exists (
      select 1 from jsonb_each_text(v_target.store_access) a(k, v) where v <> 'store' or not (k::uuid = any (v_managed))
    )) then
      raise exception 'Este utilizador tem acessos fora das suas lojas. Peça ao Super Admin.' using errcode = '42501';
    end if;
  elsif p_user_id is not null and v_target.is_super_admin and v_target.active
    and not (coalesce(p_is_super_admin, false) and coalesce(p_active, true))
    and not exists (select 1 from public.ldo_app_users where is_super_admin and active and id <> p_user_id) then
    raise exception 'Tem de existir sempre pelo menos um Super Admin ativo.' using errcode = '42501';
  end if;

  if p_user_id is null then
    insert into public.ldo_app_users (username, full_name, is_super_admin, online_access, active, store_access,
      password_hash, password_changed_at, must_change_password, invited_by, updated_by)
    values (v_username, v_name, coalesce(p_is_super_admin, false), coalesce(p_online_access, false), coalesce(p_active, true),
      p_stores,
      case when v_password = '' then null else extensions.crypt(v_password, extensions.gen_salt('bf', 10)) end,
      case when v_password = '' then null else now() end,
      v_password <> '' and coalesce(p_must_change, true), v_me, v_me)
    returning id into v_id;
  else
    update public.ldo_app_users set
      username = v_username,
      full_name = v_name,
      is_super_admin = coalesce(p_is_super_admin, false),
      online_access = coalesce(p_online_access, false),
      active = coalesce(p_active, true),
      store_access = p_stores,
      updated_by = v_me,
      updated_at = now()
    where id = p_user_id
    returning id into v_id;
    -- A new password ends the person's open sessions and any access link still pending.
    if v_password <> '' then
      update public.ldo_app_users set
        password_hash = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
        password_changed_at = now(), must_change_password = coalesce(p_must_change, true),
        failed_logins = 0, locked_until = null
      where id = v_id;
      update public.ldo_app_access_links set revoked_at = now()
      where user_id = v_id and used_at is null and revoked_at is null;
    end if;
  end if;

  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, case when p_user_id is null then 'user.create' else 'user.update' end, v_id,
    jsonb_build_object('username', v_username, 'super', coalesce(p_is_super_admin, false),
      'online', coalesce(p_online_access, false), 'active', coalesce(p_active, true), 'stores', p_stores,
      'password_reset', v_password <> ''));
  return v_id;
end;
$$;

-- Atribuir o acesso (só Super Admin), como ldo_support_set_user_access.
create function public.ldo_cr_set_user_access(p_session text, p_user_id uuid, p_level text, p_finance boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_old public.ldo_app_users;
  v_fin boolean := coalesce(p_finance, false);
begin
  if v_me is null then
    raise exception 'Só o Super Admin dá acesso à área Influenciadores.' using errcode = '42501';
  end if;
  if p_level is null or p_level not in ('none', 'view', 'manage') then
    raise exception 'Nível inválido.' using errcode = '22023';
  end if;
  select * into v_old from public.ldo_app_users where id = p_user_id for update;
  if v_old.id is null then
    raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
  end if;
  if v_fin and p_level = 'none' and not v_old.is_super_admin then
    raise exception 'As finanças exigem acesso à área Influenciadores (Consultar ou Gerir).' using errcode = '22023';
  end if;
  update public.ldo_app_users set creators_access = p_level, creators_finance = v_fin, updated_by = v_me, updated_at = now()
  where id = p_user_id and (creators_access, creators_finance) is distinct from (p_level, v_fin);
  if found then
    insert into public.ldo_app_audit (actor, action, target, details)
    values (v_me, 'user.creators_access', p_user_id, jsonb_build_object(
      'from', jsonb_build_object('level', v_old.creators_access, 'finance', v_old.creators_finance),
      'to', jsonb_build_object('level', p_level, 'finance', v_fin)));
  end if;
end;
$$;

-- [rev. R-M14] Paragem de emergência (§7.5). Create or replace nas migrações C1 (+ public_mode = 'off') e C2
-- (+ meta_mode = 'off', ai_enabled = false).
create function public.ldo_cr_lockdown(p_session text, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_super(p_session);
  v_n integer;
begin
  if v_me is null then
    raise exception 'Só o Super Admin pode parar a plataforma.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Indique o motivo.' using errcode = '22023';
  end if;
  update public.ldo_cr_logins set revoked_at = now() where revoked_at is null;
  get diagnostics v_n = row_count;
  update public.ldo_cr_settings set registrations_open = false, updated_at = now(), updated_by = v_me where id = 1;
  perform ldo_private.cr_log('staff', v_me, null, 'incident.lockdown', null,
    jsonb_build_object('reason', left(btrim(p_reason), 500), 'sessions_revoked', v_n));
  return jsonb_build_object('sessions_revoked', v_n);
end;
$$;

-- ---------------------------------------------------------------- 11. site: contas

-- Registo. Inscrições fechadas → erro; documentos desatualizados → erro; email existente → mesma resposta
-- (pending: novo token de confirmação; exists: nada). p_texts = {terms, privacy_notice, adult} (sem marketing na v1 [rev. R-B6]): textos
-- exatos das caixas mostradas.
-- [rev. S-M1] No caminho pending, a palavra-passe da conta continua a ser a de quem se registou primeiro. Por isso a
-- confirmação exige essa palavra-passe (ldo_cr_verify_email) e o email do caminho pending tem outro texto
-- («já existe um registo por confirmar com este endereço; se não fez este registo, ignore»).
-- [rev. S-B2] Mesmo tempo nos três caminhos (o bcrypt corre sempre; o caminho created já o faz ao gravar) e no
-- máximo 3 emails por hora para o mesmo endereço: o 4.º devolve quiet, a aplicação não envia nada e responde o
-- mesmo texto. [rev. S-B3] O resultado não leva o nome: o email vai para um endereço que ainda não provou ser de
-- quem se registou.
create function public.ldo_cr_register(p_token text, p_email text, p_password text, p_name text, p_terms_doc uuid,
  p_privacy_doc uuid, p_adult boolean, p_texts jsonb, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 120);
  v_ip text := ldo_private.cr_ip(p_ip_hash);
  v_s public.ldo_cr_settings;
  v_terms public.ldo_cr_legal_documents;
  v_privacy public.ldo_cr_legal_documents;
  v_c public.ldo_cr_creators;
begin
  perform ldo_private.cr_server_check(p_token);
  v_terms := ldo_private.cr_doc('terms');
  v_privacy := ldo_private.cr_doc('privacy');
  select * into v_s from public.ldo_cr_settings where id = 1;
  if not v_s.registrations_open or v_terms.id is null or v_privacy.id is null then
    raise exception 'As inscrições ainda não estão abertas. Volte em breve.' using errcode = '22023';
  end if;
  if p_terms_doc is distinct from v_terms.id or p_privacy_doc is distinct from v_privacy.id then
    raise exception 'Os Termos ou a Política foram atualizados. Recarregue a página e leia a versão nova.' using errcode = '22023';
  end if;
  if not coalesce(p_adult, false) then
    raise exception 'A plataforma é só para maiores de 18 anos.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'Indique o seu nome.' using errcode = '22023';
  end if;
  -- [rev. S-B3] O nome entra em emails da marca. «J. Silva», «D'Ávila» e «Maria-José» passam; «exemplo.pt» não.
  if v_name ~ '[0-9@/:<>_=?&#%+|{}"]' or v_name ~ '\.[^[:space:]]' then
    raise exception 'Escreva o nome só com letras (pode usar espaço, hífen, apóstrofo e ponto).' using errcode = '22023';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Indique um email válido.' using errcode = '22023';
  end if;
  perform ldo_private.cr_check_password(p_password);
  if (select count(*) from public.ldo_cr_attempts where kind = 'register' and ip_hash = v_ip
      and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Demasiados registos a partir desta ligação. Tente mais tarde.' using errcode = '22023';
  end if;
  insert into public.ldo_cr_attempts (kind, ip_hash, email_hash) values ('register', v_ip, ldo_private.cr_hash(v_email));
  perform pg_advisory_xact_lock(hashtextextended('ldo_cr_email:' || v_email, 0));
  if (select count(*) from public.ldo_cr_attempts where kind = 'register' and email_hash = ldo_private.cr_hash(v_email)
      and created_at > now() - interval '1 hour') > 3 then
    perform extensions.crypt(p_password, extensions.gen_salt('bf', 10));
    return jsonb_build_object('status', 'quiet');
  end if;
  select * into v_c from public.ldo_cr_creators where email = v_email;
  if v_c.id is not null then
    perform extensions.crypt(p_password, extensions.gen_salt('bf', 10));
    if v_c.email_verified_at is null and v_c.deleted_at is null then
      return jsonb_build_object('status', 'pending', 'verify_token', ldo_private.cr_new_token(v_c.id, 'verify', 48));
    end if;
    return jsonb_build_object('status', 'exists');
  end if;
  insert into public.ldo_cr_creators (email, password_hash, password_changed_at, adult_declared_at)
  values (v_email, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(), now())
  returning * into v_c;
  insert into public.ldo_cr_profiles (creator_id, full_name) values (v_c.id, v_name);
  perform ldo_private.cr_consent(v_c.id, 'terms', true, v_terms.id, null, p_texts ->> 'terms', v_ip);
  perform ldo_private.cr_consent(v_c.id, 'privacy_notice', true, v_privacy.id, null, p_texts ->> 'privacy_notice', v_ip);
  perform ldo_private.cr_consent(v_c.id, 'adult', true, null, null, p_texts ->> 'adult', v_ip);
  perform ldo_private.cr_log('creator', null, v_c.id, 'creator.register', v_c.id, '{}'::jsonb);
  return jsonb_build_object('status', 'created', 'verify_token', ldo_private.cr_new_token(v_c.id, 'verify', 48));
end;
$$;

-- [rev. S-M1] Confirmação do email com a palavra-passe do registo (POST; a página /conta/confirmar#t= não chama a BD
-- no GET). Só marca email_verified_at (e gasta o token) com a palavra-passe certa. Falha → {ok:false,
-- reason:'password'}, sem raise, e conta como login_fail (email_hash da conta, ip_hash): entra nos mesmos limites da
-- entrada ({ok:false, reason:'locked'}). Token inválido, usado ou expirado → {ok:false, reason:'expired'}.
create function public.ldo_cr_verify_email(p_token text, p_verify text, p_password text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t public.ldo_cr_tokens;
  v_c public.ldo_cr_creators;
  v_ip text := ldo_private.cr_ip(p_ip_hash);
  v_eh text;
begin
  perform ldo_private.cr_server_check(p_token);
  select * into v_t from public.ldo_cr_tokens
  where token_hash = extensions.digest(coalesce(p_verify, ''), 'sha256') and kind = 'verify' for update;
  if v_t.id is null or v_t.used_at is not null or v_t.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select * into v_c from public.ldo_cr_creators where id = v_t.creator_id and deleted_at is null for update;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  v_eh := ldo_private.cr_hash(v_c.email);
  if ldo_private.cr_login_locked(v_eh, v_ip) is not null then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if v_c.password_hash is null or extensions.crypt(coalesce(p_password, ''), v_c.password_hash) <> v_c.password_hash then
    insert into public.ldo_cr_attempts (kind, ip_hash, email_hash, creator_id) values ('login_fail', v_ip, v_eh, v_c.id);
    return jsonb_build_object('ok', false, 'reason', 'password');
  end if;
  update public.ldo_cr_tokens set used_at = now() where id = v_t.id;
  update public.ldo_cr_creators set email_verified_at = coalesce(email_verified_at, now()) where id = v_c.id;
  perform ldo_private.cr_log('creator', null, v_c.id, 'creator.verify_email', v_c.id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Entrada. Como ldo_auc_login (5 falhas por email e ligação em 15 min; 30 por ligação numa hora), mais [rev. S-M2]
-- o limite POR CONTA (20 falhas numa hora, de qualquer IP) → {ok:false, reason:'locked'} e, no máximo 1×/h, o aviso
-- login_locked ao titular. Contra o bloqueio por terceiros: ldo_cr_reset com sucesso apaga as falhas.
-- Dias da sessão em ldo_cr_settings.session_days; suspended e restricted entram (para ver, exportar e apagar).
-- Email por confirmar → {ok:false, reason:'unverified', verify_token, email} (novo token, como o leilão), no máximo 3
-- por hora por endereço (contados como os do registo); sem nome no resultado [rev. S-B2, S-B3].
-- Respostas: {ok:true, session, expires_at} | {ok:false, reason:'locked'|'invalid'|'unverified', …}.
create function public.ldo_cr_login(p_token text, p_email text, p_password text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_eh text := ldo_private.cr_hash(lower(btrim(coalesce(p_email, ''))));
  v_ip text := ldo_private.cr_ip(p_ip_hash);
  v_lock text;
  v_c public.ldo_cr_creators;
  v_s public.ldo_cr_settings;
  v_session text;
  v_expires timestamptz;
begin
  perform ldo_private.cr_server_check(p_token);
  v_lock := ldo_private.cr_login_locked(v_eh, v_ip);
  if v_lock is not null then
    if v_lock = 'account' then
      perform ldo_private.cr_lock_notice((select id from public.ldo_cr_creators where email = v_email and deleted_at is null));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  select * into v_s from public.ldo_cr_settings where id = 1;
  select * into v_c from public.ldo_cr_creators where email = v_email and deleted_at is null and status <> 'deleted';
  if v_c.id is null or v_c.password_hash is null then
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
  elsif extensions.crypt(coalesce(p_password, ''), v_c.password_hash) = v_c.password_hash then
    if v_c.email_verified_at is null then
      if (select count(*) from public.ldo_cr_attempts where kind = 'register' and email_hash = v_eh
          and created_at > now() - interval '1 hour') >= 3 then
        return jsonb_build_object('ok', false, 'reason', 'unverified');
      end if;
      insert into public.ldo_cr_attempts (kind, ip_hash, email_hash, creator_id) values ('register', v_ip, v_eh, v_c.id);
      return jsonb_build_object('ok', false, 'reason', 'unverified', 'email', v_c.email,
        'verify_token', ldo_private.cr_new_token(v_c.id, 'verify', 48));
    end if;
    v_session := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires := now() + make_interval(days => v_s.session_days);
    insert into public.ldo_cr_logins (token_hash, creator_id, expires_at, last_seen_at)
    values (extensions.digest(v_session, 'sha256'), v_c.id, v_expires, now());
    update public.ldo_cr_creators set last_login_at = now(), inactivity_warned_at = null where id = v_c.id;
    return jsonb_build_object('ok', true, 'session', v_session, 'expires_at', v_expires);
  end if;
  insert into public.ldo_cr_attempts (kind, ip_hash, email_hash, creator_id) values ('login_fail', v_ip, v_eh, v_c.id);
  if v_c.id is not null and ldo_private.cr_login_locked(v_eh, null) = 'account' then
    perform ldo_private.cr_lock_notice(v_c.id);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'invalid');
end;
$$;

create function public.ldo_cr_logout(p_token text, p_session text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.cr_server_check(p_token);
  update public.ldo_cr_logins set revoked_at = now()
  where token_hash = extensions.digest(coalesce(p_session, ''), 'sha256') and revoked_at is null;
end;
$$;

-- Recuperação. Devolve o token só se o email existir; a aplicação envia em after() e responde sempre o mesmo texto.
-- 5 pedidos por ligação e hora ({ok:false, reason:'rate'}) e [rev. S-B2] no máximo 3 por hora por endereço (o 4.º
-- devolve {ok:true} sem token). Também serve uma conta sem palavra-passe («Não fui eu» no IBAN).
create function public.ldo_cr_reset_request(p_token text, p_email text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_eh text := ldo_private.cr_hash(lower(btrim(coalesce(p_email, ''))));
  v_ip text := ldo_private.cr_ip(p_ip_hash);
  v_c public.ldo_cr_creators;
begin
  perform ldo_private.cr_server_check(p_token);
  if v_ip is not null and (select count(*) from public.ldo_cr_attempts where kind = 'reset' and ip_hash = v_ip
      and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;
  insert into public.ldo_cr_attempts (kind, ip_hash, email_hash) values ('reset', v_ip, v_eh);
  if (select count(*) from public.ldo_cr_attempts where kind = 'reset' and email_hash = v_eh
      and created_at > now() - interval '1 hour') > 3 then
    return jsonb_build_object('ok', true);
  end if;
  select * into v_c from public.ldo_cr_creators where email = v_email and deleted_at is null and status <> 'deleted';
  if v_c.id is null then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', true, 'email', v_c.email, 'reset_token', ldo_private.cr_new_token(v_c.id, 'reset', 2));
end;
$$;

-- Nova palavra-passe com o token do email (2 h): confirma o email (o link chegou à caixa), atualiza
-- password_changed_at (as sessões anteriores deixam de valer), revoga as sessões e [rev. S-M2] apaga as falhas de
-- entrada e de reautenticação dessa conta, para quem foi bloqueado por terceiros entrar logo a seguir.
create function public.ldo_cr_reset(p_token text, p_reset text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t public.ldo_cr_tokens;
  v_c public.ldo_cr_creators;
begin
  perform ldo_private.cr_server_check(p_token);
  perform ldo_private.cr_check_password(p_password);
  select * into v_t from public.ldo_cr_tokens
  where token_hash = extensions.digest(coalesce(p_reset, ''), 'sha256') and kind = 'reset' for update;
  if v_t.id is null or v_t.used_at is not null or v_t.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select * into v_c from public.ldo_cr_creators where id = v_t.creator_id and deleted_at is null for update;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  update public.ldo_cr_tokens set used_at = now() where id = v_t.id;
  update public.ldo_cr_creators set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    password_changed_at = now(), email_verified_at = coalesce(email_verified_at, now())
  where id = v_c.id;
  update public.ldo_cr_logins set revoked_at = now() where creator_id = v_c.id and revoked_at is null;
  delete from public.ldo_cr_attempts where kind = 'login_fail' and email_hash = ldo_private.cr_hash(v_c.email);
  delete from public.ldo_cr_attempts where kind = 'reauth_fail' and creator_id = v_c.id;
  perform ldo_private.cr_log('creator', null, v_c.id, 'creator.password_reset', v_c.id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Reautenticação nas operações sensíveis (IBAN, exportar, apagar). 5 falhas em 15 min por criador bloqueiam.
create function public.ldo_cr_reauth(p_token text, p_session text, p_password text, p_ip_hash text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_hash text;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  if (select count(*) from public.ldo_cr_attempts where kind = 'reauth_fail' and creator_id = v_id
      and created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Demasiadas tentativas. Aguarde 15 minutos.' using errcode = '42501';
  end if;
  select password_hash into v_hash from public.ldo_cr_creators where id = v_id;
  if v_hash is not null and extensions.crypt(coalesce(p_password, ''), v_hash) = v_hash then
    return true;
  end if;
  insert into public.ldo_cr_attempts (kind, ip_hash, creator_id)
  values ('reauth_fail', case when p_ip_hash ~ '^[0-9a-f]{64}$' then p_ip_hash end, v_id);
  return false;
end;
$$;

-- [rev. S-M2] Mudar a palavra-passe: valida a atual com ldo_cr_reauth (o mesmo contador de 5 falhas em 15 min) e
-- devolve {ok:false, reason:'password'} em vez de raise (um raise desfazia o registo da falha). Atualiza
-- password_changed_at, termina as outras sessões e devolve uma sessão nova para quem a fez:
-- {ok:true, session, expires_at}.
create function public.ldo_cr_password_change(p_token text, p_session text, p_old text, p_new text, p_ip_hash text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_session text := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires timestamptz;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  perform ldo_private.cr_check_password(p_new);
  if not public.ldo_cr_reauth(p_token, p_session, p_old, p_ip_hash) then
    return jsonb_build_object('ok', false, 'reason', 'password');
  end if;
  v_expires := now() + make_interval(days => (select session_days from public.ldo_cr_settings where id = 1));
  update public.ldo_cr_creators set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
    password_changed_at = now()
  where id = v_id;
  update public.ldo_cr_logins set revoked_at = now() where creator_id = v_id and revoked_at is null;
  insert into public.ldo_cr_logins (token_hash, creator_id, expires_at, last_seen_at)
  values (extensions.digest(v_session, 'sha256'), v_id, v_expires, now());
  perform ldo_private.cr_log('creator', null, v_id, 'creator.password_change', v_id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'session', v_session, 'expires_at', v_expires);
end;
$$;

-- ---------------------------------------------------------------- 12. site: dados de pagamento

-- Guardar os dados fiscais e/ou o IBAN (cifrados na aplicação). p_data:
--   {fiscal_ct?, fiscal_complete?, iban_ct?, iban_last4?, iban_country?, holder_mismatch?,
--    declarations: {vat_exempt?, withholding_waiver?}, texts: {iban_owner, vat_exempt, withholding_waiver}}
-- iban_ct só vem quando o criador escreveu um IBAN (ausente = manter).
-- [rev. S-A1] Um IBAN novo, incluindo o primeiro, fica PENDENTE (iban_pending_*) e a função devolve um token
-- iban_confirm (48 h) que a aplicação envia NA HORA, sem fila, para o email da conta (sendIbanConfirm). Só o titular
-- da caixa de correio o passa a iban_ct (ldo_cr_iban_confirm), e aí começa a espera de iban_hold_hours.
-- Com a conta suspensa o IBAN não muda. p_data.holder_mismatch: comparação feita pela aplicação (titular vs nome fiscal).
-- Um IBAN novo partilha o limite do reenvio (3 por hora): acima dele → {ok:false, reason:'rate'} sem gravar nada.
-- Palavra-passe errada → {ok:false, reason:'password'} SEM levantar erro: um raise desfazia o registo da tentativa
-- falhada feito por ldo_cr_reauth (mesma transação) e o limite de 5 em 15 min deixava de contar.
create function public.ldo_cr_finance_save(p_token text, p_session text, p_password text, p_data jsonb, p_ip_hash text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_f public.ldo_cr_finance;
  v_new_iban boolean := coalesce(p_data ->> 'iban_ct', '') <> '';
  v_confirm text;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  if not public.ldo_cr_reauth(p_token, p_session, p_password, p_ip_hash) then
    return jsonb_build_object('ok', false, 'reason', 'password');
  end if;
  if v_new_iban and (select status from public.ldo_cr_creators where id = v_id) = 'suspended' then
    raise exception 'Com a conta suspensa não é possível mudar o IBAN. Fale connosco em Mensagens.' using errcode = '42501';
  end if;
  -- Cada IBAN novo gera um email de confirmação: partilha o limite do reenvio (3 por hora, ldo_cr_attempts iban_resend).
  if v_new_iban and (select count(*) from public.ldo_cr_attempts where kind = 'iban_resend' and creator_id = v_id
      and created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;
  if (p_data ? 'fiscal_ct' and coalesce(p_data ->> 'fiscal_ct', '') !~ '^c[0-9]+\.')
     or (v_new_iban and (p_data ->> 'iban_ct' !~ '^c[0-9]+\.' or coalesce(p_data ->> 'iban_last4', '') !~ '^[0-9A-Z]{4}$'
         or coalesce(p_data ->> 'iban_country', '') !~ '^[A-Z]{2}$')) then
    raise exception 'Dados de pagamento inválidos.' using errcode = '22023';
  end if;
  insert into public.ldo_cr_finance (creator_id) values (v_id) on conflict (creator_id) do nothing;
  select * into v_f from public.ldo_cr_finance where creator_id = v_id for update;
  update public.ldo_cr_finance set
    fiscal_ct = case when p_data ? 'fiscal_ct' then p_data ->> 'fiscal_ct' else fiscal_ct end,
    fiscal_complete = case when p_data ? 'fiscal_ct' then coalesce((p_data ->> 'fiscal_complete')::boolean, false) else fiscal_complete end,
    iban_pending_ct = case when v_new_iban then p_data ->> 'iban_ct' else iban_pending_ct end,
    iban_pending_last4 = case when v_new_iban then p_data ->> 'iban_last4' else iban_pending_last4 end,
    iban_pending_country = case when v_new_iban then p_data ->> 'iban_country' else iban_pending_country end,
    iban_pending_holder_mismatch = case when v_new_iban then coalesce((p_data ->> 'holder_mismatch')::boolean, false)
                                        else iban_pending_holder_mismatch end,
    iban_pending_at = case when v_new_iban then now() else iban_pending_at end,
    updated_at = now()
  where creator_id = v_id;
  if v_new_iban then
    perform ldo_private.cr_consent(v_id, 'iban_owner', true, null, null, p_data -> 'texts' ->> 'iban_owner', p_ip_hash);
    insert into public.ldo_cr_attempts (kind, ip_hash, creator_id) values ('iban_resend', ldo_private.cr_ip(p_ip_hash), v_id);
    v_confirm := ldo_private.cr_new_token(v_id, 'iban_confirm', 48);   -- invalida um iban_confirm anterior
  end if;
  if p_data -> 'declarations' ? 'vat_exempt' then
    perform ldo_private.cr_consent(v_id, 'vat_exempt', (p_data -> 'declarations' ->> 'vat_exempt')::boolean, null, null,
      p_data -> 'texts' ->> 'vat_exempt', p_ip_hash);
  end if;
  if p_data -> 'declarations' ? 'withholding_waiver' then
    perform ldo_private.cr_consent(v_id, 'withholding_waiver', (p_data -> 'declarations' ->> 'withholding_waiver')::boolean, null, null,
      p_data -> 'texts' ->> 'withholding_waiver', p_ip_hash);
  end if;
  if not v_new_iban then
    perform ldo_private.cr_outbox(v_id, 'finance_saved', jsonb_build_object('at', now()));
  end if;
  perform ldo_private.cr_log('creator', null, v_id, case when v_new_iban then 'finance.iban_pending' else 'finance.fiscal_save' end,
    v_id, case when v_new_iban then jsonb_build_object('last4', p_data ->> 'iban_last4', 'first', v_f.iban_ct is null) else '{}'::jsonb end);
  -- O email com v_confirm sai na hora pela aplicação (para o email da conta, que não muda pela plataforma na v1).
  -- Se o envio falhar, a página diz para tentar de novo; um novo envio gera outro token.
  return jsonb_build_object('ok', true, 'iban_pending', v_new_iban, 'pending_last4', case when v_new_iban then p_data ->> 'iban_last4' end,
    'confirm_token', v_confirm, 'email', (select email from public.ldo_cr_creators where id = v_id));
end;
$$;

-- [rev. S-A1] Confirmar ou recusar um IBAN pendente, pela ligação do email (sem sessão: o token prova o acesso à
-- caixa de correio). A página /conta/iban#t= não chama a BD no GET; os dois botões fazem POST. O token vai no
-- fragmento e no corpo do POST, nunca no URL pedido ao servidor [rev. S-B11].
--   p_accept = true  → pendente passa a iban_ct; iban_changed_at = now(); iban_hold_until = now() + iban_hold_hours
--                      (também no primeiro IBAN); auditoria finance.iban_confirmed.
--   p_accept = false → «Não fui eu»: apaga o pendente, revoga todas as sessões, invalida a palavra-passe e devolve um
--                      token reset (2 h) para a pessoa definir já uma nova; auditoria finance.iban_rejected (a visão
--                      geral da equipa mostra-o durante 30 dias).
create function public.ldo_cr_iban_confirm(p_token text, p_confirm text, p_accept boolean, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t public.ldo_cr_tokens;
  v_f public.ldo_cr_finance;
  v_hours integer;
begin
  perform ldo_private.cr_server_check(p_token);
  v_hours := (select iban_hold_hours from public.ldo_cr_settings where id = 1);
  select * into v_t from public.ldo_cr_tokens
  where token_hash = extensions.digest(coalesce(p_confirm, ''), 'sha256') and kind = 'iban_confirm' for update;
  if v_t.id is null or v_t.used_at is not null or v_t.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  update public.ldo_cr_tokens set used_at = now() where id = v_t.id;
  select * into v_f from public.ldo_cr_finance where creator_id = v_t.creator_id for update;
  if v_f.iban_pending_ct is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing_pending');
  end if;
  if coalesce(p_accept, false) then
    -- Com a conta suspensa o IBAN não muda (critério PR1-6), nem pela ligação do email: o token fica usado, o
    -- pendente fica como está e a recusa fica na auditoria.
    if (select status from public.ldo_cr_creators where id = v_t.creator_id) = 'suspended' then
      perform ldo_private.cr_log('creator', null, v_t.creator_id, 'finance.iban_confirm_refused', v_t.creator_id,
        jsonb_build_object('last4', v_f.iban_pending_last4, 'reason', 'suspended'));
      return jsonb_build_object('ok', false, 'reason', 'suspended');
    end if;
    update public.ldo_cr_finance set iban_ct = iban_pending_ct, iban_last4 = iban_pending_last4,
      iban_country = iban_pending_country, iban_holder_mismatch = iban_pending_holder_mismatch,
      iban_changed_at = now(), iban_hold_until = now() + make_interval(hours => v_hours),
      iban_pending_ct = null, iban_pending_last4 = null, iban_pending_country = null,
      iban_pending_holder_mismatch = false, iban_pending_at = null, updated_at = now()
    where creator_id = v_t.creator_id;
    perform ldo_private.cr_log('creator', null, v_t.creator_id, 'finance.iban_confirmed', v_t.creator_id,
      jsonb_build_object('last4', v_f.iban_pending_last4, 'previous_last4', v_f.iban_last4,
        'holder_mismatch', v_f.iban_pending_holder_mismatch));
    return jsonb_build_object('ok', true, 'confirmed', true, 'last4', v_f.iban_pending_last4,
      'hold_until', now() + make_interval(hours => v_hours));
  end if;
  update public.ldo_cr_finance set iban_pending_ct = null, iban_pending_last4 = null, iban_pending_country = null,
    iban_pending_holder_mismatch = false, iban_pending_at = null, updated_at = now()
  where creator_id = v_t.creator_id;
  update public.ldo_cr_creators set password_hash = null, password_changed_at = now() where id = v_t.creator_id;
  update public.ldo_cr_logins set revoked_at = now() where creator_id = v_t.creator_id and revoked_at is null;
  perform ldo_private.cr_log('creator', null, v_t.creator_id, 'finance.iban_rejected', v_t.creator_id,
    jsonb_build_object('last4', v_f.iban_pending_last4));
  return jsonb_build_object('ok', true, 'confirmed', false, 'reset_token', ldo_private.cr_new_token(v_t.creator_id, 'reset', 2));
end;
$$;

-- [rev. S-A1] «Reenviar o email» em /pagamentos: só com um IBAN pendente, no máximo 3 por hora (ldo_cr_attempts
-- iban_resend). Gera um novo iban_confirm (o anterior deixa de valer) e devolve-o com os 4 últimos e o email da conta,
-- para a aplicação enviar na hora: {ok:true, confirm_token, pending_last4, email} | {ok:false, reason:'nothing_pending'|'rate'}.
create function public.ldo_cr_iban_resend(p_token text, p_session text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_f public.ldo_cr_finance;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  select * into v_f from public.ldo_cr_finance where creator_id = v_id for update;
  if v_f.iban_pending_ct is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing_pending');
  end if;
  if (select count(*) from public.ldo_cr_attempts where kind = 'iban_resend' and creator_id = v_id
      and created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;
  insert into public.ldo_cr_attempts (kind, ip_hash, creator_id) values ('iban_resend', ldo_private.cr_ip(p_ip_hash), v_id);
  perform ldo_private.cr_log('creator', null, v_id, 'finance.iban_resend', v_id, jsonb_build_object('last4', v_f.iban_pending_last4));
  return jsonb_build_object('ok', true, 'confirm_token', ldo_private.cr_new_token(v_id, 'iban_confirm', 48),
    'pending_last4', v_f.iban_pending_last4, 'email', (select email from public.ldo_cr_creators where id = v_id));
end;
$$;

-- O próprio vê o IBAN mascarado (só last4) e os dados fiscais cifrados (a aplicação decifra para os pôr no
-- formulário). Nunca o iban_ct.
create function public.ldo_cr_finance_get(p_token text, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  return (select jsonb_build_object('fiscal_ct', f.fiscal_ct, 'fiscal_complete', f.fiscal_complete, 'iban_last4', f.iban_last4,
      'iban_country', f.iban_country, 'iban_changed_at', f.iban_changed_at, 'iban_hold_until', f.iban_hold_until,
      'iban_pending_last4', f.iban_pending_last4, 'iban_pending_at', f.iban_pending_at,
      'declarations', jsonb_build_object('vat_exempt', ldo_private.cr_consent_state(v_id) -> 'vat_exempt',
        'withholding_waiver', ldo_private.cr_consent_state(v_id) -> 'withholding_waiver'))
    from public.ldo_cr_finance f where f.creator_id = v_id);
end;
$$;

-- ---------------------------------------------------------------- 13. equipa: revelar os dados financeiros (auditado)

-- [rev. S-A1] A espera depois de mudar o IBAN é IMPOSTA aqui (antes era só um aviso em ldo_cr_payment_save, que
-- chegava depois da transferência). Com iban_hold_until > now(), só revela com p_oob_confirmed = true («confirmei
-- o IBAN com o criador por telefone ou outro canal»), que fica na auditoria. Devolve iban_changed_at, que a
-- aplicação passa a ldo_cr_payment_save para provar que o IBAN pago é o revelado. O pendente nunca é revelado.
-- [rev. S-M8] A equipa entra só com utilizador e palavra-passe e a sessão dura 12 h (lib/session.ts): uma sessão
-- roubada revelava todos os IBAN, um a seguir ao outro. Cada revelação pede agora a palavra-passe de quem revela
-- (bcrypt contra ldo_app_users.password_hash). Errada → {ok:false, reason:'password'} SEM raise, para a falha ficar
-- em failed_logins; à 5.ª, locked_until = now() + 15 min (a regra de ldo_login, que também impede entrar no
-- dashboard). No máximo 20 revelações por pessoa em 24 h (contadas em ldo_cr_audit); à 10.ª devolve alert = true e
-- a aplicação avisa os Super Admin por email (ldo_cr_staff_alert_recipients).
create function public.ldo_cr_finance_reveal(p_session text, p_creator uuid, p_reason text, p_oob_confirmed boolean,
  p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_finance(p_session);
  v_u public.ldo_app_users;
  v_f public.ldo_cr_finance;
  v_reason text := left(btrim(coalesce(p_reason, '')), 300);
  v_hold boolean;
  v_count integer;
begin
  if v_me is null then
    raise exception 'Sem permissão de finanças.' using errcode = '42501';
  end if;
  if length(v_reason) < 5 then
    raise exception 'Indique o motivo (ex.: pagamento da campanha de Natal).' using errcode = '22023';
  end if;
  select * into v_u from public.ldo_app_users where id = v_me for update;
  if v_u.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if v_u.password_hash is null or extensions.crypt(coalesce(p_password, ''), v_u.password_hash) <> v_u.password_hash then
    update public.ldo_app_users set
      failed_logins = case when failed_logins + 1 >= 5 then 0 else failed_logins + 1 end,
      locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where id = v_me;
    return jsonb_build_object('ok', false, 'reason', case when v_u.failed_logins + 1 >= 5 then 'locked' else 'password' end);
  end if;
  update public.ldo_app_users set failed_logins = 0 where id = v_me and failed_logins <> 0;
  select count(*) into v_count from public.ldo_cr_audit
  where action = 'finance.reveal' and staff_id = v_me and created_at > now() - interval '24 hours';
  if v_count >= 20 then
    raise exception 'Chegou ao limite de 20 revelações em 24 horas. Se precisar de mais, fale com o Super Admin.' using errcode = '42501';
  end if;
  select * into v_f from public.ldo_cr_finance where creator_id = p_creator;
  if v_f.creator_id is null then
    raise exception 'Este criador ainda não indicou dados de pagamento.' using errcode = 'P0002';
  end if;
  v_hold := v_f.iban_ct is not null and v_f.iban_hold_until > now();
  if v_hold and not coalesce(p_oob_confirmed, false) then
    raise exception 'IBAN alterado há menos de % h: confirme-o com o criador por telefone antes de pagar.',
      (select iban_hold_hours from public.ldo_cr_settings where id = 1) using errcode = '42501';
  end if;
  perform ldo_private.cr_log('staff', v_me, p_creator, 'finance.reveal', p_creator,
    jsonb_build_object('reason', v_reason, 'during_hold', v_hold, 'oob_confirmed', v_hold and coalesce(p_oob_confirmed, false)));
  return jsonb_build_object('ok', true, 'alert', v_count + 1 = 10,
    'fiscal_ct', v_f.fiscal_ct, 'iban_ct', v_f.iban_ct, 'iban_last4', v_f.iban_last4,
    'iban_changed_at', v_f.iban_changed_at, 'iban_hold_until', v_f.iban_hold_until,
    'iban_holder_mismatch', v_f.iban_holder_mismatch, 'iban_pending_last4', v_f.iban_pending_last4);
end;
$$;

-- ---------------------------------------------------------------- 14. site: perfil, redes, documentos, mensagens

-- Estado do criador para o layout do site. null sem sessão válida (o layout manda entrar). Atualiza last_seen_at da
-- sessão no máximo 1×/h. notifications: as últimas 20 linhas da fila do próprio (kind, payload, data), que o site
-- mostra com o título de outboxEmail. tasks: o que falta fazer (A: completar o perfil, aceitar os Termos, tomar
-- conhecimento da Política, confirmar o IBAN). As migrações B e C juntam campanhas, entregas e Meta.
create function public.ldo_cr_me(p_token text, p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_c public.ldo_cr_creators;
  v_p public.ldo_cr_profiles;
  v_steps jsonb;
  v_reaccept jsonb;
  v_privacy jsonb;
  v_pending_last4 text;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator(p_session);
  if v_id is null then
    return null;
  end if;
  update public.ldo_cr_logins set last_seen_at = now()
  where token_hash = extensions.digest(p_session, 'sha256') and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  select * into v_c from public.ldo_cr_creators where id = v_id;
  select * into v_p from public.ldo_cr_profiles where creator_id = v_id;
  v_steps := ldo_private.cr_steps(v_id);
  v_reaccept := ldo_private.cr_reaccept(v_id);
  v_privacy := ldo_private.cr_privacy_pending(v_id);
  select iban_pending_last4 into v_pending_last4 from public.ldo_cr_finance where creator_id = v_id;
  return jsonb_build_object(
    'id', v_c.id, 'email', v_c.email, 'status', v_c.status,
    'status_reason', case when v_c.status in ('rejected', 'suspended') then v_c.status_reason end,
    'status_at', v_c.status_at, 'created_at', v_c.created_at,
    'full_name', v_p.full_name, 'display_name', v_p.display_name,
    'first_name', nullif(split_part(coalesce(v_p.full_name, ''), ' ', 1), ''),
    'submitted_at', v_p.submitted_at,
    'onboarding', v_steps,
    'consents', ldo_private.cr_consent_state(v_id),
    'reaccept', v_reaccept,
    'privacy_notice_pending', v_privacy,
    'unread_messages', (select count(*) from public.ldo_cr_messages
      where creator_id = v_id and author_kind <> 'creator' and read_by_creator_at is null),
    'iban_pending_last4', v_pending_last4,
    'tasks', (select coalesce(jsonb_agg(x.t), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'reaccept_terms') as t where jsonb_array_length(v_reaccept) > 0
        union all select jsonb_build_object('kind', 'privacy_notice', 'version', v_privacy ->> 'version') where v_privacy is not null
        union all select jsonb_build_object('kind', 'complete_profile', 'steps', v_steps)
          where v_c.status in ('draft', 'rejected') and not (v_steps ->> 'complete')::boolean
        union all select jsonb_build_object('kind', 'submit_profile')
          where v_c.status in ('draft', 'rejected') and (v_steps ->> 'complete')::boolean
        union all select jsonb_build_object('kind', 'iban_confirm', 'last4', v_pending_last4) where v_pending_last4 is not null
      ) x),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('kind', o.kind, 'payload', o.payload - 'email' - 'token',
        'created_at', o.created_at) order by o.id desc)
      from (select * from public.ldo_cr_outbox where creator_id = v_id order by id desc limit 20) o), '[]'::jsonb)
  );
end;
$$;

-- Perfil para os passos do onboarding e /perfil. available_stores: lojas ativas do dashboard (para as caixas).
create function public.ldo_cr_profile_get(p_token text, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  return jsonb_build_object(
    'status', (select status from public.ldo_cr_creators where id = v_id),
    'profile', (select jsonb_build_object('full_name', p.full_name, 'display_name', p.display_name, 'city', p.city,
        'district', p.district, 'country', p.country, 'bio', p.bio, 'categories', to_jsonb(p.categories),
        'formats', to_jsonb(p.formats), 'languages', to_jsonb(p.languages), 'travel_radius_km', p.travel_radius_km,
        'portfolio_url', p.portfolio_url, 'submitted_at', p.submitted_at, 'updated_at', p.updated_at)
      from public.ldo_cr_profiles p where p.creator_id = v_id),
    'contacts', (select jsonb_build_object('phone', k.phone, 'whatsapp', k.whatsapp, 'preferred', k.preferred)
      from public.ldo_cr_contacts k where k.creator_id = v_id),
    'store_ids', coalesce((select jsonb_agg(cs.store_id) from public.ldo_cr_creator_stores cs where cs.creator_id = v_id), '[]'::jsonb),
    'available_stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'city', s.city)
        order by s.sort_order, s.name) from public.ldo_app_stores s where s.active), '[]'::jsonb),
    'social_accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'handle', a.handle,
        'profile_url', a.profile_url, 'verification', a.verification, 'updated_at', a.updated_at,
        'metrics', (select jsonb_build_object('declared_on', m.declared_on, 'followers', m.followers, 'avg_views', m.avg_views,
            'avg_likes', m.avg_likes, 'avg_comments', m.avg_comments, 'pt_audience_pct', m.pt_audience_pct,
            'engagement_pct', m.engagement_pct, 'validated', m.validated_at is not null)
          from public.ldo_cr_declared_metrics m where m.account_id = a.id order by m.declared_on desc limit 1))
        order by a.platform)
      from public.ldo_cr_social_accounts a where a.creator_id = v_id), '[]'::jsonb),
    'steps', ldo_private.cr_steps(v_id));
end;
$$;

-- Gravar um passo do onboarding (ou /perfil). p_step:
--   about    {full_name, display_name, city, district, country, bio, languages[]}
--   contacts {phone, whatsapp, preferred}
--   content  {categories[], formats[], store_ids[], travel_radius_km, portfolio_url}
--   networks {accounts: [{id?, platform, handle, profile_url?, metrics?}]}   (o mesmo que ldo_cr_social_save, conta a conta)
-- As listas fechadas vêm da aplicação; a BD confirma o formato e o tamanho. Mudar nomes, redes ou lojas num perfil
-- approved liga changed_since_review. Devolve os passos (cr_steps).
create function public.ldo_cr_profile_save(p_token text, p_session text, p_step text, p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_old public.ldo_cr_profiles;
  v_name text;
  v_display text;
  v_city text;
  v_district text;
  v_country text;
  v_bio text;
  v_langs text[];
  v_phone text;
  v_whatsapp boolean;
  v_preferred text;
  v_cats text[];
  v_formats text[];
  v_stores uuid[];
  v_radius integer;
  v_url text;
  v_changed boolean := false;
  v_item jsonb;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Dados inválidos.' using errcode = '22023';
  end if;
  insert into public.ldo_cr_profiles (creator_id) values (v_id) on conflict (creator_id) do nothing;
  select * into v_old from public.ldo_cr_profiles where creator_id = v_id for update;
  if p_step = 'about' then
    v_name := left(btrim(regexp_replace(coalesce(p_data ->> 'full_name', ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 120);
    v_display := nullif(left(btrim(regexp_replace(coalesce(p_data ->> 'display_name', ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 80), '');
    v_city := nullif(left(btrim(coalesce(p_data ->> 'city', '')), 100), '');
    v_district := nullif(left(btrim(coalesce(p_data ->> 'district', '')), 60), '');
    v_country := upper(btrim(coalesce(nullif(p_data ->> 'country', ''), 'PT')));
    v_bio := nullif(btrim(coalesce(p_data ->> 'bio', '')), '');
    if v_name = '' then
      raise exception 'Indique o seu nome.' using errcode = '22023';
    end if;
    -- [rev. S-B3] A mesma regra do registo.
    if v_name ~ '[0-9@/:<>_=?&#%+|{}"]' or v_name ~ '\.[^[:space:]]' then
      raise exception 'Escreva o nome só com letras (pode usar espaço, hífen, apóstrofo e ponto).' using errcode = '22023';
    end if;
    if v_country !~ '^[A-Z]{2}$' then
      raise exception 'Escolha o país.' using errcode = '22023';
    end if;
    if length(coalesce(v_bio, '')) > 1500 then
      raise exception 'A apresentação pode ter até 1500 caracteres.' using errcode = '22023';
    end if;
    v_langs := ldo_private.cr_list(p_data -> 'languages', 'os idiomas', 6);
    if cardinality(v_langs) = 0 then
      raise exception 'Escolha pelo menos um idioma.' using errcode = '22023';
    end if;
    v_changed := v_name is distinct from v_old.full_name or v_display is distinct from v_old.display_name;
    update public.ldo_cr_profiles set full_name = v_name, display_name = v_display, city = v_city, district = v_district,
      country = v_country, bio = v_bio, languages = v_langs, updated_at = now()
    where creator_id = v_id;
  elsif p_step = 'contacts' then
    v_phone := nullif(regexp_replace(coalesce(p_data ->> 'phone', ''), '[[:space:]().-]', '', 'g'), '');
    v_whatsapp := coalesce((p_data ->> 'whatsapp') in ('true', 'on', '1'), false);
    v_preferred := coalesce(nullif(p_data ->> 'preferred', ''), 'email');
    if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
      raise exception 'Indique o telemóvel com o indicativo do país (ex.: +351 912 345 678).' using errcode = '22023';
    end if;
    if v_preferred not in ('email', 'telefone', 'whatsapp') then
      raise exception 'Escolha como prefere ser contactado.' using errcode = '22023';
    end if;
    if v_preferred <> 'email' and v_phone is null then
      raise exception 'Para ser contactado por telefone ou WhatsApp, indique o telemóvel.' using errcode = '22023';
    end if;
    if v_preferred = 'whatsapp' and not v_whatsapp then
      raise exception 'Marque que tem WhatsApp neste número.' using errcode = '22023';
    end if;
    insert into public.ldo_cr_contacts (creator_id, phone, whatsapp, preferred, updated_at)
    values (v_id, v_phone, v_whatsapp and v_phone is not null, v_preferred, now())
    on conflict (creator_id) do update set phone = excluded.phone, whatsapp = excluded.whatsapp,
      preferred = excluded.preferred, updated_at = now();
  elsif p_step = 'content' then
    v_cats := ldo_private.cr_list(p_data -> 'categories', 'as categorias', 12);
    v_formats := ldo_private.cr_list(p_data -> 'formats', 'os formatos', 10);
    if jsonb_typeof(coalesce(p_data -> 'store_ids', '[]'::jsonb)) <> 'array'
       or exists (select 1 from jsonb_array_elements_text(coalesce(p_data -> 'store_ids', '[]'::jsonb)) e
                  where e !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'Escolha as lojas da lista.' using errcode = '22023';
    end if;
    v_stores := array(select distinct e::uuid from jsonb_array_elements_text(coalesce(p_data -> 'store_ids', '[]'::jsonb)) e);
    if exists (select 1 from unnest(v_stores) s where not exists (select 1 from public.ldo_app_stores a where a.id = s and a.active)) then
      raise exception 'Escolha as lojas da lista.' using errcode = '22023';
    end if;
    begin
      v_radius := nullif(btrim(coalesce(p_data ->> 'travel_radius_km', '')), '')::integer;
    exception when others then
      raise exception 'Indique a distância em quilómetros.' using errcode = '22023';
    end;
    if v_radius not between 0 and 500 then
      raise exception 'A distância vai de 0 a 500 km.' using errcode = '22023';
    end if;
    v_url := nullif(btrim(coalesce(p_data ->> 'portfolio_url', '')), '');
    if v_url is not null and (v_url !~ '^https://[^\s]+$' or length(v_url) > 300) then
      raise exception 'O portefólio tem de ser um endereço que comece por https://.' using errcode = '22023';
    end if;
    v_changed := array(select s::text from unnest(v_stores) s order by s::text)
      is distinct from array(select store_id::text from public.ldo_cr_creator_stores where creator_id = v_id order by store_id::text);
    update public.ldo_cr_profiles set categories = v_cats, formats = v_formats, travel_radius_km = v_radius,
      portfolio_url = v_url, updated_at = now()
    where creator_id = v_id;
    delete from public.ldo_cr_creator_stores where creator_id = v_id and not (store_id = any (v_stores));
    insert into public.ldo_cr_creator_stores (creator_id, store_id)
    select v_id, s from unnest(v_stores) s on conflict do nothing;
  elsif p_step = 'networks' then
    if jsonb_typeof(coalesce(p_data -> 'accounts', '[]'::jsonb)) <> 'array' then
      raise exception 'Dados das redes inválidos.' using errcode = '22023';
    end if;
    for v_item in select * from jsonb_array_elements(coalesce(p_data -> 'accounts', '[]'::jsonb)) loop
      perform ldo_private.cr_social_upsert(v_id, v_item);
    end loop;
  else
    raise exception 'Passo desconhecido.' using errcode = '22023';
  end if;
  if v_changed then
    update public.ldo_cr_creators set changed_since_review = true where id = v_id and status = 'approved';
  end if;
  perform ldo_private.cr_log('creator', null, v_id, 'profile.save', v_id, jsonb_build_object('step', p_step));
  return ldo_private.cr_steps(v_id);
end;
$$;

-- Enviar para revisão: passos completos e email confirmado (cr_creator). Grava data_truth (texto de CONSENT_TEXT),
-- passa draft/rejected → pending_review e põe profile_received na fila.
create function public.ldo_cr_profile_submit(p_token text, p_session text, p_text text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_status text;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, true);
  select status into v_status from public.ldo_cr_creators where id = v_id for update;
  if v_status = 'pending_review' then
    raise exception 'O seu perfil já foi enviado: a equipa está a revê-lo.' using errcode = '22023';
  elsif v_status not in ('draft', 'rejected') then
    raise exception 'O seu perfil já foi revisto pela equipa.' using errcode = '22023';
  end if;
  if not (ldo_private.cr_steps(v_id) ->> 'complete')::boolean then
    raise exception 'Complete todos os passos antes de enviar o perfil.' using errcode = '22023';
  end if;
  perform ldo_private.cr_consent(v_id, 'data_truth', true, null, null, p_text, p_ip_hash);
  update public.ldo_cr_creators set status = 'pending_review', status_at = now(), status_reason = null, status_by = null
  where id = v_id;
  update public.ldo_cr_profiles set submitted_at = now() where creator_id = v_id;
  perform ldo_private.cr_outbox(v_id, 'profile_received', '{}'::jsonb);
  perform ldo_private.cr_log('creator', null, v_id, 'profile.submit', v_id, jsonb_build_object('from', v_status));
  return jsonb_build_object('ok', true, 'status', 'pending_review');
end;
$$;

-- Conta declarada (cria ou edita). p_data = {id?, platform, handle, profile_url?, metrics?: {followers, avg_views,
-- avg_likes, avg_comments, pt_audience_pct, engagement_pct}}. [rev. S-B4] O id passa por cr_own (em cr_social_upsert).
create function public.ldo_cr_social_save(p_token text, p_session text, p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_account uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  v_account := ldo_private.cr_social_upsert(v_id, p_data);
  perform ldo_private.cr_log('creator', null, v_id, 'social.save', v_account, '{}'::jsonb);
  return (select jsonb_build_object('id', a.id, 'platform', a.platform, 'handle', a.handle, 'verification', a.verification)
    from public.ldo_cr_social_accounts a where a.id = v_account);
end;
$$;

-- Apagar uma conta declarada (e os números). [rev. S-B4] cr_own. Uma conta verified desliga-se em /redes (C2); a
-- migração C1 junta o caso da conta Instagram com conta pública (= ldo_cr_public_disable).
create function public.ldo_cr_social_delete(p_token text, p_session text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_a public.ldo_cr_social_accounts;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  perform ldo_private.cr_own(v_id, 'social_account', p_id);
  select * into v_a from public.ldo_cr_social_accounts where id = p_id for update;
  if v_a.verification = 'verified' then
    raise exception 'Esta conta está ligada: use «Desligar e apagar os dados» em Redes.' using errcode = '22023';
  end if;
  delete from public.ldo_cr_social_accounts where id = p_id;
  update public.ldo_cr_creators set changed_since_review = true where id = v_id and status = 'approved';
  perform ldo_private.cr_log('creator', null, v_id, 'social.delete', p_id, jsonb_build_object('platform', v_a.platform));
end;
$$;

-- Documento publicado e identificação legal (sem sessão). p_kind: terms | privacy | cookies | meta_data → {document,
-- company, registrations_open}; vazio ou null → {documents: [{id, kind, version, title, published_at}] dos publicados,
-- company, registrations_open} (o formulário de registo usa os ids de terms e privacy).
create function public.ldo_cr_legal_public(p_token text, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.ldo_cr_settings;
  v_company jsonb;
begin
  perform ldo_private.cr_server_check(p_token);
  select * into v_s from public.ldo_cr_settings where id = 1;
  v_company := jsonb_build_object('company_name', v_s.company_name, 'company_nif', v_s.company_nif,
    'company_address', v_s.company_address, 'company_registry', v_s.company_registry,
    'contact_email', v_s.contact_email, 'privacy_email', v_s.privacy_email);
  if coalesce(p_kind, '') = '' then
    return jsonb_build_object('company', v_company, 'registrations_open', v_s.registrations_open,
      'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'version', d.version,
          'title', d.title, 'published_at', d.published_at) order by d.kind)
        from public.ldo_cr_legal_documents d where d.status = 'published' and d.campaign_id is null), '[]'::jsonb));
  end if;
  if p_kind not in ('terms', 'privacy', 'cookies', 'meta_data') then
    raise exception 'Documento desconhecido.' using errcode = '22023';
  end if;
  return jsonb_build_object('company', v_company, 'registrations_open', v_s.registrations_open,
    'document', (select jsonb_build_object('id', d.id, 'kind', d.kind, 'version', d.version, 'title', d.title, 'body', d.body,
        'changes_summary', d.changes_summary, 'published_at', d.published_at)
      from public.ldo_cr_legal_documents d where d.kind = p_kind and d.status = 'published' and d.campaign_id is null));
end;
$$;

-- Nova aceitação dos Termos (terms) ou «Tomei conhecimento» da Política (privacy_notice, que não bloqueia nada)
-- [rev. R-M6]. Só aceita o documento publicado (por isso dispensa cr_own: o id não é de um objeto do criador).
-- Devolve {reaccept, privacy_notice_pending}.
create function public.ldo_cr_legal_accept(p_token text, p_session text, p_doc uuid, p_text text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_d public.ldo_cr_legal_documents;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  select * into v_d from public.ldo_cr_legal_documents
  where id = p_doc and status = 'published' and campaign_id is null and kind in ('terms', 'privacy');
  if v_d.id is null then
    raise exception 'Este documento já foi substituído. Recarregue a página.' using errcode = '22023';
  end if;
  -- A prova é só de acrescento: aceitar outra vez o mesmo documento não grava nada (devolve o estado atual).
  if not exists (select 1 from public.ldo_cr_consents where creator_id = v_id and document_id = v_d.id and granted
      and purpose = case v_d.kind when 'terms' then 'terms' else 'privacy_notice' end) then
    perform ldo_private.cr_consent(v_id, case v_d.kind when 'terms' then 'terms' else 'privacy_notice' end, true, v_d.id, null,
      p_text, p_ip_hash);
    perform ldo_private.cr_log('creator', null, v_id, 'legal.accept', v_d.id,
      jsonb_build_object('kind', v_d.kind, 'version', v_d.version));
  end if;
  return jsonb_build_object('reaccept', ldo_private.cr_reaccept(v_id), 'privacy_notice_pending', ldo_private.cr_privacy_pending(v_id));
end;
$$;

-- Conversa com a equipa (as últimas 200). Abrir marca como lidas as mensagens da equipa e do sistema.
create function public.ldo_cr_messages_list(p_token text, p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  update public.ldo_cr_messages set read_by_creator_at = now()
  where creator_id = v_id and author_kind <> 'creator' and read_by_creator_at is null;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author', m.author_kind, 'body', m.body,
      'ref_kind', m.ref_kind, 'ref_id', m.ref_id, 'created_at', m.created_at, 'read_by_staff_at', m.read_by_staff_at) order by m.id)
    from (select * from public.ldo_cr_messages where creator_id = v_id order by id desc limit 200) m), '[]'::jsonb);
end;
$$;

-- Mensagem do criador. 30 por hora (ldo_cr_attempts message). [rev. S-B4] Com ref_id, cr_own pelo tipo
-- (campanha → campaign, candidatura → application, pedido → request, entrega → submission, pagamento → payment);
-- geral exige ref_id nulo. Na fase A só há geral: os outros tipos ainda não existem e cr_own recusa-os.
create function public.ldo_cr_message_send(p_token text, p_session text, p_body text, p_ref_kind text, p_ref_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_kind text := coalesce(nullif(p_ref_kind, ''), 'geral');
  v_body text := btrim(coalesce(p_body, ''));
  v_msg public.ldo_cr_messages;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  if v_body = '' or length(v_body) > 4000 then
    raise exception 'Escreva a mensagem (até 4000 caracteres).' using errcode = '22023';
  end if;
  if v_kind = 'geral' then
    if p_ref_id is not null then
      raise exception 'Referência inválida.' using errcode = '22023';
    end if;
  elsif v_kind in ('campanha', 'candidatura', 'pedido', 'entrega', 'pagamento') then
    perform ldo_private.cr_own(v_id, case v_kind when 'campanha' then 'campaign' when 'candidatura' then 'application'
      when 'pedido' then 'request' when 'entrega' then 'submission' else 'payment' end, p_ref_id);
  else
    raise exception 'Referência inválida.' using errcode = '22023';
  end if;
  if (select count(*) from public.ldo_cr_attempts where kind = 'message' and creator_id = v_id
      and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Enviou muitas mensagens na última hora. Aguarde um pouco.' using errcode = '22023';
  end if;
  insert into public.ldo_cr_attempts (kind, creator_id) values ('message', v_id);
  insert into public.ldo_cr_messages (creator_id, ref_kind, ref_id, author_kind, body)
  values (v_id, v_kind, p_ref_id, 'creator', v_body)
  returning * into v_msg;
  perform ldo_private.cr_log('creator', null, v_id, 'message.send', v_id, jsonb_build_object('message_id', v_msg.id));
  return jsonb_build_object('id', v_msg.id, 'created_at', v_msg.created_at);
end;
$$;

-- ---------------------------------------------------------------- 15. site: consentimentos, RGPD e apagamento

-- Interruptores permanentes das Definições. Fase A: campaign_news (marketing só volta com um envio real [rev. R-B6]). A migração C2 junta ai_analysis.
create function public.ldo_cr_consent_set(p_token text, p_session text, p_purpose text, p_granted boolean, p_text text,
  p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  if p_purpose not in ('campaign_news') then
    raise exception 'Finalidade inválida.' using errcode = '22023';
  end if;
  -- Só grava quando o estado muda: a tabela é só de acrescento e não pode encher com cliques repetidos.
  if coalesce((ldo_private.cr_consent_state(v_id) -> p_purpose ->> 'granted')::boolean, false) is distinct from coalesce(p_granted, false) then
    perform ldo_private.cr_consent(v_id, p_purpose, coalesce(p_granted, false), null, null, p_text, p_ip_hash);
  end if;
  return ldo_private.cr_consent_state(v_id);
end;
$$;

-- Pedido RGPD feito no site (objection, restriction, human_review, rectification, other): fica open com prazo de
-- 1 mês e a equipa vê-o na visão geral. No máximo 5 abertos por pessoa.
create function public.ldo_cr_privacy_request(p_token text, p_session text, p_kind text, p_details text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_req uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  if p_kind is null or p_kind not in ('objection', 'restriction', 'human_review', 'rectification', 'other') then
    raise exception 'Tipo de pedido inválido.' using errcode = '22023';
  end if;
  if length(coalesce(p_details, '')) > 4000 then
    raise exception 'O pedido pode ter até 4000 caracteres.' using errcode = '22023';
  end if;
  if (select count(*) from public.ldo_cr_privacy_requests where creator_id = v_id and status = 'open') >= 5 then
    raise exception 'Já tem 5 pedidos por responder. Respondemos no prazo de um mês.' using errcode = '22023';
  end if;
  insert into public.ldo_cr_privacy_requests (creator_id, kind, channel, details)
  values (v_id, p_kind, 'self_service', btrim(coalesce(p_details, '')))
  returning id into v_req;
  perform ldo_private.cr_log('creator', null, v_id, 'privacy.request', v_req, jsonb_build_object('kind', p_kind));
  return v_req;
end;
$$;

-- «Descarregar os meus dados» (arts. 15.º e 20.º), com reautenticação: {ok:false, reason:'password'|'rate'} ou
-- {ok:true, data}. data = cr_export_common + finance com os cifrados do próprio (a rota /api/c/export decifra
-- fiscal_ct e iban_ct; o IBAN vai completo porque é dele e houve reautenticação). Nunca iban_pending_ct.
-- Grava um pedido access done (self_service). No máximo 5 exportações por hora.
create function public.ldo_cr_export(p_token text, p_session text, p_password text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_req uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  if not public.ldo_cr_reauth(p_token, p_session, p_password, p_ip_hash) then
    return jsonb_build_object('ok', false, 'reason', 'password');
  end if;
  if (select count(*) from public.ldo_cr_attempts where kind = 'export' and creator_id = v_id
      and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;
  insert into public.ldo_cr_attempts (kind, ip_hash, creator_id) values ('export', ldo_private.cr_ip(p_ip_hash), v_id);
  insert into public.ldo_cr_privacy_requests (creator_id, kind, channel, status, handled_at, response)
  values (v_id, 'access', 'self_service', 'done', now(), 'Dados descarregados pela própria pessoa.')
  returning id into v_req;
  perform ldo_private.cr_log('creator', null, v_id, 'privacy.export', v_req, jsonb_build_object('channel', 'self_service'));
  return jsonb_build_object('ok', true, 'data', ldo_private.cr_export_common(v_id) || jsonb_build_object(
    'finance', (select jsonb_build_object('fiscal_ct', f.fiscal_ct, 'fiscal_complete', f.fiscal_complete,
        'iban_ct', f.iban_ct, 'iban_last4', f.iban_last4, 'iban_country', f.iban_country,
        'iban_holder_mismatch', f.iban_holder_mismatch, 'iban_changed_at', f.iban_changed_at,
        'iban_hold_until', f.iban_hold_until, 'iban_pending_last4', f.iban_pending_last4, 'iban_pending_at', f.iban_pending_at)
      from public.ldo_cr_finance f where f.creator_id = v_id)));
end;
$$;

-- Antes de apagar: {blocked: motivo ou null, first_name, email} (cr_delete_blocker, sem erro). Sem bloqueio, a
-- aplicação envia a confirmação «conta apagada» antes de apagar; com bloqueio, o ecrã explica o que fica [rev. R-M7].
create function public.ldo_cr_delete_check(p_token text, p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  return (select jsonb_build_object('blocked', ldo_private.cr_delete_blocker(v_id),
      'first_name', nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'email', c.email)
    from public.ldo_cr_creators c left join public.ldo_cr_profiles p on p.creator_id = c.id where c.id = v_id);
end;
$$;

-- Apagar a conta (RGPD art. 17.º). O email «A sua conta foi apagada» é enviado pela aplicação NA HORA, antes de
-- chamar esta função (depois o endereço já não existe e a fila por enviar é apagada). Fica o que tem prazo legal
-- (pagamentos, licenças em vigor), já pseudonimizado.
-- Como em finance_save: palavra-passe errada → {ok:false, reason:'password'} sem levantar erro.
-- A aplicação chama primeiro ldo_cr_delete_check (mesmas validações, sem apagar) para enviar o email enquanto o
-- endereço existe; depois chama esta.
-- [rev. R-M7] Com uma colaboração a decorrer NÃO levanta erro (o raise desfazia tudo e o pedido não ficava): apaga
-- já o opcional (cr_erase_optional), deixa UM pedido erasure aberto com o motivo e o prazo de 1 mês (art. 12.º,
-- n.os 3 e 4) e devolve {ok:false, reason:'blocked', detail, request_id}. A equipa conclui com ldo_cr_admin_delete.
create function public.ldo_cr_delete_account(p_token text, p_session text, p_password text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_block text;
  v_req uuid;
begin
  perform ldo_private.cr_server_check(p_token);
  v_id := ldo_private.cr_creator_require(p_session, false);
  if not public.ldo_cr_reauth(p_token, p_session, p_password, p_ip_hash) then
    return jsonb_build_object('ok', false, 'reason', 'password');
  end if;
  v_block := ldo_private.cr_delete_blocker(v_id);
  if v_block is not null then
    perform ldo_private.cr_erase_optional(v_id);
    select id into v_req from public.ldo_cr_privacy_requests
    where creator_id = v_id and kind = 'erasure' and status = 'open' order by received_at desc limit 1;
    if v_req is null then
      insert into public.ldo_cr_privacy_requests (creator_id, kind, channel, details)
      values (v_id, 'erasure', 'self_service', left('Apagamento pedido com uma colaboração a decorrer. ' || v_block, 4000))
      returning id into v_req;
      perform ldo_private.cr_outbox(v_id, 'erasure_blocked', jsonb_build_object('request_id', v_req, 'detail', v_block));
    end if;
    perform ldo_private.cr_log('creator', null, v_id, 'privacy.erasure_blocked', v_req, jsonb_build_object('detail', v_block));
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'detail', v_block, 'request_id', v_req);
  end if;
  update public.ldo_cr_privacy_requests set status = 'done', handled_at = now(),
    response = 'Apagamento concluído pela própria pessoa.'
  where creator_id = v_id and kind = 'erasure' and status = 'open';
  insert into public.ldo_cr_privacy_requests (creator_id, kind, channel, status, handled_at, response)
  values (v_id, 'erasure', 'self_service', 'done', now(), 'Apagamento feito pela própria pessoa.')
  returning id into v_req;
  -- Prova do apagamento (§7.3: privacy.erasure fica audit_decisions_years), como no apagamento pela equipa.
  perform ldo_private.cr_log('creator', null, v_id, 'privacy.erasure', v_req, jsonb_build_object('channel', 'self_service'));
  perform ldo_private.cr_anonymize(v_id, 'self');
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- 16. equipa: criadores, mensagens, notas

-- Contadores da visão geral (fase A). As migrações B e C juntam candidaturas, pedidos, entregas, carregamentos e Meta.
create function public.ldo_cr_overview(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.cr_require(p_session, 'view');
begin
  return jsonb_build_object(
    'profiles_pending', (select count(*) from public.ldo_cr_creators where status = 'pending_review'),
    'profiles_changed', (select count(*) from public.ldo_cr_creators where status = 'approved' and changed_since_review),
    'creators_active', (select count(*) from public.ldo_cr_creators where deleted_at is null and email_verified_at is not null),
    'creators_approved', (select count(*) from public.ldo_cr_creators where status = 'approved'),
    'messages_unread', (select count(*) from public.ldo_cr_messages m join public.ldo_cr_creators c on c.id = m.creator_id
      where m.author_kind = 'creator' and m.read_by_staff_at is null and c.deleted_at is null),
    'privacy_open', (select count(*) from public.ldo_cr_privacy_requests where status = 'open'),
    -- [rev. R-B2] O prazo conta com a prorrogação.
    'privacy_due_soon', (select count(*) from public.ldo_cr_privacy_requests
      where status = 'open' and coalesce(extended_until, due_at) <= now() + interval '7 days'),
    'privacy_overdue', (select count(*) from public.ldo_cr_privacy_requests
      where status = 'open' and coalesce(extended_until, due_at) < now()),
    -- [rev. S-A1]
    'iban_hold', (select count(*) from public.ldo_cr_finance where iban_hold_until > now()),
    'iban_pending', (select count(*) from public.ldo_cr_finance where iban_pending_ct is not null),
    'iban_rejected_30d', (select count(*) from public.ldo_cr_audit
      where action = 'finance.iban_rejected' and created_at > now() - interval '30 days'),
    -- [rev. R-M7] Apagamentos à espera do fim de uma colaboração e os que já podem ser concluídos.
    'erasure_waiting', (select count(*) from public.ldo_cr_privacy_requests r join public.ldo_cr_creators c on c.id = r.creator_id
      where r.kind = 'erasure' and r.status = 'open' and c.deleted_at is null and ldo_private.cr_delete_blocker(c.id) is not null),
    'erasure_ready', (select count(*) from public.ldo_cr_privacy_requests r join public.ldo_cr_creators c on c.id = r.creator_id
      where r.kind = 'erasure' and r.status = 'open' and c.deleted_at is null and ldo_private.cr_delete_blocker(c.id) is null),
    'registrations_open', (select registrations_open from public.ldo_cr_settings where id = 1),
    'legal_published', (select coalesce(jsonb_object_agg(kind, version), '{}'::jsonb) from public.ldo_cr_legal_documents
      where status = 'published' and campaign_id is null));
end;
$$;

-- Lista de criadores. p_filter: {status?, q?, store_id?, platform?, verified?, changed?, page?, order?: 'created'|'name'}.
-- Sem status mostra todos menos os apagados. Ordem por data de registo ou nome, NUNCA por métricas. Seguidores: o
-- último número validado e, sem ele, o último declarado (as migrações C juntam os públicos e os ligados à frente).
-- Devolve {items, total, page, page_size}.
create function public.ldo_cr_creators_list(p_session text, p_filter jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'view');
  v_f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_status text := coalesce(nullif(v_f ->> 'status', ''), '');
  v_q text := lower(nullif(btrim(coalesce(v_f ->> 'q', '')), ''));
  v_store uuid;
  v_platform text := coalesce(nullif(v_f ->> 'platform', ''), '');
  v_verified boolean := case v_f ->> 'verified' when 'true' then true when 'false' then false end;
  v_changed boolean := coalesce(v_f ->> 'changed', '') = 'true';
  v_page integer := 1;
  v_name_order boolean := coalesce(v_f ->> 'order', '') = 'name';
begin
  if coalesce(v_f ->> 'store_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_store := (v_f ->> 'store_id')::uuid;
  end if;
  if coalesce(v_f ->> 'page', '') ~ '^[0-9]{1,6}$' then
    v_page := greatest(1, (v_f ->> 'page')::integer);
  end if;
  return (
    with base as (
      select c.id, c.email, c.status, c.changed_since_review, c.created_at, c.last_login_at,
        p.full_name, p.display_name, p.city, p.district, p.submitted_at
      from public.ldo_cr_creators c left join public.ldo_cr_profiles p on p.creator_id = c.id
      where ((v_status = '' and c.status <> 'deleted') or c.status = v_status)
        and (v_q is null or strpos(c.email, v_q) > 0 or strpos(lower(coalesce(p.full_name, '')), v_q) > 0
          or strpos(lower(coalesce(p.display_name, '')), v_q) > 0
          or exists (select 1 from public.ldo_cr_social_accounts a where a.creator_id = c.id
                     and strpos(lower(a.handle), ltrim(v_q, '@')) > 0))
        and (v_store is null or exists (select 1 from public.ldo_cr_creator_stores s where s.creator_id = c.id and s.store_id = v_store))
        and (v_platform = '' or exists (select 1 from public.ldo_cr_social_accounts a where a.creator_id = c.id and a.platform = v_platform))
        and (v_verified is null or v_verified = exists (select 1 from public.ldo_cr_social_accounts a
             where a.creator_id = c.id and a.verification in ('public', 'verified')))
        and (not v_changed or c.changed_since_review)
    ), page as (
      select * from base
      order by case when v_name_order then lower(coalesce(display_name, full_name, email)) end, created_at desc
      limit 50 offset (v_page - 1) * 50
    )
    select jsonb_build_object('total', (select count(*) from base), 'page', v_page, 'page_size', 50,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'email', b.email, 'full_name', b.full_name, 'display_name', b.display_name, 'city', b.city,
        'district', b.district, 'status', b.status, 'changed_since_review', b.changed_since_review,
        'created_at', b.created_at, 'submitted_at', b.submitted_at, 'last_login_at', b.last_login_at,
        'stores_count', (select count(*) from public.ldo_cr_creator_stores s where s.creator_id = b.id),
        'unread_messages', (select count(*) from public.ldo_cr_messages m where m.creator_id = b.id
          and m.author_kind = 'creator' and m.read_by_staff_at is null),
        'iban_pending', exists (select 1 from public.ldo_cr_finance f where f.creator_id = b.id and f.iban_pending_ct is not null),
        'networks', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'handle', a.handle,
            'verification', a.verification, 'followers', m.followers, 'followers_source', m.source,
            'followers_on', m.declared_on) order by a.platform)
          from public.ldo_cr_social_accounts a
          left join lateral (select dm.followers, dm.declared_on,
              case when dm.validated_at is not null then 'validated' else 'declared' end as source
            from public.ldo_cr_declared_metrics dm where dm.account_id = a.id and dm.followers is not null
            order by (dm.validated_at is not null) desc, dm.declared_on desc limit 1) m on true
          where a.creator_id = b.id), '[]'::jsonb))
        order by case when v_name_order then lower(coalesce(b.display_name, b.full_name, b.email)) end, b.created_at desc)
        from page b), '[]'::jsonb)));
end;
$$;

-- Ficha completa (separadores Perfil, Redes e números, Pagamentos, Mensagens, Notas e histórico). Regista
-- creator.view no máximo 1×/h por pessoa e criador (por isso é volatile). Nunca devolve *_ct nem moradas.
-- shared_with: quantas outras pessoas declararam o mesmo @ na mesma rede (aviso). viewer: nível de quem vê.
create function public.ldo_cr_creator_get(p_session text, p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'view');
  v_c public.ldo_cr_creators;
begin
  select * into v_c from public.ldo_cr_creators where id = p_id;
  if v_c.id is null then
    raise exception 'Criador não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ldo_cr_audit where action = 'creator.view' and staff_id = v_me and creator_id = p_id
                 and created_at > now() - interval '1 hour') then
    perform ldo_private.cr_log('staff', v_me, p_id, 'creator.view', p_id, '{}'::jsonb);
  end if;
  return jsonb_build_object(
    'viewer', jsonb_build_object('level', ldo_private.cr_level(p_session), 'finance', ldo_private.cr_finance(p_session) is not null,
      'super', ldo_private.support_super(p_session) is not null),
    'creator', jsonb_build_object('id', v_c.id, 'email', v_c.email, 'status', v_c.status, 'status_reason', v_c.status_reason,
      'status_at', v_c.status_at, 'status_by', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = v_c.status_by),
      'changed_since_review', v_c.changed_since_review, 'created_at', v_c.created_at, 'email_verified_at', v_c.email_verified_at,
      'adult_declared_at', v_c.adult_declared_at, 'last_login_at', v_c.last_login_at,
      'inactivity_warned_at', v_c.inactivity_warned_at, 'deleted_at', v_c.deleted_at, 'delete_reason', v_c.delete_reason),
    'profile', (select jsonb_build_object('full_name', p.full_name, 'display_name', p.display_name, 'city', p.city,
        'district', p.district, 'country', p.country, 'bio', p.bio, 'categories', to_jsonb(p.categories),
        'formats', to_jsonb(p.formats), 'languages', to_jsonb(p.languages), 'travel_radius_km', p.travel_radius_km,
        'portfolio_url', p.portfolio_url, 'submitted_at', p.submitted_at, 'updated_at', p.updated_at)
      from public.ldo_cr_profiles p where p.creator_id = p_id),
    'steps', ldo_private.cr_steps(p_id),
    'contacts', (select jsonb_build_object('phone', k.phone, 'whatsapp', k.whatsapp, 'preferred', k.preferred, 'updated_at', k.updated_at)
      from public.ldo_cr_contacts k where k.creator_id = p_id),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name) order by s.sort_order, s.name)
      from public.ldo_cr_creator_stores cs join public.ldo_app_stores s on s.id = cs.store_id where cs.creator_id = p_id), '[]'::jsonb),
    'social_accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'handle', a.handle,
        'profile_url', a.profile_url, 'verification', a.verification, 'created_at', a.created_at, 'updated_at', a.updated_at,
        'shared_with', (select count(*) from public.ldo_cr_social_accounts o
          where o.platform = a.platform and lower(o.handle) = lower(a.handle) and o.creator_id <> a.creator_id),
        'metrics', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'declared_on', m.declared_on, 'followers', m.followers,
            'avg_views', m.avg_views, 'avg_likes', m.avg_likes, 'avg_comments', m.avg_comments,
            'pt_audience_pct', m.pt_audience_pct, 'engagement_pct', m.engagement_pct,
            'evidence_file_id', m.evidence_file_id, 'validated_at', m.validated_at,
            'validated_by', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = m.validated_by))
            order by m.declared_on desc)
          from public.ldo_cr_declared_metrics m where m.account_id = a.id), '[]'::jsonb)) order by a.platform)
      from public.ldo_cr_social_accounts a where a.creator_id = p_id), '[]'::jsonb),
    'consents', jsonb_build_object('current', ldo_private.cr_consent_state(p_id),
      'history', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'purpose', c.purpose, 'granted', c.granted,
          'document_id', c.document_id, 'document_version', d.version, 'context', c.context, 'text_shown', c.text_shown,
          'text_hash', c.text_hash, 'created_at', c.created_at) order by c.id desc)
        from public.ldo_cr_consents c left join public.ldo_cr_legal_documents d on d.id = c.document_id
        where c.creator_id = p_id), '[]'::jsonb)),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at,
        'author', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = n.author)) order by n.id desc)
      from public.ldo_cr_notes n where n.creator_id = p_id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author_kind', m.author_kind,
        'author', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = m.author_staff),
        'body', m.body, 'ref_kind', m.ref_kind, 'ref_id', m.ref_id, 'created_at', m.created_at,
        'read_by_creator_at', m.read_by_creator_at, 'read_by_staff_at', m.read_by_staff_at) order by m.id)
      from (select * from public.ldo_cr_messages where creator_id = p_id order by id desc limit 50) m), '[]'::jsonb),
    -- Resumo financeiro sem nada cifrado: o IBAN e os dados fiscais completos só por ldo_cr_finance_reveal.
    'finance', (select jsonb_build_object('fiscal_complete', f.fiscal_complete, 'iban_last4', f.iban_last4,
        'iban_country', f.iban_country, 'iban_changed_at', f.iban_changed_at, 'iban_hold_until', f.iban_hold_until,
        'iban_hold', coalesce(f.iban_hold_until > now(), false), 'iban_holder_mismatch', f.iban_holder_mismatch,
        'iban_pending_last4', f.iban_pending_last4, 'iban_pending_at', f.iban_pending_at,
        'iban_pending_holder_mismatch', f.iban_pending_holder_mismatch, 'updated_at', f.updated_at)
      from public.ldo_cr_finance f where f.creator_id = p_id),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'actor_kind', a.actor_kind,
        'staff', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = a.staff_id),
        'action', a.action, 'target', a.target, 'details', a.details, 'created_at', a.created_at) order by a.id desc)
      from (select * from public.ldo_cr_audit where creator_id = p_id and action <> 'creator.view' order by id desc limit 100) a), '[]'::jsonb),
    'privacy_requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'channel', r.channel,
        'status', r.status, 'received_at', r.received_at, 'due_at', r.due_at, 'extended_until', r.extended_until,
        'effective_due', coalesce(r.extended_until, r.due_at), 'identity_checked', r.identity_checked,
        'details', r.details, 'response', r.response, 'handled_at', r.handled_at) order by r.received_at desc)
      from public.ldo_cr_privacy_requests r where r.creator_id = p_id), '[]'::jsonb),
    'delete_blocker', ldo_private.cr_delete_blocker(p_id));
end;
$$;

-- Decisão sobre o perfil. Transições: pending_review → approved/rejected, approved → suspended,
-- suspended → approved, rejected → pending_review (reabrir), qualquer → restricted (só com um pedido RGPD
-- restriction aberto), restricted → approved/pending_review. Motivo com 10 ou mais caracteres em rejected, suspended e
-- restricted. Aprovar limpa changed_since_review. Fila: profile_approved / profile_rejected / profile_suspended.
create function public.ldo_cr_creator_status(p_session text, p_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_c public.ldo_cr_creators;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
begin
  select * into v_c from public.ldo_cr_creators where id = p_id for update;
  if v_c.id is null or v_c.deleted_at is not null then
    raise exception 'Criador não encontrado.' using errcode = 'P0002';
  end if;
  if not ((v_c.status = 'pending_review' and p_status in ('approved', 'rejected'))
       or (v_c.status = 'approved' and p_status = 'suspended')
       or (v_c.status = 'suspended' and p_status = 'approved')
       or (v_c.status = 'rejected' and p_status = 'pending_review')
       or (v_c.status <> 'restricted' and p_status = 'restricted')
       or (v_c.status = 'restricted' and p_status in ('approved', 'pending_review'))) then
    raise exception 'Não é possível passar de «%» para «%».', v_c.status, coalesce(p_status, '') using errcode = '22023';
  end if;
  if p_status in ('rejected', 'suspended', 'restricted') and length(coalesce(v_reason, '')) < 10 then
    raise exception 'Explique o motivo (pelo menos 10 caracteres).' using errcode = '22023';
  end if;
  if p_status = 'restricted' and not exists (select 1 from public.ldo_cr_privacy_requests
      where creator_id = p_id and kind = 'restriction' and status = 'open') then
    raise exception 'A limitação só se aplica com um pedido RGPD de limitação aberto.' using errcode = '22023';
  end if;
  update public.ldo_cr_creators set status = p_status, status_reason = v_reason, status_at = now(), status_by = v_me,
    changed_since_review = case when p_status = 'approved' then false else changed_since_review end
  where id = p_id;
  if p_status = 'approved' and v_c.status in ('pending_review', 'suspended') then
    perform ldo_private.cr_outbox(p_id, 'profile_approved', '{}'::jsonb);
  elsif p_status = 'rejected' then
    perform ldo_private.cr_outbox(p_id, 'profile_rejected', jsonb_build_object('reason', v_reason));
  elsif p_status = 'suspended' then
    perform ldo_private.cr_outbox(p_id, 'profile_suspended', jsonb_build_object('reason', v_reason));
  end if;
  perform ldo_private.cr_log('staff', v_me, p_id, 'creator.status', p_id,
    jsonb_build_object('from', v_c.status, 'to', p_status, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- Nota interna (o titular pode pedir acesso: a página avisa). Devolve o id.
create function public.ldo_cr_note_add(p_session text, p_id uuid, p_body text) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_body text := btrim(coalesce(p_body, ''));
  v_note bigint;
begin
  if not exists (select 1 from public.ldo_cr_creators where id = p_id and deleted_at is null) then
    raise exception 'Criador não encontrado.' using errcode = 'P0002';
  end if;
  if v_body = '' or length(v_body) > 4000 then
    raise exception 'Escreva a nota (até 4000 caracteres).' using errcode = '22023';
  end if;
  insert into public.ldo_cr_notes (creator_id, author, body) values (p_id, v_me, v_body) returning id into v_note;
  perform ldo_private.cr_log('staff', v_me, p_id, 'creator.note', p_id, jsonb_build_object('note_id', v_note));
  return v_note;
end;
$$;

-- Conversa com um criador (as últimas 200). Abrir marca como lidas as mensagens do criador.
create function public.ldo_cr_staff_messages(p_session text, p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.cr_require(p_session, 'view');
begin
  if not exists (select 1 from public.ldo_cr_creators where id = p_id) then
    raise exception 'Criador não encontrado.' using errcode = 'P0002';
  end if;
  update public.ldo_cr_messages set read_by_staff_at = now()
  where creator_id = p_id and author_kind = 'creator' and read_by_staff_at is null;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author_kind', m.author_kind,
      'author', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = m.author_staff),
      'body', m.body, 'ref_kind', m.ref_kind, 'ref_id', m.ref_id, 'created_at', m.created_at,
      'read_by_creator_at', m.read_by_creator_at, 'read_by_staff_at', m.read_by_staff_at) order by m.id)
    from (select * from public.ldo_cr_messages where creator_id = p_id order by id desc limit 200) m), '[]'::jsonb);
end;
$$;

-- Mensagem da equipa. Põe na fila 'message' no máximo 1 email por criador em cada 15 min (se já houver um por
-- enviar, junta-se a ele). Na fase A só há referência geral (a migração B junta as outras, com a verificação do objeto).
create function public.ldo_cr_staff_message_send(p_session text, p_id uuid, p_body text, p_ref_kind text, p_ref_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_body text := btrim(coalesce(p_body, ''));
  v_msg public.ldo_cr_messages;
  v_last timestamptz;
begin
  if not exists (select 1 from public.ldo_cr_creators where id = p_id and deleted_at is null) then
    raise exception 'Criador não encontrado.' using errcode = 'P0002';
  end if;
  if v_body = '' or length(v_body) > 4000 then
    raise exception 'Escreva a mensagem (até 4000 caracteres).' using errcode = '22023';
  end if;
  if coalesce(nullif(p_ref_kind, ''), 'geral') <> 'geral' or p_ref_id is not null then
    raise exception 'Referência inválida.' using errcode = '22023';
  end if;
  insert into public.ldo_cr_messages (creator_id, author_kind, author_staff, body)
  values (p_id, 'staff', v_me, v_body)
  returning * into v_msg;
  -- payload.count: quantas mensagens o email junta (o texto das mensagens não vai no email).
  update public.ldo_cr_outbox set payload = jsonb_build_object('count', coalesce((payload ->> 'count')::integer, 1) + 1)
  where creator_id = p_id and kind = 'message' and sent_at is null and attempts < 5
    and (lease_until is null or lease_until < now());
  if not found then
    select max(created_at) into v_last from public.ldo_cr_outbox where creator_id = p_id and kind = 'message';
    insert into public.ldo_cr_outbox (kind, creator_id, payload, due_at)
    values ('message', p_id, jsonb_build_object('count', 1), greatest(now(), coalesce(v_last + interval '15 minutes', now())));
  end if;
  perform ldo_private.cr_log('staff', v_me, p_id, 'message.send', p_id, jsonb_build_object('message_id', v_msg.id));
  return jsonb_build_object('id', v_msg.id, 'created_at', v_msg.created_at);
end;
$$;

-- Validar (ou desmarcar) números declarados com a captura das estatísticas. Validar exige evidence_file_id (os
-- ficheiros entram na migração B; até lá não há nada para validar).
create function public.ldo_cr_declared_validate(p_session text, p_metric_id bigint, p_ok boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_m public.ldo_cr_declared_metrics;
  v_creator uuid;
begin
  select * into v_m from public.ldo_cr_declared_metrics where id = p_metric_id for update;
  if v_m.id is null then
    raise exception 'Números não encontrados.' using errcode = 'P0002';
  end if;
  if coalesce(p_ok, false) and v_m.evidence_file_id is null then
    raise exception 'Para validar, o criador tem de juntar a captura das estatísticas.' using errcode = '22023';
  end if;
  select creator_id into v_creator from public.ldo_cr_social_accounts where id = v_m.account_id;
  update public.ldo_cr_declared_metrics set
    validated_by = case when coalesce(p_ok, false) then v_me end,
    validated_at = case when coalesce(p_ok, false) then now() end
  where id = p_metric_id;
  perform ldo_private.cr_log('staff', v_me, v_creator, 'metrics.validate', v_m.account_id,
    jsonb_build_object('metric_id', p_metric_id, 'ok', coalesce(p_ok, false)));
  return jsonb_build_object('ok', true, 'validated', coalesce(p_ok, false));
end;
$$;

-- ---------------------------------------------------------------- 17. equipa: definições e documentos legais

-- Teto de cada prazo de conservação pelo sufixo da chave (dias ≤ 3650, meses ≤ 120, anos ≤ 30, horas ≤ 720)
-- [rev. S-B6]. O piso é o de cr_ret (cr_ret(jsonb_build_object(chave, 0), chave)).
create function ldo_private.cr_ret_max(p_key text) returns integer
language sql immutable set search_path = '' as $$
  select case when p_key ~ '_hours(_|$)' then 720 when p_key ~ '_days(_|$)' then 3650
    when p_key ~ '_months(_|$)' then 120 when p_key ~ '_years(_|$)' then 30 else 0 end;
$$;

-- Definições (todas as pessoas com acesso à área as veem). retention_limits: {chave: {min, max}} para o formulário.
create function public.ldo_cr_settings_get(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'view');
  v_s public.ldo_cr_settings;
begin
  select * into v_s from public.ldo_cr_settings where id = 1;
  return to_jsonb(v_s) - 'updated_by' || jsonb_build_object(
    'updated_by', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = v_s.updated_by),
    'can_edit', ldo_private.support_super(p_session) is not null,
    'retention_limits', (select coalesce(jsonb_object_agg(k, jsonb_build_object(
        'min', ldo_private.cr_ret(jsonb_build_object(k, 0), k), 'max', ldo_private.cr_ret_max(k))), '{}'::jsonb)
      from jsonb_object_keys(v_s.retention) k));
end;
$$;

-- Guardar as definições (Super Admin). Só mudam as chaves presentes em p_data: company_name, company_nif,
-- company_address, company_registry, contact_email, privacy_email, registrations_open, session_days, iban_hold_hours,
-- retention. As migrações B e C fazem «create or replace» para juntar as suas chaves.
-- [rev. S-B6] retention só se grava completa: as chaves que já existem (as do valor por omissão, mais as que as
-- migrações B e C juntarem), todas inteiras, cada uma entre o piso de cr_ret e o teto de cr_ret_max, e
-- inactive_warn_months < inactive_months. Senão, 22023 com o nome da chave. A aplicação repete a validação
-- (retentionProblem). Abrir as inscrições exige Termos e Política publicados. Auditoria settings.save com o antes e
-- o depois.
create function public.ldo_cr_settings_save(p_session text, p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_old public.ldo_cr_settings;
  v_new public.ldo_cr_settings;
  v_r jsonb;
  v_k text;
  v_v numeric;
  v_min integer;
  v_max integer;
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin altera as definições.' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Dados inválidos.' using errcode = '22023';
  end if;
  select * into v_old from public.ldo_cr_settings where id = 1 for update;
  v_new := v_old;
  if p_data ? 'company_name' then v_new.company_name := left(btrim(coalesce(p_data ->> 'company_name', '')), 200); end if;
  if p_data ? 'company_address' then v_new.company_address := left(btrim(coalesce(p_data ->> 'company_address', '')), 400); end if;
  if p_data ? 'company_registry' then v_new.company_registry := left(btrim(coalesce(p_data ->> 'company_registry', '')), 200); end if;
  if p_data ? 'company_nif' then
    v_new.company_nif := regexp_replace(coalesce(p_data ->> 'company_nif', ''), '\s', '', 'g');
    if v_new.company_nif !~ '^([0-9]{9})?$' then
      raise exception 'O NIF da empresa tem 9 algarismos.' using errcode = '22023';
    end if;
  end if;
  if p_data ? 'contact_email' then
    v_new.contact_email := lower(btrim(coalesce(p_data ->> 'contact_email', '')));
    if length(v_new.contact_email) > 254 or v_new.contact_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
      raise exception 'Indique um email de contacto válido.' using errcode = '22023';
    end if;
  end if;
  if p_data ? 'privacy_email' then
    v_new.privacy_email := lower(btrim(coalesce(p_data ->> 'privacy_email', '')));
    if length(v_new.privacy_email) > 254 or v_new.privacy_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
      raise exception 'Indique um email de privacidade válido.' using errcode = '22023';
    end if;
  end if;
  if p_data ? 'registrations_open' then
    if jsonb_typeof(p_data -> 'registrations_open') <> 'boolean' then
      raise exception 'Valor inválido para as inscrições.' using errcode = '22023';
    end if;
    v_new.registrations_open := (p_data ->> 'registrations_open')::boolean;
  end if;
  if p_data ? 'session_days' then
    if jsonb_typeof(p_data -> 'session_days') <> 'number' or (p_data ->> 'session_days')::numeric not between 1 and 30
       or (p_data ->> 'session_days')::numeric <> trunc((p_data ->> 'session_days')::numeric) then
      raise exception 'A sessão dura entre 1 e 30 dias.' using errcode = '22023';
    end if;
    v_new.session_days := (p_data ->> 'session_days')::numeric::integer;
  end if;
  if p_data ? 'iban_hold_hours' then
    if jsonb_typeof(p_data -> 'iban_hold_hours') <> 'number' or (p_data ->> 'iban_hold_hours')::numeric not between 0 and 336
       or (p_data ->> 'iban_hold_hours')::numeric <> trunc((p_data ->> 'iban_hold_hours')::numeric) then
      raise exception 'A espera do IBAN vai de 0 a 336 horas.' using errcode = '22023';
    end if;
    v_new.iban_hold_hours := (p_data ->> 'iban_hold_hours')::numeric::integer;
  end if;
  if p_data ? 'retention' then
    v_r := p_data -> 'retention';
    if v_r is null or jsonb_typeof(v_r) <> 'object' then
      raise exception 'Prazos de conservação inválidos.' using errcode = '22023';
    end if;
    for v_k in select jsonb_object_keys(v_r) loop
      if not (v_old.retention ? v_k) then
        raise exception 'Prazo de conservação desconhecido: %.', v_k using errcode = '22023';
      end if;
    end loop;
    for v_k in select jsonb_object_keys(v_old.retention) loop
      v_min := ldo_private.cr_ret(jsonb_build_object(v_k, 0), v_k);
      v_max := ldo_private.cr_ret_max(v_k);
      if jsonb_typeof(v_r -> v_k) is distinct from 'number' then
        raise exception 'Prazo de conservação em falta ou inválido: % (entre % e %).', v_k, v_min, v_max using errcode = '22023';
      end if;
      v_v := (v_r ->> v_k)::numeric;
      if v_v <> trunc(v_v) or v_v < v_min or v_v > v_max then
        raise exception 'Prazo de conservação inválido: % (entre % e %).', v_k, v_min, v_max using errcode = '22023';
      end if;
    end loop;
    if (v_r ->> 'inactive_warn_months')::numeric >= (v_r ->> 'inactive_months')::numeric then
      raise exception 'O aviso de inatividade (inactive_warn_months) tem de vir antes da anonimização (inactive_months).' using errcode = '22023';
    end if;
    v_new.retention := (select jsonb_object_agg(key, (value #>> '{}')::numeric::integer) from jsonb_each(v_r));
  end if;
  if v_new.registrations_open and not v_old.registrations_open
     and ((ldo_private.cr_doc('terms')).id is null or (ldo_private.cr_doc('privacy')).id is null) then
    raise exception 'Publique os Termos e a Política de Privacidade antes de abrir as inscrições.' using errcode = '22023';
  end if;
  update public.ldo_cr_settings set company_name = v_new.company_name, company_nif = v_new.company_nif,
    company_address = v_new.company_address, company_registry = v_new.company_registry,
    contact_email = v_new.contact_email, privacy_email = v_new.privacy_email,
    registrations_open = v_new.registrations_open, session_days = v_new.session_days,
    iban_hold_hours = v_new.iban_hold_hours, retention = v_new.retention, updated_at = now(), updated_by = v_me
  where id = 1;
  perform ldo_private.cr_log('staff', v_me, null, 'settings.save', null, jsonb_build_object(
    'before', to_jsonb(v_old) - 'updated_at' - 'updated_by', 'after', to_jsonb(v_new) - 'updated_at' - 'updated_by'));
  return public.ldo_cr_settings_get(p_session);
end;
$$;

-- Documentos legais gerais (rascunhos, publicados e retirados), com quantas pessoas aceitaram ou tomaram
-- conhecimento de cada versão (Privacidade: «documentos aceites por versão»).
create function public.ldo_cr_legal_list(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.cr_require(p_session, 'view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'version', d.version, 'title', d.title,
      'body', d.body, 'changes_summary', d.changes_summary, 'status', d.status, 'requires_reacceptance', d.requires_reacceptance,
      'published_at', d.published_at,
      'published_by', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = d.published_by),
      'created_at', d.created_at,
      'created_by', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = d.created_by),
      'accepted_count', (select count(distinct c.creator_id) from public.ldo_cr_consents c where c.document_id = d.id and c.granted))
      order by d.kind, d.created_at desc)
    from public.ldo_cr_legal_documents d where d.campaign_id is null), '[]'::jsonb);
end;
$$;

-- Criar (p_id null) ou editar um rascunho. p_data: {kind (só na criação: terms|privacy|cookies|meta_data), version,
-- title, body, changes_summary, requires_reacceptance (só terms) [rev. R-M6]}. Devolve o id.
create function public.ldo_cr_legal_save(p_session text, p_id uuid, p_data jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_d public.ldo_cr_legal_documents;
  v_kind text;
  v_version text := btrim(coalesce(p_data ->> 'version', ''));
  v_title text := btrim(coalesce(p_data ->> 'title', ''));
  v_body text := coalesce(p_data ->> 'body', '');
  v_summary text := btrim(coalesce(p_data ->> 'changes_summary', ''));
  v_reaccept boolean := coalesce((p_data ->> 'requires_reacceptance') in ('true', 'on', '1'), false);
  v_id uuid;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Dados inválidos.' using errcode = '22023';
  end if;
  if p_id is not null then
    select * into v_d from public.ldo_cr_legal_documents where id = p_id and campaign_id is null for update;
    if v_d.id is null then
      raise exception 'Documento não encontrado.' using errcode = 'P0002';
    end if;
    if v_d.status <> 'draft' then
      raise exception 'Um documento publicado não muda: crie uma versão nova.' using errcode = '22023';
    end if;
    v_kind := v_d.kind;
  else
    v_kind := coalesce(p_data ->> 'kind', '');
  end if;
  if v_kind not in ('terms', 'privacy', 'cookies', 'meta_data') then
    raise exception 'Tipo de documento inválido.' using errcode = '22023';
  end if;
  if v_version !~ '^[0-9]{1,3}\.[0-9]{1,3}$' then
    raise exception 'A versão tem a forma 1.0, 1.1, 2.0…' using errcode = '22023';
  end if;
  if length(v_title) not between 1 and 200 then
    raise exception 'Indique o título (até 200 caracteres).' using errcode = '22023';
  end if;
  if length(v_body) > 200000 or length(v_summary) > 2000 then
    raise exception 'O texto é demasiado longo.' using errcode = '22023';
  end if;
  if v_reaccept and v_kind <> 'terms' then
    raise exception 'Só os Termos pedem nova aceitação: a Política é informação.' using errcode = '22023';
  end if;
  begin
    if p_id is null then
      insert into public.ldo_cr_legal_documents (kind, version, title, body, changes_summary, requires_reacceptance, created_by)
      values (v_kind, v_version, v_title, v_body, v_summary, v_reaccept, v_me)
      returning id into v_id;
    else
      update public.ldo_cr_legal_documents set version = v_version, title = v_title, body = v_body,
        changes_summary = v_summary, requires_reacceptance = v_reaccept
      where id = p_id;
      v_id := p_id;
    end if;
  exception when unique_violation then
    raise exception 'Já existe a versão % deste documento.', v_version using errcode = '22023';
  end;
  perform ldo_private.cr_log('staff', v_me, null, 'legal.save', v_id, jsonb_build_object('kind', v_kind, 'version', v_version));
  return v_id;
end;
$$;

-- Publicar (Super Admin): o publicado anterior do mesmo tipo passa a retired e este a published, numa transação.
-- Termos com requires_reacceptance: fila terms_updated para todos os ativos. Política: fila privacy_updated para
-- todos os ativos, sempre, com o resumo das mudanças («não precisa de aceitar nada») [rev. R-M6]. (legal.publish)
create function public.ldo_cr_legal_publish(p_session text, p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_d public.ldo_cr_legal_documents;
  v_prev uuid;
  v_n integer := 0;
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin publica documentos legais.' using errcode = '42501';
  end if;
  select * into v_d from public.ldo_cr_legal_documents where id = p_id and campaign_id is null for update;
  if v_d.id is null then
    raise exception 'Documento não encontrado.' using errcode = 'P0002';
  end if;
  if v_d.status <> 'draft' then
    raise exception 'Só um rascunho pode ser publicado.' using errcode = '22023';
  end if;
  if btrim(v_d.body) = '' then
    raise exception 'O documento está vazio.' using errcode = '22023';
  end if;
  update public.ldo_cr_legal_documents set status = 'retired'
  where kind = v_d.kind and campaign_id is null and status = 'published'
  returning id into v_prev;
  update public.ldo_cr_legal_documents set status = 'published', published_at = now(), published_by = v_me where id = p_id;
  if (v_d.kind = 'terms' and v_d.requires_reacceptance) or v_d.kind = 'privacy' then
    insert into public.ldo_cr_outbox (kind, creator_id, payload)
    select case v_d.kind when 'terms' then 'terms_updated' else 'privacy_updated' end, c.id,
      jsonb_build_object('document_id', v_d.id, 'version', v_d.version, 'changes_summary', v_d.changes_summary)
    from public.ldo_cr_creators c where c.deleted_at is null and c.email_verified_at is not null;
    get diagnostics v_n = row_count;
  end if;
  perform ldo_private.cr_log('staff', v_me, null, 'legal.publish', p_id, jsonb_build_object('kind', v_d.kind,
    'version', v_d.version, 'previous', v_prev, 'requires_reacceptance', v_d.requires_reacceptance, 'notified', v_n));
  return jsonb_build_object('ok', true, 'notified', v_n, 'retired', v_prev);
end;
$$;

-- ---------------------------------------------------------------- 18. equipa: pedidos RGPD, exportação e apagamento

-- Pedidos RGPD. p_status: null, '' ou 'all' = todos; senão open | done | refused. effective_due = prazo com a
-- prorrogação [rev. R-B2]. Os abertos primeiro, pelo prazo.
create function public.ldo_cr_privacy_list(p_session text, p_status text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.cr_require(p_session, 'view');
begin
  return coalesce((select jsonb_agg(x.item order by x.open desc, x.due) from (
      select r.status = 'open' as open, coalesce(r.extended_until, r.due_at) as due,
        jsonb_build_object('id', r.id, 'creator_id', r.creator_id, 'creator_email', c.email,
          'creator_name', coalesce(p.display_name, p.full_name), 'creator_deleted', c.deleted_at is not null,
          'kind', r.kind, 'channel', r.channel, 'status', r.status, 'received_at', r.received_at, 'due_at', r.due_at,
          'extended_until', r.extended_until, 'extension_reason', r.extension_reason,
          'effective_due', coalesce(r.extended_until, r.due_at), 'details', r.details, 'response', r.response,
          'requester', r.requester, 'identity_checked', r.identity_checked,
          'handled_by', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = r.handled_by),
          'handled_at', r.handled_at) as item
      from public.ldo_cr_privacy_requests r
      left join public.ldo_cr_creators c on c.id = r.creator_id
      left join public.ldo_cr_profiles p on p.creator_id = r.creator_id
      where coalesce(p_status, '') in ('', 'all') or r.status = p_status
      order by r.status = 'open' desc, coalesce(r.extended_until, r.due_at) limit 500) x), '[]'::jsonb);
end;
$$;

-- Atualizar um pedido RGPD. Por esta ordem, numa transação (todas as validações antes de gravar):
--   p_identity_ok não nulo → identity_checked;
--   p_extend (motivo) → prorroga UMA vez, só antes do due_at, até received_at + 3 meses (art. 12.º, n.º 3): grava
--     extended_until e extension_reason e põe privacy_request_extended na fila (privacy.extend) [rev. R-B2];
--   p_status done | refused → fecha com resposta obrigatória; fila privacy_request_done (privacy.update).
create function public.ldo_cr_privacy_update(p_session text, p_id uuid, p_status text, p_response text, p_extend text,
  p_identity_ok boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_r public.ldo_cr_privacy_requests;
  v_extend text := nullif(left(btrim(coalesce(p_extend, '')), 1000), '');
  v_response text := btrim(coalesce(p_response, ''));
  v_close boolean := coalesce(p_status, '') <> '' and p_status is distinct from 'open';
  v_until timestamptz;
begin
  select * into v_r from public.ldo_cr_privacy_requests where id = p_id for update;
  if v_r.id is null then
    raise exception 'Pedido não encontrado.' using errcode = 'P0002';
  end if;
  if coalesce(p_status, '') not in ('', 'open', 'done', 'refused') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  if v_extend is not null then
    if v_r.status <> 'open' then
      raise exception 'Só um pedido aberto pode ser prorrogado.' using errcode = '22023';
    end if;
    if v_r.extended_until is not null then
      raise exception 'Este pedido já foi prorrogado.' using errcode = '22023';
    end if;
    if now() >= v_r.due_at then
      raise exception 'O prazo já passou: a prorrogação tem de ser comunicada dentro do primeiro mês.' using errcode = '22023';
    end if;
    if length(v_extend) < 10 then
      raise exception 'Explique o motivo da prorrogação (pelo menos 10 caracteres).' using errcode = '22023';
    end if;
    v_until := least(v_r.due_at + interval '2 months', v_r.received_at + interval '3 months');
  end if;
  if v_close then
    if v_r.status <> 'open' then
      raise exception 'Este pedido já está fechado.' using errcode = '22023';
    end if;
    if length(v_response) < 5 or length(v_response) > 4000 then
      raise exception 'Escreva a resposta dada ao titular (até 4000 caracteres).' using errcode = '22023';
    end if;
  end if;
  if p_identity_ok is not null then
    update public.ldo_cr_privacy_requests set identity_checked = p_identity_ok where id = p_id;
  end if;
  if v_extend is not null then
    update public.ldo_cr_privacy_requests set extended_until = v_until, extension_reason = v_extend where id = p_id;
    if v_r.creator_id is not null then
      perform ldo_private.cr_outbox(v_r.creator_id, 'privacy_request_extended', jsonb_build_object('request_id', p_id,
        'kind', v_r.kind, 'extended_until', v_until, 'reason', v_extend));
    end if;
    perform ldo_private.cr_log('staff', v_me, v_r.creator_id, 'privacy.extend', p_id,
      jsonb_build_object('extended_until', v_until, 'reason', v_extend));
  end if;
  if v_close then
    update public.ldo_cr_privacy_requests set status = p_status, response = v_response, handled_by = v_me, handled_at = now()
    where id = p_id;
    if v_r.creator_id is not null then
      perform ldo_private.cr_outbox(v_r.creator_id, 'privacy_request_done', jsonb_build_object('request_id', p_id,
        'kind', v_r.kind, 'status', p_status, 'response', v_response));
    end if;
  end if;
  if v_close or p_identity_ok is not null then
    perform ldo_private.cr_log('staff', v_me, v_r.creator_id, 'privacy.update', p_id,
      jsonb_build_object('status', case when v_close then p_status end, 'identity_checked', p_identity_ok));
  end if;
  return (select jsonb_build_object('id', r.id, 'status', r.status, 'identity_checked', r.identity_checked,
      'extended_until', r.extended_until, 'effective_due', coalesce(r.extended_until, r.due_at))
    from public.ldo_cr_privacy_requests r where r.id = p_id);
end;
$$;

-- [rev. R-B2] Registar um pedido recebido por email ou por outro canal (channel email | staff), também de terceiros
-- (p_creator nulo e p_requester com o nome e o contacto). received_at entre há 30 dias e agora (nulo = agora);
-- due_at = received_at + 1 mês. (privacy.register)
create function public.ldo_cr_privacy_register(p_session text, p_creator uuid, p_kind text, p_channel text, p_details text,
  p_received_at timestamptz, p_requester text, p_identity_ok boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_received timestamptz := coalesce(p_received_at, now());
  v_requester text := left(btrim(coalesce(p_requester, '')), 300);
  v_req uuid;
begin
  if p_kind is null or p_kind not in ('access', 'portability', 'rectification', 'erasure', 'objection', 'restriction',
      'human_review', 'withdrawal', 'other') then
    raise exception 'Tipo de pedido inválido.' using errcode = '22023';
  end if;
  if p_channel is null or p_channel not in ('email', 'staff') then
    raise exception 'Canal inválido.' using errcode = '22023';
  end if;
  if v_received > now() + interval '5 minutes' or v_received < now() - interval '30 days' then
    raise exception 'A data de receção tem de estar entre há 30 dias e agora.' using errcode = '22023';
  end if;
  if p_creator is not null and not exists (select 1 from public.ldo_cr_creators where id = p_creator) then
    raise exception 'Criador não encontrado.' using errcode = 'P0002';
  end if;
  if p_creator is null and length(v_requester) < 3 then
    raise exception 'Indique quem fez o pedido (nome e contacto).' using errcode = '22023';
  end if;
  if length(coalesce(p_details, '')) > 4000 then
    raise exception 'O detalhe pode ter até 4000 caracteres.' using errcode = '22023';
  end if;
  insert into public.ldo_cr_privacy_requests (creator_id, kind, channel, received_at, due_at, details, requester, identity_checked)
  values (p_creator, p_kind, p_channel, least(v_received, now()), least(v_received, now()) + interval '1 month',
    btrim(coalesce(p_details, '')), v_requester, coalesce(p_identity_ok, false))
  returning id into v_req;
  perform ldo_private.cr_log('staff', v_me, p_creator, 'privacy.register', v_req,
    jsonb_build_object('kind', p_kind, 'channel', p_channel, 'third_party', p_creator is null));
  return v_req;
end;
$$;

-- Exportação pela equipa [rev. R-M9, S-M8]: só com o pedido RGPD access ou portability desse criador, aberto e com a
-- identidade confirmada (senão 22023). O JSON não tem nenhum dado cifrado (só o resumo financeiro) e leva a nota
-- de onde estão os dados completos. Envia-se só para o email da conta (send_to). (privacy.export, com o pedido)
create function public.ldo_cr_admin_export(p_session text, p_id uuid, p_request uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_c public.ldo_cr_creators;
begin
  select * into v_c from public.ldo_cr_creators where id = p_id;
  if v_c.id is null then
    raise exception 'Criador não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ldo_cr_privacy_requests where id = p_request and creator_id = p_id
      and kind in ('access', 'portability') and status = 'open' and identity_checked) then
    raise exception 'Registe primeiro o pedido de acesso ou portabilidade desta pessoa e confirme a identidade.' using errcode = '22023';
  end if;
  perform ldo_private.cr_log('staff', v_me, p_id, 'privacy.export', p_request, jsonb_build_object('request_id', p_request));
  return ldo_private.cr_export_common(p_id) || jsonb_build_object(
    'finance', (select jsonb_build_object('fiscal_complete', f.fiscal_complete, 'iban_last4', f.iban_last4,
        'iban_country', f.iban_country, 'iban_changed_at', f.iban_changed_at)
      from public.ldo_cr_finance f where f.creator_id = p_id),
    'note', 'O IBAN, os dados fiscais e as moradas completos estão em Definições → Descarregar os meus dados, com a palavra-passe.',
    'request_id', p_request,
    'send_to', v_c.email);
end;
$$;

-- Apagamento pela equipa (Super Admin). Sem p_minor: exige p_request = pedido erasure desse criador, aberto, com a
-- identidade confirmada ou feito no site (self_service, o caso de R-M7) [rev. R-M9]; corre cr_delete_blockers e
-- cr_anonymize(id, 'staff') e fecha como done TODOS os pedidos erasure abertos (privacy.erasure). Com p_minor
-- [rev. R-B3]: pedido opcional, motivo com 10 ou mais caracteres, sem esperar pelos bloqueios; cr_anonymize(id,
-- 'minor') (creator.minor). A migração B junta o cancelamento das colaborações. Devolve o email e o primeiro nome
-- de antes, para a aplicação avisar a pessoa.
create function public.ldo_cr_admin_delete(p_session text, p_id uuid, p_reason text, p_request uuid, p_minor boolean)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.cr_require(p_session, 'manage');
  v_c public.ldo_cr_creators;
  v_first text;
  v_minor boolean := coalesce(p_minor, false);
  v_reason text := left(btrim(coalesce(p_reason, '')), 1000);
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin apaga contas.' using errcode = '42501';
  end if;
  select * into v_c from public.ldo_cr_creators where id = p_id for update;
  if v_c.id is null or v_c.deleted_at is not null then
    raise exception 'Criador não encontrado.' using errcode = 'P0002';
  end if;
  if v_minor then
    if length(v_reason) < 10 then
      raise exception 'Explique o motivo (pelo menos 10 caracteres).' using errcode = '22023';
    end if;
    if p_request is not null and not exists (select 1 from public.ldo_cr_privacy_requests where id = p_request and creator_id = p_id) then
      raise exception 'Pedido RGPD não encontrado.' using errcode = '22023';
    end if;
  else
    if not exists (select 1 from public.ldo_cr_privacy_requests where id = p_request and creator_id = p_id
        and kind = 'erasure' and status = 'open' and (identity_checked or channel = 'self_service')) then
      raise exception 'Registe primeiro o pedido de apagamento desta pessoa e confirme a identidade.' using errcode = '22023';
    end if;
    perform ldo_private.cr_delete_blockers(p_id);
  end if;
  select nullif(split_part(coalesce(full_name, ''), ' ', 1), '') into v_first from public.ldo_cr_profiles where creator_id = p_id;
  update public.ldo_cr_privacy_requests set status = 'done', handled_by = v_me, handled_at = now(),
    response = case when v_minor then 'Conta apagada pela equipa (menor de idade).' else 'Apagamento concluído pela equipa.' end
  where creator_id = p_id and status = 'open' and (kind = 'erasure' or id = p_request);
  perform ldo_private.cr_anonymize(p_id, case when v_minor then 'minor' else 'staff' end);
  perform ldo_private.cr_log('staff', v_me, p_id, case when v_minor then 'creator.minor' else 'privacy.erasure' end, p_id,
    jsonb_build_object('request_id', p_request, 'reason', nullif(v_reason, '')));
  return jsonb_build_object('ok', true, 'email', v_c.email, 'first_name', v_first);
end;
$$;

-- ---------------------------------------------------------------- 19. limpeza diária (prazos de conservação, §7)

-- [rev. S-B6] Prazo de conservação com piso. Um valor abaixo do piso (por engano, ou com uma sessão de Super Admin
-- roubada) apagaria na limpeza seguinte provas que a lei manda guardar. ldo_cr_settings_save recusa-o (22023) e,
-- se mesmo assim lá chegar, a limpeza usa o piso. Chave em falta ou não numérica → null → nada se apaga nessa
-- categoria. Pisos [a confirmar: advogado]: payments_years 10, consents_years_after_end 5, audit_decisions_years 5,
-- inactive_months 12, proof_years 3 [rev. R-M10]; os restantes 1. Mudam só com migração.
create function ldo_private.cr_ret(p_r jsonb, p_key text) returns integer
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_r -> p_key) = 'number' then
    greatest((p_r ->> p_key)::numeric::integer, case p_key
      when 'payments_years' then 10 when 'consents_years_after_end' then 5 when 'audit_decisions_years' then 5
      when 'inactive_months' then 12 when 'proof_years' then 3 else 1 end)
  end;
$$;

create function ldo_private.cr_retention() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := (select retention from public.ldo_cr_settings where id = 1);
  v record;
  -- [rev. S-B6] Todos os prazos passam por cr_ret (piso; chave em falta → null → não apaga).
  -- [rev. R-B9] Limitação do tratamento (art. 18.º, n.º 1, al. c)): a limpeza não apaga dados de quem a pediu.
  -- Exceções: segurança (tentativas, tokens, sessões, IBAN pendente) e, na migração C, os dados da Meta (termos 3.d).
  v_restricted uuid[] := array(select id from public.ldo_cr_creators where status = 'restricted');
  -- [rev. R-M3] Decisões e provas RGPD: audit_decisions_years (5). finance.reveal segue os pagamentos (migração B).
  -- Acrescentadas: R-M7, R-M8, R-M14, R-B2, R-B3, R-B5.
  v_decisions text[] := array['creator.status', 'creator.minor', 'legal.publish', 'settings.save', 'privacy.export',
    'privacy.register', 'privacy.extend', 'privacy.erasure_blocked', 'privacy.erasure', 'meta.data_deletion', 'meta.deauthorize',
    'finance.iban_confirmed', 'finance.iban_rejected', 'finance.iban_confirm_refused', 'licence.image_revoked', 'ai.consent_withdrawn',
    'incident.lockdown'];
begin
  perform set_config('ldo.cr_retention', 'on', true);
  delete from public.ldo_cr_attempts where created_at < now() - make_interval(days => ldo_private.cr_ret(r, 'attempts_days'));
  delete from public.ldo_cr_tokens where created_at < now() - interval '30 days';
  update public.ldo_cr_logins set revoked_at = now() where revoked_at is null and expires_at < now();
  delete from public.ldo_cr_logins where revoked_at < now() - interval '90 days';
  -- Contas nunca confirmadas (cr_anonymize apaga também os consentimentos delas [rev. R-M11]).
  for v in select id from public.ldo_cr_creators where email_verified_at is null and deleted_at is null
           and created_at < now() - make_interval(days => ldo_private.cr_ret(r, 'unverified_days')) loop
    perform ldo_private.cr_anonymize(v.id, 'unverified');
  end loop;
  -- Inatividade: aviso aos 22 meses e anonimização aos 24, se nada o impedir (senão fica registado para a equipa).
  -- Nunca com a limitação em curso [rev. R-B9].
  for v in select id, coalesce(last_login_at, created_at) as last_seen from public.ldo_cr_creators
           where deleted_at is null and inactivity_warned_at is null and status <> 'restricted'
           and coalesce(last_login_at, created_at) < now() - make_interval(months => ldo_private.cr_ret(r, 'inactive_warn_months')) loop
    perform ldo_private.cr_outbox(v.id, 'inactivity_warning', jsonb_build_object('delete_on',
      v.last_seen + make_interval(months => ldo_private.cr_ret(r, 'inactive_months'))));
    update public.ldo_cr_creators set inactivity_warned_at = now() where id = v.id;
  end loop;
  for v in select id from public.ldo_cr_creators where deleted_at is null and status <> 'restricted'
           and coalesce(last_login_at, created_at) < now() - make_interval(months => ldo_private.cr_ret(r, 'inactive_months')) loop
    begin
      perform ldo_private.cr_delete_blockers(v.id);
      perform ldo_private.cr_anonymize(v.id, 'inactivity');
    exception when sqlstate '22023' then
      perform ldo_private.cr_log('system', null, v.id, 'retention.blocked', v.id, jsonb_build_object('detail', sqlerrm));
    end;
  end loop;
  delete from public.ldo_cr_messages where created_at < now() - make_interval(months => ldo_private.cr_ret(r, 'messages_months'))
    and not (creator_id = any (v_restricted));
  -- [rev. R-M11] Números declarados: 24 meses, guardando sempre o mais recente de cada conta (é o que as sugestões usam).
  delete from public.ldo_cr_declared_metrics m using public.ldo_cr_social_accounts a
  where a.id = m.account_id and not (a.creator_id = any (v_restricted))
    and m.declared_on < (now() - make_interval(months => ldo_private.cr_ret(r, 'declared_metrics_months')))::date
    and exists (select 1 from public.ldo_cr_declared_metrics n where n.account_id = m.account_id and n.declared_on > m.declared_on);
  -- Auditoria (só de acrescento): 12 meses para o corrente; as decisões e as provas RGPD ficam audit_decisions_years.
  delete from public.ldo_cr_audit where created_at < now() - make_interval(months => ldo_private.cr_ret(r, 'audit_months'))
    and action <> 'finance.reveal' and not (action = any (v_decisions))
    and (creator_id is null or not (creator_id = any (v_restricted)));
  delete from public.ldo_cr_audit where created_at < now() - make_interval(years => ldo_private.cr_ret(r, 'audit_decisions_years'))
    and action = any (v_decisions) and (creator_id is null or not (creator_id = any (v_restricted)));
  -- Enviadas, e também as que falharam 5 vezes (ldo_cr_outbox_claim já não as escolhe): o mesmo prazo, contado da criação.
  delete from public.ldo_cr_outbox
  where (sent_at < now() - make_interval(days => ldo_private.cr_ret(r, 'outbox_days')))
     or (sent_at is null and attempts >= 5 and created_at < now() - make_interval(days => ldo_private.cr_ret(r, 'outbox_days')));
  -- [rev. S-A1] IBAN pendentes nunca confirmados.
  update public.ldo_cr_finance set iban_pending_ct = null, iban_pending_last4 = null, iban_pending_country = null,
    iban_pending_holder_mismatch = false, iban_pending_at = null
  where iban_pending_at < now() - interval '30 days';
  delete from public.ldo_cr_privacy_requests where status <> 'open'
    and received_at < now() - make_interval(years => ldo_private.cr_ret(r, 'privacy_requests_years'))
    and (creator_id is null or not (creator_id = any (v_restricted)));
  -- Consentimentos de contas apagadas há mais do que o prazo.
  delete from public.ldo_cr_consents c using public.ldo_cr_creators k
  where k.id = c.creator_id and k.deleted_at < now() - make_interval(years => ldo_private.cr_ret(r, 'consents_years_after_end'));
  -- Migrações B e C: «create or replace» com candidaturas, moradas, ficheiros, pedidos, dados Meta, indicadores e IA,
  -- sempre com o filtro de v_restricted, salvo nos dados da Meta [rev. R-B9].
end;
$$;

-- Diária às 03:41 (pg_cron; não chama nenhuma rota, por isso fica nesta migração). Parar:
-- select cron.unschedule('ldo-creators-retention');
select cron.schedule('ldo-creators-retention', '41 3 * * *', $$select ldo_private.cr_retention()$$);

-- ---------------------------------------------------------------- 20. servidor: tick, fila de emails, avisos, rotação

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ldo_creators_tick',
  'Token da verificação automática da plataforma de criadores (pg_cron -> /api/c/tick)')
where not exists (select 1 from vault.secrets where name = 'ldo_creators_tick');

create function public.ldo_cr_tick_check(p_token text, p_value text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_secret text;
begin
  perform ldo_private.cr_server_check(p_token);
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ldo_creators_tick';
  return v_secret is not null and coalesce(p_value, '') <> ''
    and extensions.digest(p_value, 'sha256') = extensions.digest(v_secret, 'sha256');
end;
$$;

-- Fila de emails, igual à do leilão (lease de 2 min, até 5 tentativas, nova tentativa 10 min depois). Junta o email,
-- o primeiro nome (só de contas com o email confirmado [rev. S-B3]) e o estado; nunca IBAN, NIF nem morada.
-- deleted = true → a aplicação marca como feito sem enviar.
create function public.ldo_cr_outbox_claim(p_token text, p_limit integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_lease timestamptz := now() + interval '2 minutes';
  v_out jsonb;
begin
  perform ldo_private.cr_server_check(p_token);
  -- (Um WITH que altera dados tem de estar no topo da instrução.)
  with picked as (
    select o.id from public.ldo_cr_outbox o
    where o.sent_at is null and o.due_at <= now() and o.attempts < 5 and (o.lease_until is null or o.lease_until < now())
    order by o.due_at limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ), upd as (
    update public.ldo_cr_outbox o set lease_until = v_lease from picked where o.id = picked.id returning o.*
  )
  select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'payload', u.payload, 'lease', v_lease,
    'created_at', u.created_at, 'email', c.email,
    'first_name', case when c.email_verified_at is not null
      then nullif(split_part(coalesce(p.full_name, p.display_name, ''), ' ', 1), '') end,
    'status', c.status, 'deleted', c.deleted_at is not null))
  into v_out
  from upd u join public.ldo_cr_creators c on c.id = u.creator_id
  left join public.ldo_cr_profiles p on p.creator_id = u.creator_id;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;

create function public.ldo_cr_outbox_done(p_token text, p_id bigint, p_lease timestamptz, p_ok boolean, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.cr_server_check(p_token);
  if p_ok then
    update public.ldo_cr_outbox set sent_at = now(), lease_until = null, detail = left(p_detail, 500)
    where id = p_id and lease_until = p_lease;
  else
    update public.ldo_cr_outbox set attempts = attempts + 1, lease_until = null, detail = left(p_detail, 500),
      due_at = now() + interval '10 minutes'
    where id = p_id and lease_until = p_lease;
  end if;
end;
$$;

-- [rev. S-M8] Destinatários dos avisos de segurança da área (revelações de IBAN acima do normal): os Super Admin
-- ativos com email. Só o servidor (CREATORS_SERVER_TOKEN); o email sai da aplicação em after().
create function public.ldo_cr_staff_alert_recipients(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.cr_server_check(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'name', coalesce(u.full_name, u.username)))
    from public.ldo_app_users u where u.active and u.is_super_admin and u.email is not null), '[]'::jsonb);
end;
$$;

-- [rev. S-B12] Rotação da chave de cifra (também ação de incidente, R-M14). Com CREATORS_ENCRYPTION_KEY =
-- "c2:<nova>,c1:<antiga>" e CREATORS_RESEAL_FROM = "c1", o tick pede lotes de *_ct ainda em c1., abre-os com c1,
-- volta a cifrá-los com c2 (a mesma AAD) e grava-os só se o valor não mudou entretanto. Não mexe em iban_changed_at.
-- Quando o lote vem vazio, retira-se c1. As migrações B e C juntam address_ct, payee_ct e token_ct (create or replace).
-- Devolve [{t, id, col, aad, ct}].
create function public.ldo_cr_reseal_batch(p_token text, p_from text, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.cr_server_check(p_token);
  if coalesce(p_from, '') !~ '^c[0-9]+$' then
    raise exception 'Versão inválida.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(x) from (
      select 'finance' as t, creator_id as id, 'fiscal_ct' as col, 'fiscal:' || creator_id as aad, fiscal_ct as ct
        from public.ldo_cr_finance where fiscal_ct like p_from || '.%'
      union all
      select 'finance', creator_id, 'iban_ct', 'iban:' || creator_id, iban_ct
        from public.ldo_cr_finance where iban_ct like p_from || '.%'
      union all
      select 'finance', creator_id, 'iban_pending_ct', 'iban:' || creator_id, iban_pending_ct
        from public.ldo_cr_finance where iban_pending_ct like p_from || '.%'
      limit greatest(1, least(coalesce(p_limit, 50), 200))) x), '[]'::jsonb);
end;
$$;

create function public.ldo_cr_reseal_put(p_token text, p_table text, p_id uuid, p_col text, p_old text, p_new text)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.cr_server_check(p_token);
  if p_old is null or coalesce(p_new, '') !~ '^c[0-9]+\.' then
    raise exception 'Valor inválido.' using errcode = '22023';
  end if;
  if p_table = 'finance' and p_col = 'fiscal_ct' then
    update public.ldo_cr_finance set fiscal_ct = p_new where creator_id = p_id and fiscal_ct = p_old;
  elsif p_table = 'finance' and p_col = 'iban_ct' then
    update public.ldo_cr_finance set iban_ct = p_new where creator_id = p_id and iban_ct = p_old;
  elsif p_table = 'finance' and p_col = 'iban_pending_ct' then
    update public.ldo_cr_finance set iban_pending_ct = p_new where creator_id = p_id and iban_pending_ct = p_old;
  else
    raise exception 'Coluna desconhecida.' using errcode = '22023';
  end if;
  return found;
end;
$$;

-- ---------------------------------------------------------------- 21. acessos às funções

revoke all on function
  ldo_private.cr_server_check(text),
  ldo_private.cr_level(text), ldo_private.cr_require(text, text), ldo_private.cr_finance(text),
  ldo_private.cr_creator(text), ldo_private.cr_reaccept(uuid), ldo_private.cr_privacy_pending(uuid), ldo_private.cr_creator_require(text, boolean),
  ldo_private.cr_hash(text), ldo_private.cr_ip(text), ldo_private.cr_check_password(text), ldo_private.cr_new_token(uuid, text, integer),
  ldo_private.cr_log(text, uuid, uuid, text, uuid, jsonb), ldo_private.cr_outbox(uuid, text, jsonb),
  ldo_private.cr_login_locked(text, text), ldo_private.cr_lock_notice(uuid),
  ldo_private.cr_doc(text), ldo_private.cr_consent(uuid, text, boolean, uuid, jsonb, text, text),
  ldo_private.cr_consent_state(uuid), ldo_private.cr_anonymize(uuid, text), ldo_private.cr_delete_blocker(uuid), ldo_private.cr_delete_blockers(uuid), ldo_private.cr_erase_optional(uuid),
  ldo_private.cr_append_only(), ldo_private.cr_legal_guard(),
  ldo_private.cr_steps(uuid), ldo_private.cr_list(jsonb, text, integer), ldo_private.cr_social_upsert(uuid, jsonb),
  ldo_private.cr_export_common(uuid),
  ldo_private.cr_retention(),
  ldo_private.cr_own(uuid, text, uuid),   -- [rev. S-B4]
  ldo_private.cr_ret(jsonb, text),        -- [rev. S-B6]
  ldo_private.cr_ret_max(text)
from public, anon, authenticated;

revoke all on function
  -- equipa (p_session)
  public.ldo_cr_set_user_access(text, uuid, text, boolean), public.ldo_cr_overview(text),
  public.ldo_cr_creators_list(text, jsonb), public.ldo_cr_creator_get(text, uuid),
  public.ldo_cr_creator_status(text, uuid, text, text), public.ldo_cr_note_add(text, uuid, text),
  public.ldo_cr_staff_messages(text, uuid), public.ldo_cr_staff_message_send(text, uuid, text, text, uuid),
  public.ldo_cr_declared_validate(text, bigint, boolean), public.ldo_cr_finance_reveal(text, uuid, text, boolean, text),
  public.ldo_cr_settings_get(text), public.ldo_cr_settings_save(text, jsonb), public.ldo_cr_legal_list(text),
  public.ldo_cr_legal_save(text, uuid, jsonb), public.ldo_cr_legal_publish(text, uuid),
  public.ldo_cr_privacy_list(text, text), public.ldo_cr_privacy_update(text, uuid, text, text, text, boolean), public.ldo_cr_privacy_register(text, uuid, text, text, text, timestamptz, text, boolean),
  public.ldo_cr_admin_export(text, uuid, uuid), public.ldo_cr_admin_delete(text, uuid, text, uuid, boolean), public.ldo_cr_lockdown(text, text),
  -- site (p_token + p_session)
  public.ldo_cr_register(text, text, text, text, uuid, uuid, boolean, jsonb, text),
  public.ldo_cr_verify_email(text, text, text, text), public.ldo_cr_login(text, text, text, text), public.ldo_cr_logout(text, text),
  public.ldo_cr_reset_request(text, text, text), public.ldo_cr_reset(text, text, text),
  public.ldo_cr_password_change(text, text, text, text, text), public.ldo_cr_reauth(text, text, text, text),
  public.ldo_cr_iban_confirm(text, text, boolean, text), public.ldo_cr_iban_resend(text, text, text),
  public.ldo_cr_me(text, text), public.ldo_cr_profile_get(text, text), public.ldo_cr_profile_save(text, text, text, jsonb),
  public.ldo_cr_profile_submit(text, text, text, text), public.ldo_cr_social_save(text, text, jsonb),
  public.ldo_cr_social_delete(text, text, uuid), public.ldo_cr_finance_get(text, text),
  public.ldo_cr_finance_save(text, text, text, jsonb, text), public.ldo_cr_consent_set(text, text, text, boolean, text, text),
  public.ldo_cr_legal_public(text, text), public.ldo_cr_legal_accept(text, text, uuid, text, text),
  public.ldo_cr_messages_list(text, text), public.ldo_cr_message_send(text, text, text, text, uuid),
  public.ldo_cr_privacy_request(text, text, text, text), public.ldo_cr_export(text, text, text, text),
  public.ldo_cr_delete_check(text, text), public.ldo_cr_delete_account(text, text, text, text),
  -- servidor (p_token)
  public.ldo_cr_outbox_claim(text, integer), public.ldo_cr_outbox_done(text, bigint, timestamptz, boolean, text),
  public.ldo_cr_tick_check(text, text), public.ldo_cr_staff_alert_recipients(text),
  public.ldo_cr_reseal_batch(text, text, integer), public.ldo_cr_reseal_put(text, text, uuid, text, text, text)
from public, authenticated;

grant execute on function
  public.ldo_cr_set_user_access(text, uuid, text, boolean), public.ldo_cr_overview(text),
  public.ldo_cr_creators_list(text, jsonb), public.ldo_cr_creator_get(text, uuid),
  public.ldo_cr_creator_status(text, uuid, text, text), public.ldo_cr_note_add(text, uuid, text),
  public.ldo_cr_staff_messages(text, uuid), public.ldo_cr_staff_message_send(text, uuid, text, text, uuid),
  public.ldo_cr_declared_validate(text, bigint, boolean), public.ldo_cr_finance_reveal(text, uuid, text, boolean, text),
  public.ldo_cr_settings_get(text), public.ldo_cr_settings_save(text, jsonb), public.ldo_cr_legal_list(text),
  public.ldo_cr_legal_save(text, uuid, jsonb), public.ldo_cr_legal_publish(text, uuid),
  public.ldo_cr_privacy_list(text, text), public.ldo_cr_privacy_update(text, uuid, text, text, text, boolean), public.ldo_cr_privacy_register(text, uuid, text, text, text, timestamptz, text, boolean),
  public.ldo_cr_admin_export(text, uuid, uuid), public.ldo_cr_admin_delete(text, uuid, text, uuid, boolean), public.ldo_cr_lockdown(text, text),
  public.ldo_cr_register(text, text, text, text, uuid, uuid, boolean, jsonb, text),
  public.ldo_cr_verify_email(text, text, text, text), public.ldo_cr_login(text, text, text, text), public.ldo_cr_logout(text, text),
  public.ldo_cr_reset_request(text, text, text), public.ldo_cr_reset(text, text, text),
  public.ldo_cr_password_change(text, text, text, text, text), public.ldo_cr_reauth(text, text, text, text),
  public.ldo_cr_iban_confirm(text, text, boolean, text), public.ldo_cr_iban_resend(text, text, text),
  public.ldo_cr_me(text, text), public.ldo_cr_profile_get(text, text), public.ldo_cr_profile_save(text, text, text, jsonb),
  public.ldo_cr_profile_submit(text, text, text, text), public.ldo_cr_social_save(text, text, jsonb),
  public.ldo_cr_social_delete(text, text, uuid), public.ldo_cr_finance_get(text, text),
  public.ldo_cr_finance_save(text, text, text, jsonb, text), public.ldo_cr_consent_set(text, text, text, boolean, text, text),
  public.ldo_cr_legal_public(text, text), public.ldo_cr_legal_accept(text, text, uuid, text, text),
  public.ldo_cr_messages_list(text, text), public.ldo_cr_message_send(text, text, text, text, uuid),
  public.ldo_cr_privacy_request(text, text, text, text), public.ldo_cr_export(text, text, text, text),
  public.ldo_cr_delete_check(text, text), public.ldo_cr_delete_account(text, text, text, text),
  public.ldo_cr_outbox_claim(text, integer), public.ldo_cr_outbox_done(text, bigint, timestamptz, boolean, text),
  public.ldo_cr_tick_check(text, text), public.ldo_cr_staff_alert_recipients(text),
  public.ldo_cr_reseal_batch(text, text, integer), public.ldo_cr_reseal_put(text, text, uuid, text, text, text)
to anon;

-- ---------------------------------------------------------------- 22. documentos legais: rascunhos 0.1

-- Textos-base de enquadramento-legal.md (§6.a, §6.b e as instruções de apagamento do §2.6), já corrigidos segundo o
-- §7.2 da especificação («Política de Privacidade: o que o texto diz») [rev. R-M12] e com as duas camadas da Meta
-- [rev. META-4]. Marcados «Em revisão jurídica». NENHUM fica publicado: o Super Admin publica a v1.0 depois do
-- advogado. Markdown simples (títulos, parágrafos, listas, negrito e ligações https), mostrado por c/legal.tsx.
-- A identificação do responsável (nome, NIPC, morada, registo) vem de ldo_cr_settings e aparece junto do texto.
-- Cada corpo fica entre $<kind>$ … $<kind>$ (os testes leem-no daqui).
insert into public.ldo_cr_legal_documents (kind, version, title, changes_summary, body) values
('terms', '0.1', 'Termos de participação — rascunho (Em revisão jurídica)', 'Primeira versão, para revisão jurídica.',
$terms$
**Em revisão jurídica.** Este texto é um rascunho e ainda não está em vigor.

# Termos de participação na plataforma Loja do Ouro Criadores

## 1. Objeto e partes
Estes Termos regulam a utilização da plataforma Loja do Ouro Criadores (criadores.lojadoouro.pt) pelos criadores de conteúdo que nela se registam. A identificação completa da Loja do Ouro está no fim desta página. A plataforma serve para colaborações entre a Loja do Ouro e criadores independentes: **não cria qualquer vínculo laboral**.

## 2. Quem pode participar
- Pessoas com 18 ou mais anos e capacidade jurídica plena. A plataforma não é para menores, nem como criadores nem nos conteúdos.
- Uma conta por pessoa, com redes sociais próprias.
- Residentes em Portugal ou noutro país, com as regras fiscais desse país.

## 3. Conta e segurança
Escolhe uma palavra-passe pessoal e é responsável por a guardar. Operações sensíveis (dados de pagamento, exportação e apagamento da conta) pedem a palavra-passe outra vez. Se suspeitar de uso indevido, use «Recuperar a palavra-passe» e fale connosco.

## 4. Perfil e veracidade
- Os dados e os números que indica têm de ser verdadeiros e as contas têm de ser suas.
- É proibido comprar seguidores ou interações, participar em grupos de interação combinada ou usar automatismos.
- Podemos pedir capturas das estatísticas para confirmar os números declarados.

## 5. Redes sociais
Declarar as redes é obrigatório para participar; ligá-las não é. Com a sua autorização expressa e separada, a Loja do Ouro pode ler os números públicos da sua conta profissional do Instagram ou, se ligar a conta através da Meta, as estatísticas dela. Pode parar a leitura ou desligar a conta a qualquer momento em Redes. Os pormenores estão na Política de Privacidade.

## 6. Campanhas
- As campanhas publicadas mostram os requisitos e o motivo de cada um. Pode candidatar-se a qualquer uma: nenhuma candidatura é excluída de forma automática.
- A seleção é feita por uma pessoa da equipa e não há garantia de seleção. Pode pedir uma revisão humana de uma recusa.
- Tipos de colaboração: paga, permuta, oferta (unboxing), conteúdo sem publicação (UGC) e presença em loja.
- Cada colaboração rege-se pelas Condições Particulares da campanha, que aceita antes de começar.

## 7. Pedidos de produto (unboxing)
O criador sugere uma peça e a Loja do Ouro aprova ou recusa. As Condições do pedido dizem se a entrega é uma oferta definitiva ou um empréstimo com devolução, se há obrigação de publicar, o prazo e as regras de transporte e de risco.

## 8. Regras de publicidade
- Uma publicação feita no âmbito de uma colaboração identifica-se como publicidade **no início**, com uma etiqueta reconhecida (#PUB, #PARCERIA ou, só nas ofertas, #OFERTA), e com o rótulo de parceria da rede social.
- Siga o guia da Direção-Geral do Consumidor para influenciadores.
- Fale da sua experiência real, sem alegações que a Loja do Ouro não tenha aprovado (por exemplo, preços, quilates ou sustentabilidade).
- Os conteúdos passam por aprovação prévia quando a campanha o pede; a Loja do Ouro pode pedir a correção ou a retirada de uma publicação.
- Registe na plataforma a prova da publicação (endereço e captura).

## 9. Contrapartidas e pagamentos
- Nas colaborações pagas, o criador emite a fatura-recibo e aplicam-se as retenções na fonte previstas na lei.
- O pagamento é feito no prazo das Condições Particulares, depois de aprovados os entregáveis, para um IBAN de que o criador é titular.
- Um IBAN novo só passa a valer depois de confirmado pela ligação enviada para o email da conta; a seguir, os pagamentos esperam o período de segurança indicado na plataforma.
- Nas permutas, as Condições indicam o valor normal da peça e os efeitos fiscais.

## 10. Conteúdos, licença, imagem e voz
- O criador mantém os direitos de autor. A licença de utilização (meios, território, prazo, anúncios pagos e anúncios de parceria) consta das Condições Particulares de cada campanha.
- A autorização de uso da imagem e da voz fica limitada a essa licença. Pode revogá-la em Candidaturas, com as consequências previstas nas Condições Particulares.
- O criador garante que tem a autorização de todas as pessoas identificáveis, que não aparecem menores de 18 anos e que a música e os elementos usados estão licenciados.

## 11. Conduta
São proibidos conteúdos ilegais, discriminatórios ou de ódio. Os briefings e os lançamentos são confidenciais até à data indicada. Uma exclusividade só existe se estiver acordada e paga nas Condições Particulares.

## 12. Inteligência artificial
A Loja do Ouro pode usar inteligência artificial para apoiar a análise do desempenho, só com o seu consentimento separado, e nunca para decidir sozinha. Conteúdos gerados por inteligência artificial pelo criador têm de ser declarados.

## 13. Suspensão e cessação
A Loja do Ouro pode suspender uma conta por incumprimento, informação falsa ou fraude, com o motivo indicado. O criador pode apagar a conta a qualquer momento em Definições. As licenças em vigor e os pagamentos pendentes seguem as Condições Particulares.

## 14. Responsabilidade
Cada criador responde pelos seus conteúdos e declarações, nos termos da lei (incluindo o Código da Publicidade).

## 15. Proteção de dados
O tratamento dos dados pessoais está descrito na Política de Privacidade.

## 16. Alterações aos Termos
Cada versão nova fica publicada nesta página, com a data e o resumo do que mudou. Se a alteração for substancial, avisamos também por email e na plataforma e pedimos que aceite a nova versão para continuar a usar a plataforma.

## 17. Comunicações eletrónicas
A aceitação na plataforma e as notificações por email são válidas entre as partes.

## 18. Lei aplicável e litígios
Aplica-se a lei portuguesa. Os litígios são resolvidos no foro a indicar pelo advogado, sem prejuízo dos meios de resolução alternativa previstos na lei.
$terms$),
('privacy', '0.1', 'Política de Privacidade — rascunho (Em revisão jurídica)', 'Primeira versão, para revisão jurídica.',
$privacy$
**Em revisão jurídica.** Este texto é um rascunho e ainda não está em vigor.

# Política de Privacidade da plataforma Loja do Ouro Criadores

## 1. Quem é responsável pelos seus dados
A Loja do Ouro, identificada no fim desta página, é responsável pelo tratamento dos dados pessoais recolhidos na plataforma Loja do Ouro Criadores (criadores.lojadoouro.pt). Para qualquer questão sobre os seus dados, escreva para o endereço de privacidade indicado no fim desta página.

## 2. A quem se aplica
A criadores de conteúdo com 18 ou mais anos que se registam na plataforma, se candidatam a campanhas, pedem produtos ou nos entregam conteúdos.

## 3. Que dados tratamos
- **Conta:** email, palavra-passe, guardada só como resumo criptográfico (bcrypt) na nossa base de dados (ninguém a consegue ler), e datas de acesso.
- **Perfil:** nome, nome artístico, a declaração de que tem 18 ou mais anos (não pedimos a sua idade nem quando nasceu), cidade e distrito, telefone, biografia, fotografia, categorias e formatos de conteúdo, idiomas, lojas onde pode gravar e portefólio.
- **Redes sociais que indicar:** nome de utilizador e endereço do perfil.
- **Números que nos declarar:** marcados como «não verificado» até a equipa os validar com capturas das estatísticas que nos enviar.
- **Dados públicos do Instagram, se o autorizar:** com o seu @ e a sua autorização, lemos através da Meta os números públicos da sua conta profissional (seguidores, número de publicações e, por publicação, gostos, comentários e visualizações de reels), a partir da conta Instagram da Loja do Ouro. Não acedemos à sua conta, não lemos mensagens nem estatísticas privadas e não guardamos imagens. Para confirmar que a conta é sua, pedimos-lhe que escreva um código na biografia; lemos a biografia só para isso e não a guardamos. Estes números não servem para indicadores nem para análise por inteligência artificial.
- **Dados obtidos da Meta, se ligar a sua conta** (Instagram, através do Facebook Login da Meta, pelo seu portefólio de negócios ou pela sua Página de Facebook): identificador e nome do perfil; número de seguidores e de publicações; publicações e respetivas métricas (gostos, comentários, visualizações, guardados, alcance); estatísticas da conta; miniaturas das publicações (endereços temporários da Meta; não guardamos imagens); dados agregados da sua audiência por idade, género, país e cidade. A cidade serve só para campanhas de presença em loja. Não recolhemos listas dos seus seguidores nem dados individuais sobre eles.
- **Candidaturas, propostas, mensagens e pedidos de produto.**
- **Conteúdos que nos entregar** (fotografia, vídeo, texto) e as respetivas licenças.
- **Dados fiscais e de pagamento**, cifrados: nome fiscal, NIF, morada fiscal, residência fiscal, regime de IVA, IBAN e titular, faturas-recibo.
- **Morada de entrega**, cifrada, só para enviar produtos aprovados.
- **Indicadores e análises** sobre o desempenho dos seus conteúdos (incluindo os feitos com apoio de inteligência artificial, se o autorizar) e notas internas da equipa sobre colaborações. Pode pedir-nos acesso a estas notas.
- **Dados técnicos:** registos de acesso e de segurança.

## 4. Para que usamos os dados e com que fundamento
- **Conta, perfil, candidaturas, campanhas, pedidos de produto, entregas e mensagens:** execução do contrato ou diligências pré-contratuais a seu pedido (art. 6.º, n.º 1, al. b), do RGPD).
- **Avisos de campanhas novas por email:** execução do contrato; pode desligá-los em Definições ou na ligação de cada email.
- **Leitura dos dados públicos do Instagram:** o seu consentimento (al. a)). Retirar o consentimento é carregar em «Parar a leitura e apagar os dados públicos», em Redes: apagamos de imediato o que foi lido. Estes dados não servem para indicadores nem para inteligência artificial.
- **Ligar o Instagram, atualizar os dados e calcular os indicadores de autenticidade:** o seu consentimento (al. a)). Retirar o consentimento é carregar em «Desligar e apagar os dados», em Redes, com efeito imediato.
- **Análise por inteligência artificial:** o seu consentimento, separado e opcional (al. a)). Ao retirá-lo, apagamos as análises já feitas.
- **Pagamentos, documentos fiscais e retenções:** execução do contrato e cumprimento de obrigações legais (als. b) e c)).
- **Utilização dos conteúdos e da sua imagem nos termos da licença de cada campanha:** execução do contrato.
- **Prova da identificação publicitária das publicações, durante 3 anos:** interesse legítimo e obrigação legal (als. f) e c)).
- **Segurança da plataforma, auditoria de acessos e defesa em litígios:** interesse legítimo e obrigações legais (als. f) e c)).

## 5. Indicadores de autenticidade (só com o Instagram ligado)
Com a sua conta ligada, calculamos indicadores estatísticos simples, sempre explicados e sem nota:
- **I1, alcance da base:** que parte dos seguidores vê as publicações.
- **I2, interação por seguidor e por alcance:** gostos, comentários, guardados e partilhas face aos seguidores e às pessoas alcançadas.
- **I3, subidas bruscas de seguidores:** aumentos fora do habitual num só dia.
- **I4, coerência geográfica:** se a audiência está nos países e cidades esperados para a conta.
- **I5, padrão de gostos e comentários:** se a interação é demasiado regular de publicação para publicação.
- **I6, alcance das stories:** que parte dos seguidores vê as stories.

Cada indicador compara-se com criadores do mesmo escalão de seguidores. Não há nota nem ordenação, e nenhuma seleção, recusa ou pagamento é decidido de forma automática: a decisão é sempre de uma pessoa da equipa. Algumas campanhas pedem números verificados: pode ligar o Instagram ou enviar capturas das estatísticas, que a equipa valida.

## 6. Inteligência artificial
Só com o seu consentimento, e a pedido de uma pessoa da equipa, podemos pedir a um modelo de inteligência artificial um resumo do perfil e das melhores publicações. Ao modelo vão só números agregados e as legendas das publicações, limpas; nunca vão o seu nome, o seu @, contactos, IBAN, NIF, moradas, cidades nem imagens. O fornecedor é a Anthropic, nos EUA (ver o ponto 9). As sugestões de cumprimento de requisitos das campanhas não usam números obtidos da Meta. Não usamos inteligência artificial para inferir dados sensíveis nem para reconhecer emoções.

## 7. Dados de terceiros
Só tratamos informação agregada sobre a sua audiência, tal como a Meta a disponibiliza, sem identificar seguidores. Se nos entregar conteúdos com outras pessoas, garante que tem a autorização delas e que não aparecem menores.

## 8. Dados obrigatórios
Os dados de conta e de perfil assinalados como obrigatórios são necessários para participar. Ligar o Instagram ou autorizar a leitura dos dados públicos é opcional: pode declarar os seus números, que ficam marcados como «não verificado». Algumas campanhas pedem números verificados: pode ligar o Instagram ou enviar capturas das estatísticas, que a equipa valida. Os dados fiscais e de pagamento são necessários para receber contrapartidas.

## 9. Com quem partilhamos e onde
Prestadores que tratam dados por nossa conta, com contrato nos termos do art. 28.º do RGPD:
- **Supabase** (base de dados), na União Europeia (Frankfurt).
- **Vercel** (alojamento, funções e armazenamento de ficheiros), em Frankfurt; alguns registos técnicos da plataforma podem ser tratados nos EUA.
- **Anthropic** (análise por inteligência artificial, só com o seu consentimento), nos EUA.
- **Resend** (envio de emails), na região indicada no contrato.
- **Google Workspace** (caixas de correio dos criadores e da privacidade), na UE e nos EUA, conforme a configuração.
- **Transportadora**, em Portugal, só com o nome, a morada e o telefone de um envio.

A **Meta** (Meta Platforms Ireland) trata os seus dados como responsável independente, segundo as suas políticas: sabe que a Loja do Ouro consulta o seu @ (dados públicos) e que autorizou a nossa app (Instagram ligado). Partilhamos dados com autoridades públicas quando a lei o exige e com consultores jurídicos e contabilísticos sujeitos a sigilo. Não vendemos os seus dados.

## 10. Transferências para fora do Espaço Económico Europeu
A Anthropic e, em parte, a Vercel, a Resend e a Google tratam dados nos EUA. Essas transferências baseiam-se nas cláusulas contratuais-tipo aprovadas pela Comissão Europeia, incluídas nos contratos com cada prestador, e, para as empresas certificadas, na decisão de adequação do Quadro de Privacidade de Dados UE-EUA. Pode pedir-nos cópia das garantias aplicáveis.

## 11. Durante quanto tempo guardamos
- Conta e perfil: enquanto a conta existir. Sem atividade, avisamos aos 22 meses e anonimizamos a conta aos 24.
- Conta registada mas nunca confirmada: 30 dias.
- Dados públicos do Instagram: enquanto a leitura estiver autorizada, numa janela de 24 meses; apagados de imediato quando parar a leitura.
- Dados do Instagram ligado: enquanto a conta estiver ligada, numa janela de 24 meses; apagados de imediato quando desligar.
- Indicadores e análises por inteligência artificial: 12 meses (as análises apagam-se também quando retirar o consentimento).
- Mensagens: 24 meses. Números declarados: 24 meses, guardando sempre o mais recente.
- Morada de envio: 12 meses depois da entrega, devolução ou cancelamento.
- Candidaturas não selecionadas: 24 meses depois da decisão.
- Prova de publicação: 3 anos depois da publicação.
- Licenças e conteúdos licenciados: até ao fim da licença e mais 3 anos.
- Pagamentos e documentos fiscais: 10 anos.
- Registos de consentimento: enquanto a conta existir e mais 5 anos.
- Pedidos sobre os seus direitos: 5 anos.

Quando desliga uma rede, para a leitura dos dados públicos ou pede o apagamento, apagamos de imediato os dados obtidos dessa forma, salvo os que a lei nos obriga a guardar (por exemplo, documentos fiscais durante 10 anos).

## 12. Os seus direitos
Pode pedir acesso, retificação, apagamento, limitação e portabilidade dos seus dados, opor-se a tratamentos baseados em interesse legítimo e retirar o consentimento a qualquer momento, sem afetar o tratamento anterior. Muitos destes direitos estão disponíveis diretamente em Definições (descarregar os meus dados, apagar a conta, pedir a limitação ou uma revisão humana) e em Redes. Também pode escrever para o endereço de privacidade indicado no fim desta página. Respondemos no prazo de um mês, que pode ser prorrogado por mais dois meses nos pedidos complexos, com aviso no primeiro mês. Tem ainda o direito de apresentar reclamação à Comissão Nacional de Proteção de Dados (www.cnpd.pt).

## 13. Como desligar e apagar os dados obtidos da Meta
- Dados públicos do Instagram: em Redes, «Parar a leitura e apagar os dados públicos».
- Instagram ligado: em Redes, «Desligar e apagar os dados». Também pode remover a app «Loja do Ouro Criadores» na Meta: se ligou pelo Facebook, em Facebook → Definições e privacidade → Definições → Apps e sites; se ligou pelo portefólio de negócios, em Definições do negócio → Integrações → Apps ligadas.
- As instruções completas e o estado de um pedido de eliminação feito na Meta estão na página /dados-meta.

## 14. Segurança
Cifra em trânsito e em repouso; IBAN, dados fiscais, moradas e tokens de acesso cifrados; IBAN mostrado mascarado; registo de acessos; acesso da equipa com utilizador e palavra-passe pessoais e permissões separadas: só quem trata de pagamentos vê o IBAN completo, com o motivo registado.

## 15. Menores
A plataforma destina-se exclusivamente a maiores de 18 anos. Não são permitidos menores nos conteúdos entregues.

## 16. Cookies
Usamos só os cookies essenciais ao funcionamento da plataforma, descritos na página de Cookies.

## 17. Alterações
Avisamos por email e na plataforma. A Política é informação: não lhe pedimos que a aceite. As versões anteriores ficam guardadas e pode pedir-nos cópia.
$privacy$),
('cookies', '0.1', 'Política de Cookies — rascunho (Em revisão jurídica)', 'Primeira versão, para revisão jurídica.',
$cookies$
**Em revisão jurídica.** Este texto é um rascunho e ainda não está em vigor.

# Cookies

A plataforma Loja do Ouro Criadores usa **só cookies essenciais**, sem os quais não funciona. Não usamos cookies de análise, de publicidade nem de terceiros, por isso não lhe pedimos consentimento (Lei n.º 41/2004, art. 5.º).

- **__Host-ldo_criador** — mantém a sua sessão depois de entrar. Dura até sair ou até a sessão terminar (no máximo o número de dias indicado nas definições da plataforma). Não pode ser lido por outros sites, nem por outros endereços da Loja do Ouro.
- **__Host-ldo_cr_oauth** — só existe durante 10 minutos, quando liga a sua conta do Instagram através da Meta, para confirmar que o regresso da Meta é seu.

As imagens e os tipos de letra são servidos pelo próprio site: o seu navegador não contacta outros serviços ao abrir estas páginas.

Pode apagar os cookies nas definições do seu navegador; se apagar o de sessão, tem de entrar outra vez.
$cookies$),
('meta_data', '0.1', 'Dados obtidos através da Meta — rascunho (Em revisão jurídica)', 'Primeira versão, para revisão jurídica.',
$meta_data$
**Em revisão jurídica.** Este texto é um rascunho e ainda não está em vigor.

# Como apagar os dados que obtivemos através da Meta

- **Dados públicos do Instagram:** em Redes, «Parar a leitura e apagar os dados públicos». Apagamos tudo de imediato.
- **Instagram ligado:** em Redes, «Desligar e apagar os dados». Apagamos tudo de imediato. Também pode remover a app «Loja do Ouro Criadores» na Meta: se ligou pelo Facebook, em Facebook → Definições e privacidade → Definições → Apps e sites (ou Integrações empresariais); se ligou pelo portefólio de negócios, em Definições do negócio → Integrações → Apps ligadas.
- **Pedido de eliminação feito na Meta:** recebemo-lo automaticamente, apagamos os dados das duas formas e damos-lhe um código para acompanhar o pedido nesta página.
- Também pode escrever para privacidade@lojadoouro.pt.

A Política de Privacidade explica que dados obtemos, para quê e durante quanto tempo.
$meta_data$);
