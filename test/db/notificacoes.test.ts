import { describe, test, expect } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { listarNotificacoes, resolverNotificacao } from '../../src/db/notificacoes';
import { resumoPorTenant } from '../../src/db/observability';
import type { Env } from '../../src/env';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (4, 'locadora', 'Locadora', 1), (5, 'taina', 'Taina', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key, cw_webhook_secret, pulseboard_ativo, pulseboard_url)
        VALUES (4, 5, 9, 'k4', 's', 1, 'https://p/l'), (5, 4, 5, 'k5', 's', 1, 'https://p/t')`);
  for (const t of [4, 5]) {
    exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id) VALUES (${t}, 1, 'Novo Lead', ${t * 10})`);
    exec(`INSERT INTO stage_triggers (tenant_id, stage_id, frase) VALUES (${t}, (SELECT id FROM funnel_stages WHERE tenant_id = ${t}), 'oi')`);
  }
  exec(`INSERT INTO events (id, tenant_id, source, event_type, payload, status, motivo, received_at)
        VALUES (1, 4, 'kanban', 'kanban_conversao', '{}', 'erro', 'EXATID-MTLP62G0RIVB: "Oportunidade Ganha" sem valor da venda', datetime('now','-3 hour')),
               (2, 5, 'kanban', 'kanban_conversao', '{}', 'erro', 'TAINA-MTLH789J6AVC-proposta_enviada: Data Manager 400', datetime('now','-3 hour')),
               (3, 4, 'chatwoot', 'message_incoming', '{}', 'ok', NULL, datetime('now','-1 hour'))`);
  let kv: string | null = null;
  const env = {
    DB: d1,
    CACHE: { get: async () => (kv ? JSON.parse(kv) : null), put: async (_k: string, v: string) => { kv = v; } },
  } as unknown as Env;
  return { env, exec, consultar };
}

describe('central de notificacoes', () => {
  test('lista os dois erros de 21/09, cada um no seu cliente', async () => {
    const { env } = cenario();
    const n = await listarNotificacoes(env);
    expect(n.filter((x) => x.origem === 'evento').map((x) => x.cliente).sort()).toEqual(['Locadora', 'Taina']);
  });

  test('resolver tira da central E do cartao do cliente, sem apagar o evento', async () => {
    const { env, consultar } = cenario();
    const antes = (await resumoPorTenant(env.DB)).find((t) => t.slug === 'locadora')!;
    expect(antes.ultimo_erro_motivo).toContain('sem valor');

    const n = (await listarNotificacoes(env)).find((x) => x.cliente === 'Locadora' && x.origem === 'evento')!;
    const r = await resolverNotificacao(env, n.chave, n.ids, 'ryan@p12');
    expect(r.resolvidos).toBe(1);

    expect((await listarNotificacoes(env)).some((x) => x.cliente === 'Locadora' && x.origem === 'evento')).toBe(false);
    const depois = (await resumoPorTenant(env.DB)).find((t) => t.slug === 'locadora')!;
    expect(depois.ultimo_erro_motivo).toBeNull();
    expect(depois.erros_24h).toBe(0);
    expect(consultar('SELECT status, resolvido_por FROM events WHERE id = 1')[0]).toEqual({ status: 'erro', resolvido_por: 'ryan@p12' });
  });

  test('id que nao e erro em aberto nao muda nada', async () => {
    const { env } = cenario();
    expect((await resolverNotificacao(env, 'ev:4:x', [3, 999], 'x')).resolvidos).toBe(0);
  });

  test('conversao que ja subiu nao aparece, mesmo sem o evento marcado', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO conversions (tenant_id, dedupe_key, protocol, conversion_event, status, validate_only, sent_at)
          VALUES (5, 'TAINA-MTLH789J6AVC-proposta_enviada', 'TAINA-MTLH789J6AVC', 'proposta_enviada', 'enviado', 0, datetime('now'))`);
    expect((await listarNotificacoes(env)).some((x) => x.cliente === 'Taina' && x.origem === 'evento')).toBe(false);
  });

  test('aviso de configuracao dispensado nao volta', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET pulseboard_ativo = 0 WHERE tenant_id = 5`);
    const aviso = (await listarNotificacoes(env)).find((x) => x.chave === 'cfg:5:pulseboard-off')!;
    expect(aviso.tipo).toBe('aviso');
    await resolverNotificacao(env, aviso.chave, undefined, 'x');
    expect((await listarNotificacoes(env)).some((x) => x.chave === 'cfg:5:pulseboard-off')).toBe(false);
  });

  test('queda do WhatsApp confirmada pelo vigia aparece como erro', async () => {
    const { env } = cenario();
    await env.CACHE.put('vigia:whatsapp', JSON.stringify({ 'Exatidão 02': { tipo: 'caixa', desde: Date.now() - 3600e3, vezes: 2, avisadoEm: Date.now(), rotulo: 'Locadora · Exatidão 02', texto: 'a caixa sumiu' } }));
    const n = (await listarNotificacoes(env)).find((x) => x.origem === 'whatsapp')!;
    expect(n.tipo).toBe('erro');
    expect(n.detalhe).toBe('a caixa sumiu');
  });
});
