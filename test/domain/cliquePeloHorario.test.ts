import { describe, test, expect } from 'vitest';
import {
  abriuSoComAutomatica,
  janelaDoClique,
  escolherClique,
  ANTES_S,
  DEPOIS_S,
} from '../../src/domain/cliquePeloHorario';

/**
 * Lead da conversa 1724 da Locadora (21/11/2026): clicou no anuncio, mandou a
 * mensagem com o protocolo, e a Evolution so' entregou as respostas automaticas
 * do WhatsApp Business. Sem a mensagem, o protocolo nunca chegou e o lead do
 * Google ficou no Organico.
 */

const FRASES = [{ frase: 'Seja muito bem-vindo(a) à Locadora' }, { frase: 'Nosso atendimento acontece de segunda a sexta' }];
const SAUDACAO = 'Olá! Seja muito bem-vindo(a) à Locadora Exatidão 🤝\nNossa equipe está pronta.';

const msg = (id: number, tipo: number, content: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, message_type: tipo, content, created_at: 1795257688 + id, ...extra });

describe('abriuSoComAutomatica', () => {
  test('conversa que abre com a saudacao automatica, sem mensagem do lead antes', () => {
    expect(abriuSoComAutomatica([msg(1, 1, SAUDACAO), msg(2, 1, 'Olá!\nNosso atendimento acontece de segunda a sexta.')], FRASES)).toBe(true);
  });

  test('o lead escreveu primeiro: nada se perdeu', () => {
    expect(abriuSoComAutomatica([msg(1, 0, 'Olá, quero um orçamento'), msg(2, 1, SAUDACAO)], FRASES)).toBe(false);
  });

  test('atendente abriu a conversa: a primeira mensagem nao e automatica', () => {
    expect(abriuSoComAutomatica([msg(1, 1, 'Bom dia, tudo bem? Aqui é a Ana da Locadora')], FRASES)).toBe(false);
  });

  test('mensagem do lead que chega DEPOIS da saudacao nao desfaz: a primeira dele continua perdida', () => {
    expect(abriuSoComAutomatica([msg(1, 1, SAUDACAO), msg(2, 0, 'Obrigado, não preciso mais')], FRASES)).toBe(true);
  });

  test('atividade do sistema e nota interna nao contam como primeira mensagem', () => {
    const lista = [msg(1, 2, 'Atribuído a Ana'), msg(2, 1, 'bilhete', { private: true }), msg(3, 1, SAUDACAO)];
    expect(abriuSoComAutomatica(lista, FRASES)).toBe(true);
  });

  test('ordena pelo id: a lista do Chatwoot pode vir em qualquer ordem', () => {
    expect(abriuSoComAutomatica([msg(2, 1, SAUDACAO), msg(1, 0, 'oi')], FRASES)).toBe(false);
  });

  test('cliente sem resposta automatica cadastrada, ou conversa vazia: nunca', () => {
    expect(abriuSoComAutomatica([msg(1, 1, SAUDACAO)], [])).toBe(false);
    expect(abriuSoComAutomatica([], FRASES)).toBe(false);
  });
});

describe('janelaDoClique', () => {
  test('do clique ate a conversa: 2 min antes e 40 s depois, no formato do D1 (UTC)', () => {
    // conversa 1724: criada em 2026-11-21 10:41:28 UTC
    const criada = Date.UTC(2026, 10, 21, 10, 41, 28) / 1000;
    expect(janelaDoClique(criada)).toEqual({ de: '2026-11-21 10:39:28', ate: '2026-11-21 10:42:08' });
    expect(ANTES_S).toBe(120);
    expect(DEPOIS_S).toBe(40);
  });
});

describe('escolherClique', () => {
  test('um clique so no horario: e ele', () => {
    expect(escolherClique([{ protocol: 'ANDAIM-AAAA1111BBBB', created_at: '2026-11-21 10:41:16' }]))
      .toEqual({ protocolo: 'ANDAIM-AAAA1111BBBB' });
  });

  test('nenhum clique: nao ha o que ligar', () => {
    expect(escolherClique([])).toEqual({ motivo: 'nenhum clique sem telefone no horario' });
  });

  test('dois cliques no mesmo horario: nao da para saber de quem e a conversa', () => {
    const r = escolherClique([
      { protocol: 'ANDAIM-AAAA1111BBBB', created_at: '2026-11-21 10:41:16' },
      { protocol: 'EXATID-CCCC2222DDDD', created_at: '2026-11-21 10:40:50' },
    ]);
    expect(r).toEqual({ motivo: '2 cliques sem telefone no horario (ANDAIM-AAAA1111BBBB, EXATID-CCCC2222DDDD): nao da para saber qual' });
  });
});
