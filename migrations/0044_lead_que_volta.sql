-- Lead que volta: quem escreve de novo 15+ dias depois do card chegar numa
-- etapa final abre um card novo (titulo com " #1", " #2"...), em vez de
-- reabrir o antigo.
--
-- `retorno_dias`: prazo do cliente em dias; NULL = volta desligada (nasce assim
-- para todos). Para ligar, 15.
ALTER TABLE tenant_config ADD COLUMN retorno_dias INTEGER;

-- So' no lead copiado do ciclo anterior: `retorno_de` = protocolo raiz (o do
-- primeiro ciclo); `clique_em` = data do clique original, que e' a que o
-- Google olha.
ALTER TABLE leads ADD COLUMN retorno_de TEXT;
ALTER TABLE leads ADD COLUMN clique_em TEXT;

-- O numero da volta do lead do ciclo (copia ou anuncio novo); NULL ou 0 = nao
-- e' volta. A Geral separa a linha da volta por este dado, nao pelo " #n" do
-- nome: um perfil do WhatsApp chamado "Ana #2" nao e' volta nenhuma.
ALTER TABLE leads ADD COLUMN volta INTEGER;

-- Uma linha por volta. As duas UNIQUE seguram a corrida: o mesmo card antigo
-- so' gera um card novo, e a mesma conversa so' tem uma volta de cada numero,
-- mesmo que o webhook chegue duas vezes. `desligou_antigo` marca que o card
-- velho ja' foi tirado do caminho, para o reprocesso nao repetir.
-- `trabalhando_ate`: quem abre a volta segura a linha ate' esta hora (UTC);
-- NULL = ninguem. Duas entregas da mesma mensagem ao mesmo tempo nao criam dois
-- cards: a segunda acha a linha segura e volta para a fila.
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
  trabalhando_ate TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, task_anterior),
  UNIQUE (tenant_id, cw_conversation_id, n)
);
