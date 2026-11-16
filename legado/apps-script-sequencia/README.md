# Apps Script antigo: "Sequencia Leads - Todos os Clientes"

Copia do projeto que numerava e ordenava a aba de leads de cada cliente, guardada aqui
para nao depender do Google. Dono: contato@. Arquivos: `Sequencia.gs`, `Ordenacao.gs`,
`appsscript.json`.

- Acionadores (por tempo): `gerarSequencias` a cada 1 minuto e `ordenarTodas` a cada
  5 minutos, com notificacao de falha diaria.
- Apagados em 13/11/2026. Ultima execucao 19h08 (Brasilia); o motor do CRM
  (`src/pipelines/sequencia.ts`) foi ligado as 19h11.
- Nao tem segredo no codigo: so' ids de planilha e as URLs dos webhooks de aviso.

Para voltar a ele, ver "Voltar atras" em `docs/marca-e-sequencia.md`. Primeiro desligar o
motor do CRM (senao os dois numeram a mesma linha), depois colar o codigo e recriar os
dois acionadores.
