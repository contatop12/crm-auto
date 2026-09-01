-- Registro de cada movimentacao de card feita pelos gatilhos.
--
-- Sem isto nao da' para monitorar se os gatilhos estao funcionando: o card
-- mudar de etapa no Chatwoot nao deixa rastro do lado de ca, e a pergunta
-- "a frase que a equipe usa ainda move o card?" fica sem resposta ate alguem
-- reclamar que o funil parou.
--
-- Guarda tambem o que NAO moveu e por que: gatilho que nunca casa e' um
-- problema silencioso, e e' o caso mais comum quando a equipe muda o texto.
CREATE TABLE card_moves (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id        INTEGER,
  conversation_id INTEGER,
  /** Frase cadastrada que casou. Vazio quando foi a resposta automatica. */
  gatilho        TEXT,
  trecho         TEXT,          -- pedaco da mensagem, para conferir o casamento
  etapa_de       TEXT,
  etapa_para     TEXT,
  moveu          INTEGER NOT NULL DEFAULT 0,
  motivo         TEXT,          -- por que nao moveu, quando nao moveu
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_card_moves_tenant ON card_moves(tenant_id, created_at DESC);
