import { describe, test, expect } from 'vitest';
import { lerCartaoDaEvolution } from '../../src/domain/referralEvolution';

/** `messages.upsert` da Evolution v2, no formato de um lead real de anuncio. */
function corpo(
  over: { event?: string; key?: Record<string, unknown>; message?: Record<string, unknown>; data?: Record<string, unknown> } = {},
) {
  return JSON.stringify({
    event: over.event ?? 'messages.upsert',
    instance: 'Tainã Aci',
    data: {
      key: { remoteJid: '5571991065853@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3', ...over.key },
      pushName: 'Maria',
      message: over.message ?? {
        extendedTextMessage: {
          text: 'Olá! Gostaria de mais informações [Protocolo: MA21RMKT]',
          contextInfo: {
            externalAdReply: {
              title: 'Harmonização facial',
              body: 'Agende sua avaliação',
              mediaType: 'IMAGE',
              jpegThumbnail: '/9j/4AAQSkZJRgABAQ-MINIATURA',
              sourceType: 'ad',
              sourceId: '120212345678900',
              sourceUrl: 'https://fb.me/abcDEF123',
              ctwaClid: 'ARAkLkA8rmlFeiCktEJQ-clid',
            },
          },
        },
      },
      messageType: 'extendedTextMessage',
      messageTimestamp: 1758540000,
      ...over.data,
    },
    date_time: '2026-09-22T10:00:00.000Z',
    apikey: 'segredo-da-instancia',
  });
}

describe('lerCartaoDaEvolution', () => {
  test('le o clique, o anuncio e a instancia do corpo real', () => {
    expect(lerCartaoDaEvolution(corpo())).toEqual({
      telefone: '5571991065853',
      ctwaClid: 'ARAkLkA8rmlFeiCktEJQ-clid',
      adId: '120212345678900',
      sourceUrl: 'https://fb.me/abcDEF123',
      titulo: 'Harmonização facial',
      instancia: 'Tainã Aci',
    });
  });

  test('a miniatura e a apikey nunca entram no resultado', () => {
    const r = JSON.stringify(lerCartaoDaEvolution(corpo()));
    expect(r).not.toContain('MINIATURA');
    expect(r).not.toContain('segredo-da-instancia');
  });

  test('acha o cartao em message.contextInfo', () => {
    const r = lerCartaoDaEvolution(corpo({
      message: { conversation: 'oi', contextInfo: { externalAdReply: { ctwaClid: 'c2' } } },
    }));
    expect(r?.ctwaClid).toBe('c2');
  });

  test('acha o cartao em data.contextInfo', () => {
    const r = lerCartaoDaEvolution(corpo({
      message: { conversation: 'oi' },
      data: { contextInfo: { externalAdReply: { ctwaClid: 'c3' } } },
    }));
    expect(r?.ctwaClid).toBe('c3');
  });

  test('acha o cartao numa mensagem de imagem', () => {
    const r = lerCartaoDaEvolution(corpo({
      message: { imageMessage: { caption: 'x', contextInfo: { externalAdReply: { ctwaClid: 'c4' } } } },
    }));
    expect(r?.ctwaClid).toBe('c4');
  });

  test('numero no endereco novo do WhatsApp (LID) vem do campo ao lado', () => {
    const r = lerCartaoDaEvolution(corpo({
      key: { remoteJid: '123456789012345@lid', remoteJidAlt: '5571991065853@s.whatsapp.net' },
    }));
    expect(r?.telefone).toBe('5571991065853');
  });

  test.each([
    ['grupo', corpo({ key: { remoteJid: '120363041234567890@g.us', senderPn: '5571991065853@s.whatsapp.net' } })],
    ['status', corpo({ key: { remoteJid: 'status@broadcast' } })],
    ['mensagem enviada pela empresa', corpo({ key: { fromMe: true } })],
    ['mensagem sem cartao', corpo({ message: { conversation: 'oi' } })],
    ['outro evento', corpo({ event: 'messages.update' })],
    ['LID sem numero', corpo({ key: { remoteJid: '123456789012345@lid' } })],
    ['json invalido', '{nao e json'],
  ])('%s nao e cartao de anuncio', (_, raw) => {
    expect(lerCartaoDaEvolution(raw)).toBeNull();
  });
});
