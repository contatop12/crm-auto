import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { avisarLeadNoGrupo } from '../../src/pipelines/kanbanTask';
import type { Env } from '../../src/env';

const BOARD_ADS = 13;
const BOARD_ORGANICO = 14;

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'persianas', 'Persianas', 1)`);
  // quem identifica o cliente e' a URL; o codi_id ficou opcional
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, cw_board_organico_id,
          pulseboard_url, ingest_key)
        VALUES (1, 7, ${BOARD_ADS}, ${BOARD_ORGANICO}, 'https://pulseboard.teste/persianas', 'k')`);
  return { env: { DB: d1 } as unknown as Env, consultar, exec };
}

function task(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 719,
    board_id: BOARD_ADS,
    board_step_id: 50,
    title: 'Conversa #28 - Carol Nunes',
    custom_attributes: { protocolo: 'PERS-1720000000000-ABC' },
    conversations: [{ id: 754, display_id: 28 }],
    contacts: [{ name: 'Carol Nunes', phone_number: '+5511996316799' }],
    ...over,
  });
}

let enviados: Array<Record<string, unknown>>;
let urls: string[];

beforeEach(() => {
  enviados = [];
  urls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    urls.push(String(url));
    enviados.push(JSON.parse(String(init.body)));
    return new Response('ok', { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('avisarLeadNoGrupo', () => {
  test('avisa o grupo quando o card entra no board de Ads', async () => {
    const { env } = cenario();
    const r = await avisarLeadNoGrupo(env, 1, task());

    expect(r.status).toBe('ok');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.nome).toBe('Carol Nunes');
    // sem codi_id no cadastro, o campo nao vai no corpo: mandar vazio faria o
    // Pulseboard tentar rotear por um campo em branco em vez de pela URL
    expect(enviados[0]).not.toHaveProperty('codi_id');
  });

  test('vai para o webhook do cliente, nao para o padrao', async () => {
    const { env } = cenario();
    await avisarLeadNoGrupo(env, 1, task());
    expect(urls[0]).toBe('https://pulseboard.teste/persianas');
  });

  test('codi_id nao sobe nem quando sobrou um no cadastro', async () => {
    // o roteamento por codi_id saiu de uso; mandar um antigo faria o Pulseboard
    // rotear por ele e devolver `rota_nao_mapeada` de novo
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET pulseboard_codi_id = 'CODI-123' WHERE tenant_id = 1`);
    await avisarLeadNoGrupo(env, 1, task());
    expect(enviados[0]).not.toHaveProperty('codi_id');
  });

  test('manda o telefone so com digitos, com DDI e sem mais', async () => {
    const { env } = cenario();
    await avisarLeadNoGrupo(env, 1, task());
    expect(enviados[0]!.telefone).toBe('5511996316799');
  });

  test('nao avisa card do board Organico', async () => {
    const { env } = cenario();
    const r = await avisarLeadNoGrupo(env, 1, task({ board_id: BOARD_ORGANICO }));

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('nao no de Ads');
    expect(enviados).toHaveLength(0);
  });

  test('nao avisa duas vezes o mesmo lead', async () => {
    const { env } = cenario();
    await avisarLeadNoGrupo(env, 1, task());
    const segunda = await avisarLeadNoGrupo(env, 1, task());

    expect(segunda.status).toBe('ignorado');
    expect(segunda.motivo).toContain('ja avisado');
    expect(enviados).toHaveLength(1);
  });

  test('card que sai e volta do board nao avisa de novo', async () => {
    const { env } = cenario();
    await avisarLeadNoGrupo(env, 1, task());
    await avisarLeadNoGrupo(env, 1, task({ board_id: BOARD_ORGANICO }));
    await avisarLeadNoGrupo(env, 1, task());

    expect(enviados).toHaveLength(1);
  });

  test('depois de uma falha, a retentativa envia', async () => {
    const { env } = cenario();
    vi.stubGlobal('fetch', async () => new Response('cai', { status: 500 }));

    const primeira = await avisarLeadNoGrupo(env, 1, task());
    expect(primeira.status).toBe('erro');

    // a fila retenta: agora o Pulseboard responde
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      enviados.push(JSON.parse(String(init.body)));
      return new Response('ok', { status: 200 });
    });

    const segunda = await avisarLeadNoGrupo(env, 1, task());
    expect(segunda.status).toBe('ok');
    expect(enviados).toHaveLength(1);
  });

  test('monta o canal a partir dos dados do clique', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO leads (tenant_id, protocol, nome, quiz_version, gclid, page_url)
          VALUES (1, 'PERS-1720000000000-ABC', 'Carol do Quiz', 'v2', 'Cj0KC', 'https://x.com.br/quiz/v2?a=1')`);

    await avisarLeadNoGrupo(env, 1, task());

    expect(enviados[0]!.Canal).toBe('Campanha de Quiz - Google');
    expect(enviados[0]!.nome).toBe('Carol do Quiz');
    expect(enviados[0]!.URL).toBe('https://x.com.br/quiz/v2');
  });

  test('lead sem clique registrado ainda avisa, com canal generico', async () => {
    const { env } = cenario();
    await avisarLeadNoGrupo(env, 1, task());
    expect(enviados[0]!.Canal).toBe('Campanha de Mensagem - Direto');
  });

  test('cliente sem webhook proprio registra erro em vez de avisar errado', async () => {
    const { env, exec, consultar } = cenario();
    exec('UPDATE tenant_config SET pulseboard_url = NULL WHERE tenant_id = 1');

    const r = await avisarLeadNoGrupo(env, 1, task());

    expect(r.status).toBe('erro');
    expect(enviados).toHaveLength(0);
    expect(consultar<{ erro: string }>('SELECT erro FROM group_notifications')[0]!.erro).toContain(
      'webhook',
    );
  });

  test('sem protocolo, deduplica pelo id da task', async () => {
    const { env, consultar } = cenario();
    await avisarLeadNoGrupo(env, 1, task({ custom_attributes: {} }));
    await avisarLeadNoGrupo(env, 1, task({ custom_attributes: {} }));

    expect(enviados).toHaveLength(1);
    expect(consultar<{ chave: string }>('SELECT chave FROM group_notifications')[0]!.chave).toBe(
      'task:719',
    );
  });

  test('registra o que foi enviado, para a tela mostrar', async () => {
    const { env, consultar } = cenario();
    await avisarLeadNoGrupo(env, 1, task());

    const [linha] = consultar<{ status: string; canal: string; lead_nome: string }>(
      'SELECT status, canal, lead_nome FROM group_notifications',
    );
    expect(linha!.status).toBe('enviado');
    expect(linha!.lead_nome).toBe('Carol Nunes');
    expect(linha!.canal).toContain('Campanha de');
  });
});

describe('aviso desligado por cliente', () => {
  test('cliente com o aviso desligado nao chama o Pulseboard', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET pulseboard_ativo = 0 WHERE tenant_id = 1`);
    const r = await avisarLeadNoGrupo(env, 1, task());
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('desligado');
    expect(enviados).toHaveLength(0);
  });

  test('sem webhook proprio e erro de cadastro: visivel, mas fora da fila', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET pulseboard_url = NULL WHERE tenant_id = 1`);
    const r = await avisarLeadNoGrupo(env, 1, task());
    expect(r.status).toBe('erro');
    expect(r.retentar).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  test('rota nao mapeada nao volta para a fila', async () => {
    const { env } = cenario();
    vi.stubGlobal('fetch', async () => new Response(
      '{"ok":true,"sent":0,"skipped":["lead_index_0: rota_nao_mapeada (page_id=vazio; codi_id=000)"]}',
      { status: 200 },
    ));
    const r = await avisarLeadNoGrupo(env, 1, task());
    expect(r.status).toBe('erro');
    expect(r.retentar).toBe(false);
    expect(r.motivo).toContain('nao tem rota');
  });

  test('Pulseboard fora do ar volta para a fila', async () => {
    const { env } = cenario();
    vi.stubGlobal('fetch', async () => new Response('bad gateway', { status: 502 }));
    const r = await avisarLeadNoGrupo(env, 1, task());
    expect(r.status).toBe('erro');
    expect(r.retentar).not.toBe(false);
  });
});
