import { maskPhone } from './mask';

/**
 * Quem e' o evento, lido do proprio payload.
 *
 * A lista de eventos mostrava so' `message_incoming / ignorado / pipeline
 * leadMessage nao implementado` — verdadeiro e inutil: nao da' para saber se e'
 * um lead novo ou uma conversa velha, de que board veio, nem se aquele lead ja
 * foi tratado. O payload cru tem tudo isso; faltava ler.
 *
 * Mascarado por construcao. O painel junta os leads de todos os clientes e a
 * lista e' a primeira tela que abre — telefone inteiro e texto de mensagem so'
 * pelo "revelar", que e' acao deliberada e registrada.
 */

export type Origem = 'anuncio' | 'organico' | null;
export type Momento = 'lead novo' | 'conversa em andamento' | null;

export interface ResumoEvento {
  /** Nome do lead, encurtado: primeiro nome + inicial do sobrenome. */
  quem: string | null;
  telefone: string | null;
  /** Quem escreveu: o lead ou o vendedor (nome do agente). */
  autor: string | null;
  conversaId: number | null;
  inbox: string | null;
  board: string | null;
  etapa: string | null;
  protocolo: string | null;
  origem: Origem;
  momento: Momento;
  /** Segundos entre a criacao da conversa e este evento. null = nao da' para saber. */
  idadeConversa: number | null;
  /** A conversao de "Conversa Iniciada" ja foi mandada para esta conversa. */
  conversaEnviada: boolean;
  etiquetas: string[];
}

/** Board de entrada e board do funil, para dizer anuncio ou organico. */
export interface BoardsDoTenant {
  organico: number | null;
  funil: number | null;
}

/**
 * Ate' aqui a conversa ainda e' o primeiro contato.
 *
 * Nao e' o tempo de resposta do vendedor — e' a folga entre a conversa nascer e
 * o webhook da primeira mensagem chegar. Cinco minutos cobrem fila e retentativa
 * sem confundir com o lead que voltou a falar no dia seguinte.
 */
const JANELA_LEAD_NOVO = 300;

export function resumirEvento(
  raw: string | null | undefined,
  boards: BoardsDoTenant = { organico: null, funil: null },
): ResumoEvento {
  const vazio: ResumoEvento = {
    quem: null, telefone: null, autor: null, conversaId: null, inbox: null,
    board: null, etapa: null, protocolo: null, origem: null, momento: null,
    idadeConversa: null, conversaEnviada: false, etiquetas: [],
  };

  let p: Rec;
  try {
    const j = JSON.parse(String(raw ?? ''));
    if (!j || typeof j !== 'object' || Array.isArray(j)) return vazio;
    p = j as Rec;
  } catch {
    return vazio;
  }

  // A regra de automacao do Chatwoot manda a conversa na raiz; o webhook de
  // mensagem manda dentro de `conversation`. Mesmo objeto, dois envelopes.
  const conv = obj(p.conversation) ?? p;
  const attrs = obj(conv.custom_attributes) ?? {};
  const task = obj(conv.kanban_task) ?? {};
  const lead = obj(obj(conv.meta)?.sender) ?? {};

  const boardId = num(task.board_id) ?? num(obj(task.board)?.id);
  const protocolo =
    str(attrs.protocolo) ?? str(obj(task.custom_attributes)?.protocolo);

  const criada = num(conv.created_at);
  const quando = num(primeiraMensagem(conv)?.created_at) ?? num(conv.last_activity_at);
  const idade = criada !== null && quando !== null ? Math.max(quando - criada, 0) : null;

  return {
    quem: encurtarNome(str(lead.name) ?? str(attrs.nome_lead)),
    telefone: mascarar(str(lead.phone_number) ?? str(attrs.phone_lead)),
    autor: autorDaMensagem(p),
    conversaId: num(conv.id),
    inbox: str(obj(p.inbox)?.name),
    board: str(obj(task.board)?.name),
    etapa: str(obj(task.board_step)?.name),
    protocolo,
    origem: classificarOrigem(boardId, protocolo, boards),
    momento:
      idade === null ? null
      : idade <= JANELA_LEAD_NOVO ? 'lead novo'
      : 'conversa em andamento',
    idadeConversa: idade,
    conversaEnviada: attrs.conversa_enviada === true,
    etiquetas: lista(conv.labels),
  };
}

/**
 * De onde o lead veio.
 *
 * O board manda, quando o cliente tem os dois cadastrados: e' o dado do
 * Chatwoot, nao inferencia nossa. Sem board configurado sobra o protocolo, que
 * so' existe quando houve clique em anuncio — mas ele chega depois do primeiro
 * webhook, entao a ausencia nao prova organico e fica `null`.
 */
function classificarOrigem(
  boardId: number | null,
  protocolo: string | null,
  boards: BoardsDoTenant,
): Origem {
  if (boardId !== null) {
    if (boards.funil !== null && boardId === boards.funil) return 'anuncio';
    if (boards.organico !== null && boardId === boards.organico) return 'organico';
  }
  return protocolo ? 'anuncio' : null;
}

/** `message_type` diz se escreveu o lead ou o vendedor. */
function autorDaMensagem(p: Rec): string | null {
  const tipo = str(p.message_type);
  if (tipo === 'incoming') return 'lead';
  if (tipo === 'outgoing') {
    const s = obj(p.sender) ?? {};
    return encurtarNome(str(s.available_name) ?? str(s.name)) ?? 'vendedor';
  }
  return null;
}

function primeiraMensagem(conv: Rec): Rec | null {
  const m = conv.messages;
  return Array.isArray(m) ? (obj(m[0]) ?? null) : null;
}

/**
 * "Maria Aparecida da Silva" vira "Maria A." — o bastante para achar a conversa
 * no Chatwoot sem despejar o nome inteiro do lead numa lista de diagnostico.
 *
 * Contato que o vendedor nunca nomeou vem com o proprio numero no lugar do nome.
 * Mascarar so' o campo `phone_number` deixaria o telefone inteiro aparecendo
 * aqui — foi o que aconteceu com metade dos eventos reais da Vita.
 */
export function encurtarNome(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (pareceTelefone(t)) return maskPhone(t) || null;

  const partes = t.split(/\s+/).filter(Boolean);
  if (partes.length === 1) return partes[0]!;
  return `${partes[0]} ${partes[1]![0]!.toUpperCase()}.`;
}

/** Oito digitos ou mais e quase nenhuma letra: e' um numero, nao um nome. */
function pareceTelefone(v: string): boolean {
  const digitos = (v.match(/\d/g) ?? []).length;
  const letras = (v.match(/\p{L}/gu) ?? []).length;
  return digitos >= 8 && letras <= 1;
}

function mascarar(v: string | null): string | null {
  return v ? maskPhone(v) || null : null;
}

// ---------------------------------------------------------------------------
// Leitura tolerante: o payload vem do Chatwoot e muda de forma entre versoes.
// Campo ausente ou de tipo inesperado vira null, nunca excecao — um resumo
// incompleto ainda ajuda; um erro derruba a lista inteira.
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function obj(v: unknown): Rec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
}

/**
 * O nome do pipeline em termos de negocio.
 *
 * `leadMessage` diz o arquivo que roda; nao diz o que aconteceu com o cliente.
 * A tela precisa do segundo.
 */
export function nomeDoPipeline(source: string, eventType: string | null): string {
  if (source === 'click') return 'clique no anúncio';
  if (source === 'kanban') return 'mudança de etapa';
  switch (eventType) {
    case 'conversation_created': return 'conversa criada';
    case 'message_created':
    case 'message_incoming': return 'mensagem do lead';
    case 'message_outgoing': return 'resposta do vendedor';
    default: return 'sem pipeline';
  }
}
