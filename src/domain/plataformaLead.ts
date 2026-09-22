/**
 * Para qual plataforma de anuncio a conversao deste lead volta.
 *
 * Substitui o `ehDoMeta` do stageChanged, que so' sabia dizer "nao e' do
 * Google". Agora o lead da Meta tem para onde ir: a Conversions API, por um de
 * dois canais — o clique no anuncio de mensagem (`ctwa_clid`) ou o cookie do
 * pixel no site (`fbc`).
 *
 * A ordem e' a decisao:
 *  1. clique do Google (gclid/gbraid/wbraid) vence tudo: e' mais forte e mais
 *     recente que um cookie de pixel, que so' prova que a pessoa passou pela Meta;
 *  2. ctwa_clid → Meta, canal whatsapp;
 *  3. formulario nativo da Meta → fica de fora (decisao da fase 1);
 *  4. fbc → Meta, canal site;
 *  5. utm de rede da Meta sem identificador → e' da Meta, mas a CAPI de
 *     mensagem exige o ctwa_clid: nao ha o que enviar;
 *  6. o resto → Google, o caminho de sempre (sem conta ou sem dado, o proprio
 *     Google recusa com motivo).
 */

export interface SinaisDoLead {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ctwa_clid: string | null;
  fbc: string | null;
  evento: string | null;
  utm_source: string | null;
}

export type CanalMeta = 'whatsapp' | 'site';
export type MotivoForaDaMeta = 'formulario' | 'sem_identificador';

export type Destino =
  | { plataforma: 'google' }
  | { plataforma: 'meta'; canal: CanalMeta }
  | { plataforma: 'meta'; fora: MotivoForaDaMeta };

/** Token inteiro, como o `ehDoMeta` antigo: `digital` nao e' `ig`. */
const REDE_META = /^(meta|facebook|instagram|fb|ig)$/i;

export function destinoDoLead(l: SinaisDoLead): Destino {
  if (l.gclid || l.gbraid || l.wbraid) return { plataforma: 'google' };
  if (l.ctwa_clid) return { plataforma: 'meta', canal: 'whatsapp' };
  if (l.evento === 'meta_lead_form') return { plataforma: 'meta', fora: 'formulario' };
  if (l.fbc) return { plataforma: 'meta', canal: 'site' };
  if (REDE_META.test((l.utm_source ?? '').trim())) return { plataforma: 'meta', fora: 'sem_identificador' };
  return { plataforma: 'google' };
}

export const MOTIVO_FORA: Record<MotivoForaDaMeta, string> = {
  formulario: 'formulario nativo da Meta nao envia para a Meta',
  sem_identificador: 'sem ctwa_clid nem fbc, a Meta nao teria como atribuir',
};
