import type { Env, QueueMessage } from '../env';
import { eventoPorId, marcarEvento } from '../db/queries';

/**
 * Consumidor da fila — onde o trabalho real acontece.
 *
 * Substitui o `Wait 25s` do n8n: quando o card do board de entrada ainda nao
 * existe, a mensagem e' devolvida a fila com `retry()` e o backoff cuida do
 * resto, em vez de dormir um tempo fixo torcendo para dar certo.
 *
 * ESTADO: os cinco pipelines ainda nao estao implementados (Fase 3 do plano).
 * Ate la o consumidor registra o evento como `ignorado` com o motivo explicito,
 * para que a tela de Eventos mostre exatamente o que chegou e o que falta.
 */

type Resultado = { status: 'ok' | 'ignorado' | 'erro'; motivo: string };

async function processar(msg: QueueMessage, _env: Env): Promise<Resultado> {
  switch (msg.source) {
    case 'click':
      return { status: 'ignorado', motivo: 'pipeline click ainda nao implementado (Fase 3)' };

    case 'chatwoot':
      switch (msg.eventType) {
        case 'conversation_created':
          return {
            status: 'ignorado',
            motivo: 'pipeline conversationCreated ainda nao implementado (Fase 3)',
          };
        case 'message_created':
        case 'message_incoming':
          return {
            status: 'ignorado',
            motivo: 'pipeline leadMessage ainda nao implementado (Fase 3)',
          };
        case 'message_outgoing':
          return {
            status: 'ignorado',
            motivo: 'pipeline sellerMessage ainda nao implementado (Fase 3)',
          };
        default:
          return { status: 'ignorado', motivo: `evento sem pipeline: ${msg.eventType}` };
      }

    case 'kanban':
      return { status: 'ignorado', motivo: 'pipeline stageChanged ainda nao implementado (Fase 3)' };

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

      const r = await processar(m.body, env);
      await marcarEvento(env.DB, m.body.eventId, r.status, r.motivo);
      m.ack();
    } catch (e) {
      // Erro transitorio (Chatwoot fora do ar, card ainda nao criado): devolve a
      // fila. Depois de `max_retries` a mensagem cai na DLQ e fica visivel.
      await marcarEvento(env.DB, m.body.eventId, 'erro', (e as Error).message).catch(() => {});
      m.retry();
    }
  }
}
