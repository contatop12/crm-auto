# Lead que volta: card novo e ciclo novo

Data: 21/11/2026 · Estado: aguardando aprovação

## Intenção

O lead que já fechou (Ganho) ou foi perdido (Perda) e volta a falar depois de
15 dias é uma oportunidade nova. Hoje a mensagem dele reabre a mesma conversa,
o card continua parado em Ganho/Perda e nem a planilha, nem o grupo, nem a
plataforma de anúncio ficam sabendo.

O que se quer: um card novo no começo do funil, o card antigo preservado como
histórico, e a volta contando como lead novo em tudo.

## O que o usuário decidiu

1. **Regra.** Chega mensagem do lead, o card da conversa está em Ganho ou
   Perda, e a mensagem anterior do lead tem 15 dias ou mais.
2. **Card novo** com `#1`, `#2`, `#3`… no fim do nome, pelo número de voltas.
   O card antigo fica onde está.
3. **Lead novo em tudo:** linha e sequência novas na Geral, aviso no grupo,
   conversões.
4. **Origem.** Volta sem anúncio novo herda a origem do ciclo anterior (mesma
   campanha; as conversões voltam para ela). Volta com anúncio novo usa a
   origem do anúncio novo.

## Como funciona hoje (o que a mudança toca)

- O Chatwoot (Kanban Pro, fechado: só API) cria um card por conversa. A
  conversa traz `kanban_task` no singular, e é por ele que o CRM mexe no card:
  título (`pipelines/tituloCard.ts`), Pendente (`pipelines/pendente.ts`),
  mover pela frase do vendedor (`pipelines/sellerMessage.ts`).
- A Evolution reabre sempre a mesma conversa (`reopenConversation=true`,
  exigido pelo resolver automático desde 19/11). Por isso a volta cai na
  conversa antiga e no card antigo.
- Planilha, aviso e conversão andam pelo **protocolo**, não pelo card:
  `conversions.dedupe_key = protocolo-evento`, `group_notifications.chave =
  protocolo`, uma linha da Geral por protocolo.
- `atribuirLead` (`pipelines/leadMessage.ts`) sai cedo quando a conversa já tem
  `protocolo`: o clique novo de quem volta é ignorado.
- `tituloDoCard` (`domain/tituloCard.ts`) reescreve o título a cada mensagem a
  partir do nome do contato: um sufixo posto à mão sumiria.
- `protocoloDaFrase` e `protocoloDoAnuncio` derivam o protocolo do id da
  conversa: dois ciclos na mesma conversa dariam o mesmo protocolo.
- `recuperarRespostasAnteriores` (chamada em `avisarLeadNoGrupo`) lê todas as
  respostas do vendedor na conversa e adianta o card: num card novo, as frases
  do ciclo antigo ("segue a proposta") o levariam direto para Proposta Enviada.

Conferido na instância em 21/11 (só leitura): nos 5.272 cards das 6 contas
nenhuma conversa tem dois cards e nenhum card tem duas conversas. Ganho e Perda
são as etapas com `completed`/`cancelled` (Oportunidade Ganha / Oportunidade
Perdida em todas as contas). "Desqualificado" da Persianas não tem a marca. O
Orgânico da Persianas (board 14) também tem Ganho e Perda.

## Abordagens

- **A. O CRM cria o card e abre um ciclo novo do lead, com protocolo próprio
  (escolhida).** Como tudo já anda pelo protocolo, planilha, aviso e conversão
  tratam a volta como lead novo pelos caminhos que existem. Custo: mexe na
  atribuição, que é o código mais delicado, e depende de um teste da API do
  Kanban.
- **B. Forçar conversa nova no Chatwoot.** O card nasceria sozinho e a
  atribuição nem mudaria. Não dá: reabrir ou não é configuração da instância
  da Evolution, não do contato, e a mensagem da volta já caiu na conversa
  antiga.
- **C. Reaproveitar o card antigo (voltar para Novo Lead e renomear).** Mais
  barato, sem incógnita de API. Descartada: o Ganho sairia da coluna e do
  relatório de funil, que é o que se quer preservar.

## Desenho

### 1. A regra

Função pura em `domain/retorno.ts`. É volta quando, juntas:

- a mensagem é do lead (`incoming`, não privada) e o número não é da própria
  empresa (`numeros_proprios`);
- o card da conversa está numa etapa com `completed` ou `cancelled`;
- a mensagem anterior **do lead** nesta conversa tem `retorno_dias` dias ou
  mais (padrão 15). Mensagem do vendedor não conta. Sem nenhuma mensagem
  anterior do lead, vale a data em que o card entrou na etapa final: o
  `step_changed_at` do card (`cw.tarefa`), buscado só nesse caso.

A mensagem anterior é procurada para trás a partir do id da mensagem atual
(`mensagensAte` + paginação), não "as últimas da conversa": reprocessar o
evento depois dá a mesma resposta.

Vale para os dois boards do cliente (funil e Orgânico).

### 2. O lead do ciclo novo

Mesma ordem de fontes da atribuição: protocolo na mensagem, anúncio da Meta
(cartão ou `ctwa_clid`), telefone na janela, frase de entrada.

- **Anúncio novo:** a fonte entrega um protocolo que nenhum ciclo desta
  conversa usou. O lead é o desse clique. Para frase e anúncio da Meta, cujo
  protocolo deriva da conversa (`PREFIXO-MSG-<conversa>`,
  `PREFIXO-CTWA-<conversa>`), o ciclo entra no protocolo:
  `PREFIXO-MSG-<conversa>-R<n>`.
- **Sem anúncio novo** (nenhuma fonte, ou a fonte devolve um protocolo já
  usado por esta conversa): o lead é uma **cópia** da linha de `leads` do
  ciclo anterior, com:
  - `protocol` = `<protocolo raiz>-R<n>` (sempre sobre o protocolo do primeiro
    ciclo, não encadeado);
  - identidade e atribuição copiadas (nome, e-mail, telefones, `gclid`,
    `gbraid`, `wbraid`, UTMs, `utm_campaign_nome`, `fbc`, `ctwa_clid`,
    `page_url`);
  - `origem = 'mensagem'`, `evento = 'retorno'`, `quiz_version` vazio: a volta
    chegou pelo WhatsApp, então o canal do aviso é "Mensagem" e quem avisa o
    grupo é o CRM (lead de formulário/quiz herdado não teria fluxo de
    formulário para avisar);
  - `valor_proposta` vazio, `created_at` = agora (a DATA/HORA da Geral e do
    aviso é a da volta);
  - `retorno_de` = protocolo raiz, `clique_em` = data do clique original.
- **Sem lead:** não há anúncio novo e o ciclo anterior não tinha protocolo, ou
  tinha protocolo sem linha em `leads` (nada para copiar). Nasce só o card.
  Planilha, aviso e conversão seguem a regra de hoje para card sem protocolo.

Lead de clique sem campanha (protocolo do site, sem `gclid` nem UTM) é copiado
como está e segue as regras de hoje para esse tipo de lead.

O protocolo do ciclo é interno: nunca chega digitado numa mensagem, então
`findProtocol` não precisa reconhecê-lo. Planilha, conversão e Pulseboard o
tratam como texto; confirmar com uma busca ao planejar.

O nome do lead do ciclo leva o `#n` (`Vital #1`), para a Geral e o aviso do
grupo mostrarem que é volta.

### 3. O card novo

`POST /kanban/tasks`, criado pelo CRM:

- **Board:** o do card antigo. Exceção: card antigo no Orgânico e lead do ciclo
  vindo de anúncio (Google/Meta) ou do perfil do Google → board do funil.
- **Etapa:** a primeira do board.
- **Título:** o do card antigo, sem sufixo de volta anterior, mais ` #n`:
  `#1240 - 5511999990000 - Vital #1`.
- **Ligações:** a mesma conversa e o mesmo contato; responsável igual ao do
  card antigo, se a API aceitar.
- **Atributos:** `protocolo` e UTMs do ciclo novo. Valor vazio.

O card antigo não muda: etapa, título, valor e protocolo ficam.

### 4. Depois do card

A volta passa pelo **mesmo caminho da atribuição** (`atribuirLead` com um modo
de volta), não por uma segunda atribuição escrita à parte:

1. Conversa: `protocolo` e UTMs do ciclo novo nos atributos; etiquetas de
   origem do ciclo acrescentadas. O modo de volta **nunca** grava
   `funil = PROMOVER`: a regra "[PAINEL] Promover ao funil de Ads" reage a
   esse valor e transferiria o card da conversa (conferido nas contas 5 e 7 em
   21/11; a regra antiga "LeadsGoogle", que reage a qualquer protocolo, está
   desligada). Quando o card novo nasce no board do funil e a conversa ainda
   não tem `funil = Lead`, o CRM grava `Lead` direto.
2. `conversations`: `protocol` e `task_id` passam a ser os do ciclo novo.
3. Planilha: entrada na Geral (linha e sequência novas), pelo
   `espelharNaPlanilha` de hoje.
4. Conversão de entrada, quando o lead é de anúncio, pelo
   `dispararConversaoDeEntrada` de hoje.
5. Aviso no grupo: o próprio pipeline chama `avisarLeadNoGrupo` com o card
   novo, sem depender do webhook do card. `group_notifications` barra a
   repetição se o webhook vier depois.

As conversões das etapas seguintes já funcionam: o card novo traz o protocolo
novo, e `acharProtocolo` lê do card. A regra "Etapa do card → planilha" tem de
seguir o mesmo caminho: a etapa do card novo vai para a linha nova, e a linha
antiga continua em Ganho/Perda. Conferir em `espelharEtapaNaGeral` que o
protocolo vem do card antes da conversa.

Ajustes para o ciclo novo não herdar o passado da conversa:

- `recuperarRespostasAnteriores` e a regra das mensagens automáticas só olham
  mensagens **depois** da volta.
- Conversão do Google com `clique_em` há mais de 90 dias: `ignorado`, com o
  motivo ("clique original com mais de 90 dias"). Planilha e aviso seguem. Na
  Meta o evento vai como hoje; ela aceita ou recusa, e a recusa aparece no
  painel.

### 5. Título

`tituloDoCard` preserva o ` #n` do fim ao reescrever. Sem isso a mensagem
seguinte apagaria o sufixo.

### 6. Banco (migration 0044)

- `tenant_config.retorno_dias INTEGER` (NULL = desligado).
- `leads.retorno_de TEXT`, `leads.clique_em TEXT`.
- Tabela `retornos`: `tenant_id`, `cw_conversation_id`, `n`, `mensagem_id`,
  `task_anterior`, `task_novo`, `protocolo_anterior`, `protocolo_novo`,
  `origem` (`anuncio_novo` | `herdada` | `sem_lead`), `status`, `erro`,
  `created_at`. `UNIQUE (tenant_id, task_anterior)` e
  `UNIQUE (tenant_id, cw_conversation_id, n)`.

### 7. Uma volta, um card

- A reserva é `INSERT OR IGNORE` em `retornos` pela
  `UNIQUE (tenant_id, task_anterior)`: um card fechado só gera uma volta. A
  mesma mensagem chega em dois eventos (`message_created` e
  `message_incoming`) e a fila retenta; nada disso cria segundo card.
- `n` = voltas já registradas da conversa + 1.
- Retentável: com `task_novo` gravado, a retentativa não cria card, só termina
  os passos que faltam (todos já têm dedup próprio).
- Falha aqui não derruba a atribuição nem os outros pipelines da mensagem; o
  erro fica em `retornos` e no log.

### 8. Teste na instância, antes de qualquer código de produção

Precisa do ok do usuário e de uma conversa interna. Responde:

1. O Kanban aceita um segundo card ligado à mesma conversa?
2. Depois disso, `conversation.kanban_task` (no GET e no webhook da mensagem
   seguinte) aponta para o card novo ou para o antigo?
3. Card criado pela API dispara o webhook do card?
4. Nomes exatos dos campos do `POST` (`conversation_ids`, `contact_ids`,
   responsável) e se `DELETE` funciona (limpeza do teste).
5. Gravar `protocolo` e UTMs na conversa, com `funil = Lead`, não faz nenhuma
   regra criar ou mover card.
6. No ramo de desligar: o card antigo, sem conversa, continua contado no
   relatório de funil (`/kanban/reports/*`, que é do Chatwoot). Se sumir do
   relatório, parar e voltar ao usuário.

Regra de decisão:

- Aceita e a conversa aponta para o novo → os dois cards ficam ligados à
  conversa.
- Aceita e aponta para o antigo, ou recusa → o card antigo perde a ligação com
  a conversa (`PUT` com `conversation_ids` vazio) e mantém o contato; se criar
  o novo falhar, a ligação é devolvida. O painel de cards órfãos deixa de
  listar os que estão em `retornos.task_anterior`.
- Nem desligar funciona → parar e voltar ao usuário.

## Fora de escopo

- Tela no painel para ligar/desligar ou mudar o prazo (a coluna no banco basta).
- Mudança na Pulseboard (o dedupe por telefone dela é de 24 h; conferir no
  código antes de confiar).
- Qualquer coisa retroativa: card já fechado só ganha card novo na próxima
  mensagem do lead.

## Anti-objetivos

- Dois cards para a mesma volta.
- Card antigo saindo de Ganho/Perda ou perdendo valor e protocolo.
- Card novo andando sozinho por causa de mensagens do ciclo antigo.
- Conversão subindo para plataforma diferente da que trouxe o lead.

## Restrições

- Kanban do Chatwoot só por API; Worker Cloudflare, D1 e fila, como o resto.
- Teste, comentário e commit sem telefone nem sobrenome real de lead.
- Outras sessões editam este checkout: trabalhar em worktree.
- Backup do D1 antes da migration; migration remota antes do push; os dois
  passam pelo usuário.

## Chamadas minhas (o usuário não decidiu; pode corrigir)

- Ganho/Perda = marca `completed`/`cancelled` do Chatwoot, não o nome da etapa.
  "Desqualificado" fica fora.
- A regra é literal: quem ficou 20 dias calado, teve o card fechado hoje e
  responde amanhã gera volta. Alternativa: contar os 15 dias também a partir
  da entrada do card em Ganho/Perda.
- Vale também no Orgânico da Persianas.
- O `#n` aparece também no nome da Geral e do aviso.
- Contagem de voltas por conversa, não por telefone.
- `retorno_dias` nasce NULL: liga-se primeiro em um cliente, confere-se uma
  volta real de ponta a ponta (card, Geral, sequência, aviso, conversão) e só
  então liga-se em todos com 15.

## Fica com quem constrói

- Como saber que a etapa é final sem custar uma chamada ao Chatwoot em toda
  mensagem (payload, `funnel_stages` ou cache).
- A forma do modo de volta dentro de `atribuirLead`.
- Tirar o `#n` do nome se algum envio a plataforma usar o nome do lead.
- Conferir que a Pulseboard casa o aviso da volta com a linha **nova** da
  Geral (mesmo telefone da linha antiga), no primeiro cliente ligado.

## Testes

- Domínio: regra da volta (limites de 15 dias, vendedor não conta, sem
  mensagem anterior), título (sufixo preservado, `#2` depois de `#1`),
  protocolo do ciclo, anúncio novo × herdado × sem lead.
- Pipeline, com Chatwoot e D1 de mentira como nos testes atuais: uma volta cria
  um card; dois eventos da mesma mensagem criam um; retentativa não duplica;
  conversão de clique com mais de 90 dias é ignorada com motivo; respostas
  antigas do vendedor não movem o card novo.
