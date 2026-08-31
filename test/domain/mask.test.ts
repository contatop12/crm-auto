import { describe, test, expect } from 'vitest';
import { maskPhone, maskEmail, maskPayload } from '../../src/domain/mask';

describe('maskPhone', () => {
  test('mostra DDI+DDD e os dois ultimos digitos', () => {
    expect(maskPhone('+5511996316799')).toBe('+5511*******99');
  });

  test('funciona sem o DDI', () => {
    expect(maskPhone('11996316799')).toBe('11*******99');
  });

  test('numero curto vira tudo asterisco em vez de vazar', () => {
    expect(maskPhone('1234')).toBe('****');
  });

  test('devolve vazio para entrada vazia', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
  });
});

describe('maskEmail', () => {
  test('mostra a primeira letra e o dominio', () => {
    expect(maskEmail('joao.silva@gmail.com')).toBe('j*********@gmail.com');
  });

  test('usuario de uma letra nao vaza', () => {
    expect(maskEmail('a@gmail.com')).toBe('*@gmail.com');
  });

  test('devolve vazio quando nao e email', () => {
    expect(maskEmail('nao-e-email')).toBe('');
    expect(maskEmail('')).toBe('');
  });
});

describe('maskPayload', () => {
  test('mascara telefone e email dentro do json do webhook', () => {
    const p = JSON.stringify({
      sender: { phone_number: '+5511996316799', email: 'joao.silva@gmail.com' },
    });
    const r = JSON.parse(maskPayload(p));
    expect(r.sender.phone_number).toBe('+5511*******99');
    expect(r.sender.email).toBe('j*********@gmail.com');
  });

  test('mascara em qualquer profundidade', () => {
    const p = JSON.stringify({
      conversation: { meta: { sender: { phone_number: '11996316799' } } },
    });
    const r = JSON.parse(maskPayload(p));
    expect(r.conversation.meta.sender.phone_number).toBe('11*******99');
  });

  test('mascara dentro de array', () => {
    const p = JSON.stringify({ contacts: [{ phone_number: '11996316799' }] });
    const r = JSON.parse(maskPayload(p));
    expect(r.contacts[0].phone_number).toBe('11*******99');
  });

  test('trunca o texto da mensagem, que pode conter dado pessoal', () => {
    const longa = 'meu cpf e 123.456.789-00 e moro na rua tal numero 42 apto 7. '.repeat(4);
    const r = JSON.parse(maskPayload(JSON.stringify({ content: longa })));
    expect(r.content.length).toBeLessThan(longa.length);
    expect(r.content).toContain('…');
  });

  test('mantem os campos que o diagnostico precisa', () => {
    const p = JSON.stringify({
      event: 'conversation_created',
      conversation: { id: 754, display_id: 28, custom_attributes: { protocolo: 'ABC-1-X' } },
    });
    const r = JSON.parse(maskPayload(p));
    expect(r.event).toBe('conversation_created');
    expect(r.conversation.id).toBe(754);
    expect(r.conversation.display_id).toBe(28);
    expect(r.conversation.custom_attributes.protocolo).toBe('ABC-1-X');
  });

  test('mascara o identifier do WhatsApp, que carrega o numero', () => {
    const p = JSON.stringify({ sender: { identifier: '5511996316799@s.whatsapp.net' } });
    const r = JSON.parse(maskPayload(p));
    expect(r.sender.identifier).not.toContain('996316799');
  });

  test('payload que nao e json volta como veio, truncado', () => {
    expect(maskPayload('isto nao e json')).toContain('isto nao e json');
  });
});
