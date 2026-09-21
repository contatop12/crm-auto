/**
 * Vigia do caminho WhatsApp -> Evolution -> Chatwoot.
 *
 * Em 17/09 as caixas da Locadora foram renomeadas no Chatwoot ("Locadora
 * Exatidão 02" virou "Locadora - 8910"). O Evolution acha a caixa PELO NOME
 * (`nameInbox`), entao parou de entregar em silencio: quatro dias, ~800
 * mensagens de cliente que o time nunca viu. Nada deu erro em lugar nenhum.
 *
 * Por isso o vigia nao mede "silencio" (fim de semana sem campanha tambem e'
 * silencio): compara o que o Evolution RECEBEU com o que CHEGOU no Chatwoot.
 * Sem mensagem, os dois ficam em zero e nao ha' alarme.
 */

/** Mensagem como o `findMessages` do Evolution devolve (so' o que o vigia le'). */
export interface MensagemEvo {
  key?: { fromMe?: boolean; remoteJid?: string };
  messageType?: string;
  messageTimestamp?: number | string;
}

/**
 * Tipos que nao viram mensagem na conversa do Chatwoot. Contar isso do lado
 * do Evolution faria parecer que falta mensagem no Chatwoot.
 */
const NAO_VIRA_MENSAGEM = new Set([
  'reactionMessage',
  'protocolMessage',
  'senderKeyDistributionMessage',
  'pollUpdateMessage',
  'editedMessage',
  'secretEncryptedMessage',
  'messageContextInfo',
]);

/**
 * Mensagens de cliente recebidas em [desde, ate), em segundos. So' conversa
 * individual: grupo, status e canal ficam de fora (o Chatwoot pode ignora'-los
 * por configuracao, e ai' faltariam sem ser falha).
 */
export function contarRecebidas(msgs: MensagemEvo[], desde: number, ate: number): number {
  let n = 0;
  for (const m of msgs) {
    if (m.key?.fromMe) continue;
    const jid = String(m.key?.remoteJid ?? '');
    if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) continue;
    if (NAO_VIRA_MENSAGEM.has(String(m.messageType ?? ''))) continue;
    const ts = Number(m.messageTimestamp ?? 0);
    if (ts >= desde && ts < ate) n++;
  }
  return n;
}

/** Instancia para onde a caixa do Chatwoot manda as respostas do time. */
export function instanciaDoWebhook(url: unknown): string | null {
  const s = String(url ?? '');
  const i = s.indexOf('/chatwoot/webhook/');
  if (i < 0) return null;
  const nome = s.slice(i + '/chatwoot/webhook/'.length).split(/[?#]/)[0] ?? '';
  try {
    return decodeURIComponent(nome) || null;
  } catch {
    return nome || null;
  }
}

export interface CaixaCw {
  id: number;
  nome: string;
  /** Instancia do Evolution no webhook da caixa (o caminho de volta). */
  instancia: string | null;
}

export interface LeituraInstancia {
  instancia: string;
  cliente: string;
  /** `null` quando a instancia nem existe no Evolution. */
  estado: string | null;
  /** O aparelho respondeu ao `fetchProfile`? `null` = nao testado. */
  viva: boolean | null;
  chatwoot: { ligado: boolean; conta: number; caixa: string } | null;
  /** Caixas da conta do Chatwoot; `null` quando nao deu para ler. */
  caixas: CaixaCw[] | null;
  /** Recebidas pelo Evolution na janela longa e na curta. */
  recebidas?: { longa: number; curta: number };
  /** Entregues no Chatwoot, mesmas janelas. */
  entregues?: { longa: number; curta: number };
}

export type TipoProblema = 'servidor' | 'desconectada' | 'caixa' | 'entrega';

export interface Problema {
  tipo: TipoProblema;
  texto: string;
}

/** Janela longa do vigia, em minutos. */
export const JANELA_LONGA_MIN = 90;
/** Janela curta: pega a queda total rapido, sem esperar a longa esvaziar. */
export const JANELA_CURTA_MIN = 30;
/** Abaixo disto o volume e' baixo demais para concluir alguma coisa. */
export const MINIMO_PARA_JULGAR = 4;
/** Chegou ate' esta fracao do que o Evolution recebeu = nao esta entregando. */
export const FRACAO_FALHA = 0.3;

/**
 * O problema mais grave da instancia, ou `null`. A ordem importa: desconectada
 * explica a caixa sem mensagem, e caixa inexistente explica a entrega zerada.
 */
export function diagnosticar(l: LeituraInstancia): Problema | null {
  if (l.estado === null) {
    return { tipo: 'desconectada', texto: 'a instância não existe mais no Evolution.' };
  }
  if (l.estado !== 'open') {
    return {
      tipo: 'desconectada',
      texto: `desconectada do WhatsApp (estado "${l.estado}"). Precisa ler o QR code de novo.`,
    };
  }
  if (l.viva === false) {
    return {
      tipo: 'desconectada',
      texto:
        'o Evolution diz "conectada", mas o aparelho não responde. Provavelmente foi desvinculado: leia o QR code de novo.',
    };
  }
  if (!l.chatwoot?.ligado) {
    return { tipo: 'caixa', texto: 'a integração com o Chatwoot está desligada nesta instância.' };
  }
  if (l.caixas && !l.caixas.some((c) => c.nome === l.chatwoot!.caixa)) {
    return {
      tipo: 'caixa',
      texto:
        `o Evolution procura a caixa "${l.chatwoot.caixa}" e ela não existe no Chatwoot (conta ${l.chatwoot.conta}). ` +
        'Alguém renomeou a caixa? As mensagens deste número NÃO estão entrando no CRM.',
    };
  }
  const r = l.recebidas;
  const e = l.entregues;
  if (r && e) {
    // a janela longa demora a esvaziar depois do conserto: se a curta ja'
    // entrega, e' a sobra da queda, nao queda nova
    const curtaEntrega = r.curta > 0 && e.curta >= r.curta * (1 - FRACAO_FALHA);
    const longa = r.longa >= MINIMO_PARA_JULGAR && e.longa <= r.longa * FRACAO_FALHA && !curtaEntrega;
    const curta = r.curta >= MINIMO_PARA_JULGAR && e.curta === 0;
    if (longa || curta) {
      const [rec, ent, min] = longa ? [r.longa, e.longa, JANELA_LONGA_MIN] : [r.curta, e.curta, JANELA_CURTA_MIN];
      return {
        tipo: 'entrega',
        texto:
          `o WhatsApp recebeu ${rec} mensagens de clientes nos últimos ${min} min e só ${ent} chegaram no Chatwoot. ` +
          'O Evolution não está entregando: veja o log do Evolution no Coolify.',
      };
    }
  }
  return null;
}

/**
 * Nome certo da caixa quando o `nameInbox` ficou para tras: a caixa cujo
 * webhook aponta para ESTA instancia prova qual e' a caixa dela. So' corrige
 * com uma candidata unica — duas caixas apontando para a mesma instancia e' um
 * erro de configuracao que o vigia nao resolve sozinho.
 */
export function caixaParaCorrigir(l: LeituraInstancia): string | null {
  if (!l.chatwoot?.ligado || !l.caixas) return null;
  if (l.caixas.some((c) => c.nome === l.chatwoot!.caixa)) return null;
  const minhas = l.caixas.filter((c) => c.instancia === l.instancia);
  return minhas.length === 1 ? minhas[0]!.nome : null;
}

/** O que o vigia lembra entre uma rodada e outra (fica no KV). */
export interface RegistroVigia {
  tipo: TipoProblema;
  /** Primeira rodada em que o problema apareceu (ms). */
  desde: number;
  /** Rodadas seguidas com o mesmo problema. */
  vezes: number;
  /** Ultimo aviso mandado (ms); `null` = ainda nao avisou. */
  avisadoEm: number | null;
  /** Resolveu fora do horario de aviso: a boa noticia espera o horario. */
  resolvidoEm?: number;
  /** Para a central de notificacoes mostrar a queda sem refazer a leitura. */
  rotulo?: string;
  texto?: string;
}

export type EstadoVigia = Record<string, RegistroVigia>;

export interface Achado {
  chave: string;
  rotulo: string;
  problema: Problema | null;
}

/** Rodadas seguidas antes de avisar: uma leitura ruim isolada nao e' queda. */
export const CONFIRMAR_EM = 2;
/** Enquanto nao resolve, lembra a cada tanto. */
export const LEMBRAR_A_CADA_MS = 4 * 3600e3;

/** Hora cheia em Brasilia (UTC-3, sem horario de verao). */
export function horaBrasilia(agora: number): number {
  return new Date(agora - 3 * 3600e3).getUTCHours();
}

/** Avisa das 7h as 21h59, todo dia: o vigia nao depende do volume de campanha. */
export function horarioDeAviso(agora: number): boolean {
  const h = horaBrasilia(agora);
  return h >= 7 && h < 22;
}

function hhmm(ms: number): string {
  return new Date(ms - 3 * 3600e3).toISOString().slice(11, 16);
}

export function duracao(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}

const RESOLVIDO: Record<TipoProblema, string> = {
  servidor: 'o servidor do Evolution voltou a responder',
  desconectada: 'o número está conectado de novo',
  caixa: 'a caixa do Chatwoot foi encontrada de novo',
  entrega: 'as mensagens voltaram a chegar no Chatwoot',
};

/**
 * Decide o que avisar nesta rodada e o estado para a proxima.
 *
 * Avisa quando o problema se confirma (`CONFIRMAR_EM` rodadas), lembra a cada
 * `LEMBRAR_A_CADA_MS` e manda o "voltou ao normal" so' do que foi avisado.
 * Fora do horario nada sai: o aviso e a boa noticia esperam as 7h.
 */
export function planejarAvisos(
  anterior: EstadoVigia,
  achados: Achado[],
  agora: number,
): { avisos: string[]; estado: EstadoVigia } {
  const avisos: string[] = [];
  const podeAvisar = horarioDeAviso(agora);
  // quem nao foi avaliado nesta rodada (o servidor caiu antes) fica como estava:
  // sem isso, a volta do servidor apagaria a queda que ja' tinha sido avisada
  const avaliadas = new Set(achados.map((a) => a.chave));
  const estado: EstadoVigia = Object.fromEntries(
    Object.entries(anterior).filter(([chave]) => !avaliadas.has(chave)),
  );

  for (const a of achados) {
    const prev = anterior[a.chave];

    if (!a.problema) {
      if (!prev?.avisadoEm) continue; // nunca avisou: some sem barulho
      const fim = prev.resolvidoEm ?? agora;
      if (podeAvisar) {
        avisos.push(`✅ *Normalizado* — ${a.rotulo}\n${RESOLVIDO[prev.tipo]} (às ${hhmm(fim)}; durou ${duracao(fim - prev.desde)}).`);
      } else {
        estado[a.chave] = { ...prev, resolvidoEm: fim };
      }
      continue;
    }

    const mesmo = prev && prev.tipo === a.problema.tipo;
    const reg: RegistroVigia = mesmo
      ? { tipo: prev.tipo, desde: prev.desde, vezes: prev.vezes + 1, avisadoEm: prev.avisadoEm }
      : { tipo: a.problema.tipo, desde: agora, vezes: 1, avisadoEm: null };
    reg.rotulo = a.rotulo;
    reg.texto = a.problema.texto;

    if (podeAvisar && reg.vezes >= CONFIRMAR_EM) {
      if (reg.avisadoEm === null) {
        avisos.push(`⚠️ *WhatsApp › Chatwoot* — ${a.rotulo}\n${a.problema.texto}`);
        reg.avisadoEm = agora;
      } else if (agora - reg.avisadoEm >= LEMBRAR_A_CADA_MS) {
        avisos.push(`⏰ *Ainda com problema* — ${a.rotulo} (desde ${hhmm(reg.desde)}, há ${duracao(agora - reg.desde)})\n${a.problema.texto}`);
        reg.avisadoEm = agora;
      }
    }
    estado[a.chave] = reg;
  }
  return { avisos, estado };
}
