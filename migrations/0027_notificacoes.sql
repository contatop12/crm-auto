-- Central de notificacoes.
--
-- Erro resolvido sai do cartao do cliente e da central, mas continua no log:
-- apagar o evento apagaria o diagnostico junto. `resolvido_em` marca quando, e
-- `resolvido_por` diz se foi alguem da equipe ou o proprio sistema (a conversao
-- que falhou e depois subiu resolve o proprio erro).
ALTER TABLE events ADD COLUMN resolvido_em TEXT;
ALTER TABLE events ADD COLUMN resolvido_por TEXT;

-- Aviso que nao e' evento (configuracao pendente, queda do WhatsApp): quem
-- dispensou e quando. A chave identifica a ocorrencia, nao o tipo — uma queda
-- nova do mesmo numero volta a aparecer.
CREATE TABLE notificacoes_dispensadas (
  chave          TEXT PRIMARY KEY,
  dispensada_em  TEXT NOT NULL DEFAULT (datetime('now')),
  por            TEXT
);
