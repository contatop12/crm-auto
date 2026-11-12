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
