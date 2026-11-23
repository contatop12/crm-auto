# Rede de segurança: lead de anúncio cuja primeira mensagem não chegou

Data: 23/11/2026. Pedido do usuário depois do caso da conversa 1724 da Locadora.

## O problema

O protocolo do clique vem na primeira mensagem do lead. Em 21/11/2026 a
integração do WhatsApp (Evolution) não entregou essa mensagem: a conversa nasceu
no Chatwoot só com as respostas automáticas do WhatsApp Business, o CRM nunca
viu o protocolo e um lead do Google Ads ficou dois dias no Orgânico, sem aviso
no grupo, sem linha na planilha e sem conversão. O clique estava gravado 12 s
antes de a conversa nascer, sem telefone.

Medido na Locadora, de 07 a 23/11/2026: 4 de 275 conversas novas nasceram assim.

## O que a rede faz

Quando a resposta automática do cliente abre uma conversa nova, o CRM confere
75 s depois. Se a conversa continua sem protocolo, abriu só com a resposta
automática (nada do lead antes dela) e existe **um único** clique do site, sem
telefone e sem conversa, entre 2 min antes e 40 s depois de a conversa nascer,
a conversa é atribuída a esse clique pelo caminho de sempre (`atribuirLead`):
atributos, etiquetas, funil de Ads, conversão de entrada, planilha e aviso no
grupo. A conversa ganha uma nota interna dizendo que a ligação foi pelo horário
e que a mensagem do lead só existe no celular.

Não liga, e registra o motivo no evento `clique_pelo_horario` (tela de Eventos):

- o lead escreveu antes da resposta automática (nada se perdeu);
- a conversa já tem protocolo (a mensagem chegou);
- o telefone já tem lead na janela de casamento (formulário, clique de outro
  dia): a atribuição normal casa pelo telefone;
- nenhum clique no horário, ou mais de um (não dá para saber qual).

## Por que é seguro o bastante

- A resposta automática do WhatsApp Business só sai porque o lead escreveu. Em
  26 conversas normais com saudação, ela nunca chegou antes da mensagem do lead.
- Entre os leads que escrevem logo depois de clicar, 50 de 52 mandaram em até
  60 s; o clique chega até 32 s depois da conversa (o aviso do site concorre
  com o WhatsApp).
- Atribuição errada exige ao mesmo tempo uma primeira mensagem perdida de quem
  não clicou e um clique sem dono de outra pessoa na mesma janela de 160 s
  (cerca de 3 cliques sem dono por dia na Locadora).

## Abordagens

1. **Conferência agendada pela resposta automática (escolhida).** Usa o que já
   existe: trechos de `respostas_automaticas`, evento com atraso na fila (como
   `conversa_formulario`) e `atribuirLead` com o protocolo informado. Sem
   migration.
2. Casar no `conversation_created`. Descartada: nessa hora ainda não dá para
   saber se a mensagem do lead vai chegar.
3. Vigia periódico comparando Evolution e Chatwoot. Descartada: a mensagem
   também não está na Evolution.

## Decisões

- Vale para o cliente que tem resposta automática cadastrada (aba Funil >
  Mensagens automáticas). Hoje só a Locadora. A saudação do 8844 ("A Locadora
  Exatidão agradece…") não está cadastrada: enquanto não estiver, a rede não
  cobre esse número.
- Candidato é só `evento = 'whatsapp_click'` sem telefone. Lead da extensão de
  mensagem do Google não tem clique: se a primeira mensagem dele se perde, não
  há o que ligar.
- Retentativa da fila retoma com o mesmo clique (`conversations` com protocolo e
  sem origem), porque a atribuição grava o telefone no lead antes de terminar.
- A saudação sai em rajada e pode agendar duas conferências da mesma conversa.
  Quem impede a atribuição em dobro é uma reserva atômica em `conversations`
  (a linha com o protocolo, antes de atribuir); se a atribuição recusa, a
  reserva é desfeita. Linha pendente vista na primeira entrega é de outra
  execução e não é retomada. Achados da revisão de 23/11/2026.
- Risco aceito pelo usuário: o clique único do horário pode ser de outra pessoa
  (quem clicou e não escreveu). A conversão vai para o Google com esse clique.
- Fora do escopo: conversa antiga reaberta, e o motivo de a Evolution perder a
  mensagem.

## Arquivos

- `src/domain/cliquePeloHorario.ts`: a regra e as janelas.
- `src/pipelines/cliquePeloHorario.ts`: agendar e conferir.
- `src/pipelines/leadMessage.ts`: `atribuirLead` aceita `opts.protocolo`.
- `src/clients/chatwoot.ts`: `mensagensDesdeOInicio`, `notaInterna`.
- `src/queue/consumer.ts`: ligação na fila.
