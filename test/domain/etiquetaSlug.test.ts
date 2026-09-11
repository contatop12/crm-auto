import { describe, test, expect } from 'vitest';
import { etiquetaSlug, buildLabels } from '../../src/domain/labels';

describe('etiquetaSlug', () => {
  test('minusculo, sem acento', () => {
    expect(etiquetaSlug('Orgânico')).toBe('organico');
    expect(etiquetaSlug('Ligação')).toBe('ligacao');
    expect(etiquetaSlug('Indicação')).toBe('indicacao');
  });

  test('espaco vira hifen', () => {
    expect(etiquetaSlug('Google Meu Negócio')).toBe('google-meu-negocio');
    expect(etiquetaSlug('Formulário do Site')).toBe('formulario-do-site');
  });

  test('underline tambem vira hifen', () => {
    expect(etiquetaSlug('Msg_Site')).toBe('msg-site');
    expect(etiquetaSlug('Msg_nat')).toBe('msg-nat');
  });

  test('barra da frente e do fim some', () => {
    // sao caminhos de pagina; a barra nao faz parte do nome da etiqueta
    expect(etiquetaSlug('/aparelho-auditivo')).toBe('aparelho-auditivo');
    expect(etiquetaSlug('/aparelho-auditivo-preco/')).toBe('aparelho-auditivo-preco');
    expect(etiquetaSlug('/aparelho-auditivo-interton/')).toBe('aparelho-auditivo-interton');
  });

  test('caminho sem barra nenhuma passa igual', () => {
    expect(etiquetaSlug('zumbido-no-ouvido')).toBe('zumbido-no-ouvido');
  });

  test('URL inteira vira so o caminho', () => {
    // chegou uma assim na lista: `https://a/aparelho-auditivo-discreto`
    expect(etiquetaSlug('https://a/aparelho-auditivo-discreto')).toBe('aparelho-auditivo-discreto');
    expect(etiquetaSlug('https://vitaaudio.com.br/audiometria')).toBe('audiometria');
  });

  test('barra no meio vira hifen, nao some', () => {
    // juntar sem separador colaria duas palavras numa so'
    expect(etiquetaSlug('/blog/perda-auditiva')).toBe('blog-perda-auditiva');
  });

  test('hifen repetido colapsa', () => {
    expect(etiquetaSlug('a  --  b')).toBe('a-b');
    expect(etiquetaSlug('--teste--')).toBe('teste');
  });

  test('pontuacao que nao separa some', () => {
    expect(etiquetaSlug('aparelho (novo)!')).toBe('aparelho-novo');
    expect(etiquetaSlug('preço: R$ 100')).toBe('preco-r-100');
  });

  test('vazio e nulo devolvem vazio, nunca hifen solto', () => {
    expect(etiquetaSlug('')).toBe('');
    expect(etiquetaSlug('   ')).toBe('');
    expect(etiquetaSlug('///')).toBe('');
    expect(etiquetaSlug(null)).toBe('');
    expect(etiquetaSlug(undefined)).toBe('');
  });

  test('ja normalizado nao muda', () => {
    expect(etiquetaSlug('google')).toBe('google');
    expect(etiquetaSlug('msg-site')).toBe('msg-site');
  });
});

describe('rede do Meta na etiqueta', () => {
  const vocab = ['google', 'instagram', 'facebook', 'mensagem', 'aparelho-auditivo'].map((s) => ({
    slug: s, labelChatwoot: s, labelWhatsapp: null,
  }));

  test('google deixou de ser google-ads', () => {
    const r = buildLabels({ origem: 'mensagem', plataforma: 'google' }, vocab as never);
    expect(r.chatwoot).toContain('google');
    expect(r.chatwoot).not.toContain('google-ads');
  });

  test('utm de instagram vira instagram', () => {
    const r = buildLabels(
      { origem: 'mensagem', plataforma: 'meta', utmSource: 'instagram_feed' }, vocab as never);
    expect(r.chatwoot).toContain('instagram');
    expect(r.chatwoot).not.toContain('facebook');
  });

  test('meta sem pista de rede cai em facebook', () => {
    const r = buildLabels({ origem: 'mensagem', plataforma: 'meta' }, vocab as never);
    expect(r.chatwoot).toContain('facebook');
  });

  test('a pagina do clique tambem vira etiqueta', () => {
    const r = buildLabels(
      { origem: 'mensagem', plataforma: 'google', pagina: '/aparelho-auditivo/' }, vocab as never);
    expect(r.chatwoot).toContain('aparelho-auditivo');
  });

  test('pagina fora do vocabulario nao entra', () => {
    const r = buildLabels(
      { origem: 'mensagem', plataforma: 'google', pagina: '/pagina-qualquer' }, vocab as never);
    expect(r.chatwoot).not.toContain('pagina-qualquer');
    expect(r.ignoradas).toContain('pagina-qualquer');
  });
});
