import type { Env, QueueMessage } from '../env';
import { eventoPorId, marcarEvento } from '../db/queries';
import { avisarLeadNoGrupo } from '../pipelines/kanbanTask';
import { atribuirLead } from '../pipelines/leadMessage';
import { registrarClique } from '../pipelines/click';

/**
 * Consumidor da fila — onde o trabalho real acontece.
 *
 * Substitui o `Wait 25s` do n8n: quando o card do board de entrada ainda nao
 * existe, a mensagem e' devolvida a fila com `retry()` e o backoff cuida do
 * resto, em vez de dormir um tempo fixo torcendo para dar certo.
 *
 * ESTADO: o aviso de lead novo no grupo do cliente ja funciona. Os demais
 * pipelines (Fase 3) ainda registram o evento como `ignorado` com o motivo
 * explicito, para a tela de Eventos mostrar o que chegou e o que falta.
 */

type Resultado = { status: 'ok' | 'ignorado' | 'erro'; motivo: string };

async function processar(msg: QueueMessage, env: Env, payload: string): Promise<Resultado> {
  switch (msg.source) {
    case 'click':
      // cabeca da corrente: sem a linha em `leads`, o protocolo que o lead
      // manda depois nao casa com nada
      return registrarClique(env, msg.tenantId, payload);

    case 'chatwoot':
      switch (msg.eventType) {
        case 'conversation_created':
          return {
            status: 'ignorado',
            motivo: 'pipeline conversationCreated ainda nao implementado (Fase 3)',
          };
        case 'message_created':
        case 'message_incoming':
          // Onde a atribuicao acontece: le o protocolo da mensagem, acha o
          // clique e escreve origem, UTMs e etiquetas na conversa e no card.
          return atribuirLead(env, msg.tenantId, payload);
        case 'message_outgoing':
          return {
            status: 'ignorado',
            motivo: 'pipeline sellerMessage ainda nao implementado (Fase 3)',
          };
        default:
          return { status: 'ignorado', motivo: `evento sem pipeline: ${msg.eventType}` };
      }

    case 'kanban':
      // `conversao` vem das regras de etapa avancada (Qualificado, Compra).
      // Avisar o grupo aqui anunciaria como "lead novo" quem ja fechou.
      if (msg.eventType === 'kanban_conversao') {
        return {
          status: 'ignorado',
          motivo: 'pipeline stageChanged ainda nao implementado (Fase 3)',
        };
      }
      return avisarLeadNoGrupo(env, msg.tenantId, payload);

    default:
      return { status: 'ignorado', motivo: `origem desconhecida: ${msg.source}` };
  }
}

export async function consumir(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
  for (const m of batch.messages) {
    try {
      const evento = await eventoPorId(env.DB, m.body.eventId);
      if (!evento) {
        // evento sumiu do banco: retentar nao ajuda
        m.ack();
        continue;
      }

      const r = await processar(m.body, env, evento.payload);
      await marcarEvento(env.DB, m.body.eventId, r.status, r.motivo);

      // 'erro' e' falha possivelmente transitoria (Pulseboard fora do ar, por
      // exemplo): devolve a fila para o backoff tentar de novo. 'ok' e
      // 'ignorado' sao definitivos.
      if (r.status === 'erro') m.retry();
      else m.ack();
    } catch (e) {
      // Erro transitorio (Chatwoot fora do ar, card ainda nao criado): devolve a
      // fila. Depois de `max_retries` a mensagem cai na DLQ e fica visivel.
      await marcarEvento(env.DB, m.body.eventId, 'erro', (e as Error).message).catch(() => {});
      m.retry();
    }
  }
}
