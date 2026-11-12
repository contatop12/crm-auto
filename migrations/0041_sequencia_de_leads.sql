-- Numeracao (SEQUENCIA) e ordenacao da aba de leads de cada cliente, feitas pelo
-- Worker (src/pipelines/sequencia.ts). Era o Apps Script "Sequencia Leads - Todos
-- os Clientes"; a lista abaixo e' a PLANILHAS dele em 12/11/2026, na mesma ordem.
--
-- Nem toda planilha daqui e' cliente do CRM (Debony, Patricia, Consorcios, as da
-- Practical Life), por isso a lista e' propria e nao sai de `tenant_config`.
CREATE TABLE sequencia_planilhas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  doc            TEXT NOT NULL,
  aba            TEXT NOT NULL DEFAULT 'Geral',   -- a busca ignora maiusculas
  cliente        TEXT NOT NULL,                   -- rotulo, para log e painel
  nome_no_aviso  TEXT,                            -- vazio = titulo da planilha
  prefixo        TEXT NOT NULL DEFAULT '',        -- preenchido: PREFIXO + MES + NN
  numerar        INTEGER NOT NULL DEFAULT 1,      -- 0 = so' ordena
  notificar      INTEGER NOT NULL DEFAULT 1,      -- 0 = numera sem avisar a Pulseboard
  ordenar        INTEGER NOT NULL DEFAULT 1,
  ativo          INTEGER NOT NULL DEFAULT 1,
  posicao        INTEGER NOT NULL DEFAULT 0,
  erro           TEXT,                            -- da ultima rodada; NULL = foi bem
  erro_desde     TEXT,
  erros_seguidos INTEGER NOT NULL DEFAULT 0,
  formato_em     TEXT,                            -- ultima vez que o formato de DATA/HORA foi reaplicado
  UNIQUE (doc, aba)
);

-- Uma linha numerada que precisa virar aviso. O estado anda:
--   a_gravar -> gravado -> enviado | reserva | desistiu
-- `a_gravar` nasce ANTES de a sequencia ir para a planilha: se a rodada morrer no
-- meio, a seguinte acha a linha ja' numerada e manda o aviso que faltou. No Apps
-- Script esse lead ficava numerado e sem aviso para sempre.
-- No modo sombra nada e' gravado nem enviado: fica `sombra` e depois `sombra_ok`,
-- `sombra_diverge` ou `sombra_faltou`, conforme o que o Apps Script fez na aba.
CREATE TABLE sequencia_avisos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  planilha_id   INTEGER NOT NULL REFERENCES sequencia_planilhas(id),
  sequencia     TEXT NOT NULL,
  estado        TEXT NOT NULL,
  payload       TEXT NOT NULL,                    -- o corpo do aviso (tem nome e telefone: some em 30 dias)
  tentativas    INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sequencia_avisos_estado ON sequencia_avisos (estado, planilha_id);

-- modo: desligado | sombra | ligado. Nasce desligado: o Apps Script ainda esta'
-- rodando, e os dois numerando ao mesmo tempo dariam sequencia repetida.
-- trava: ate' quando a rodada em curso segura a vez (ISO); '' = livre.
CREATE TABLE sequencia_estado (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
INSERT INTO sequencia_estado (chave, valor) VALUES ('modo', 'desligado'), ('trava', ''), ('ultima_rodada', '');

INSERT INTO sequencia_planilhas (posicao, cliente, doc, aba, nome_no_aviso, numerar, notificar, ordenar) VALUES
  (1,  'Tainã Aci',             '1agGk8HN98inXotnusMoxKGwyJoftzeoMQyTT55kPMuc', 'Geral', NULL, 1, 1, 1),
  (2,  'Lorena',                '1mr9s_9UKShni_EakFh1ofuiU-JgTlVN3NKKRpKq0Lnw', 'Geral', NULL, 1, 1, 1),
  (3,  'Vita Audio',            '1KMnwB0q2yFjpISN_QX7kr-BhhsoJoKep317qH_u3m3k', 'Geral', NULL, 1, 1, 1),
  -- Locadora e Persianas: sem ordenar desde 14/10. O motivo era do Apps Script (a
  -- validacao da coluna STATUS recusava a regravacao); mover linha nao esbarra nisso,
  -- mas religar e' decisao a parte.
  (4,  'Locadora Exatidão',     '1_FUKAUvlr1O8O2jMJCVbcdsWXUdjRMvDJo8fSHmQPBw', 'Geral', NULL, 1, 1, 0),
  (5,  'Persianas Paulista',    '1j-w1Vw2OAV8f-HqWM7zzFMqAHgjsGgOS2aEQhaxxLn0', 'Geral', NULL, 1, 1, 0),
  (6,  'Debony Usinagem',       '1dzWYVieSqrlCgRfr2M1PCtx4Z6RT261HaZrw05tNoDc', 'Geral', NULL, 1, 1, 1),
  (7,  'Patrícia Faro',         '1PpYc2hat7gbe7S-Ua1JBjVk5dRsHqPiO_sKTwFtUC2k', 'Geral', NULL, 1, 1, 1),
  (8,  'Consorcios Indaiatuba', '16_1kLHBtzO6EeFPR37caFub4e36jQFJAJqGfZ_OhZFg', 'Geral', NULL, 1, 1, 1),
  -- Practical Life: a sequencia e' do n8n; aqui so' ordena. PLJP nem isso (GERAL corrompida em 29/10).
  (9,  'Practical Life JP',     '1USb94hBZvXnejxsoRm273MU8h1scJUm5gLgMWldu53k', 'GERAL', NULL, 0, 0, 0),
  (10, 'Practical Life JP/CB',  '1cxvNc1igNZ7bJYaWVH5Qrsd5_fD7MMV5BrSaicnoAZM', 'GERAL', NULL, 0, 0, 1),
  (11, 'Practical Life CB',     '1m446aVw_p0FGdLn5x2XJ2676cm_QjY3GxcKoJ1AJOUc', 'GERAL', NULL, 0, 0, 1),
  -- Libertad e Rafaela: mesma planilha, um cliente por aba. Sem aviso de proposito:
  -- o fluxo do n8n ja' avisa a Pulseboard, e ligar aqui duplica a mensagem no grupo.
  (12, 'Libertad',              '1EkldxEJGTpDVAUZxU_dHMeS28y_l3LyqvOMWCbicAPo', 'Libertad',          'Libertad',          1, 0, 1),
  (13, 'Assessora Rafaela',     '1EkldxEJGTpDVAUZxU_dHMeS28y_l3LyqvOMWCbicAPo', 'Assessora Rafaela', 'Assessora Rafaela', 1, 0, 1),
  (14, 'Tile Serviços',         '16KENrryYmTimE_eEi37XmKxATNW0cZ2OOwA0ZEC2s2c', 'Google', NULL, 1, 1, 1),
  (15, 'Martinelli Chaves',     '1Ag_e9b1Yv8BmDitREZ-WeGUTqpwO7HsqeMbxMCGcAow', 'Geral', NULL, 1, 1, 1);
