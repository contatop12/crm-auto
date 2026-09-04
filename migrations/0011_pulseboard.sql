-- Aviso de lead novo no grupo: ligado ou desligado por cliente.
--
-- Ate' aqui o aviso era obrigatorio. Cliente sem `codi_id` — Locadora e Taina —
-- devolvia `erro` a cada lead novo, e a fila retentava um cadastro que nunca ia
-- se preencher sozinho. Configuracao faltando nao e' falha transitoria.
--
-- Nasce em 1 para nao mudar o comportamento de quem ja' usa; quem esta sem
-- `codi_id` e' desligado logo abaixo.
ALTER TABLE tenant_config ADD COLUMN pulseboard_ativo INTEGER NOT NULL DEFAULT 1;

UPDATE tenant_config SET pulseboard_ativo = 0
 WHERE pulseboard_codi_id IS NULL OR trim(pulseboard_codi_id) = '';
