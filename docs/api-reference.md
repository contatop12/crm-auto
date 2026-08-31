# Referência de API — verificada contra as instâncias reais

Tudo aqui foi confirmado por sondagem direta em 2026-08-31, não por leitura de
documentação. Onde o comportamento real diverge do que os workflows n8n assumem,
está marcado como **DIVERGE**.

---

## Chatwoot (fork fazer.ai)

- Base: `https://chatwoot.sitespdoze.com.br`
- Versão da instância: `v4.17.0-fazer-ai-pro.123` (≥ v4.12.0, então assinatura HMAC de webhook está disponível)
- Auth: header **`api_access_token`**. `Authorization: <token>` devolve 401.
- Um único token global atende todas as contas (role `administrator` em cada uma).

### Contas

| Chatwoot | Nome | Google Ads |
|---|---|---|
| 2 | Vita Audio | 6973821129 |
| 3 | Tile Serviços | 5569751788 / 1408366050 |
| 4 | Tainã Aci | 4666625860 |
| 5 | Locadora Exatidão | 8320185148 |
| 7 | Persianas Paulista | 9994324142 |

### Envelopes de resposta

**DIVERGE:** o código n8n trata 5 formatos possíveis por rota (`raw`, `.tasks`,
`.payload`, `.data`, objeto solto). Na prática cada rota tem um formato só.

| Rota | Envelope real |
|---|---|
| `GET /api/v1/accounts/{acc}/kanban/boards` | `{ boards: [...], preferences: {...} }` |
| `GET /api/v1/accounts/{acc}/kanban/boards/{b}/steps` | `{ steps: [...] }` |
| `GET /api/v1/accounts/{acc}/kanban/tasks?board_id={b}` | `{ tasks: [...], meta: { total_count, page, per_page, has_more } }` |
| `GET /api/v1/accounts/{acc}/webhooks` | `{ payload: { webhooks: [...] } }` |

`meta.has_more` é paginação de verdade — o `per_page: 250` dos workflows é um
teto arbitrário, não uma garantia de que veio tudo.

### Escrita

```
POST /api/v1/accounts/{acc}/kanban/tasks                 { task }
PUT  /api/v1/accounts/{acc}/kanban/tasks/{t}             { task }
POST /api/v1/accounts/{acc}/kanban/tasks/{t}/move        { board_step_id, insert_before_task_id }
POST /api/v1/accounts/{acc}/conversations/{c}/labels             { labels }
POST /api/v1/accounts/{acc}/conversations/{c}/custom_attributes  { custom_attributes }
POST /api/v1/accounts/{acc}/webhooks   { url, subscriptions[], secret? }
```

**Os três últimos SUBSTITUEM o valor inteiro.** O merge é responsabilidade do
cliente: `GET` antes, mescla, `POST` depois. Perder esse passo apaga o
`protocolo` gravado no card.

### Campos da task

```
id, account_id, board_id, board_step_id, created_by_id, title, description,
priority, start_date, due_date, step_changed_at, created_at, updated_at,
custom_attributes, status, date_status, contact_ids, conversation_ids, labels,
contacts, conversations, assigned_agents, participants, creator, board,
value, weighted_value, has_products, task_products
```

**DIVERGE — armadilha do `conversation_ids`:**

```json
"conversation_ids": [28],
"conversations": [{ "id": 754, "display_id": 28 }]
```

`conversation_ids` guarda **display_id**, não o id interno. O webhook entrega o
id interno (754). Casar `conversation_id` do webhook contra `conversation_ids[]`
**nunca casa**. A ligação confiável é `conversations[].id`.

Outros pontos:
- `task.value` volta como **string** (`"2028.0"`), não número.
- `conversations[]` dentro da task **não traz `custom_attributes`** — por isso o
  protocolo precisa estar na própria task.
- `board_step_id` está sempre presente: a etapa atual resolve por ID contra a
  lista de steps. Não é preciso adivinhar pelo nome.

### Campos do step

```json
{ "id": 27, "board_id": 7, "name": "Novo Lead", "description": "", "color": "#94a3b8",
  "cancelled": false, "completed": false, "created_at": "...", "updated_at": "...",
  "tasks_count": 8, "inferred_task_status": "open", "probability": "0.0" }
```

`cancelled` (Perdida / Desqualificado) e `completed` (Ganha) marcam as etapas
terminais. **É daqui que `is_final` deve ser derivado**, em vez de uma flag
digitada à mão no painel.

### Boards e etapas por conta

| Conta | Board de entrada | Board do funil | Etapas do funil (`id:nome`) |
|---|---|---|---|
| 7 Persianas | 14 `Orgânico ` | 13 `Lead Ads` | 50 Novo Lead · 51 Qualificando · 52 Proposta Enviada · 57 Agendamento de Visita · 53 Negociação · 58 Produção · 54 Oportunidade Perdida · 59 Desqualificado · 55 Oportunidade Ganha |
| 2 Vita | 8 `Organico` | 7 `Pipeline de Vendas` | 27 Novo Lead · 28 Qualificando · 29 Agendamento Realizado · 34 Testando o Produto · 31 Oportunidade Perdida · 32 Oportunidade Ganha |
| 5 Locadora | 10 `Orgânico ` | 9 `Leads Google Ads` | 36 Novo Lead · 37 Qualificando · 38 Proposta Enviada · 39 Negociação · 40 Oportunidade Perdida · 41 Oportunidade Ganha |

Atenção ao nome do board de entrada da Persianas e da Locadora: `"Orgânico "`
termina com espaço. Comparar por nome exige `trim()`.

**Bug latente encontrado:** o board 7 do Vita **não tem** a etapa
`Compareceu à Consulta`, mas ela está no `ORDEM_FUNIL` e nos `GATILHOS` do
workflow v4. Esse gatilho nunca dispara.

### Webhooks registrados hoje

Três por conta, um por trigger do n8n, cada um com uma inscrição só:

| Nome | Inscrição |
|---|---|
| `[N8N] Chatwoot Trigger - Mensagem do Lead` | `message_incoming` |
| `[N8N] Chatwoot Trigger - Mensagem do Atendente` | `message_outgoing` |
| `[N8N] Chatwoot Trigger - Conversa Criada` | `conversation_created` |

O `secret` volta na resposta do `GET`, então a ferramenta consegue registrar o
webhook e ler o segredo HMAC de volta para validar as assinaturas.

Como `subscriptions` é array, a ferramenta registra **um webhook só com as três
inscrições** — uma URL, um segredo.

### Assinatura HMAC

```
X-Chatwoot-Signature: sha256=<hex>
X-Chatwoot-Timestamp: <unix segundos>

payloadAssinado = `${timestamp}.${rawBody}`
esperado        = 'sha256=' + hmacSHA256(secret, payloadAssinado).hex()
tolerância      = 300s
```

---

## Google Ads API

**DIVERGE — versão:** os workflows chamam **`v21`, que não existe mais**. Todas
as versões de `v16` a `v21` devolvem 404 HTML. **Só `v22` responde.**

Como o node HTTP tem `onError: continueRegularOutput`, essa chamada falha em
silêncio hoje em produção: a classificação de tipo de campanha vem caindo no
palpite pelo nome desde que a v21 foi desligada.

- Endpoint: `POST https://googleads.googleapis.com/v22/customers/{cid}/googleAds:search`
- Headers: `authorization: Bearer <token>`, `developer-token`, `login-customer-id: 3780611396`
- OAuth: refresh token do `.env` funciona; escopo `https://www.googleapis.com/auth/adwords` presente; access token dura 3600s (cachear em KV com TTL de ~55min).

### MCC 3780611396 — 20 contas de cliente

Contas ligadas ao CRM hoje: Vita Audio `6973821129`, Persianas Paulista
`9994324142`, Locadora Exatidão `8320185148`, Tainã aci `4666625860`,
Tile Serviços `5569751788` / `1408366050`.

### Ações de conversão do CRM já existentes

Todas com `type = UPLOAD_CLICKS`. Este é o template do gerador de metas:

| Nome | Categoria | `primary_for_goal` |
|---|---|---|
| `CRM - Conversa Iniciada - WhatsApp` (ou `CRM - Conversão WhatsApp`) | `CONTACT` | true |
| `CRM - Proposta Enviada` | `QUALIFIED_LEAD` | false |
| `CRM - Lead Qualificado 1` | `QUALIFIED_LEAD` | false |
| `CRM - Lead Qualificado 2` | `QUALIFIED_LEAD` | false |
| `CRM - Compra (valor real)` | `PURCHASE` | true |

**IDs reais por cliente:**

| Evento | Vita `6973821129` | Persianas `9994324142` | Locadora `8320185148` |
|---|---|---|---|
| conversa | 7698886680 | 7712794954 | 7701391152 |
| proposta_enviada | — | 7728830342 | — |
| qualificado_1 | 7698566576 | 7712764018 | 7701525103 |
| qualificado_2 | 7698899220 | 7712766130 | 7701396945 |
| compra | 7698567533 | 7712770534 | 7701138959 |

Isso **encerra a pendência nº 1 do plano**: os IDs no `MAPA_ETAPAS` da Persianas
já estão corretos. O sticky que dizia "ainda são os da Tainã Aci" está
desatualizado.

Lacunas: Vita e Locadora não têm ação de `proposta_enviada`, embora o board da
Locadora tenha a etapa `Proposta Enviada`. É exatamente o buraco que o gerador
de metas do painel preenche.
