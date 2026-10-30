import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { EvolutionClient } from '../clients/evolution';
import { conversaEmOutraCaixa, parDeCaixas, rotuloDaCaixa, textoDoAlerta } from '../domain/contatoDuplicado';

/**
 * Alerta de contato em dois numeros do mesmo cliente.
 *
 * Locadora: o mesmo telefone chama o 8910 e o 2244, e cada atendente trabalha
 * sem saber do outro. Na primeira mensagem de uma conversa nova, olha as
 * conversas do contato nas OUTRAS caixas (abertas, ou com atividade nos
 * ultimos 30 dias) e avisa o grupo `tenant_config.alerta_duplicado_grupo`
 * (jid ...@g.us) pela instancia de alerta da Evolution.
 *
 * Uma vez por contato + par de caixas (`alertas_duplicado`). Sem grupo
 * configurado so' loga e NAO grava a linha: gravar queimaria o alerta antes de
 * existir para onde mandar. Roda depois do rodizio, para o texto trazer o
 * responsavel que acabou de ser atribuido. Nunca sobe erro.
 */
export async function alertarContatoDuplicado(env: Env, tenantId: number, payload: string): Promise<void> {
  let reservado: number | null = null;
  try {
    const p = obj(JSON.parse(payload));
    if (!p || p.message_type !== 'incoming' || p.private === true) return;

    const conv = obj(p.conversation);
    const sender = obj(obj(conv?.meta)?.sender) ?? obj(p.sender);
    const conversa = num(conv?.id);
    const inbox = num(obj(p.inbox)?.id) ?? num(conv?.inbox_id);
    const contato = num(sender?.id);
    const telefone = str(sender?.phone_number)?.replace(/\D/g, '');
    // Conversa nova = o contato acabou de abrir um segundo canal. Nas
    // mensagens seguintes a pergunta ja' foi feita (e custa uma chamada).
    if (!conversa || !inbox || !contato || !telefone || !recemCriada(conv?.created_at)) return;

    const cfg = await env.DB.prepare(
      `SELECT c.cw_account_id AS acc, c.alerta_duplicado_grupo AS grupo,
              c.alerta_duplicado_instancia AS instancia, t.nome
       FROM tenant_config c JOIN tenants t ON t.id = c.tenant_id WHERE c.tenant_id = ?`,
    )
      .bind(tenantId)
      .first<{ acc: number | null; grupo: string | null; instancia: string | null; nome: string }>();
    if (!cfg?.acc) return;

    const cw = ChatwootClient.fromEnv(env);
    const outra = conversaEmOutraCaixa(await cw.conversasDoContato(cfg.acc, contato), { conversa, inbox }, Date.now());
    if (!outra) return;

    const [a, b] = parDeCaixas(inbox, outra.inbox_id);
    if (!cfg.grupo) {
      console.log(JSON.stringify({ acao: 'duplicado_sem_grupo', contato, caixas: [a, b], conversas: [conversa, outra.id] }));
      return;
    }

    // A reserva vem antes do envio: duas mensagens em paralelo nao mandam o
    // alerta em dobro. Se o envio falhar, a linha sai e a proxima tenta.
    const r = await env.DB.prepare(
      'INSERT OR IGNORE INTO alertas_duplicado (tenant_id, contato_id, inbox_a, inbox_b) VALUES (?, ?, ?, ?)',
    )
      .bind(tenantId, contato, a, b)
      .run();
    if (!r.meta.changes) return;
    const linha = await env.DB.prepare(
      'SELECT id FROM alertas_duplicado WHERE tenant_id = ? AND contato_id = ? AND inbox_a = ? AND inbox_b = ?',
    )
      .bind(tenantId, contato, a, b)
      .first<{ id: number }>();
    reservado = linha?.id ?? null;

    // dono atual da conversa nova: o que o rodizio acabou de gravar
    const mesmasConversas = await cw.conversasDoContato(cfg.acc, contato);
    const dona = (id: number) => str(mesmasConversas.find((c) => c.id === id)?.meta?.assignee?.name) ?? null;
    const caixas = await cw.caixas(cfg.acc);
    const nomeDaCaixa = (id: number, fallback?: string | null) => caixas.find((c) => c.id === id)?.name ?? fallback;

    const texto = textoDoAlerta({
      cliente: cfg.nome,
      nome: str(sender?.name) ?? telefone,
      telefone,
      antiga: {
        rotulo: rotuloDaCaixa(nomeDaCaixa(outra.inbox_id), outra.inbox_id),
        conversa: outra.id,
        responsavel: str(outra.meta?.assignee?.name) ?? null,
        ultimaAtividadeMs: (outra.last_activity_at ?? 0) * 1000,
      },
      nova: {
        rotulo: rotuloDaCaixa(nomeDaCaixa(inbox, str(obj(p.inbox)?.name)), inbox),
        conversa,
        responsavel: dona(conversa),
      },
    });

    // A instancia tem de estar no grupo: a do cliente, ou a de alerta do sistema.
    await EvolutionClient.fromEnv(env).enviarTexto(cfg.instancia || env.EVOLUTION_ALERT_INSTANCE, cfg.grupo, texto);
    await env.DB.prepare("UPDATE alertas_duplicado SET alertado_em = datetime('now') WHERE id = ?").bind(reservado).run();
    reservado = null;
    console.log(JSON.stringify({ acao: 'duplicado_alertou', contato, caixas: [a, b], conversas: [conversa, outra.id] }));
  } catch (e) {
    if (reservado) {
      await env.DB.prepare('DELETE FROM alertas_duplicado WHERE id = ? AND alertado_em IS NULL').bind(reservado).run().catch(() => {});
    }
    console.log(JSON.stringify({ acao: 'duplicado_falhou', erro: (e as Error).message.slice(0, 200) }));
  }
}

/** Conversa criada nos ultimos minutos. O Chatwoot manda `created_at` em segundos. */
function recemCriada(v: unknown): boolean {
  const quando = typeof v === 'number' ? v * 1000 : Date.parse(String(v ?? ''));
  return Number.isFinite(quando) && Date.now() - quando < 10 * 60 * 1000;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
