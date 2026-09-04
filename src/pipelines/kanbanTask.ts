import type { Env } from '../env';
import { parseKanbanTask } from '../domain/kanbanTask';
import { montarCanal } from '../domain/canal';
import { detectOrigin, detectPlatform } from '../domain/platform';
import { normFone } from '../domain/phone';
import { PulseboardClient, ErroPulseboard } from '../clients/pulseboard';

/**
 * Avisa o grupo do cliente quando um lead entra no funil de Ads.
 *
 * Gatilho: webhook da task do Kanban. So conta o board de Ads — o Organico
 * guarda quem ja estava em conversa e quem nao veio de anuncio, entao avisar
 * dali encheria o grupo de ruido.
 *
 * A duplicata e' barrada por `group_notifications`: o webhook dispara em
 * QUALQUER alteracao da task, e um card que sai e volta avisaria de novo.
 */

export interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
  /** `false` = erro de cadastro; fica visivel no painel, mas sai da fila. */
  retentar?: boolean;
}

interface ConfigTenant {
  cw_account_id: number | null;
  cw_board_funil_id: number | null;
  pulseboard_url: string | null;
  pulseboard_ativo: number;
}

interface LinhaLead {
  nome: string | null;
  phone_e164: string | null;
  page_url: string | null;
  origem: string | null;
  evento: string | null;
  quiz_version: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbc: string | null;
}

export async function avisarLeadNoGrupo(
  env: Env,
  tenantId: number,
  payload: string,
): Promise<Resultado> {
  const cfg = await env.DB.prepare(
    `SELECT cw_account_id, cw_board_funil_id, pulseboard_url, pulseboard_ativo
     FROM tenant_config WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<ConfigTenant>();

  if (!cfg) return { status: 'ignorado', motivo: 'cliente sem configuracao' };

  let cru: unknown;
  try {
    cru = JSON.parse(payload);
  } catch {
    return { status: 'ignorado', motivo: 'payload do Kanban nao e json' };
  }

  const t = parseKanbanTask(cru);
  if (!t.taskId) return { status: 'ignorado', motivo: 'payload sem task' };

  if (!cfg.cw_board_funil_id) {
    return { status: 'ignorado', motivo: 'board de Ads nao configurado para este cliente' };
  }
  if (t.boardId !== cfg.cw_board_funil_id) {
    return {
      status: 'ignorado',
      motivo: `card no board ${t.boardId}, nao no de Ads (${cfg.cw_board_funil_id})`,
    };
  }

  /**
   * O MESMO card avisa uma vez, mesmo trocando de nome no meio.
   *
   * `chaveDedupe` e' o protocolo quando existe e `task:<id>` quando nao. So'
   * que o webhook chega ANTES de `leadMessage` carimbar o protocolo, e de novo
   * depois: a chave muda de `task:1555` para `PERSI-...` entre um e outro, a
   * UNIQUE nao ve conflito, e o grupo recebe dois avisos do mesmo lead — o
   * primeiro sem URL, porque o clique ainda nao tinha casado.
   *
   * O card e' a identidade estavel. Se ja' avisamos por ele, acabou.
   */
  if (t.taskId) {
    const mesmaTask = await env.DB.prepare(
      `SELECT chave, status FROM group_notifications
       WHERE tenant_id = ? AND task_id = ? AND chave != ?`,
    )
      .bind(tenantId, t.taskId, t.chaveDedupe)
      .first<{ chave: string; status: string }>();

    if (mesmaTask && mesmaTask.status !== 'erro') {
      return {
        status: 'ignorado',
        motivo: `grupo ja avisado sobre o card ${t.taskId} (como ${mesmaTask.chave})`,
      };
    }
  }

  // Trava de duplicata: a UNIQUE decide, sem leitura antes da escrita.
  const reserva = await env.DB.prepare(
    `INSERT OR IGNORE INTO group_notifications (tenant_id, chave, task_id, protocolo)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(tenantId, t.chaveDedupe, t.taskId, t.protocolo || null)
    .run();

  if ((reserva.meta.changes ?? 0) === 0) {
    // Ja existe linha. Se a tentativa anterior falhou, esta e' a retentativa da
    // fila e deve seguir: parar aqui deixaria o grupo sem aviso para sempre.
    // 'pendente' significa que outra invocacao esta cuidando agora.
    const antes = await env.DB.prepare(
      'SELECT status FROM group_notifications WHERE tenant_id = ? AND chave = ?',
    )
      .bind(tenantId, t.chaveDedupe)
      .first<{ status: string }>();

    if (antes?.status !== 'erro') {
      return { status: 'ignorado', motivo: `grupo ja avisado sobre ${t.chaveDedupe}` };
    }
  }

  // Dados do clique para montar o canal. Lead que nunca passou pela ingestao
  // ainda e' avisado — so com menos precisao no rotulo.
  const lead = t.protocolo
    ? await env.DB.prepare(
        `SELECT nome, phone_e164, page_url, origem, evento, quiz_version,
                utm_source, utm_medium, utm_campaign, gclid, gbraid, wbraid, fbc
         FROM leads WHERE tenant_id = ? AND protocol = ?`,
      )
        .bind(tenantId, t.protocolo)
        .first<LinhaLead>()
    : null;

  const sinais = {
    utmSource: lead?.utm_source,
    utmMedium: lead?.utm_medium,
    utmCampaign: lead?.utm_campaign,
    gclid: lead?.gclid,
    gbraid: lead?.gbraid,
    wbraid: lead?.wbraid,
    fbc: lead?.fbc,
    origemClick: lead?.origem,
    eventClick: lead?.evento,
    quizVersion: lead?.quiz_version ?? t.quizVersion,
  };

  const canal = montarCanal({
    origem: detectOrigin(sinais),
    plataforma: detectPlatform(sinais),
    quizVersion: sinais.quizVersion,
  });

  const nome = lead?.nome || t.nome || 'Lead';
  // o Pulseboard espera so digitos, com DDI e sem '+'
  const telefone = (normFone(lead?.phone_e164 ?? t.telefone) || '').replace('+', '');
  const url = String(lead?.page_url ?? '').split('?')[0] ?? '';

  const marcar = (status: string, erro?: string) =>
    env.DB.prepare(
      `UPDATE group_notifications
       SET status = ?, erro = ?, canal = ?, lead_nome = ?, telefone = ?, enviado_em = datetime('now')
       WHERE tenant_id = ? AND chave = ?`,
    )
      .bind(status, erro ?? null, canal, nome, telefone, tenantId, t.chaveDedupe)
      .run();

  // Cliente que nao usa o aviso no grupo. Sem isto, cada lead novo virava um
  // erro e a fila retentava um cadastro inexistente.
  if (cfg.pulseboard_ativo !== 1) {
    await marcar('ignorado', 'aviso no grupo desligado para este cliente');
    return { status: 'ignorado', motivo: `aviso no grupo desligado · ${nome} · ${canal}` };
  }

  // Quem identifica o cliente agora e' a URL. Sem uma propria, o aviso cairia no
  // webhook padrao e o Pulseboard nao teria como saber de que grupo se trata.
  if (!cfg.pulseboard_url) {
    const msg = 'cliente sem webhook do Pulseboard — preencha no perfil ou desligue o aviso';
    await marcar('erro', msg);
    // cadastro faltando nao melhora com retentativa
    return { status: 'erro', motivo: msg, retentar: false };
  }

  try {
    await new PulseboardClient(cfg.pulseboard_url).avisarLeadNovo({
      canal,
      nome,
      telefone,
      url,
      etapa: t.etapa || null,
      conversa: t.conversaDisplay && cfg.cw_account_id
        ? `${env.CHATWOOT_BASE_URL}/app/accounts/${cfg.cw_account_id}/conversations/${t.conversaDisplay}`
        : null,
    });
  } catch (e) {
    const msg = (e as Error).message;
    await marcar('erro', msg);
    // Grupo sem aviso e' perda de lead, entao a falha transitoria volta para a
    // fila. A de cadastro nao: fica visivel e para de tentar.
    const permanente = e instanceof ErroPulseboard && e.permanente;
    return { status: 'erro', motivo: `Pulseboard falhou: ${msg}`, retentar: !permanente };
  }

  await marcar('enviado');
  return { status: 'ok', motivo: `grupo avisado: ${nome} · ${canal}` };
}
