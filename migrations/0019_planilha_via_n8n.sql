-- A planilha geral de leads passa a ser escrita pelo n8n.
--
-- Escrever direto pela API do Sheets exigia autorizar o escopo `spreadsheets`
-- na conta Google. O n8n ja' tem a credencial do Sheets funcionando, entao o
-- motor so' entrega o registro pronto a um webhook dele, e o no do Google Sheets
-- no n8n escolhe a coluna de cada dado lendo os cabecalhos da planilha real.
--
-- `sheets_ativo` continua sendo o interruptor.
ALTER TABLE tenant_config ADD COLUMN planilha_webhook_url TEXT;

-- O mapa coluna -> campo passa a morar no n8n. A tabela nasceu na 0017 e nunca
-- recebeu linha em nenhum cliente.
DROP TABLE IF EXISTS sheet_columns;
