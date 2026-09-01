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
}

export const CATALOGO: MetaCatalogo[] = [
  {
    evento: 'conversa',
    nome: 'CRM - Conversa Iniciada',
    categoria: 'CONTACT',
    valor: 0,
    primary: true,
    janelaClique: 30,
    // as contas foram criadas em momentos diferentes e o nome variou
    apelidos: ['CRM - Conversa Iniciada - WhatsApp', 'CRM - Conversão WhatsApp', 'CRM - Conversao WhatsApp'],
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
    primary: true,
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

  return CATALOGO.map((m) => {
    const sugerida =
      m.evento === 'conversa' ? null
      : m.evento === 'qualificado_1' ? (intermediarias[0] ?? null)
      : m.evento === 'qualificado_2' ? (intermediarias[1] ?? null)
      : ganha;

    const achada =
      porNome.get(norm(m.nome)) ??
      m.apelidos.map((a) => porNome.get(norm(a))).find(Boolean) ??
      null;

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
    };
  });
}

/** A unica etapa final que vira conversao e' a de ganho. */
function ehGanho(s: Stage): boolean {
  return /ganha|ganho|fechad/i.test(s.nome);
}
