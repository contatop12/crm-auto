/**
 * Estado de cada etapa do fluxo de um cliente.
 *
 * Responde "onde o lead para" — diferente da tela de Integracoes, que responde
 * "as credenciais funcionam". Uma conta pode estar perfeitamente conectada e o
 * lead ainda assim nao andar, porque falta o webhook, a meta ou o codi_id.
 */

export type EstadoEtapa = 'ok' | 'erro' | 'aguardando' | 'pendente';

export interface SinaisEtapa {
  total24h: number;
  total7d: number;
  /** Ultima vez que a etapa rodou. */
  ultimoEm: string | null;
  ultimoErroEm: string | null;
  ultimoErroMotivo: string | null;
  /** O que falta configurar. Quando preenchido, vence tudo. */
  pendencia: string | null;
  /** false = o codigo desta etapa ainda nao existe. */
  implementado: boolean;
}

export interface EtapaAvaliada {
  estado: EstadoEtapa;
  detalhe: string;
}

function maisRecente(a: string | null, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return a >= b;
}

export function avaliarEtapa(s: SinaisEtapa): EtapaAvaliada {
  // Configuracao faltando vence qualquer outro sinal: o erro seria consequencia,
  // e mostrar o erro esconderia a causa.
  if (s.pendencia) return { estado: 'pendente', detalhe: s.pendencia };

  if (!s.implementado) {
    return { estado: 'pendente', detalhe: 'esta etapa ainda não foi implementada' };
  }

  // Erro so conta se for mais recente que o ultimo sucesso — senao uma falha
  // antiga manteria a etapa vermelha para sempre.
  if (s.ultimoErroEm && maisRecente(s.ultimoErroEm, s.ultimoEm)) {
    return {
      estado: 'erro',
      detalhe: s.ultimoErroMotivo ?? 'último processamento falhou',
    };
  }

  if (s.total7d > 0 || s.ultimoEm) {
    return {
      estado: 'ok',
      detalhe: `${s.total24h} em 24h · ${s.total7d} em 7 dias`,
    };
  }

  return { estado: 'aguardando', detalhe: 'configurado, mas nada chegou ainda' };
}
