-- Quais leads o sistema grava na aba Geral da planilha de leads, por canal.
--
-- `google,meta,direto`, separados por virgula. NULL = todos, que e' como sempre
-- foi; texto vazio = nenhum. O lead continua indo para a aba do canal dele
-- (Google Mensagem, Meta Mensagem, WhatsApp Direto) de qualquer jeito.
ALTER TABLE tenant_config ADD COLUMN sheets_geral_canais TEXT;

-- Tainã (22/09): a Geral recebe so' o lead da campanha de mensagem do Meta. O
-- de mensagem do Google fica so' na "Google Mensagem" — o time apagava da
-- Geral as linhas que o sistema escrevia la', e a SEQUENCIA ficava furada.
UPDATE tenant_config SET sheets_geral_canais = 'meta'
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina');
