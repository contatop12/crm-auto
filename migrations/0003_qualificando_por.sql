-- Quem faz o card avancar para a etapa de atendimento.
--
-- Vita, Persianas e Locadora: a primeira RESPOSTA DO VENDEDOR.
-- Taina Aci: a resposta do LEAD. La uma mensagem automatica sai assim que o
-- formulario e enviado, entao mover no primeiro outgoing faria todo card saltar
-- de etapa na hora e o Novo Lead ficaria sempre vazio.
ALTER TABLE tenant_config ADD COLUMN qualificando_por TEXT NOT NULL DEFAULT 'resposta_do_vendedor';
