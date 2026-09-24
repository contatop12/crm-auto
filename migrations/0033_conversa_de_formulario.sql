-- O lead que chegou por formulario sobe "Conversa Iniciada"?
--
-- Na Locadora nao: a LP de andaimes tem a conversao do proprio formulario no
-- site, e o lead so' chama no WhatsApp depois. Subir a conversa de entrada
-- quando ele manda a mensagem conta o mesmo lead duas vezes no Google. As
-- etapas seguintes (Proposta Enviada, Oportunidade Ganha) continuam subindo,
-- porque essas o formulario nao tem como saber.
--
-- 1 = sobe, como sempre foi. Nasce ligado: quem nao tem formulario com
-- conversao propria nao pode perder a conversa de entrada.
ALTER TABLE tenant_config ADD COLUMN conversa_de_formulario INTEGER NOT NULL DEFAULT 1;

UPDATE tenant_config SET conversa_de_formulario = 0
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'locadora');
