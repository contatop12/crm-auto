-- O nome da campanha, resolvido pelo ID contra a API do Google Ads.
--
-- O anuncio manda `utm_campaign` com o ID quando a macro {campaignname} nao
-- esta' preenchida — foi o que sempre chegou da Locadora ("21802734158"). O
-- sistema ja' buscava o nome para escrever no card do Chatwoot, mas jogava
-- fora; a planilha e o banco ficavam com o numero.
--
-- Aqui ele fica guardado, e a coluna CAMPANHA da aba Geral passa a mostrar o
-- nome. Sem o nome (API fora, campanha apagada) a coluna fica com o ID.
ALTER TABLE leads ADD COLUMN utm_campaign_nome TEXT;
