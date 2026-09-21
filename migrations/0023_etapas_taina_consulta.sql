-- Tainã: o quadro do Chatwoot mudou e o funil daqui ficou para tras.
--   etapa 23 foi renomeada "Negociação" -> "Agendamento Realizado"
--   etapa 67 "Consultada realizada" e' nova, entre ela e "Oportunidade Perdida"
-- (lido do board 5 da conta 4 em 21/09)
UPDATE funnel_stages SET nome = 'Agendamento Realizado', synced_at = datetime('now')
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina') AND cw_step_id = 23;

UPDATE funnel_stages SET posicao = posicao + 1, synced_at = datetime('now')
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina') AND cw_step_id IN (24, 25);

INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, is_final, cw_cancelled, cw_completed, auto_on_reply, synced_at)
SELECT id, 5, 'Consultada realizada', 67, 0, 0, 0, 0, datetime('now') FROM tenants WHERE slug = 'taina';

-- A mensagem que o time manda depois da consulta move o card para ela.
-- Mensagem inteira: "gostaríamos de saber sua opinião sobre a consulta que você
-- teve com a Dra. Tainã". So' o comeco: a comparacao nao ignora pontuacao, e
-- "Dra." com ou sem ponto quebraria a frase inteira.
INSERT INTO stage_triggers (tenant_id, stage_id, frase, tipo)
SELECT s.tenant_id, s.id, 'gostaríamos de saber sua opinião sobre a consulta', 'contem'
  FROM funnel_stages s JOIN tenants t ON t.id = s.tenant_id
 WHERE t.slug = 'taina' AND s.cw_step_id = 67;
