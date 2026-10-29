-- Card em "Qualificando" com o lead calado ha' N dias vai para "Pendente" e
-- ganha a etiqueta "qualificando": olhando a coluna Pendente, da' para saber de
-- que etapa o lead veio. Quando o lead responde, o card volta para Qualificando
-- e a etiqueta sai (regra em domain/pendente.ts).
--
-- NULL = o cliente nao usa. So' a Locadora, a pedido do usuario em 28/10/2026:
-- uma semana. Eram 49 dos 59 cards de Qualificando parados, alguns ha' 2 meses.
ALTER TABLE tenant_config ADD COLUMN pendente_qualificando_dias INTEGER;

UPDATE tenant_config SET pendente_qualificando_dias = 7
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'locadora');

-- Toda mudanca no card (a etiqueta, a etapa) dispara a regra "Lead novo no
-- funil", e quem segura o aviso repetido e' o registro em group_notifications.
-- Destes 49, seis nunca passaram pelo aviso do CRM (cinco sao de antes de
-- 07/09/2026, o primeiro aviso da Locadora): sem o registro, o grupo receberia
-- como lead novo quem a vendedora atende ha' mais de um mes.
-- Um INSERT por card: o D1 recusa UNION com 6 termos ("too many terms in
-- compound SELECT").
INSERT OR IGNORE INTO group_notifications (tenant_id, chave, task_id, status, erro)
SELECT id, 'task:1142', 1142, 'ignorado', 'card antigo de Qualificando, levado para Pendente: ja atendido' FROM tenants WHERE slug = 'locadora';
INSERT OR IGNORE INTO group_notifications (tenant_id, chave, task_id, status, erro)
SELECT id, 'task:1378', 1378, 'ignorado', 'card antigo de Qualificando, levado para Pendente: ja atendido' FROM tenants WHERE slug = 'locadora';
INSERT OR IGNORE INTO group_notifications (tenant_id, chave, task_id, status, erro)
SELECT id, 'task:1415', 1415, 'ignorado', 'card antigo de Qualificando, levado para Pendente: ja atendido' FROM tenants WHERE slug = 'locadora';
INSERT OR IGNORE INTO group_notifications (tenant_id, chave, task_id, status, erro)
SELECT id, 'task:1447', 1447, 'ignorado', 'card antigo de Qualificando, levado para Pendente: ja atendido' FROM tenants WHERE slug = 'locadora';
INSERT OR IGNORE INTO group_notifications (tenant_id, chave, task_id, status, erro)
SELECT id, 'task:1465', 1465, 'ignorado', 'card antigo de Qualificando, levado para Pendente: ja atendido' FROM tenants WHERE slug = 'locadora';
INSERT OR IGNORE INTO group_notifications (tenant_id, chave, task_id, status, erro)
SELECT id, 'task:2237', 2237, 'ignorado', 'card antigo de Qualificando, levado para Pendente: ja atendido' FROM tenants WHERE slug = 'locadora';
