import type { Env, QueueMessage } from '../env';
import { eventoPorId, marcarEvento } from '../db/queries';
import { avisarLeadNoGrupo } from '../pipelines/kanbanTask';
import { atribuirLead } from '../pipelines/leadMessage';
import { registrarClique } from '../pipelines/click';
import { moverPelaResposta } from '../pipelines/sellerMessage';
import { enviarConversao } from '../pipelines/stageChanged';

/**
 * Consumidor da fila — onde o trabalho real acontece.
 *
 * Substitui o `Wait 25s` do n8n: quando o card do board de entrada ainda nao
 * existe, a mensagem e' devolvida a fila com `retry()` e o backoff cuida do
 * resto, em vez de dormir um tempo fixo torcendo para dar certo.
 *
 * ESTADO: falta so' `conversationCreated`, que registra o evento como
 * `ignorado` com o motivo explicito — a tela de Eventos mostra o que chegou e
 * o que ainda nao tem tratamento.
 */

type Resultado = {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
  /** `false` = erro que nao melhora sozinho; fica visivel, mas sai da fila. */
  retentar?: boolean;
};

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
          // move o card pela frase do vendedor e captura o valor da proposta
          return moverPelaResposta(env, msg.tenantId, payload);
        default:
          return { status: 'ignorado', motivo: `evento sem pipeline: ${msg.eventType}` };
      }

    case 'kanban':
      // `conversao` vem das regras de etapa avancada (Qualificado, Compra).
      // Avisar o grupo aqui anunciaria como "lead novo" quem ja fechou.
      if (msg.eventType === 'kanban_conversao') {
        return enviarConversao(env, msg.tenantId, payload);
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
      //
      // `retentar: false` e' o meio-termo que faltava: erro de CADASTRO, que
      // continua visivel no painel mas nao volta para a fila. Um codi_id sem
      // rota nao se cadastra sozinho — retentar so' gastava tentativa e mantinha
      // o cliente vermelho sem caminho de saida.
      if (r.status === 'erro' && r.retentar !== false) m.retry();
      else m.ack();
    } catch (e) {
      // Erro transitorio (Chatwoot fora do ar, card ainda nao criado): devolve a
      // fila. Depois de `max_retries` a mensagem cai na DLQ e fica visivel.
      await marcarEvento(env.DB, m.body.eventId, 'erro', (e as Error).message).catch(() => {});
      m.retry();
    }
  }
}
