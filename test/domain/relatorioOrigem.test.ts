import { describe, test, expect } from 'vitest';
import { agregarOrigem, diaLocal, type LinhaDeLead } from '../../src/domain/relatorioOrigem';

const lead = (extra: Partial<LinhaDeLead>): LinhaDeLead => ({
  created_at: '2026-11-10 12:00:00', utm_source: null, utm_campaign: null, utm_campaign_nome: null, gclid: null, gbraid: null,
  wbraid: null, ctwa_clid: null, fbc: null, evento: null, origem: null, quiz_version: null, ...extra,
});

describe('relatorio de origem', () => {
  test('o dia e' + "' o do fuso do cliente, nao o do UTC", () => {
    expect(diaLocal('2026-11-10 02:30:00', -3)).toBe('2026-11-09');
    expect(diaLocal('2026-11-10 12:00:00', -3)).toBe('2026-11-10');
    expect(diaLocal('lixo', -3)).toBe('');
  });

  test('separa Google, Meta e direto, e o canal (quiz, formulario, mensagem)', () => {
    const r = agregarOrigem(
      [
        lead({ gclid: 'a', utm_campaign: '111', utm_campaign_nome: 'Persianas SP' }),
        lead({ gclid: 'b', utm_campaign: '111', utm_campaign_nome: 'Persianas SP', quiz_version: 'v2' }),
        lead({ ctwa_clid: 'c', utm_source: 'facebook', utm_campaign: 'Meta Msg' }),
        lead({ origem: 'formulario' }),
      ],
      ['2026-11-10 13:00:00'],
      -3,
    );
    expect(r.total).toBe(5);
    const mapa = Object.fromEntries(r.porOrigem.map((o) => [`${o.plataforma}|${o.canal}`, o.total]));
    expect(mapa).toEqual({ 'google|Mensagem': 1, 'google|Quiz': 1, 'meta|Mensagem': 1, 'direto|Formulário': 1, 'direto|WhatsApp direto': 1 });
    expect(r.porCampanha[0]).toEqual({ campanha: 'Persianas SP', plataforma: 'google', total: 2 });
    expect(r.porDia).toEqual([{ dia: '2026-11-10', google: 2, meta: 1, direto: 2 }]);
  });

  test('campanha sem nome usa o ID, e sem nada vira "(sem campanha)"', () => {
    const r = agregarOrigem([lead({ gclid: 'a', utm_campaign: '999' }), lead({ gclid: 'b' })], [], -3);
    expect(r.porCampanha.map((c) => c.campanha).sort()).toEqual(['(sem campanha)', '999']);
  });

  test('so numeros: nada de dado pessoal na resposta', () => {
    const r = agregarOrigem([lead({ gclid: 'a' })], [], -3);
    expect(JSON.stringify(r)).not.toMatch(/nome"|phone|telefone|email/);
  });

  test('mais de 30 campanhas: o resto vira "Outras campanhas"', () => {
    const linhas = Array.from({ length: 35 }, (_, i) => lead({ gclid: 'g' + i, utm_campaign: 'c' + i }));
    const r = agregarOrigem(linhas, [], -3);
    expect(r.porCampanha).toHaveLength(31);
    expect(r.porCampanha[30]).toMatchObject({ campanha: 'Outras campanhas', total: 5 });
  });
});
