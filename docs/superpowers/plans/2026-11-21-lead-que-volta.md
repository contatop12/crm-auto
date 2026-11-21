# Lead que volta — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quando o lead escreve 15+ dias depois de o card dele chegar a Ganho/Perda, o CRM cria um card novo (`… #1`) e abre um ciclo novo do lead, que conta como lead novo na Geral, no grupo e nas conversões.

**Architecture:** um pipeline novo (`abrirRetorno`) roda antes da atribuição em toda mensagem do lead. Ele decide a volta, reserva em `retornos` e chama a atribuição de sempre (`atribuirLead`) em modo de volta; a atribuição resolve o lead do ciclo (anúncio novo ou cópia do anterior), pede o card novo por um callback e segue o caminho normal (etiquetas, planilha, conversão). O protocolo novo do ciclo é o que faz planilha, aviso e conversão tratarem a volta como lead novo.

**Tech Stack:** Cloudflare Worker (TypeScript), D1, Queue, KV `CACHE`, vitest com `test/helpers/fakeD1.ts` e `vi.stubGlobal('fetch')`.

**Spec:** `docs/superpowers/specs/2026-11-21-lead-que-volta-design.md`

## Global Constraints

- Worktree `crm-auto-lead-que-volta`, branch `feat/lead-que-volta`. Nunca `stash`/`checkout` na pasta `crm-auto`.
- Teste, comentário e commit sem telefone nem sobrenome real de lead (usar `5511999990000`, "Vital").
- `retorno_dias` nasce `NULL` (desligado) para todos. Padrão quando ligado: `15`.
- Ganho/Perda = `completed`/`cancelled` do Chatwoot (`funnel_stages.is_final` no funil), nunca o nome da etapa.
- O modo de volta nunca grava `funil = PROMOVER`.
- Limite do Google: clique original com mais de `90` dias.
- Comandos: `npm test`, `npm run typecheck`. Commit pequeno por tarefa.
- Push, migration remota e deploy passam pelo usuário (backup do D1 antes).

## Achados depois do desenho (valem como parte da spec)

1. **A Geral casa a linha pelo telefone.** `acrescentarLead` (`pipelines/planilha.ts:212`) não acrescenta se o telefone já está na aba, e `celulaDoStatus` (`pipelines/etapaPlanilha.ts:236`) grava a etapa na primeira linha do telefone. A linha da volta se distingue pelo `#n` no fim do NOME: o `#n` deixa de ser enfeite e vira a identidade da linha.
2. **O teste do segundo card foi barrado nesta sessão.** O código não escolhe um ramo de antemão: depois de criar o card ele confere para onde a conversa aponta e desliga o card antigo só se precisar.
3. Só `message_incoming` chega à fila para a mensagem do lead (`message_created` não tem produtor).
4. `dispararConversaoDeEntrada` não é exportada; o nome do lead não vai para Meta nem Google (sufixo no nome é seguro).

## Review Focus

1. Duas mensagens seguidas na volta: a segunda não abre outra volta nem cria card (Task 5).
2. Chatwoot recusa o segundo card na conversa: desliga o antigo, cria, e devolve a ligação se criar falhar (Task 5).
3. Card antigo movido depois da volta (Ganho → Perda): a etapa vai para a linha antiga da Geral, não para a da volta (Task 2).
4. Geral sem coluna NOME, ou linha da volta apagada pelo time: cai no comportamento de hoje (só telefone), sem erro (Task 2).
5. Conversa sem telefone (Instagram, grupo): card novo com `#n`, sem planilha e sem quebrar (Tasks 1 e 5).

---

### Task 0: Teste do segundo card na instância (usuário)

**Files:** Create `scripts/teste-segundo-card.mjs` (copiar de `scratchpad/teste-card.mjs` desta sessão).

- [ ] Usuário roda `PROPRIOS='<números próprios>' node scripts/teste-segundo-card.mjs .env <conta>` numa conversa interna e cola as linhas `ANTES/POST/DEPOIS/DELETE/FIM`.
- [ ] Ajustar `criarCard` (Task 3) se o `POST` pedir outro nome de campo. Anotar o resultado em `docs/api-reference.md`.

Não bloqueia as tarefas de código; bloqueia ligar `retorno_dias` em produção.

### Task 1: Banco e regras puras

**Files:** Create `migrations/0044_lead_que_volta.sql`, `src/domain/retorno.ts`, `test/domain/retorno.test.ts`. Modify `src/domain/tituloCard.ts` (+ teste existente em `test/domain/`).

**Produces:**
```ts
// src/domain/retorno.ts
export const DIAS_PADRAO = 15;
export function ehRetorno(c: { etapaFinal: boolean; anteriorDoLead: number | null; naEtapaDesde: number | null; agora: number; dias: number }): boolean;
export function voltaDoTitulo(titulo: string | null | undefined): number; // 0 = sem sufixo; so' conta "#n" DEPOIS do "#<conversa> - "
export function voltaDoNome(nome: string | null | undefined): number;      // "Vital #2" -> 2
export function semVolta(texto: string): string;                           // tira " #n" do fim
export function comVolta(texto: string, n: number): string;                // `${semVolta(texto)} #${n}`
export function protocoloDoCiclo(raiz: string, n: number): string;         // `${raiz}-R${n}`; raiz ja' com -R<k> perde o sufixo antes
```
Migration: `tenant_config.retorno_dias INTEGER` (NULL); `leads.retorno_de TEXT`, `leads.clique_em TEXT`; tabela `retornos (id, tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, task_novo, protocolo_anterior, protocolo_novo, origem, desligou_antigo INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pendente', erro, created_at)` com `UNIQUE (tenant_id, task_anterior)` e `UNIQUE (tenant_id, cw_conversation_id, n)`. Estilo: `0036_mensagem_automatica.sql`.

- [ ] Testes (falhando primeiro): `ehRetorno` — 14 dias 23 h = false, 15 dias = true; etapa não final = false; `anteriorDoLead` null usa `naEtapaDesde`; os dois null = false. `voltaDoTitulo('Conversa #1240') === 0`, `('#1240 - 5511999990000 - Vital #2') === 2`. `comVolta('#1240 - 5511999990000 - Vital #1', 2)` termina em `Vital #2`. `protocoloDoCiclo('VITA-1720000000000-A1B2C3-R1', 2) === 'VITA-1720000000000-A1B2C3-R2'`.
- [ ] `tituloDoCard`: teste `('#1240 - 5511999990000 - Vital #1', '+5511999990000', 'Vital Novo') === '#1240 - 5511999990000 - Vital Novo #1'` e, com o título já certo, `null`. Sem telefone (Instagram) continua `null`. Implementar: tirar o sufixo antes do regex, repor no fim.
- [ ] `npm test`, `npm run typecheck`, commit `feat(retorno): regra da volta, sufixo do card e migration 0044`.

### Task 2: Geral — linha por telefone e volta

**Files:** Modify `src/domain/planilha.ts`, `src/pipelines/planilha.ts:212-270`, `src/pipelines/etapaPlanilha.ts:84,236-262`; testes em `test/domain/` e `test/pipelines/` (os que já cobrem `linhaDoTelefone`/`acrescentarLead`/`espelharEtapaNaGeral`).

**Produces:** `export function linhaDoLead(cabecalho: string[], corpo: string[][], telefone: string, volta: number): number` — entre as linhas do telefone, a que tem `voltaDoNome(NOME) === volta`. Sem coluna NOME: a primeira do telefone (hoje). `linhaDoTelefone` continua existindo para quem não sabe a volta.

- [ ] Testes: duas linhas do mesmo telefone ("Vital" e "Vital #1"), em qualquer ordem → `volta 0` acha a primeira, `volta 1` a segunda, `volta 2` → `-1`. Sem coluna NOME → primeira do telefone.
- [ ] `acrescentarLead`: volta = `voltaDoNome(registro.nome)`; usa `linhaDoLead` no lugar do `findIndex(doLead)` (também na releitura). Teste: registro "Vital #1" com "Vital" já na aba → **acrescenta**; rodar de novo → não duplica.
- [ ] `celulaDoStatus` recebe a volta do card (`voltaDoTitulo(t.titulo)`): teste com as duas linhas — card `… #1` grava na linha "Vital #1"; card sem sufixo grava na "Vital" (Review Focus 3).
- [ ] `npm test`, commit `feat(planilha): linha da Geral por telefone e volta`.

### Task 3: Cliente do Chatwoot

**Files:** Modify `src/clients/chatwoot.ts`; teste em `test/clients/`.

**Produces:**
```ts
criarCard(acc: number, c: { titulo: string; boardId: number; stepId: number; conversas: number[]; contatos: number[]; atributos: Record<string, string> }): Promise<number>; // POST /kanban/tasks { task: { title, board_id, board_step_id, conversation_ids, contact_ids, custom_attributes } } -> id
ligarConversasDoCard(acc: number, taskId: number, conversas: number[]): Promise<void>; // PUT { task: { conversation_ids } }
mensagemAnteriorDoLead(acc: number, conversaId: number, antesDe: number, tetoPaginas?: number): Promise<number | null>; // ms; message_type 0 com id < antesDe
textosDoVendedor(acc: number, conversaId: number, tetoPaginas?: number, desde?: number): Promise<string[]>; // desde em ms: so' created_at*1000 >= desde
```
Responsável do card fica de fora até a Task 0 dizer o nome do campo.

- [ ] Testes com `fetch` de mentira: corpo do `POST`; `mensagemAnteriorDoLead` ignora a mensagem `antesDe` e as do vendedor, pagina com `before=`; `textosDoVendedor` com `desde` corta as antigas.
- [ ] Commit `feat(chatwoot): criar card e achar a mensagem anterior do lead`.

### Task 4: Atribuição em modo de volta

**Files:** Modify `src/pipelines/leadMessage.ts`, `src/domain/frasesEntrada.ts:96`, `src/domain/anuncioMeta.ts:48`; teste `test/pipelines/leadMessage.test.ts`.

**Produces:**
```ts
export interface ModoRetorno {
  n: number;
  /** protocolos que os ciclos desta conversa ja' usaram */
  usados: string[];
  /** protocolo do ciclo anterior; null = nao havia lead */
  anterior: string | null;
  /** cria (ou devolve, na retentativa) o card do ciclo; chamado ja' com o lead resolvido */
  criarCard(lead: { protocolo: string; plataforma: string; atributos: Record<string, string> }): Promise<number>;
}
atribuirLead(env, tenantId, payload, opts: { tentativa?: number; retorno?: ModoRetorno }): Promise<Resultado>;
export async function dispararConversaoDeEntrada(...)            // passa a ser exportada
protocoloDaFrase(prefixo, conversaId, ciclo = 0); protocoloDoAnuncio(prefixo, conversaId, ciclo = 0); // ciclo > 0 acrescenta `-R<ciclo>`
```
Com `opts.retorno`:
- pula o "ja tem protocolo";
- resolve o lead pelas fontes de sempre; protocolo em `usados`, ou nenhum lead → **cópia** de `anterior` (`INSERT … SELECT` em `leads`, `ON CONFLICT DO NOTHING`): `protocol = protocoloDoCiclo(raiz, n)` com `raiz = retorno_de ?? protocol` do anterior; copia identidade e atribuição; `origem='mensagem'`, `evento='retorno'`, `quiz_version`/`quiz_valor`/`valor_proposta` NULL, `created_at` agora, `retorno_de = raiz`, `clique_em = clique_em ?? created_at` do anterior. Colunas de estado de processamento não copiam;
- `anterior` null ou sem linha em `leads`, e sem fonte nova → `{ status: 'ignorado', motivo: 'volta sem lead' }` sem chamar `criarCard`;
- nome do lead do ciclo com `comVolta(nome, n)`;
- `criarCard` é chamado antes de `mesclarAtributosDaConversa`; o id devolvido substitui `conv.kanban_task.id` no resto da função e em `conversations.task_id`;
- nunca grava `SENTINELA_PROMOVER`; grava `funil: 'Lead'` quando a plataforma é google/meta/gmn e `attrs.funil !== 'Lead'`;
- planilha de entrada chamada **sempre** (`espelharNaPlanilha` tipo `entrada`), e a conversão de entrada quando `daAds`, sem depender de `promover`.

- [ ] Testes (copiar `cenario()`/`webhook()` do arquivo): (a) conversa com protocolo e sem fonte nova → nasce `leads` `…-R1` com `evento='retorno'`, `retorno_de` e `clique_em` preenchidos, nome `Vital #1`, `criarCard` chamado 1 vez, atributo `protocolo` da conversa = `…-R1`, nenhum `funil: PROMOVER` enviado; (b) mensagem com protocolo novo de clique existente → usa esse protocolo, sem cópia; (c) frase de entrada → `PREFIXO-MSG-<conversa>-R1`; (d) sem lead anterior e sem fonte → `ignorado`, `criarCard` não chamado; (e) sem `opts.retorno` nada muda (testes atuais verdes).
- [ ] Commit `feat(atribuicao): modo de volta com lead do ciclo`.

### Task 5: Pipeline da volta e fila

**Files:** Create `src/pipelines/retorno.ts`, `test/pipelines/retorno.test.ts`. Modify `src/queue/consumer.ts` (case `message_incoming`).

**Consumes:** Tasks 1, 3, 4. **Produces:** `export async function abrirRetorno(env: Env, tenantId: number, payload: string, opts: { tentativa?: number }): Promise<Resultado | null>` — `null` = não é volta, a fila segue o caminho normal; senão o resultado é o da mensagem (não chama `atribuirLead` de novo).

Passos, nesta ordem:
1. Só `incoming` não privada com `conversation.kanban_task.id`; `retorno_dias` não nulo; número não próprio.
2. Etapa final: `funnel_stages.is_final` pelo `cw_step_id`; etapa fora de `funnel_stages` (Orgânico) → `cw.steps(acc, board)` guardado no KV `CACHE` (`steps:<acc>:<board>`, 1 h).
3. `retornos` já `feito` para `task_anterior` → `null`.
4. `mensagemAnteriorDoLead`; se null, `step_changed_at` de `cw.tarefa`. `ehRetorno` falso → `null`.
5. Reserva `INSERT OR IGNORE` (`n` = `MAX(n)+1` da conversa). Linha `pendente` de outra execução com menos de 60 s → `{ status: 'erro', motivo: 'outra execucao esta abrindo esta volta' }` (a fila retenta).
6. `atribuirLead(..., { retorno })`. O `criarCard` do callback: devolve `task_novo` se já gravado; board = o do card antigo, ou o do funil quando o antigo está no Orgânico e a plataforma é google/meta/gmn; etapa = primeira do board (`funnel_stages ORDER BY posicao` no funil, `steps[0]` do cache no Orgânico); título `comVolta(tituloAntigo, n)`; conversa e contatos do card antigo. `POST` recusado → `ligarConversasDoCard(antigo, [])`, tenta de novo; falhou de novo → religa o antigo e lança. Depois de criar: `cw.conversa(...).kanban_task.id` diferente do novo → desliga o antigo e marca `desligou_antigo = 1`. Grava `task_novo` logo após o `POST`.
7. Resultado `volta sem lead` → cria o card do mesmo jeito (sem atributos).
8. `avisarLeadNoGrupo(env, tenantId, JSON.stringify(await cw.tarefa(acc, novo)), { tentativa: TENTATIVAS_ESPERANDO_PROTOCOLO })`, engolindo erro (o webhook do card é a segunda chance).
9. `retornos`: `protocolo_novo`, `origem`, `status='feito'`. Exceção em qualquer passo: grava `erro` e relança (a fila retenta e retoma pelo `task_novo`).

- [ ] Testes: volta herdada cria 1 card com título `… #1` no funil, 1ª etapa, e linha `feito`; mesma mensagem processada 2 vezes → 1 `POST` de card; segunda mensagem da volta (payload ainda com o card antigo) → `null` e nenhum `POST` (Review Focus 1); `POST` 422 → desliga, cria, `desligou_antigo=1`; 422 duas vezes → antigo religado e erro (Review Focus 2); `retorno_dias` NULL → `null` sem chamada ao Chatwoot; 14 dias → `null`; conversa sem telefone → card criado, sem planilha (Review Focus 5); segunda volta meses depois → `#2`.
- [ ] `consumer.ts`: em `message_incoming`, `const volta = await abrirRetorno(...)`; `if (volta) return volta;` antes de `atribuirLead`. Teste do consumer se houver; senão o de pipeline basta.
- [ ] Commit `feat(retorno): card novo e ciclo novo quando o lead volta`.

### Task 6: O ciclo novo não herda o passado

**Files:** Modify `src/pipelines/sellerMessage.ts:367-382`, `src/pipelines/stageChanged.ts:117-126`, `src/routes/admin.ts:1370`; testes correspondentes.

- [ ] `recuperarRespostasAnteriores`: se `taskId` está em `retornos.task_novo`, passa `desde = created_at` da volta para `textosDoVendedor`. Teste: "segue a proposta" de antes da volta não move o card novo; a de depois move.
- [ ] `enviarConversao`: `clique_em` no SELECT do lead; destino Google e `quando - clique_em > 90 dias` → `{ status: 'ignorado', motivo: '<protocolo>: clique original com mais de 90 dias, o Google nao aceita a conversao' }`, antes do INSERT em `conversions`. Testes: 91 dias ignorado sem linha em `conversions`; 89 dias segue; lead da Meta não passa por esta regra.
- [ ] `cards-orfaos`: tira da lista os cards em `retornos` com `desligou_antigo = 1`. Teste de rota.
- [ ] Regra da mensagem automática (`segundosAposOLead`): conferir que só olha a troca atual; sem mudança esperada. Anotar no commit.
- [ ] Commit `feat(retorno): respostas antigas, limite de 90 dias e orfaos`.

### Task 7: Fechamento

- [ ] `npm test` e `npm run typecheck` verdes; colar a saída.
- [ ] `docs/api-reference.md`: `POST /kanban/tasks` (campos) e o que a Task 0 mostrou.
- [ ] Entregar ao usuário, em ordem: backup do D1 (`wrangler d1 export crm_auto --remote`), migration 0044 remota, push/deploy, `UPDATE tenant_config SET retorno_dias = 15` em **um** cliente, conferir a primeira volta real (card, Geral, sequência, aviso com a linha nova, conversão), ligar nos demais. Antes de ligar cada cliente: ler as regras de automação da conta e confirmar que nenhuma ativa reage a `protocolo` sem `funil = PROMOVER`.
