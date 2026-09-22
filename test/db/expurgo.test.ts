import { describe, test, expect } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { expurgarPayloadsAntigos } from '../../src/db/observability';

describe('expurgarPayloadsAntigos', () => {
  test('o pedido e a resposta da Meta somem com 30 dias; o registro do envio fica', async () => {
    const { d1, exec, consultar } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(`INSERT INTO meta_eventos (tenant_id, dedupe_key, event_id, canal, event_name, status, request_payload,
            response_body, event_at, created_at)
          VALUES (5, 'velho', 'velho', 'site', 'LeadSubmitted', 'enviado', '{"client_ip_address":"200.1.2.3"}',
                  '{"events_received":1}', '2026-08-01T10:00:00Z', datetime('now','-31 day')),
                 (5, 'novo', 'novo', 'site', 'LeadSubmitted', 'enviado', '{"client_ip_address":"200.1.2.4"}',
                  '{"events_received":1}', '2026-09-21T10:00:00Z', datetime('now','-1 day'))`);

    expect(await expurgarPayloadsAntigos(d1, 30)).toBe(1);
    expect(consultar('SELECT dedupe_key, status, request_payload, response_body FROM meta_eventos ORDER BY id')).toEqual([
      { dedupe_key: 'velho', status: 'enviado', request_payload: null, response_body: null },
      { dedupe_key: 'novo', status: 'enviado', request_payload: '{"client_ip_address":"200.1.2.4"}', response_body: '{"events_received":1}' },
    ]);
  });
});
