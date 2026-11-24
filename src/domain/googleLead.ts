import { normFone, phoneKey } from './phone';
import { normEmail } from './email';

/**
 * Lead do formulario nativo do Google Ads (recurso "formulario de lead").
 *
 * O Google entrega no webhook `user_column_data` (uma linha por campo, com
 * `column_id` e `string_value`) e, soltos no corpo, o que identifica o clique:
 * `gcl_id`, `campaign_id`, `adgroup_id`, `creative_id`, `form_id`, `lead_id`.
 * `is_test` vem `true` no botao "Enviar dados de teste" do proprio Google.
 *
 * A automacao que repassa (Make, n8n) pode entregar o corpo cru ou ja' achatado
 * em `data` — as duas formas sao aceitas, como no formulario do Meta.
 */
export interface GoogleLead {
  leadId: string | null;
  nome: string | null;
  /** E.164. Sem ele o lead nao serve: e' por ele que a conversa e' achada depois. */
  telefone: string;
  phoneKey: string;
  email: string | null;
  /** O clique do anuncio. E' o que deixa a conversao voltar para a campanha. */
  gclid: string | null;
  campanhaId: string | null;
  grupoId: string | null;
  anuncioId: string | null;
  formId: string | null;
}

type Rec = Record<string, unknown>;

function obj(v: unknown): Rec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}

/** Texto util. O Google manda os ids como numero. */
function texto(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Corpo num nivel so', com as chaves em minusculas: colunas do Google, `data` e o que veio solto. */
function achatar(p: Rec): Rec {
  const plano: Rec = {};
  const por = (nome: string | null, valor: unknown) => {
    const k = nome?.toLowerCase();
    if (k && texto(valor) && plano[k] === undefined) plano[k] = texto(valor);
  };
  if (Array.isArray(p.user_column_data)) {
    for (const c of p.user_column_data) {
      const o = obj(c);
      por(texto(o?.column_id), o?.string_value);
    }
  }
  for (const [k, v] of Object.entries(obj(p.data) ?? {})) por(k, v);
  for (const [k, v] of Object.entries(p)) por(k, v);
  return plano;
}

function primeiro(p: Rec, nomes: string[]): string | null {
  for (const n of nomes) {
    const v = texto(p[n]);
    if (v) return v;
  }
  return null;
}

/** O disparo e' o teste do proprio Google? */
export function ehTesteDoGoogle(raw: unknown): boolean {
  const v = obj(raw)?.is_test;
  return v === true || v === 'true';
}

export function parseGoogleLead(raw: unknown): GoogleLead | null {
  const base = obj(raw);
  if (!base) return null;
  const p = achatar(base);

  const telefone = normFone(primeiro(p, ['phone_number', 'work_phone', 'telefone', 'phone', 'whatsapp']));
  if (!telefone) return null;
  const chave = phoneKey(telefone);
  if (!chave) return null;

  const nomeEmDois = [primeiro(p, ['first_name']), primeiro(p, ['last_name'])].filter(Boolean).join(' ');

  return {
    leadId: primeiro(p, ['lead_id']),
    nome: primeiro(p, ['full_name', 'nome', 'name']) ?? (nomeEmDois || null),
    telefone,
    phoneKey: chave,
    email: normEmail(primeiro(p, ['email', 'work_email'])) || null,
    gclid: primeiro(p, ['gcl_id', 'gclid']),
    campanhaId: primeiro(p, ['campaign_id']),
    grupoId: primeiro(p, ['adgroup_id']),
    anuncioId: primeiro(p, ['creative_id']),
    formId: primeiro(p, ['form_id']),
  };
}

/**
 * Protocolo do lead do formulario do Google.
 *
 * Sai do `lead_id`, que e' unico no Google: o reenvio do mesmo lead cai na
 * mesma linha. O id e' longo, entao ficam os ultimos 14 caracteres. Sem ele,
 * o telefone. O `GFORM` no meio diz que o lead veio do formulario do anuncio,
 * nao de um clique no site.
 */
export function protocoloGoogle(prefixo: string, leadId: string | null, telefone?: string | null): string {
  const p = (prefixo ?? '').trim().toUpperCase();
  const doId = (leadId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-14).toUpperCase();
  const id = doId || (telefone ?? '').replace(/\D/g, '') || 'SEM-ID';
  return p ? `${p}-GFORM-${id}` : `GFORM-${id}`;
}
