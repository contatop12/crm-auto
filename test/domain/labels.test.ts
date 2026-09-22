import { describe, test, expect } from 'vitest';
import { buildLabels } from '../../src/domain/labels';
import type { LabelVocabulary } from '../../src/domain/types';

const vocab: LabelVocabulary[] = [
  { slug: 'mensagem', labelChatwoot: 'mensagem', labelWhatsapp: 'mensagem' },
  { slug: 'formulario', labelChatwoot: 'formulario', labelWhatsapp: 'formulario' },
  { slug: 'google', labelChatwoot: 'google', labelWhatsapp: 'Google' },
  { slug: 'facebook', labelChatwoot: 'facebook', labelWhatsapp: 'Facebook' },
  { slug: 'instagram', labelChatwoot: 'instagram', labelWhatsapp: 'Instagram' },
  { slug: 'p-max', labelChatwoot: 'p-max', labelWhatsapp: 'p-max' },
  { slug: 'search', labelChatwoot: 'search', labelWhatsapp: 'search' },
  { slug: 'quiz-v2', labelChatwoot: 'quiz-v2', labelWhatsapp: null },
  { slug: 'r30', labelChatwoot: 'r30', labelWhatsapp: 'r30' },
];

describe('buildLabels', () => {
  test('lead de anuncio de mensagem no Google com P-Max', () => {
    const r = buildLabels(
      { origem: 'mensagem', plataforma: 'google', campanhaSlug: 'p-max' },
      vocab,
    );
    expect(r.slugs).toEqual(['mensagem', 'google', 'p-max']);
  });

  test('lead de quiz gera versao e faixa de valor', () => {
    const r = buildLabels(
      { origem: 'formulario', plataforma: 'google', quizVersion: 'v2', quizValor: 30 },
      vocab,
    );
    expect(r.slugs).toContain('quiz-v2');
    expect(r.slugs).toContain('r30');
    expect(r.slugs).toContain('formulario');
  });

  test('faixa de valor de um digito e r5, sem zero a esquerda', () => {
    // o zero ordenava melhor na lista do Chatwoot, mas o nome que o time usa e'
    // o que vale: etiqueta que ninguem reconhece ninguem aplica
    const v = [...vocab, { slug: 'r5', labelChatwoot: 'r5', labelWhatsapp: 'r5' }];
    const r = buildLabels({ origem: 'formulario', plataforma: 'meta', quizValor: 5 }, v);
    expect(r.slugs).toContain('r5');
  });

  test('etiqueta fora do vocabulario e descartada e registrada', () => {
    // quiz-v6 nao existe no Chatwoot; enviar criaria etiqueta solta
    const r = buildLabels(
      { origem: 'formulario', plataforma: 'google', quizVersion: 'v6' },
      vocab,
    );
    expect(r.slugs).not.toContain('quiz-v6');
    expect(r.ignoradas).toContain('quiz-v6');
  });

  test('plataforma outro nao gera etiqueta de plataforma', () => {
    const r = buildLabels({ origem: 'mensagem', plataforma: 'outro' }, vocab);
    expect(r.slugs).toEqual(['mensagem']);
  });

  test('traduz para o nome real da etiqueta em cada canal', () => {
    const r = buildLabels({ origem: 'mensagem', plataforma: 'google' }, vocab);
    expect(r.chatwoot).toEqual(['mensagem', 'google']);
    expect(r.whatsapp).toEqual(['mensagem', 'Google']);
  });

  test('etiqueta sem nome no WhatsApp nao vai para o WhatsApp', () => {
    const r = buildLabels(
      { origem: 'formulario', plataforma: 'outro', quizVersion: 'v2' },
      vocab,
    );
    expect(r.chatwoot).toContain('quiz-v2');
    expect(r.whatsapp).not.toContain('quiz-v2');
  });

  test('nao repete etiqueta', () => {
    const r = buildLabels(
      { origem: 'mensagem', plataforma: 'google', campanhaSlug: 'google' },
      vocab,
    );
    expect(r.slugs.filter((s) => s === 'google')).toHaveLength(1);
  });
});

/** O esquema da Vita: origem / canal / trafego / pagina / campanha, sem `mensagem`. */
const vita: LabelVocabulary[] = [
  'google', 'instagram', 'facebook', 'site', 'msg-site', 'msg-nat', 'formulario-do-site',
  'pago', 'organico', 'direto', 'search', 'aparelho-auditivo', 'aparelho-auditivo-preco',
].map((s) => ({ slug: s, labelChatwoot: s, labelWhatsapp: null }));

describe('buildLabels no esquema completo (Vita)', () => {
  test('lead de anuncio do Google pelo botao do site', () => {
    const r = buildLabels({
      origem: 'mensagem', plataforma: 'google', campanhaSlug: 'search',
      trafego: 'pago', canal: 'msg-site', pagina: 'https://audicao.vitaaudio.com.br/aparelho-auditivo-preco?gclid=x',
    }, vita);
    expect(r.slugs).toEqual(['google', 'msg-site', 'pago', 'aparelho-auditivo-preco', 'search']);
    // `mensagem` nao existe na Vita: fica registrada como ignorada, nao vai
    expect(r.ignoradas).toContain('mensagem');
  });

  test('pagina com sufixo do botao cai no primeiro trecho', () => {
    const r = buildLabels({ origem: null, plataforma: 'google', pagina: 'https://audicao.vitaaudio.com.br/aparelho-auditivo/whatsapp' }, vita);
    expect(r.slugs).toEqual(['google', 'aparelho-auditivo']);
  });

  test('clique do site sem anuncio: site, canal e organico', () => {
    const r = buildLabels({ origem: 'mensagem', plataforma: 'outro', viaSite: true, canal: 'msg-site', trafego: 'organico' }, vita);
    expect(r.slugs).toEqual(['site', 'msg-site', 'organico']);
  });

  test('contato sem lead: so o trafego direto, sem origem inventada', () => {
    const r = buildLabels({ origem: null, plataforma: 'outro', trafego: 'direto' }, vita);
    expect(r.slugs).toEqual(['direto']);
  });

  test('cliente sem esse esquema nao ganha etiqueta nova', () => {
    // o vocabulario de sempre (Persianas antes, Taina) nao tem pago/msg-site/direto
    const r = buildLabels({ origem: 'mensagem', plataforma: 'google', trafego: 'pago', canal: 'msg-site' }, vocab);
    expect(r.slugs).toEqual(['mensagem', 'google']);
  });
});

describe('buildLabels com o vocabulario antigo', () => {
  const antigo: LabelVocabulary[] = ['mensagem', 'google-ads', 'meta-ads', 'search']
    .map((s) => ({ slug: s, labelChatwoot: s, labelWhatsapp: null }));

  test('google vira google-ads onde google nao existe (Taina, Locadora, Tile)', () => {
    expect(buildLabels({ origem: 'mensagem', plataforma: 'google', campanhaSlug: 'search' }, antigo).slugs)
      .toEqual(['mensagem', 'google-ads', 'search']);
  });

  test('instagram e facebook viram meta-ads', () => {
    expect(buildLabels({ origem: 'mensagem', plataforma: 'meta', utmSource: 'ig' }, antigo).slugs).toEqual(['mensagem', 'meta-ads']);
  });

  test('onde os dois existem, vale o nome novo', () => {
    const ambos = [...antigo, { slug: 'google', labelChatwoot: 'google', labelWhatsapp: null }];
    expect(buildLabels({ origem: 'mensagem', plataforma: 'google' }, ambos).slugs).toEqual(['mensagem', 'google']);
  });
});
