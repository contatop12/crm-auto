import { destinoDoLead } from './plataformaLead';
import { ehDoPerfilGoogle } from './platform';
import { tipoDoCanal } from './canal';

/**
 * Leads de um cliente, contados por origem, campanha e dia, para a pagina de Relatorios do
 * painel. So' numeros: nome, telefone e e-mail nunca entram aqui.
 */

export interface LinhaDeLead {
  created_at: string;
  utm_source: string | null;
  utm_medium?: string | null;
  utm_campaign: string | null;
  utm_campaign_nome: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ctwa_clid: string | null;
  fbc: string | null;
  evento: string | null;
  origem: string | null;
  quiz_version: string | null;
}

export type PlataformaDoRelatorio = 'google' | 'meta' | 'direto';

export interface RelatorioDeOrigem {
  total: number;
  porOrigem: Array<{ plataforma: PlataformaDoRelatorio; canal: string; total: number }>;
  porCampanha: Array<{ campanha: string; plataforma: PlataformaDoRelatorio; total: number }>;
  porDia: Array<{ dia: string; google: number; meta: number; direto: number }>;
}

const MAX_CAMPANHAS = 30;

/** O lead do Perfil da Empresa no Google: sem anuncio, mas nao e' "direto". */
function doPerfil(l: LinhaDeLead): boolean {
  return ehDoPerfilGoogle({
    utmSource: l.utm_source, utmMedium: l.utm_medium, utmCampaign: l.utm_campaign,
    gclid: l.gclid, gbraid: l.gbraid, wbraid: l.wbraid,
  });
}

function plataformaDe(l: LinhaDeLead): PlataformaDoRelatorio {
  // Nao e' anuncio: conta em "Sem anuncio", com canal proprio. Antes contava
  // como Google, porque o link do perfil leva utm_source=google.
  if (doPerfil(l)) return 'direto';
  const temSinal = !!(l.gclid || l.gbraid || l.wbraid || l.ctwa_clid || l.fbc || l.evento === 'meta_lead_form' || (l.utm_source ?? '').trim());
  if (!temSinal) return 'direto';
  return destinoDoLead(l).plataforma;
}

/** "2026-11-16 03:10:00" (UTC, como o D1 grava) no dia local, "2026-11-16". */
export function diaLocal(criadoEm: string, tzHoras: number): string {
  const t = Date.parse(criadoEm.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return '';
  return new Date(t + tzHoras * 3600_000).toISOString().slice(0, 10);
}

function nomeDaCampanha(l: LinhaDeLead): string {
  return (l.utm_campaign_nome ?? '').trim() || (l.utm_campaign ?? '').trim() || '(sem campanha)';
}

/** `diretos`: datas de quem chamou no WhatsApp sem anuncio (leads_diretos). */
export function agregarOrigem(linhas: LinhaDeLead[], diretos: string[], tzHoras: number): RelatorioDeOrigem {
  const origens = new Map<string, { plataforma: PlataformaDoRelatorio; canal: string; total: number }>();
  const campanhas = new Map<string, { campanha: string; plataforma: PlataformaDoRelatorio; total: number }>();
  const dias = new Map<string, { dia: string; google: number; meta: number; direto: number }>();

  const contar = (criadoEm: string, plataforma: PlataformaDoRelatorio, canal: string, campanha: string | null) => {
    const o = origens.get(plataforma + '|' + canal) ?? { plataforma, canal, total: 0 };
    o.total++;
    origens.set(plataforma + '|' + canal, o);
    if (campanha) {
      const c = campanhas.get(plataforma + '|' + campanha) ?? { campanha, plataforma, total: 0 };
      c.total++;
      campanhas.set(plataforma + '|' + campanha, c);
    }
    const dia = diaLocal(criadoEm, tzHoras);
    if (dia) {
      const d = dias.get(dia) ?? { dia, google: 0, meta: 0, direto: 0 };
      d[plataforma]++;
      dias.set(dia, d);
    }
  };

  for (const l of linhas) {
    const plataforma = plataformaDe(l);
    const tipo = tipoDoCanal({ origem: l.origem === 'formulario' ? 'formulario' : 'mensagem', quizVersion: l.quiz_version });
    // `meu_negocio` nao e' campanha: fica fora da lista de campanhas
    if (doPerfil(l)) contar(l.created_at, plataforma, 'Google Meu Negócio', null);
    else contar(l.created_at, plataforma, tipo, nomeDaCampanha(l));
  }
  for (const criadoEm of diretos) contar(criadoEm, 'direto', 'WhatsApp direto', null);

  const porTotal = <T extends { total: number }>(a: T, b: T) => b.total - a.total;
  const ordenadas = [...campanhas.values()].sort(porTotal);
  const resto = ordenadas.slice(MAX_CAMPANHAS).reduce((s, c) => s + c.total, 0);
  const porCampanha = ordenadas.slice(0, MAX_CAMPANHAS);
  if (resto) porCampanha.push({ campanha: 'Outras campanhas', plataforma: 'direto', total: resto });

  return {
    total: linhas.length + diretos.length,
    porOrigem: [...origens.values()].sort(porTotal),
    porCampanha,
    porDia: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}
