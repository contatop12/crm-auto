import { describe, test, expect } from 'vitest';
import { segundosDaAutomatica } from '../../src/domain/respostasAutomaticas';

// message_type do Chatwoot: 0 = do lead, 1 = enviada, 2 = atividade
const lead = (id: number, created_at: number) => ({ id, message_type: 0, created_at });
const saiu = (id: number, created_at: number) => ({ id, message_type: 1, created_at });

describe('segundosDaAutomatica — a mensagem que sai colada no lead e da maquina', () => {
  test('boas-vindas 1 s depois do lead e automatica', () => {
    // Locadora: o WhatsApp Business responde sozinho no mesmo segundo
    const boasVindas = saiu(2, 1001);
    expect(segundosDaAutomatica(boasVindas, [lead(1, 1000), boasVindas])).toBe(1);
  });

  test('o atendente 40 s depois do lead nao e', () => {
    const resposta = saiu(2, 1040);
    expect(segundosDaAutomatica(resposta, [lead(1, 1000), resposta])).toBeNull();
  });

  test('a mensagem que abre a conversa e automatica', () => {
    // fluxo do formulario (LP da Locadora, n8n da Tainã): o lead ainda nao escreveu
    const abertura = saiu(1, 5000);
    expect(segundosDaAutomatica(abertura, [abertura])).toBe(0);
  });

  test('a rajada que abre a conversa conta inteira', () => {
    // boas-vindas + PDF + link saem juntos
    const terceira = saiu(3, 5004);
    expect(segundosDaAutomatica(terceira, [saiu(1, 5000), saiu(2, 5002), terceira])).toBe(4);
  });

  test('o atendente escrevendo minutos depois da abertura conta, mesmo sem o lead responder', () => {
    const cobranca = saiu(2, 5300);
    expect(segundosDaAutomatica(cobranca, [saiu(1, 5000), cobranca])).toBeNull();
  });

  test('vale a ULTIMA mensagem do lead, nao a primeira', () => {
    // o "fora do horario" responde a cada mensagem, nao so' a primeira
    const conversa = [lead(1, 1000), saiu(2, 1001), lead(3, 1100)];
    expect(segundosDaAutomatica(saiu(4, 1101), [...conversa, saiu(4, 1101)])).toBe(1);
  });

  test('mensagem do lead que chegou DEPOIS nao conta', () => {
    // o lead escreveu de novo enquanto o atendente digitava
    const resposta = saiu(2, 1060);
    expect(segundosDaAutomatica(resposta, [lead(1, 1000), resposta, lead(3, 1061)])).toBeNull();
  });

  test('o limite e 15 s: 15 ainda e automatica, 16 ja e gente', () => {
    expect(segundosDaAutomatica(saiu(2, 1015), [lead(1, 1000), saiu(2, 1015)])).toBe(15);
    expect(segundosDaAutomatica(saiu(2, 1016), [lead(1, 1000), saiu(2, 1016)])).toBeNull();
  });

  test('conversa que ja existia antes conta do inicio dela', () => {
    // uma atividade (ou nota interna) abriu a conversa 1 min antes: a primeira
    // mensagem enviada nao abriu nada
    const atividade = { id: 1, message_type: 2, created_at: 5000 };
    const resposta = saiu(2, 5060);
    expect(segundosDaAutomatica(resposta, [atividade, resposta])).toBeNull();
  });

  test('nota interna do lado de ca nao vira mensagem do lead', () => {
    const nota = { id: 2, message_type: 0, created_at: 1050, private: true };
    const resposta = saiu(3, 1051);
    expect(segundosDaAutomatica(resposta, [lead(1, 1000), nota, resposta])).toBeNull();
  });
});
