# Marca do painel e sequência de leads no CRM

Dois trabalhos de 12/11/2026, na branch `feat/sequencia-e-marca`. Nenhum dos dois
muda nada em produção só por ser publicado pela metade: leia a ordem.

## 1. Sequência e ordem da aba de leads

Substitui o Apps Script "Sequencia Leads - Todos os Clientes". Código em
`src/domain/sequencia.ts` (a conta) e `src/pipelines/sequencia.ts` (ler, gravar, avisar).
A lista de planilhas está na tabela `sequencia_planilhas` (migration 0041), igual à
`PLANILHAS` do script naquele dia.

O modo fica em `sequencia_estado.modo` e nasce `desligado`.

| Modo | O que faz |
|---|---|
| `desligado` | Não lê planilha nenhuma. |
| `sombra` | Lê e calcula, não grava nem avisa. Registra o que faria e confere com o que o Apps Script fez. |
| `ligado` | Numera, avisa a Pulseboard, ordena e reaplica formato de DATA/HORA. |

### Ordem da troca

1. `npm run db:migrate:remote` (cria as tabelas, modo `desligado`).
2. Publicar o Worker (o cron de 1 minuto entra junto e não faz nada enquanto desligado).
3. `GET /api/sequencia/verificar`: toda planilha precisa responder `ok: true`. A que
   não responder precisa ser compartilhada com a conta de serviço do CRM como Editor.
4. `POST /api/sequencia/modo` com `{"modo":"sombra"}` e deixar um dia.
5. `GET /api/sequencia`: em `avisos_7_dias`, `sombra_ok` é acerto; `sombra_diverge` e
   `sombra_faltou` precisam ser olhados antes de seguir.
6. Apagar os acionadores `gerarSequencias` e `ordenarTodas` em script.google.com
   (tela Acionadores). **Só depois** `POST /api/sequencia/modo` com `{"modo":"ligado"}`.
   Os dois ligados ao mesmo tempo dão a mesma linha dois números.

Voltar atrás: modo `desligado` e recriar os acionadores (`gatilhoSequencia` e
`gatilhoOrdenacao` no próprio script).

### O que se conserta sozinho

- Planilha que falhou numa rodada é lida de novo um minuto depois; o estado é a própria aba.
- O aviso é registrado antes de a sequência ir para a planilha. Rodada que morre no
  meio é completada pela seguinte: a linha numerada sem aviso recebe o aviso.
- Aviso recusado pela Pulseboard vai pela reserva (n8n); recusado pelas duas, é
  tentado de novo por 15 rodadas.
- A ordenação move a linha inteira em vez de regravar valores. Nada é escrito por
  cima de outra linha, e o formato acompanha a linha.
- HORA mostrando `30/12/1899` (número certo, formato de data) tem o formato
  reaplicado na coluna.
- Trinta rodadas seguidas com erro na mesma planilha mandam um aviso ao grupo de alertas.

### O que não muda

- Buraco na numeração não é fechado e sequência repetida não é renumerada.
- Locadora e Persianas continuam sem ordenar; Practical Life só ordena; Libertad e
  Rafaela numeram sem avisar. Para mudar: `UPDATE sequencia_planilhas`.

## 2. Marca do painel (ChatWork)

- Logo: `panel/marca/*.svg`, servida em `/ingest/marca/<arquivo>`. Para redesenhar:
  `python scripts/marca/gerar-logo.py <Poppins-SemiBold.ttf> panel/marca`.
- Cor e ícone da aba: `panel/chatwoot-marca.js`, que sai junto no
  `/ingest/categorias/script.js` já instalado no `DASHBOARD_SCRIPTS`.
- Nome e logo: `InstallationConfig` do Chatwoot. Depois de o Worker estar publicado,
  no Terminal do Coolify (container rails):

```bash
bundle exec rails runner '
base = "https://crm.sitespdoze.com.br/ingest/marca"
novo = {
  "INSTALLATION_NAME" => "ChatWork",
  "BRAND_NAME"        => "ChatWork",
  "LOGO"              => "#{base}/logo.svg",
  "LOGO_DARK"         => "#{base}/logo_dark.svg",
  "LOGO_THUMBNAIL"    => "#{base}/logo_thumbnail.svg",
}
puts "ANTES: " + InstallationConfig.where(name: novo.keys).map { |c| [c.name, c.value] }.inspect
novo.each { |nome, valor| c = InstallationConfig.find_or_initialize_by(name: nome); c.value = valor; c.save! }
GlobalConfig.clear_cache
puts "DEPOIS: " + InstallationConfig.where(name: novo.keys).map { |c| [c.name, c.value] }.inspect
'
```

A linha `ANTES` é o que guardar para voltar atrás (mesmo comando, com os valores antigos).

Ficam com o nome antigo: o `manifest.json` (nome ao instalar como aplicativo) e as
ilustrações com azul desenhado dentro do SVG. `BRAND_URL` e `WIDGET_BRAND_URL` entram
na troca de domínio.

## 3. Voltar atrás

### Marca

Valores de antes de 12/11/2026 do `InstallationConfig` do Chatwoot: `INSTALLATION_NAME` e
`BRAND_NAME` = `Chatwoot`; `LOGO` = `/brand-assets/logo.svg`; `LOGO_DARK` =
`/brand-assets/logo_dark.svg`; `LOGO_THUMBNAIL` = `/brand-assets/logo_thumbnail.svg`.
Gravar com o mesmo comando rails da seção 2, trocando o hash `novo` por esses valores.

A cor sai tirando `/chatwoot-marca.js` da lista em `src/routes/categorias.ts` (e publicando).

### Ordem do kanban

A tabela `p12_bkp_kanban_prefs_20261113`, no Postgres do Chatwoot, guarda as preferências
de antes de 13/11/2026. **Não apague essa tabela.** Para restaurar:

```sql
UPDATE kanban_account_user_preferences p
   SET preferences = b.preferences, updated_at = NOW()
  FROM p12_bkp_kanban_prefs_20261113 b
 WHERE b.id = p.id;

DELETE FROM kanban_account_user_preferences
 WHERE id NOT IN (SELECT id FROM p12_bkp_kanban_prefs_20261113);
```

### Sequência

1. Desligar o motor do CRM: `UPDATE sequencia_estado SET valor = 'desligado' WHERE chave = 'modo'`
   (D1 `crm_auto`). Antes de qualquer outra coisa: os dois ligados dão a mesma linha dois números.
2. Colar o código de `legado/apps-script-sequencia/` (`Sequencia.gs`, `Ordenacao.gs`,
   `appsscript.json`) no projeto "Sequencia Leads - Todos os Clientes" (dono contato@; o
   original foi exportado em 13/11/2026, id do arquivo
   `1H3tP6opvvaPqdSSfK_yF-rBX4u0CONN4RwrQuU6TufbAnCS_3Ra88xN6`) e recriar os dois acionadores
   por tempo, rodando `gatilhoSequencia` e `gatilhoOrdenacao`: `gerarSequencias` a cada 1
   minuto e `ordenarTodas` a cada 5.
3. Se uma planilha ficou errada, restaurar do backup diário (abaixo). O histórico de versões
   do próprio Google também serve.

### Backup diário das planilhas

`src/pipelines/backupPlanilhas.ts`, no cron de minuto: depois de 01:00 (São Paulo), grava
um `.json.gz` por planilha ativa de `sequencia_planilhas` no bucket R2 privado
`crm-auto-backups`, em `planilhas/AAAA-MM-DD/<id>-<cliente>.json.gz`. Objetos somem em 30
dias (tem nome e telefone). Cada arquivo traz `{doc, aba, cliente, em, formatado, bruto}`:
o texto como aparece e as fórmulas/números de série por baixo.

O estado do dia fica em `sequencia_estado`, chave `backup_planilhas` (`concluido`, `arquivos`,
`bytes`, `erros`). Planilha com erro é tentada de novo a cada 30 min, até 4 vezes.

Para restaurar, em uma aba nova (a original nunca é tocada). A CLI não lista objetos: o nome
sai do padrão `<id>-<cliente-sem-acento>` (id de `sequencia_planilhas`) ou do painel do R2.

```bash
npx wrangler r2 object get crm-auto-backups/planilhas/2026-11-16/1-taina-aci.json.gz --file taina.json.gz --remote
node scripts/restaurar-planilha.mjs taina.json.gz              # só mostra o que faria
node scripts/restaurar-planilha.mjs taina.json.gz --confirmar  # cria a aba "Backup 2026-11-16"
```

Usa `CLIENT_ID`, `CLIENT_SECRET` e `REFRESH_TOKEN` do `.env`. Grava o texto como aparecia
(RAW): telefone e zero à esquerda ficam iguais, nenhuma fórmula roda, e data e hora entram
como texto. Quem decide copiar a aba de volta para a original é a pessoa. Apague o arquivo
baixado depois: tem dado pessoal.

O script fica em `scripts/` e não em `scripts/backup/` porque o `.gitignore` ignora pastas
`backup*` (lá ficam cópias locais com dado pessoal).
