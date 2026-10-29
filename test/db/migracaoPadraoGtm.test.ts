import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fakeD1 } from '../helpers/fakeD1';
import { lerModelo, planejarGtm, remapearGatilhos, indiceDeGatilhos } from '../../src/domain/gtm';

const MIGRATION = readFileSync('migrations/0037_padrao_gtm_window_open.sql', 'utf8');
/** As migrations anteriores a 0037: o banco como ele esta' em producao hoje. */
const ANTES = readdirSync('migrations')
  .filter((f) => f.endsWith('.sql') && f < '0037')
  .sort()
  .map((f) => `migrations/${f}`);

const semGancho = JSON.stringify({ containerVersion: { tag: [{ name: 'velho' }] } });

function banco(json: string) {
  const d = fakeD1(ANTES);
  d.exec(`INSERT INTO padrao_gtm (id, nome, json) VALUES (1, 'P12 - MODELO', '${json.replace(/'/g, "''")}')`);
  return d;
}

describe('migracao 0037 (modelo do GTM com window.open)', () => {
  test('o modelo passa a ter o gancho e o gatilho p12_whatsapp_open no coletor', () => {
    const { exec, consultar } = banco(semGancho);
    exec(MIGRATION);
    const modelo = lerModelo((consultar(`SELECT json FROM padrao_gtm WHERE id = 1`)[0] as { json: string }).json);

    const gatilho = modelo.trigger.find((t) => t.name === 'P12 - WhatsApp aberto por script')!;
    expect(gatilho.type).toBe('CUSTOM_EVENT');
    expect(JSON.stringify(gatilho)).toContain('p12_whatsapp_open');

    const coletor = modelo.tag.find((t) => t.name === 'P12 | Collector - WhatsApp Click')!;
    expect(coletor.firingTriggerId).toEqual(['210', String(gatilho.triggerId)]);

    const decorador = modelo.tag.find((t) => t.name === 'P12 | WhatsApp - Injetar Protocolo no Link')!;
    const html = decorador.parameter!.find((p) => p.key === 'html')!.value!;
    expect(html).toContain('joinchat:open');
    expect(html).toContain('window.open=function');
    expect(html).toContain('p12_whatsapp_open');
  });

  test('cliente novo recebe o gatilho e o coletor aponta para ele pelo nome', () => {
    const { exec, consultar } = banco(semGancho);
    exec(MIGRATION);
    const modelo = lerModelo((consultar(`SELECT json FROM padrao_gtm WHERE id = 1`)[0] as { json: string }).json);
    const vazio = { templates: [], variaveis: [], gatilhos: [], tags: [], builtIn: [] };
    const plano = planejarGtm(modelo, vazio, { prefixo: 'VITA', clientId: 'p12-vita', collectUrl: 'https://x/y' });
    expect(plano.gatilhosACriar.map((g) => g.name)).toContain('P12 - WhatsApp aberto por script');

    const ids = new Map(plano.gatilhosACriar.map((g, i) => [String(g.name).toLowerCase(), `novo${i}`]));
    const coletor = plano.tagsACriar.find((t) => t.name === 'P12 | Collector - WhatsApp Click')!;
    const criado = remapearGatilhos(coletor, ids, indiceDeGatilhos(modelo));
    expect(criado.firingTriggerId).toHaveLength(2);
    expect((criado.firingTriggerId as string[]).every((i) => i.startsWith('novo'))).toBe(true);
  });

  test('rodar de novo, ou com o gancho ja no modelo, nao reescreve', () => {
    const jaTem = JSON.stringify({ marca: 'p12_whatsapp_open' });
    const { exec, consultar } = banco(jaTem);
    exec(MIGRATION);
    expect(consultar(`SELECT json FROM padrao_gtm WHERE id = 1`)).toEqual([{ json: jaTem }]);
  });
});
