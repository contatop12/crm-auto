# Relatorios unificados no painel do Chatwoot (2026-11-16)

## Problema
Relatorios tem 10 sub-abas (Visao geral, Conversas, Agentes, Etiquetas, Caixa de Entrada, Time,
Funis, CSAT, SLA, Robos), cada uma com exibicao propria e dados que parecem errados (nas contas dos
clientes toda conversa fica sem atendente e nada e' "resolvido"). O trabalho real esta no kanban e
nas etiquetas de origem. A pagina fica espremida (`max-w-5xl`). Quem usa: o gestor do cliente.
Perguntas que a pagina responde: quantos leads chegaram e de onde, quem ficou sem resposta, onde o
funil trava, como cada atendente esta indo.

## Desenho
1. **Menu**: "Relatorios" e' um item so'. Os sub-itens somem; clicar abre `/reports/overview`.
   As telas originais seguem abrindo pelo endereco e por link "Relatorios originais do Chatwoot"
   no rodape. `/reports/overview?original=1` mostra a tela nativa.
2. **Pagina** em `/reports/overview`: esconde o conteudo nativo, ocupa toda a largura da area (margem
   32 px no desktop, 16 px no celular). Cores/tipografia pelas variaveis do Chatwoot, claro e escuro.
   Graficos em SVG feitos a mao. Qualquer excecao devolve a tela original.
3. **Filtros fixos no topo**: periodo (hoje, 7 dias, 30 dias, este mes, mes passado, personalizado),
   funil, caixa de entrada, atendente, etiqueta, time, comparar com periodo anterior. Ficam na URL e
   no navegador. A API do Chatwoot so' filtra uma dimensao (caixa, atendente, etiqueta ou time) por
   vez nos numeros de conversa; escolher uma limpa as outras.
4. **Para agir agora**: alertas clicaveis (conversas sem resposta, leads parados em Novo Lead,
   etapa com cards mais velhos, maior perda do funil, caixa sem conversa).
5. **Numeros-chave** com variacao contra o periodo anterior.
6. **Visoes**: Visao geral, Funil (reaproveita `window.__p12Funil`), Origem dos leads (CRM),
   Atendimento, Etiquetas, Caixas de entrada, Atendentes, Time. Tabelas ordenaveis, CSV, grafico
   ou tabela. Visao sem dado mostra vazio explicado.
7. **Rota nova no CRM** `GET /ingest/categorias/:conta/origem?since&until&tz`: autentica pela sessao do
   Chatwoot (como as demais) e devolve so' numeros agregados (por origem, campanha e dia). Nunca nome
   nem telefone. A conta se liga ao cliente por `tenant_config.cw_account_id`.

## Arquivos
- `panel/chatwoot-relatorios.js` (calculo puro em `window.__p12Relatorios`, testado com `node:vm`)
- `src/domain/relatorioOrigem.ts` (classificacao e agregacao) e rota em `src/routes/categorias.ts`
- servido junto do script das categorias em `/ingest/categorias/script.js`
