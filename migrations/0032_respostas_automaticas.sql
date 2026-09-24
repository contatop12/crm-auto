-- Mensagem que o proprio sistema manda, e que nao e' resposta do atendente.
--
-- A etapa "Qualificando" avanca na primeira resposta do comercial. So' que a
-- boas-vindas do Chatwoot e a mensagem de continuidade do fluxo do formulario
-- tambem sao `outgoing`, chegam em segundos e levavam o card para la' antes de
-- alguem olhar o lead. Na Locadora (22/09/2026) a boas-vindas saiu 4 s depois
-- do lead chegar: o card saiu de "Novo Lead" sozinho e o aviso no grupo, que
-- depende de uma alteracao do card nessa etapa, nunca aconteceu.
--
-- Comparada normalizada (sem acento, sem emoji, minuscula) e por "contem", como
-- as frases de entrada: o nome do lead entra no meio do texto.
CREATE TABLE respostas_automaticas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  frase       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_respostas_automaticas_tenant ON respostas_automaticas(tenant_id);

-- Locadora: a boas-vindas do Chatwoot, a continuidade do fluxo da LP e o aviso
-- de fora do horario.
INSERT INTO respostas_automaticas (tenant_id, frase)
SELECT id, 'Seja muito bem-vindo(a) à Locadora Exatidão' FROM tenants WHERE slug = 'locadora';
INSERT INTO respostas_automaticas (tenant_id, frase)
SELECT id, 'Vi que você se cadastrou em nosso site em busca de' FROM tenants WHERE slug = 'locadora';
INSERT INTO respostas_automaticas (tenant_id, frase)
SELECT id, 'Nosso atendimento acontece de segunda a sexta' FROM tenants WHERE slug = 'locadora';
