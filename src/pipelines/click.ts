import type { Env } from '../env';
import { normFone, phoneKey } from '../domain/phone';
import { normEmail } from '../domain/email';

/**
 * Clique no anuncio, vindo do GTM.
 *
 * E' a cabeca da corrente: sem esta linha em `leads`, a mensagem que o lead
 * manda depois carrega um protocolo que nao casa com nada, e o `leadMessage`
 * devolve "protocolo nao esta na base de cliques".
 *
 * Substitui o bloco 01 do n8n, que escrevia direto na aba `Cliques`. Aqui o
 * banco e' a fonte da verdade; a planilha vira espelho.
 */

interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
}

/**
 * Nomes que o GTM manda. Sao os mesmos cabecalhos da planilha — o snake_case
 * veio de la' — mas aceitamos camelCase tambem porque o modelo de tag do GTM
 * varia de cliente para cliente e nao vale quebrar por causa disso.
 */
function ler(p: Record<string, unknown>, ...nomes: string[]): string | null {
  for (const n of nomes) {
    const v = p[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Macro do GTM que ficou sem resolver: `{campaignname}` nao e' nome de campanha. */
const MACRO = /^\{[^}]*\}$/;

function semMacro(v: string | null): string | null {
  return v && MACRO.test(v) ? null : v;
}

export async function registrarClique(
  env: Env,
  tenantId: number,
  payload: string,
): Promise<Resultado> {
  let p: Record<string, unknown>;
  try {
    const j = JSON.parse(payload) as unknown;
    if (!j || typeof j !== 'object' || Array.isArray(j)) {
      return { status: 'ignorado', motivo: 'corpo do clique nao e um objeto' };
    }
    p = j as Record<string, unknown>;
  } catch {
    return { status: 'ignorado', motivo: 'corpo do clique nao e json' };
  }

  const protocol = ler(p, 'protocol', 'protocolo');
  if (!protocol) {
    // sem protocolo nao ha chave: a mensagem do lead nao teria como casar
    return { status: 'ignorado', motivo: 'clique sem protocolo' };
  }

  const fone = ler(p, 'phone_number', 'phone', 'telefone');
  const email = normEmail(ler(p, 'email')) || null;

  const campos = {
    nome: ler(p, 'lead_name', 'nome', 'name'),
    email,
    phone_raw: fone,
    phone_e164: normFone(fone) || null,
    phone_key: phoneKey(fone) || null,
    gclid: ler(p, 'gclid'),
    gbraid: ler(p, 'gbraid'),
    wbraid: ler(p, 'wbraid'),
    utm_source: semMacro(ler(p, 'utm_source', 'utmSource')),
    utm_medium: semMacro(ler(p, 'utm_medium', 'utmMedium')),
    utm_campaign: semMacro(ler(p, 'utm_campaign', 'utmCampaign')),
    utm_id: ler(p, 'utm_id', 'utmId'),
    utm_term: semMacro(ler(p, 'utm_term', 'utmTerm')),
    utm_content: semMacro(ler(p, 'utm_content', 'utmContent')),
    fbp: ler(p, 'fbp'),
    fbc: ler(p, 'fbc'),
    client_id: ler(p, 'client_id', 'clientId'),
    origem: ler(p, 'origem', 'origin') ?? 'clique',
    evento: ler(p, 'event', 'evento') ?? 'whatsapp_click',
    page_url: ler(p, 'page_url', 'pageUrl', 'url'),
    whatsapp_url: ler(p, 'whatsapp_url', 'whatsappUrl'),
    referrer: ler(p, 'referrer', 'referer'),
    user_agent: ler(p, 'user_agent', 'userAgent'),
    ip_address: ler(p, 'ip_address', 'ip'),
    quiz_version: ler(p, 'quiz_version', 'quizVersion'),
    quiz_form_id: ler(p, 'form_id', 'formId'),
  };

  const quizValor = Number(ler(p, 'quiz_valor', 'quizValor') ?? '');
  const valorProposta = Number(ler(p, 'valor_proposta', 'valorProposta') ?? '');

  const colunas = Object.keys(campos);
  const valores = Object.values(campos);

  // O mesmo protocolo pode chegar duas vezes: o beacon do GTM nao garante envio
  // unico. Atualizar so' o que veio preenchido evita que a repeticao apague o
  // que a primeira trouxe.
  const atualiza = colunas
    .map((c) => `${c} = COALESCE(excluded.${c}, leads.${c})`)
    .concat([
      'quiz_valor = COALESCE(excluded.quiz_valor, leads.quiz_valor)',
      'valor_proposta = COALESCE(excluded.valor_proposta, leads.valor_proposta)',
      "updated_at = datetime('now')",
    ])
    .join(', ');

  await env.DB.prepare(
    `INSERT INTO leads (tenant_id, protocol, ${colunas.join(', ')}, quiz_valor, valor_proposta)
     VALUES (?, ?, ${colunas.map(() => '?').join(', ')}, ?, ?)
     ON CONFLICT (tenant_id, protocol) DO UPDATE SET ${atualiza}`,
  )
    .bind(
      tenantId,
      protocol,
      ...valores,
      Number.isFinite(quizValor) && quizValor ? Math.trunc(quizValor) : null,
      Number.isFinite(valorProposta) && valorProposta ? valorProposta : null,
    )
    .run();

  const plataforma = campos.gclid || campos.gbraid || campos.wbraid ? 'google' : campos.fbc ? 'meta' : 'sem plataforma';
  return {
    status: 'ok',
    motivo: `clique ${protocol} registrado (${plataforma}${campos.phone_key ? ', com telefone' : ''})`,
  };
}
