import { describe, test, expect } from 'vitest';
import { buildLabels } from '../../src/domain/labels';
import type { LabelVocabulary } from '../../src/domain/types';

const vocab: LabelVocabulary[] = [
  { slug: 'mensagem', labelChatwoot: 'mensagem', labelWhatsapp: 'mensagem' },
  { slug: 'formulario', labelChatwoot: 'formulario', labelWhatsapp: 'formulario' },
  { slug: 'google-ads', labelChatwoot: 'google-ads', labelWhatsapp: 'Google Ads' },
  { slug: 'meta-ads', labelChatwoot: 'meta-ads', labelWhatsapp: 'meta-ads' },
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
    expect(r.slugs).toEqual(['mensagem', 'google-ads', 'p-max']);
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

  test('faixa de valor de um digito vira r05', () => {
    const v = [...vocab, { slug: 'r05', labelChatwoot: 'r05', labelWhatsapp: 'r05' }];
    const r = buildLabels({ origem: 'formulario', plataforma: 'meta', quizValor: 5 }, v);
    expect(r.slugs).toContain('r05');
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
    expect(r.chatwoot).toEqual(['mensagem', 'google-ads']);
    expect(r.whatsapp).toEqual(['mensagem', 'Google Ads']);
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
      { origem: 'mensagem', plataforma: 'google', campanhaSlug: 'google-ads' },
      vocab,
    );
    expect(r.slugs.filter((s) => s === 'google-ads')).toHaveLength(1);
  });
});
