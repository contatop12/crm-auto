-- Lead que volta: quem escreve de novo 15+ dias depois do card chegar numa
-- etapa final abre um card novo (titulo com " #1", " #2"...), em vez de
-- reabrir o antigo.
--
-- `retorno_dias`: prazo do cliente; NULL = o padrao do codigo (15 dias).
ALTER TABLE tenant_config ADD COLUMN retorno_dias INTEGER;

-- `retorno_de`: o card de onde o lead voltou; `clique_em`: quando clicou no
-- anuncio, para dizer se a volta veio de um clique novo.
ALTER TABLE leads ADD COLUMN retorno_de TEXT;
ALTER TABLE leads ADD COLUMN clique_em TEXT;

-- Uma linha por volta. As duas UNIQUE seguram a corrida: o mesmo card antigo
-- so' gera um card novo, e a mesma conversa so' tem uma volta de cada numero,
-- mesmo que o webhook chegue duas vezes. `desligou_antigo` marca que o card
-- velho ja' foi tirado do caminho, para o reprocesso nao repetir.
CREATE TABLE IF NOT EXISTS retornos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  cw_conversation_id INTEGER NOT NULL,
  n INTEGER NOT NULL,
  mensagem_id TEXT,
  task_anterior TEXT NOT NULL,
  task_novo TEXT,
  protocolo_anterior TEXT,
  protocolo_novo TEXT,
  origem TEXT,
  desligou_antigo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente',
  erro TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, task_anterior),
  UNIQUE (tenant_id, cw_conversation_id, n)
);
