/** Tipos compartilhados do motor. Espelham as tabelas de configuracao do D1. */

/** Uma etapa do funil (tabela `funnel_stages`). */
export interface Stage {
  id: number;
  /** Ordem no funil, 1..N. Define o que e' avancar e o que e' regredir. */
  posicao: number;
  /** Nome EXATO da etapa no board do Chatwoot. */
  nome: string;
  /** Alcancavel de qualquer ponto (Ganha / Perdida / Desqualificado). */
  isFinal: boolean;
  /** Etapa alvo de qualquer resposta do vendedor (ex: "Qualificando"). */
  autoOnReply: boolean;
}

/** Uma frase-gatilho de etapa (tabela `stage_triggers`). */
export interface Trigger {
  stageId: number;
  /** Comparada apos normalizar os dois lados com `limpa()`. */
  frase: string;
  /** Se preenchido, o emoji e' conferido no texto CRU da mensagem. */
  emojiObrigatorio?: string | null;
}

/** Resultado de `matchStage`. */
export interface StageMatch {
  stageId: number;
  stageNome: string;
  /** true = casou uma frase-gatilho; false = caiu na etapa autoOnReply. */
  byKeyword: boolean;
  /** A frase cadastrada que casou, para diagnostico. Vazia no fallback. */
  matchedPhrase: string;
}

/** Uma regra da denylist de e-mail (tabela `email_denylist`). */
export interface DenyRule {
  tipo: 'dominio' | 'exato' | 'regex';
  valor: string;
}

/** Lead candidato ao casamento com uma conversa (subconjunto da tabela `leads`). */
export interface LeadCandidate {
  protocol: string;
  phoneKey: string;
  /** 'formulario' tem prioridade sobre 'clique' no desempate. */
  origem: string;
  /** ISO ou o formato brasileiro "21/08/2026 11:46:53" gravado pelo GTM. */
  createdAt: string;
}

/** Uma entrada do vocabulario de etiquetas (tabela `label_vocabulary`). */
export interface LabelVocabulary {
  slug: string;
  labelChatwoot: string;
  /** null = a etiqueta nao existe no WhatsApp e nao deve ser aplicada la. */
  labelWhatsapp: string | null;
}

/** Um padrao de extracao de valor da proposta (tabela `value_patterns`). */
export interface ValuePattern {
  /** Ordem de tentativa; o primeiro que casar vence. */
  posicao: number;
  regex: string;
  /** Abaixo disto o numero e' ignorado (ex: "entrego em 10 dias"). */
  valorMinimo: number;
}
