import type { Stage } from './types';
import type { ConversionAction } from '../clients/googleAds';

/**
 * Propoe as metas de conversao offline a partir do funil do cliente.
 *
 * Sai no padrao que as contas ja usam hoje: nome 'CRM - ...', tipo
 * UPLOAD_CLICKS, categorias CONTACT / QUALIFIED_LEAD / PURCHASE.
 *
 * Fica de fora, de proposito:
 *  - a etapa de entrada, que e' onde o card nasce;
 *  - a etapa de resposta automatica ("Qualificando"), alcancada por qualquer
 *    resposta do vendedor — viraria quase a mesma coisa que Conversa Iniciada;
 *  - as etapas de perda.
 *
 * A "Conversa Iniciada" nao vem de etapa nenhuma: ela dispara na primeira
 * mensagem, antes de o card andar.
 */

export interface MetaProposta {
  /** Evento interno usado no dedupe das conversoes. */
  evento: string;
  /** Etapa que dispara a meta. null = nao vem de etapa. */
  stageId: number | null;
  stageNome: string;
  nome: string;
  categoria: 'CONTACT' | 'QUALIFIED_LEAD' | 'PURCHASE';
  /** null = usa o valor real da negociacao. */
  valor: number | null;
  primary: boolean;
  contagem: 'ONE_PER_CLICK' | 'MANY_PER_CLICK';
  janelaClique: number;
  janelaView: number;
  jaExiste: boolean;
  idExistente: string | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Slug estavel para o campo `evento`, usado como chave de dedupe. */
function evento(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function proporMetas(stages: Stage[], existentes: ConversionAction[]): MetaProposta[] {
  const porNome = new Map(existentes.map((a) => [norm(a.name), a]));

  const marcar = (m: Omit<MetaProposta, 'jaExiste' | 'idExistente'>): MetaProposta => {
    const achada = porNome.get(norm(m.nome));
    return { ...m, jaExiste: !!achada, idExistente: achada ? String(achada.id) : null };
  };

  const metas: MetaProposta[] = [
    marcar({
      evento: 'conversa',
      stageId: null,
      stageNome: '(primeira mensagem)',
      nome: 'CRM - Conversa Iniciada',
      categoria: 'CONTACT',
      valor: 0,
      primary: true,
      contagem: 'ONE_PER_CLICK',
      janelaClique: 30,
      janelaView: 1,
    }),
  ];

  const ordenadas = [...stages].sort((a, b) => a.posicao - b.posicao);
  const entrada = ordenadas[0]?.id;

  // etapas intermediarias elegiveis, para escalonar o valor
  const meio = ordenadas.filter(
    (s) => s.id !== entrada && !s.autoOnReply && !s.isFinal,
  );

  meio.forEach((s, i) => {
    metas.push(
      marcar({
        evento: evento(s.nome),
        stageId: s.id,
        stageNome: s.nome,
        nome: `CRM - ${s.nome}`,
        categoria: 'QUALIFIED_LEAD',
        // valor cresce conforme avanca: lead mais fundo no funil vale mais
        valor: 50 * (i + 1),
        primary: false,
        contagem: 'ONE_PER_CLICK',
        janelaClique: 30,
        janelaView: 1,
      }),
    );
  });

  // etapa de ganho: a unica final que vira conversao, com o valor real
  const ganha = ordenadas.find((s) => s.isFinal && /ganha|ganho|fechad/i.test(s.nome));
  if (ganha) {
    metas.push(
      marcar({
        evento: 'compra',
        stageId: ganha.id,
        stageNome: ganha.nome,
        nome: 'CRM - Compra (valor real)',
        categoria: 'PURCHASE',
        valor: null,
        primary: true,
        contagem: 'ONE_PER_CLICK',
        janelaClique: 90,
        janelaView: 1,
      }),
    );
  }

  return metas;
}
