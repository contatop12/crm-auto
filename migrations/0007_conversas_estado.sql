-- O que a ferramenta SABE sobre a conversa depois de processar.
--
-- A lista de eventos monta as colunas "Conversa" e "Card" a partir do payload
-- gravado, que e' o retrato de quando o webhook chegou. Depois do pipeline
-- rodar, o retrato envelhece: a linha dizia "promovida ao funil de Ads" e a
-- coluna ao lado continuava mostrando "Organico".
--
-- Reescrever o payload nao e' opcao — ele e' a evidencia do que chegou. Entao o
-- que mudou depois fica aqui, e a tela sobrepoe.

ALTER TABLE conversations ADD COLUMN origem TEXT;         -- 'anuncio' | 'organico'
ALTER TABLE conversations ADD COLUMN promovido_em TEXT;   -- quando marcamos para promover
