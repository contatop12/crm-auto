-- Endpoint do Pulseboard por cliente.
--
-- Estava fixo no codigo como /site-new-lead. O endpoint em uso e'
-- /meta-new-lead, e a intencao e' ter um por cliente — entao vira config, nao
-- constante. NULL usa o padrao do cliente HTTP.
ALTER TABLE tenant_config ADD COLUMN pulseboard_url TEXT;
