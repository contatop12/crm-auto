-- Tainã: a mensagem que o time manda junto com a proposta move o card para
-- Proposta Enviada (e sobe a conversao `qualificado_1`).
--
-- Mensagem inteira do time: "Nós emitimos nota fiscal e a Dra faz um relatório
-- caso você precise solicitar o REEMBOLSO do seu plano de saúde".
--
-- So' o trecho final: a comparacao ignora acento e maiuscula mas NAO ignora
-- pontuacao, e "Dra." com ponto quebraria uma frase com "Dra faz". E "emitimos
-- nota fiscal" sozinho casaria com a resposta a quem so' perguntou se ha nota.
INSERT INTO stage_triggers (tenant_id, stage_id, frase, tipo)
SELECT s.tenant_id, s.id, 'solicitar o reembolso do seu plano de saúde', 'contem'
  FROM funnel_stages s JOIN tenants t ON t.id = s.tenant_id
 WHERE t.slug = 'taina' AND s.cw_step_id = 22;
