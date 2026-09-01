import type { Origem, Plataforma } from './platform';

/**
 * Rotulo do canal enviado ao Pulseboard, que e' o que o cliente le no grupo.
 *
 * Portado do node "HTTP Request4" dos workflows. Os fluxos atuais montam esse
 * texto de dois jeitos diferentes: o do Vita e' fixo em
 * "Campanha de Mensagem - Google" e o da Persianas deduz "Quiz" pela presenca
 * de /quiz na page_url e "Google" pela presenca de gclid. Aqui a decisao vem
 * dos mesmos sinais que ja alimentam as etiquetas, em um lugar so.
 *
 * O quiz vence "Formulário" no rotulo: tecnicamente e' um formulario, mas o
 * cliente reconhece a campanha pelo nome "Quiz".
 */

export interface CanalInput {
  origem?: Origem | null;
  plataforma?: Plataforma | null;
  quizVersion?: string | null;
}

const PLATAFORMA: Record<string, string> = {
  google: 'Google',
  meta: 'Meta',
};

export function montarCanal(i: CanalInput): string {
  const tipo = i.quizVersion ? 'Quiz' : i.origem === 'formulario' ? 'Formulário' : 'Mensagem';
  const onde = PLATAFORMA[String(i.plataforma ?? '')] ?? 'Direto';
  return `Campanha de ${tipo} - ${onde}`;
}
