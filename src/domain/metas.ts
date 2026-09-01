import type { Stage } from './types';
import type { ConversionAction } from '../clients/googleAds';

/**
 * Metas de conversao offline no Google Ads.
 *
 * As quatro metas sao as MESMAS em todo cliente, com o mesmo nome — e' assim que
 * as contas ja estao montadas e e' o que a planilha de conversoes define. O que
 * muda de cliente para cliente e' qual ETAPA dispara cada uma: na Persianas o
 * Lead Qualificado 1 vem de "Agendamento de Visita"; na Locadora, de
 * "Proposta Enviada".
 *
 * Por isso o nome nao e' derivado do nome da etapa: a sugestao de etapa e' um
 * palpite editavel, o nome e' fixo.
 */

export interface MetaCatalogo {
  evento: string;
  nome: string;
  categoria: 'CONTACT' | 'QUALIFIED_LEAD' | 'PURCHASE';
  /** null = a conversao carrega o valor real da negociacao. */
  valor: number | null;
  primary: boolean;
  janelaClique: number;
  /** Outros nomes ja usados nas contas, para reconhecer o que existe. */
  apelidos: string[];
  /** Nem todo cliente usa. Nao vem marcada quando ainda nao existe na conta. */
  opcional?: boolean;
}

export const CATALOGO: MetaCatalogo[] = [
  {
    evento: 'conversa',
    nome: 'CRM - Conversa Iniciada',
    categoria: 'CONTACT',
    valor: 10,
    // e' a unica primaria; as demais ficam secundarias ate atingir 100 conversoes
    primary: true,
    janelaClique: 30,
    // as contas foram criadas em momentos diferentes e o nome variou
    apelidos: ['CRM - Conversa Iniciada - WhatsApp', 'CRM - Conversão WhatsApp', 'CRM - Conversao WhatsApp'],
  },
  {
    evento: 'proposta_enviada',
    nome: 'CRM - Proposta Enviada',
    categoria: 'QUALIFIED_LEAD',
    valor: 50,
    primary: false,
    janelaClique: 30,
    apelidos: [],
    // so a Persianas usa esta etapa como conversao propria
    opcional: true,
  },
  {
    evento: 'qualificado_1',
    nome: 'CRM - Lead Qualificado 1',
    categoria: 'QUALIFIED_LEAD',
    valor: 100,
    primary: false,
    janelaClique: 30,
    apelidos: [],
  },
  {
    evento: 'qualificado_2',
    nome: 'CRM - Lead Qualificado 2',
    categoria: 'QUALIFIED_LEAD',
    valor: 150,
    primary: false,
    janelaClique: 30,
    apelidos: [],
  },
  {
    evento: 'compra',
    nome: 'CRM - Compra (valor real)',
    categoria: 'PURCHASE',
    valor: null,
    primary: false,
    janelaClique: 90,
    apelidos: ['CRM - Compra'],
  },
];

export interface EtapaOpcao {
  id: number;
  nome: string;
}

export interface MetaProposta {
  evento: string;
  nome: string;
  categoria: 'CONTACT' | 'QUALIFIED_LEAD' | 'PURCHASE';
  valor: number | null;
  primary: boolean;
  contagem: 'ONE_PER_CLICK' | 'MANY_PER_CLICK';
  janelaClique: number;
  janelaView: number;
  /** Etapa sugerida. null = nao vem de etapa, ou o funil nao tem candidata. */
  stageId: number | null;
  stageNome: string;
  /** Etapas que podem disparar esta meta, para trocar na tela. */
  etapasPossiveis: EtapaOpcao[];
  jaExiste: boolean;
  idExistente: string | null;
  /** Vem marcada na tela? Meta opcional inexistente comeca desmarcada. */
  marcada: boolean;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function proporMetas(stages: Stage[], existentes: ConversionAction[]): MetaProposta[] {
  const porNome = new Map(existentes.map((a) => [norm(a.name), a]));
  const ordenadas = [...stages].sort((a, b) => a.posicao - b.posicao);
  const entrada = ordenadas[0]?.id;

  // Etapas que podem disparar uma conversao: tudo menos a entrada, a etapa de
  // resposta automatica e as de perda.
  const uteis = ordenadas.filter(
    (s) => s.id !== entrada && !s.autoOnReply && !(s.isFinal && !ehGanho(s)),
  );
  const intermediarias = uteis.filter((s) => !s.isFinal);
  const ganha = ordenadas.find((s) => s.isFinal && ehGanho(s)) ?? null;

  const opcoes: EtapaOpcao[] = uteis.map((s) => ({ id: s.id, nome: s.nome }));

  const achar = (m: MetaCatalogo) =>
    porNome.get(norm(m.nome)) ??
    m.apelidos.map((a) => porNome.get(norm(a))).find(Boolean) ??
    null;

  // Se o cliente usa a meta opcional de Proposta Enviada, ela consome a primeira
  // etapa intermediaria e os Qualificados andam uma casa. E' a diferenca entre a
  // Persianas (usa: Qualificado 1 = Agendamento de Visita) e a Locadora
  // (nao usa: Qualificado 1 = Proposta Enviada).
  const usaProposta = !!achar(CATALOGO.find((m) => m.evento === 'proposta_enviada')!);
  const base = usaProposta ? 1 : 0;

  return CATALOGO.map((m) => {
    const sugerida =
      m.evento === 'conversa' ? null
      : m.evento === 'proposta_enviada' ? (intermediarias[0] ?? null)
      : m.evento === 'qualificado_1' ? (intermediarias[base] ?? null)
      : m.evento === 'qualificado_2' ? (intermediarias[base + 1] ?? null)
      : ganha;

    const achada = achar(m);

    return {
      evento: m.evento,
      nome: m.nome,
      categoria: m.categoria,
      valor: m.valor,
      primary: m.primary,
      contagem: 'ONE_PER_CLICK',
      janelaClique: m.janelaClique,
      janelaView: 1,
      stageId: sugerida ? sugerida.id : null,
      stageNome: m.evento === 'conversa' ? '(primeira mensagem)' : (sugerida?.nome ?? '(sem etapa)'),
      etapasPossiveis: opcoes,
      jaExiste: !!achada,
      idExistente: achada ? String(achada.id) : null,
      // marcar por padrao uma meta opcional criaria no Google Ads algo que o
      // cliente nao usa
      marcada: m.opcional ? !!achada : true,
    };
  });
}

/** A unica etapa final que vira conversao e' a de ganho. */
function ehGanho(s: Stage): boolean {
  return /ganha|ganho|fechad/i.test(s.nome);
}
