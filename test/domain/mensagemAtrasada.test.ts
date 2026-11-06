import { describe, test, expect } from 'vitest';
import { atrasoDaMensagem, HORAS_MENSAGEM_ATRASADA } from '../../src/domain/mensagemAtrasada';

const agora = Date.parse('2026-11-06T18:00:00Z');

describe('atrasoDaMensagem', () => {
  test('clique de 2 dias atras com o protocolo no texto: mensagem atrasada', () => {
    // Martinelli 06/11/2026: a Evolution entregou as mensagens de 04/11 com ~44 h
    const r = atrasoDaMensagem('2026-11-04 22:05:00', agora);
    expect(r).toEqual({ atrasada: true, horas: 43 });
  });

  test('clique de minutos atras: mensagem em dia', () => {
    expect(atrasoDaMensagem('2026-11-06 17:55:00', agora)).toEqual({ atrasada: false, horas: 0 });
  });

  test('o limite e inclusivo', () => {
    const limite = new Date(agora - HORAS_MENSAGEM_ATRASADA * 3600_000).toISOString();
    expect(atrasoDaMensagem(limite, agora).atrasada).toBe(true);
  });

  test('um pouco abaixo do limite ainda avisa', () => {
    const quase = new Date(agora - HORAS_MENSAGEM_ATRASADA * 3600_000 + 60_000).toISOString();
    expect(atrasoDaMensagem(quase, agora).atrasada).toBe(false);
  });

  test('sem hora do clique nao barra: perder lead novo e pior', () => {
    expect(atrasoDaMensagem(null, agora).atrasada).toBe(false);
    expect(atrasoDaMensagem('lixo', agora).atrasada).toBe(false);
  });

  test('clique no futuro (relogio torto) nao barra', () => {
    expect(atrasoDaMensagem('2026-11-07 18:00:00', agora).atrasada).toBe(false);
  });
});
