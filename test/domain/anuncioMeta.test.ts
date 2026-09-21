import { describe, test, expect } from 'vitest';
import { anuncioDoMeta, protocoloDoAnuncio } from '../../src/domain/anuncioMeta';

// formato real da primeira mensagem de quem chama pelo anuncio (Chatwoot)
const doInstagram =
  'Olá! Preenchi seu formulário e gostaria de saber mais sobre sua empresa.\n\n\n' +
  '**O Melhor Preço em Persianas Sob Medida é...**\n' +
  'Procurando a solução ideal em persianas? Na Persianas Paulista, unimos a du...\n' +
  'https://www.instagram.com/p/DcSZMKWACPl/';

describe('anuncioDoMeta', () => {
  test('reconhece o bloco do anuncio do Instagram', () => {
    expect(anuncioDoMeta(doInstagram)).toEqual({
      rede: 'instagram',
      link: 'https://www.instagram.com/p/DcSZMKWACPl/',
      titulo: 'O Melhor Preço em Persianas Sob Medida é...',
    });
  });

  test('link do Facebook vira rede facebook', () => {
    const t = 'Olá! Quero agendar.\n\n**Consulta com a Dra. Tainã**\nAgende...\nhttps://fb.me/2abcDEF';
    expect(anuncioDoMeta(t)?.rede).toBe('facebook');
  });

  test('reel do Instagram tambem e anuncio', () => {
    const t = 'Oi\n\n**Titulo**\ntexto\nhttps://www.instagram.com/reel/Abc_12-3/';
    expect(anuncioDoMeta(t)?.rede).toBe('instagram');
  });

  test('link solto de Instagram, sem o bloco do anuncio, nao e anuncio', () => {
    expect(anuncioDoMeta('olha esse modelo https://www.instagram.com/p/DcSZMKWACPl/')).toBeNull();
  });

  test('mensagem comum nao e anuncio', () => {
    expect(anuncioDoMeta('Olá! Posso ter mais informações sobre isso?')).toBeNull();
    expect(anuncioDoMeta('')).toBeNull();
  });
});

describe('protocoloDoAnuncio', () => {
  test('derivado da conversa: a segunda mensagem cai no mesmo lead', () => {
    expect(protocoloDoAnuncio('TAINA', 628)).toBe('TAINA-CTWA-628');
    expect(protocoloDoAnuncio('', 628)).toBe('CTWA-628');
  });
});
