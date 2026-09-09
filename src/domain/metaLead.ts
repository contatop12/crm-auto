import { normFone, phoneKey } from './phone';
import { normEmail } from './email';

/**
 * Lead do formulário nativo do Meta.
 *
 * O fluxo é diferente do Google: ali a pessoa clica no anúncio, abre o WhatsApp
 * e o clique traz o `gclid`. Aqui ela preenche um formulário DENTRO do Meta e
 * quem procura é o vendedor — não existe clique nosso, não existe protocolo, e
 * o lead só aparece no CRM quando alguém liga.
 *
 * O que amarra os dois lados é o TELEFONE. Por isso ele é obrigatório: um lead
 * de formulário sem telefone não tem como encontrar a conversa do WhatsApp
 * depois, e ficaria no banco sem servir para nada.
 *
 * `porTelefone` em `leadMessage` já faz esse cruzamento — é a mesma janela que
 * casa clique com mensagem. Nada de novo precisou ser inventado para isso.
 */

export interface MetaLead {
  leadgenId: string | null;
  nome: string | null;
  /** E.164. Sem ele o lead não serve. */
  telefone: string;
  phoneKey: string;
  email: string | null;
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
  formId: string | null;
}

type Rec = Record<string, unknown>;

function obj(v: unknown): Rec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Achata o `field_data` do webhook do Meta.
 *
 * O formato nativo é `[{name, values: [...]}]`. A automação pode entregar já
 * achatado ou repassar cru, e as duas formas chegam aqui.
 */
function achatar(p: Rec): Rec {
  const campos = p.field_data;
  if (!Array.isArray(campos)) return p;

  const plano: Rec = { ...p };
  for (const c of campos) {
    const o = obj(c);
    const nome = str(o?.name);
    const valor = Array.isArray(o?.values) ? str(o!.values[0]) : str(o?.value);
    if (nome && valor && plano[nome] === undefined) plano[nome] = valor;
  }
  return plano;
}

/** Primeiro nome de campo que tiver valor. O formulário do Meta é renomeável. */
function primeiro(p: Rec, nomes: string[]): string | null {
  for (const n of nomes) {
    const v = str(p[n]);
    if (v) return v;
  }
  return null;
}

export function parseMetaLead(raw: unknown): MetaLead | null {
  const base = obj(raw);
  if (!base) return null;
  const p = achatar(base);

  // Telefone é a única coisa sem a qual o lead não serve: é por ele que o
  // formulário encontra a conversa do WhatsApp depois.
  const telefone = normFone(primeiro(p, ['phone_number', 'telefone', 'phone', 'whatsapp', 'celular']));
  if (!telefone) return null;

  const chave = phoneKey(telefone);
  if (!chave) return null;

  return {
    leadgenId: primeiro(p, ['leadgen_id', 'lead_id', 'id']),
    nome: primeiro(p, ['full_name', 'nome', 'name', 'nome_completo']),
    telefone,
    phoneKey: chave,
    // `normEmail` devolve string vazia para o que nao e' e-mail; vazio no banco
    // e' pior que ausente, porque parece dado
    email: normEmail(primeiro(p, ['email', 'e_mail', 'e-mail'])) || null,
    campanha: primeiro(p, ['campaign_name', 'campanha', 'campaign']),
    conjunto: primeiro(p, ['adset_name', 'conjunto', 'adset']),
    anuncio: primeiro(p, ['ad_name', 'anuncio', 'ad']),
    formId: primeiro(p, ['form_id', 'formulario_id', 'form']),
  };
}

/**
 * Protocolo do lead de formulário.
 *
 * Derivado do `leadgen_id`, que é único no Meta — a automação pode repetir o
 * disparo, e repetir não pode criar um lead novo. Sem ele, cai no telefone, que
 * é o que sempre existe.
 *
 * O `META` no meio avisa que não há `gclid` nem clique nosso: quem ler o
 * protocolo saberá que a atribuição aqui é por dados do lead, não por clique.
 */
export function protocoloMeta(
  prefixo: string,
  leadgenId: string | null,
  telefone?: string | null,
): string {
  const p = (prefixo ?? '').trim().toUpperCase();
  const id = (leadgenId ?? '').trim() || (telefone ?? '').replace(/\D/g, '') || 'sem-id';
  return p ? `${p}-META-${id}` : `META-${id}`;
}
