-- =============================================================================
-- P12 CRM Auto - schema inicial
--
-- Substitui as abas do Google Sheets que hoje funcionam como banco:
--   aba "Cliques"    -> tabela leads
--   aba "Conversoes" -> tabela conversions
--
-- Tudo que hoje esta hardcoded dentro dos nos Code do n8n vira linha aqui.
-- D1 = SQLite: sem tipo JSON nativo (TEXT com json valido), sem array.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- CONFIGURACAO
-- -----------------------------------------------------------------------------

CREATE TABLE tenants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,   -- usado na URL de ingestao: /ingest/{slug}/click
  nome        TEXT    NOT NULL,
  ativo       INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tenant_config (
  tenant_id                INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- Chatwoot (o token e GLOBAL, fica em secret; aqui so o que varia por cliente)
  cw_account_id            INTEGER NOT NULL,
  cw_inbox_ids             TEXT    NOT NULL DEFAULT '[]',  -- json array; [] = todas
  cw_board_organico_id     INTEGER,                        -- board de entrada (card nasce aqui)
  cw_board_funil_id        INTEGER NOT NULL,               -- board do funil de Ads

  -- Google Ads
  ga_customer_id           TEXT,       -- conta operacional, sem tracos
  ga_login_customer_id     TEXT,       -- MCC, sem tracos
  ga_currency              TEXT    NOT NULL DEFAULT 'BRL',

  -- Evolution (WhatsApp)
  evo_instancia            TEXT,

  -- Pulseboard
  pulseboard_codi_id       TEXT,

  -- Espelho Google Sheets (best-effort; falha aqui nunca falha o pipeline)
  sheets_doc_id            TEXT,
  sheets_aba_cliques       TEXT    NOT NULL DEFAULT 'Cliques',
  sheets_aba_conversoes    TEXT    NOT NULL DEFAULT 'Conversoes',
  sheets_leads_doc_id      TEXT,       -- planilha "Leads - <cliente>" (append simples)
  sheets_leads_aba         TEXT,

  -- Ingestao
  ingest_key               TEXT    NOT NULL,   -- segredo da rota /ingest/{slug}/click (GTM)
  cw_webhook_secret        TEXT,               -- segredo HMAC do webhook do Chatwoot

  -- Comportamento
  validate_only            INTEGER NOT NULL DEFAULT 1,  -- shadow mode: nao grava conversao real
  janela_match_dias        INTEGER NOT NULL DEFAULT 90, -- janela do casamento por telefone
  promocao_via_api         INTEGER NOT NULL DEFAULT 1,  -- 0 = ainda usa a regra nativa do CRM

  updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Etapas do funil. Substitui ORDEM_FUNIL + ETAPAS_FINAIS + MAPA_ETAPAS.
--
-- As etapas sao SINCRONIZADAS do board do Chatwoot, nao digitadas. O board e' a
-- fonte da verdade: `GET kanban/boards/{b}/steps` devolve id, nome, `cancelled`
-- e `completed`, e e' de `cancelled OR completed` que sai `is_final`. Isso mata
-- a classe de bug em que o codigo referencia uma etapa que nao existe no board
-- (o "Compareceu a Consulta" do Vita, que nunca disparou).
CREATE TABLE funnel_stages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  posicao             INTEGER NOT NULL,          -- ordem no funil, 1..N (segue `steps_order` do board)
  nome                TEXT    NOT NULL,          -- nome EXATO da etapa no board
  cw_step_id          INTEGER NOT NULL,          -- id real da etapa no Chatwoot
  is_final            INTEGER NOT NULL DEFAULT 0,-- derivado de cancelled OR completed
  cw_cancelled        INTEGER NOT NULL DEFAULT 0,
  cw_completed        INTEGER NOT NULL DEFAULT 0,
  auto_on_reply       INTEGER NOT NULL DEFAULT 0,-- etapa alvo de qualquer resposta do vendedor (ex: "Qualificando")

  -- Conversao no Google Ads. NULL em conversion_event = etapa nao vira conversao.
  conversion_event    TEXT,                      -- 'conversa' | 'proposta_enviada' | 'qualificado_1' | ...
  conversion_action_id TEXT,                     -- preenchido pelo gerador de metas, ou colado a mao
  conversion_value    REAL,                      -- NULL com conversion_event != NULL = usa o valor real da negociacao

  -- Especificacao usada pelo gerador de metas do painel. Editavel na tela de
  -- preview antes de publicar na conta do cliente.
  ca_nome             TEXT,                      -- 'CRM - Lead Qualificado 1'
  ca_categoria        TEXT,                      -- CONTACT | QUALIFIED_LEAD | PURCHASE | SUBMIT_LEAD_FORM
  ca_contagem         TEXT DEFAULT 'ONE_PER_CLICK'  -- ONE_PER_CLICK | MANY_PER_CLICK
                      CHECK (ca_contagem IN ('ONE_PER_CLICK','MANY_PER_CLICK')),
  ca_janela_clique    INTEGER DEFAULT 30,        -- dias
  ca_janela_view      INTEGER DEFAULT 1,         -- dias
  ca_primary          INTEGER NOT NULL DEFAULT 0,-- entra na coluna "Conversoes" (lance automatico)

  synced_at           TEXT,                      -- ultima sincronizacao com o board
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, cw_step_id),
  UNIQUE (tenant_id, nome)
);
CREATE INDEX idx_funnel_stages_ordem ON funnel_stages(tenant_id, posicao);

-- Frases-gatilho. Substitui o array GATILHOS do "Parse Mensagem Vendedor".
CREATE TABLE stage_triggers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stage_id          INTEGER NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,
  frase             TEXT    NOT NULL,   -- comparada apos normalizar (sem emoji/acento, minuscula)
  emoji_obrigatorio TEXT,               -- se preenchido, conferido no texto CRU
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_stage_triggers_tenant ON stage_triggers(tenant_id, stage_id);

-- Vocabulario fechado de etiquetas. Substitui VOCABULARIO + MAPA_WHATSAPP.
-- Etiqueta fora daqui nunca e enviada: no Chatwoot viraria etiqueta solta e no
-- WhatsApp o findLabels nao acharia o id.
CREATE TABLE label_vocabulary (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug            TEXT    NOT NULL,   -- 'mensagem', 'google-ads', 'p-max', 'quiz-v2', 'r30'
  label_chatwoot  TEXT    NOT NULL,
  label_whatsapp  TEXT,               -- NULL = nao aplica no WhatsApp
  UNIQUE (tenant_id, slug)
);

-- Quiz (hoje so Persianas). form_id -> versao + faixa de valor.
CREATE TABLE quiz_config (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id    TEXT    NOT NULL,   -- 'FORMR30'
  versao     TEXT,               -- 'v2'
  valor      INTEGER,            -- 30
  UNIQUE (tenant_id, form_id)
);

-- Denylist de e-mail. Substitui DOMINIOS/EMAILS/PADROES_BLOQUEADOS.
CREATE TABLE email_denylist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = vale para todos
  tipo       TEXT    NOT NULL CHECK (tipo IN ('dominio', 'exato', 'regex')),
  valor      TEXT    NOT NULL
);
CREATE INDEX idx_email_denylist_tenant ON email_denylist(tenant_id);

-- Regras de automacao do Chatwoot, editaveis por cliente no painel.
--
-- Cada conta tem hoje um conjunto proprio (LeadsGoogle, Evento Qualificado 1,
-- Evento Qualificado 2, Evento Compra), e o conjunto MUDA de cliente para
-- cliente. Aqui a ferramenta guarda o que cada regra deve fazer e consegue
-- provisiona-la / conferi-la via API em vez de depender de configuracao manual.
CREATE TABLE automation_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome          TEXT    NOT NULL,   -- 'Evento Qualificado 1'
  cw_rule_id    INTEGER,            -- id da regra no Chatwoot, quando ja existe
  evento        TEXT    NOT NULL,   -- 'conversation_updated' | 'conversation_created' | ...
  -- condicoes e acoes ficam como json para acompanhar o formato do Chatwoot sem
  -- exigir migration a cada campo novo que o fork inventar
  condicoes     TEXT    NOT NULL DEFAULT '[]',
  acoes         TEXT    NOT NULL DEFAULT '[]',
  /* Etapa que esta regra sinaliza. Liga a regra ao funil: quando ela dispara o
     webhook, o pipeline stageChanged sabe qual conversao mandar. */
  stage_id      INTEGER REFERENCES funnel_stages(id) ON DELETE SET NULL,
  ativa         INTEGER NOT NULL DEFAULT 1,
  synced_at     TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, nome)
);
CREATE INDEX idx_automation_rules_tenant ON automation_rules(tenant_id);

-- Extracao do valor da proposta. Substitui PADROES_VALOR + VALOR_MINIMO.
CREATE TABLE value_patterns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  posicao       INTEGER NOT NULL,   -- ordem de tentativa; o primeiro que casar vence
  regex         TEXT    NOT NULL,
  valor_minimo  REAL    NOT NULL DEFAULT 50,
  UNIQUE (tenant_id, posicao)
);

-- -----------------------------------------------------------------------------
-- OPERACAO
-- -----------------------------------------------------------------------------

-- Substitui a aba "Cliques".
CREATE TABLE leads (
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  protocol       TEXT    NOT NULL,

  -- identidade
  nome           TEXT,
  email          TEXT,
  phone_raw      TEXT,
  phone_e164     TEXT,
  phone_key      TEXT,   -- DDD + ultimos 8 digitos: casa apesar do DDI 55 e do 9o digito

  -- atribuicao
  gclid          TEXT,
  gbraid         TEXT,
  wbraid         TEXT,
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  utm_id         TEXT,
  utm_term       TEXT,
  utm_content    TEXT,
  fbp            TEXT,
  fbc            TEXT,
  client_id      TEXT,

  -- contexto do clique
  origem         TEXT,   -- 'clique' | 'formulario'
  evento         TEXT,   -- 'whatsapp_click' | 'form_submit'
  page_url       TEXT,
  whatsapp_url   TEXT,
  referrer       TEXT,
  user_agent     TEXT,
  ip_address     TEXT,

  -- quiz
  quiz_version   TEXT,
  quiz_valor     INTEGER,
  quiz_form_id   TEXT,

  -- negocio
  valor_proposta REAL,

  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (tenant_id, protocol)
);
-- casamento conversa -> lead: filtra por chave de telefone dentro da janela
CREATE INDEX idx_leads_phone ON leads(tenant_id, phone_key, created_at DESC);
CREATE INDEX idx_leads_email ON leads(tenant_id, email);
CREATE INDEX idx_leads_created ON leads(tenant_id, created_at DESC);

CREATE TABLE conversations (
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cw_conversation_id   INTEGER NOT NULL,
  cw_display_id        INTEGER,   -- o "#56" do titulo do card; NAO e o mesmo que o id
  cw_contact_id        INTEGER,
  cw_inbox_id          INTEGER,
  protocol             TEXT,
  task_id              INTEGER,   -- card do Kanban ligado a esta conversa
  stage_atual          TEXT,
  conversa_enviada     INTEGER NOT NULL DEFAULT 0,  -- conversao "conversa" ja subiu
  phone_key            TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, cw_conversation_id)
);
CREATE INDEX idx_conversations_display ON conversations(tenant_id, cw_display_id);
CREATE INDEX idx_conversations_protocol ON conversations(tenant_id, protocol);
CREATE INDEX idx_conversations_task ON conversations(tenant_id, task_id);

-- Substitui a aba "Conversoes". A UNIQUE e a trava de dedup: substitui a
-- consulta na planilha + a flag conversa_enviada. O transactionId no Google
-- continua sendo a 2a trava.
CREATE TABLE conversions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dedupe_key         TEXT    NOT NULL,   -- protocol || '-' || conversion_event
  protocol           TEXT    NOT NULL,
  conversion_event   TEXT    NOT NULL,
  conversion_action  TEXT,
  conversion_value   REAL,
  currency           TEXT,
  match_type         TEXT,   -- 'click_id' | 'click_id+user_data' | 'user_data_only'
  status             TEXT    NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente','enviado','erro','ignorado')),
  validate_only      INTEGER NOT NULL DEFAULT 0,
  request_id         TEXT,
  erro               TEXT,
  event_at           TEXT,   -- quando o evento aconteceu (step_changed_at)
  sent_at            TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX idx_conversions_status ON conversions(tenant_id, status, created_at DESC);

-- Log cru de todo webhook recebido. Substitui "abrir a execucao no n8n e ler o
-- campo motivo". E a tela de Eventos do painel.
CREATE TABLE events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = slug desconhecido
  source        TEXT    NOT NULL CHECK (source IN ('click','chatwoot','kanban')),
  event_type    TEXT,          -- 'conversation_created', 'message_incoming', ...
  payload       TEXT NOT NULL, -- json cru
  signature_ok  INTEGER,       -- NULL = rota sem assinatura
  status        TEXT    NOT NULL DEFAULT 'recebido'
                CHECK (status IN ('recebido','processando','ok','ignorado','erro')),
  motivo        TEXT,          -- mesmo papel do campo `motivo` dos nos Code
  tentativas    INTEGER NOT NULL DEFAULT 0,
  received_at   TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT
);
CREATE INDEX idx_events_tenant_time ON events(tenant_id, received_at DESC);
CREATE INDEX idx_events_status ON events(status, received_at DESC);
