# Categorias de etiquetas no Chatwoot

Data: 04/11/2026. Status: rascunho, aguardando aprovação do usuário.

## Por que existe

O card do kanban mostra todas as etiquetas numa linha só. Com as 13 etiquetas de motivo de perda da Locadora, e outras que virão, fica difícil saber só de bater o olho o que cada etiqueta significa. O usuário quer agrupar etiquetas em categorias criadas por ele e ver esse agrupamento no próprio card.

## O que o usuário pediu

**Tela de Etiquetas**

- Botão "Criar categoria" ao lado de "Adicionar etiqueta". Dá para criar várias.
- Cada etiqueta fica numa categoria específica ou em "Sem categoria".
- Esboço aprovado: faixa "Categorias" acima da lista (nome, quantidade de etiquetas, lápis para renomear, arrastar para ordenar) e um seletor de categoria em cada linha da lista. Escolheu no seletor, já vale.

**Card do kanban** (layout B, escolhido entre dois esboços)

- A linha de etiquetas continua como hoje, com todas as etiquetas.
- Abaixo dela, para cada categoria que tenha etiqueta no card: o nome da categoria em letra pequena, maiúscula e cinza, e logo abaixo as etiquetas do card daquela categoria. A etiqueta aparece repetida de propósito.
- Categoria sem etiqueta no card não aparece: nem nome, nem espaço. Card sem etiqueta de categoria fica idêntico a hoje.
- Atribuição continua pelo caminho atual: card > Relacionamentos > Etiquetas. A separação é automática.

**Regras confirmadas**

- Etiqueta pertence a uma categoria só, ou a nenhuma.
- No card, as categorias seguem a ordem definida na faixa.
- Cada conta do Chatwoot tem as próprias categorias.
- Vale para todos os quadros da conta.
- O painel de Relacionamentos não muda.
- Só administradores criam e alteram categorias.

**Atualizações**

- O Chatwoot segue a versão da fazer.ai. Nada é recriado do zero.
- Quando sair versão nova, o monitor só avisa. A atualização roda somente com o ok do usuário.
- O token do Coolify não pode ir para produção.

## Fora do escopo

- Copiar, extrair ou alterar o código do Chatwoot fazer.ai Pro. O kanban é código fechado, e os termos da fazer.ai proíbem reproduzir sem autorização (fazer.ai/termos, itens 3 e 4).
- Imagem própria do Chatwoot.
- Filtro ou relatório por categoria.
- Mudar as etiquetas existentes da Locadora ou criar categorias nos clientes. Quem cria é o usuário, pela tela nova.
- Atualização automática do Chatwoot.

## O que seria um fracasso

- Quebrar o painel ou o kanban quando o script falhar. Qualquer falha tem de deixar a tela como é hoje.
- Abrir um card por engano ou atrapalhar o arrastar ao clicar no bloco novo.
- Apagar ou alterar etiqueta, ou tirar etiqueta de card, ao excluir uma categoria.
- O card piscar ou o quadro ficar lento com muitos cards.

## O que já foi verificado (04/11, só leitura)

- Chatwoot: service do Coolify 4.5.3, uuid `jaxbv73ektgnmu7fk5xtdf5g`, imagem `harbor.fazer.ai/chatwoot/fazer-ai/chatwoot-pro:latest`. Painel em chatwoot.sitespdoze.com.br, sem Content-Security-Policy.
- Card: `a[data-draggable="true"][href*="/task/<id>"]`, com `header` e um `div.flex.flex-col` de conteúdo. Fica em `.kanban-column-body`, dentro de um componente arrastável. Rota do quadro: `/app/accounts/<conta>/kanban/<quadro>`.
- API: `GET /api/v1/accounts/<conta>/kanban/tasks?board_step_id=<etapa>` traz `labels` como lista de títulos, ex.: `["google-ads","mensagem","search"]`.
- Tela de Etiquetas: rota `/app/accounts/<conta>/settings/labels/list`. A lista não usa `<table>` na conta 1, que pode estar vazia.
- Sessão: o cookie `cw_d_session_info` é legível por JavaScript.
- Versão: `GET /api` traz a versão rodando (`4.19.0-fazer-ai-pro.157`). `GET /api/v1/accounts/5` traz `latest_chatwoot_version` (`4.19.0-fazer-ai-pro.164`).
- `DASHBOARD_SCRIPTS`: no repositório público fazer-ai/chatwoot, o layout `vueapp.html.erb` imprime o valor no fim do `<body>`. Na tela do super admin, a opção só aparece na aba `internal`, da parte enterprise, que pode não existir nesta instalação.
- A API de conta não aceita campos livres em `custom_attributes` (lista fechada), então as categorias não cabem no Chatwoot.

## O que ainda não foi verificado

1. Se a imagem Pro imprime `DASHBOARD_SCRIPTS` como o repositório público. Primeiro passo da construção.
2. A marcação das etiquetas dentro do card e das linhas na tela de Etiquetas. O Chrome conectado abre só a conta 1, onde os cards não têm etiqueta, e redireciona quando se pede a conta 5. É preciso uma sessão que abra a Locadora.

Se o item 1 falhar, parar e voltar ao usuário: o projeto depende dele.

## Como vai ser construído (decisões minhas, salvo indicação)

**Script.** Um arquivo JavaScript servido pelo CRM em rota pública sob `/ingest`, carregado por uma tag `<script src>` em `DASHBOARD_SCRIPTS`. Corrigir o script passa a ser um deploy do CRM, sem mexer no Chatwoot. Ele não usa biblioteca externa, observa a tela com `MutationObserver` porque o painel é uma SPA, e só age nas duas rotas acima. Pega a conta pela URL.

**Dados.** No D1 do CRM, chaveados por `cw_account_id`, não por tenant: tabela de categorias (conta, nome, posição) e tabela de ligação etiqueta-categoria, usando o id da etiqueta. Assim, renomear a etiqueta não perde a categoria. Etiqueta apagada é ignorada na leitura.

**Excluir categoria.** As etiquetas voltam para "Sem categoria". Nada muda no Chatwoot. O usuário não contestou essa regra no esboço, mas o botão de excluir ainda não foi desenhado.

**Autorização.** Rotas novas sob `/ingest` com CORS só para a origem do Chatwoot. O script envia os cabeçalhos da sessão do agente, e o CRM os repassa a `GET /api/v1/profile` do Chatwoot para confirmar quem é. Qualquer membro da conta lê; só administrador da conta grava. O CRM não guarda nem registra esses cabeçalhos, inclusive em logs e na tabela `events`.

**Monitor de versão.** No cron diário do CRM (`17 4 * * *`), comparar as duas versões. Havendo novidade, avisar uma vez por versão, guardando a última avisada no D1, pelo `EVOLUTION_ALERT_INSTANCE` no `EVOLUTION_ALERT_GROUP_ID`, com o link das notas de versão. O CRM não recebe o token do Coolify nem dispara atualização.

**Aviso de quebra.** Se o script estiver no quadro e a API indicar cards, mas ele não achar nenhum card na tela, ou se não achar o lugar de entrada na tela de Etiquetas, envia um sinal ao CRM. O CRM avisa no mesmo grupo, uma vez por versão.

**Falhas.** Sem resposta do CRM, com erro, ou sem categorias: não desenhar nada e não mostrar erro na tela.

**Aparência.** Usar as classes do próprio Chatwoot para acompanhar o tema claro e o escuro. Textos em português.

## O que fica a critério de quem constrói

- Ler as etiquetas do card pela tela ou pela API, desde que não faça uma chamada por card.
- Nomes de rotas e tabelas, formato das respostas e cache de leitura.
- Como desenhar a janela de criar e renomear, a confirmação de excluir e o arrastar, seguindo o esboço.
- Como evitar pisca-pisca e reinserção em excesso.

## Passos que dependem do usuário

- Instalar o script, uma vez: gravar `DASHBOARD_SCRIPTS` por um comando no Terminal do Coolify, no container `rails`. O super admin não serve: o registro já existe travado, fica fora da lista e criar outro dá "Invalid action performed". A API do Coolify não executa comando em container. É uma mudança persistente no painel de todos os clientes, então precisa do ok dele na hora.
- Abrir o Chrome numa sessão com acesso à Locadora, para o teste no card real.
- Publicar o CRM: migration remota e depois push, nessa ordem.
- Dar o ok para cada atualização do Chatwoot. Hoje há 7 versões de diferença.
- Criar as categorias na tela nova.

## Como saber que deu certo

- Na Locadora, com "Motivo de perda" criada e `preco-da-locacao` dentro dela, um card com essa etiqueta mostra o bloco, e um card sem ela fica igual a hoje.
- Trocar a etiqueta de categoria muda o card ao recarregar.
- Arrastar o card e abrir o card continuam funcionando.
- Conta sem categorias: o kanban fica idêntico a hoje.
- Agente que não é administrador não consegue gravar, mesmo chamando a rota diretamente.
- Com o CRM fora do ar, o painel funciona normalmente, sem o bloco.
- O monitor avisa uma única vez sobre a versão `…164` e não repete no dia seguinte.
- Os testes do CRM continuam passando, com testes novos para as rotas e o monitor.
