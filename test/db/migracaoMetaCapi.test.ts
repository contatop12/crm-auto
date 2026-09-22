import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fakeD1 } from '../helpers/fakeD1';

/** As migrations anteriores a 0029, para montar o banco como ele esta' em producao hoje. */
const ANTES = readdirSync('migrations')
  .filter((f) => f.endsWith('.sql') && f < '0029')
  .sort()
  .map((f) => `migrations/${f}`);

describe('migracao 0029 (Meta CAPI)', () => {
  test('ingest_keys passa a aceitar o canal evolution sem perder as chaves de hoje', () => {
    const { exec, consultar } = fakeD1(ANTES);
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(`INSERT INTO ingest_keys (tenant_id, canal, chave, revelada) VALUES (5, 'click', 'k-click', 1)`);

    exec(readFileSync('migrations/0029_meta_capi.sql', 'utf8'));

    exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (5, 'evolution', 'k-evo')`);
    expect(consultar(`SELECT canal, chave FROM ingest_keys ORDER BY canal`)).toEqual([
      { canal: 'click', chave: 'k-click' },
      { canal: 'evolution', chave: 'k-evo' },
    ]);
    expect(() => exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (5, 'outro', 'x')`)).toThrow();
  });

  test('a Taina ganha a frase MA21RMKT da campanha de mensagem', () => {
    const { exec, consultar } = fakeD1(ANTES);
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(readFileSync('migrations/0029_meta_capi.sql', 'utf8'));
    expect(consultar(`SELECT tenant_id, frase, origem, plataforma FROM lead_entry_phrases WHERE frase = 'MA21RMKT'`))
      .toEqual([{ tenant_id: 5, frase: 'MA21RMKT', origem: 'mensagem', plataforma: 'meta' }]);
  });

  test('etapa so aceita LeadSubmitted ou Purchase', () => {
    const { exec } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, meta_evento) VALUES (5, 1, 'Novo Lead', 22, 'LeadSubmitted')`);
    expect(() =>
      exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, meta_evento) VALUES (5, 2, 'X', 23, 'Lead')`),
    ).toThrow();
  });

  test('um clique (ctwa_clid) vira uma atribuicao so por cliente', () => {
    const { exec, consultar } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    const inserir = `INSERT OR IGNORE INTO meta_atribuicoes (tenant_id, phone_key, ctwa_clid) VALUES (5, '7191065853', 'clid-1')`;
    exec(inserir);
    exec(inserir);
    const [a] = consultar<{ n: number; origem: string; recebido_em: string }>(
      `SELECT COUNT(*) AS n, MAX(origem) AS origem, MAX(recebido_em) AS recebido_em FROM meta_atribuicoes`,
    );
    expect(a!.n).toBe(1);
    expect(a!.origem).toBe('evolution');
    expect(a!.recebido_em).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('meta_eventos deduplica por cliente e chave, e cliente novo nasce sem enviar', () => {
    const { exec, consultar } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (5, 3, 9, 'k')`);
    const inserir = `INSERT OR IGNORE INTO meta_eventos (tenant_id, dedupe_key, event_id, canal, event_name, event_at)
                     VALUES (5, 'P-LeadSubmitted', 'P-LeadSubmitted', 'whatsapp', 'LeadSubmitted', '2026-09-22T10:00:00Z')`;
    exec(inserir);
    exec(inserir);
    expect(consultar(`SELECT status, origem FROM meta_eventos`)).toEqual([{ status: 'pendente', origem: 'crm' }]);
    expect(consultar(`SELECT meta_dry_run, meta_token_valido FROM tenant_config`)).toEqual([
      { meta_dry_run: 1, meta_token_valido: 0 },
    ]);
  });
});
