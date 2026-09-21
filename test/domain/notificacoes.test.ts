import { describe, test, expect } from 'vitest';
import {
  agruparErros,
  avisosDeConfiguracao,
  avisosDoVigia,
  chaveDoErro,
  normalizarMotivo,
  ordenar,
  type ConfigCliente,
  type ErroEvento,
} from '../../src/domain/notificacoes';

const erro = (over: Partial<ErroEvento> = {}): ErroEvento => ({
  id: 1,
  tenant_id: 5,
  cliente: 'Taina Aci',
  source: 'kanban',
  event_type: 'kanban_conversao',
  motivo: 'TAINA-MTLH789J6AVC-proposta_enviada: Data Manager 400: There was a problem with the request.',
  received_at: '2026-09-21 17:52:33',
  ...over,
});

describe('normalizarMotivo e chaveDoErro', () => {
  test('o protocolo sai do texto para erros iguais virarem um so', () => {
    expect(normalizarMotivo('TAINA-MTLH789J6AVC-proposta_enviada: Data Manager 400')).toBe('…: Data Manager #');
    expect(normalizarMotivo('EXATID-MTLP62G0RIVB: "Oportunidade Ganha" sem valor')).toBe('…: "Oportunidade Ganha" sem valor');
  });
  test('acha a chave da conversao no comeco do erro', () => {
    expect(chaveDoErro('TAINA-MTLH789J6AVC-proposta_enviada: Data Manager 400')).toBe('TAINA-MTLH789J6AVC-proposta_enviada');
    expect(chaveDoErro('EXATID-MTLP62G0RIVB: sem valor')).toBeNull();
    expect(chaveDoErro(null)).toBeNull();
  });
});

describe('agruparErros', () => {
  test('o mesmo erro em protocolos diferentes vira uma notificacao com a contagem', () => {
    const n = agruparErros(
      [
        erro({ id: 1, received_at: '2026-09-21 10:00:00' }),
        erro({ id: 2, motivo: 'TAINA-ABCDEF12345-proposta_enviada: Data Manager 400: There was a problem with the request.', received_at: '2026-09-21 12:00:00' }),
      ],
      new Set(),
    );
    expect(n).toHaveLength(1);
    expect(n[0]!.quantidade).toBe(2);
    expect(n[0]!.ids).toEqual([1, 2]);
    expect(n[0]!.quando).toBe('2026-09-21 12:00:00');
    expect(n[0]!.titulo).toContain('Google Ads');
    expect(n[0]!.aba).toBe('google');
  });

  test('clientes diferentes nao se misturam', () => {
    expect(agruparErros([erro({ id: 1 }), erro({ id: 2, tenant_id: 4, cliente: 'Locadora' })], new Set())).toHaveLength(2);
  });

  test('conversao que ja subiu num reenvio sai da lista', () => {
    const n = agruparErros([erro()], new Set(['5:TAINA-MTLH789J6AVC-proposta_enviada']));
    expect(n).toEqual([]);
  });

  test('a mesma chave em outro cliente nao esconde o erro', () => {
    expect(agruparErros([erro()], new Set(['4:TAINA-MTLH789J6AVC-proposta_enviada']))).toHaveLength(1);
  });

  test('titulo pelo tipo do erro', () => {
    const t = (o: Partial<ErroEvento>) => agruparErros([erro(o)], new Set())[0]!.titulo;
    expect(t({ motivo: 'Pulseboard respondeu 500' })).toContain('grupo');
    expect(t({ event_type: 'assinatura_invalida', source: 'chatwoot', motivo: 'header ausente' })).toContain('assinatura');
    expect(t({ event_type: 'message_incoming', source: 'chatwoot', motivo: 'x' })).toContain('lead');
  });
});

const cfg = (over: Partial<ConfigCliente> = {}): ConfigCliente => ({
  tenant_id: 6, cliente: 'Tile Servicos', validate_only: 0, pulseboard_ativo: 1, pulseboard_url: 'https://p/x',
  tem_segredo: 1, cw_account_id: 3, ga_customer_id: '5569751788', etapas: 6, etapas_com_meta: 4, gatilhos: 2, ...over,
});

describe('avisosDeConfiguracao', () => {
  test('cliente completo nao gera aviso', () => {
    expect(avisosDeConfiguracao([cfg()], '')).toEqual([]);
  });
  test('a Tile de hoje: sem Pulseboard e sem gatilhos, dois avisos dispensaveis', () => {
    const n = avisosDeConfiguracao([cfg({ pulseboard_ativo: 0, gatilhos: 0 })], '');
    expect(n.map((x) => x.chave)).toEqual(['cfg:6:pulseboard-off', 'cfg:6:gatilhos']);
    expect(n.every((x) => x.tipo === 'aviso')).toBe(true);
  });
  test('sem webhook e erro: nenhuma conversa chega', () => {
    const n = avisosDeConfiguracao([cfg({ tem_segredo: 0 })], '');
    expect(n[0]!.tipo).toBe('erro');
  });
  test('modo sombra e etapas sem meta', () => {
    const n = avisosDeConfiguracao([cfg({ validate_only: 1, etapas_com_meta: 0 })], '');
    expect(n.map((x) => x.chave)).toEqual(['cfg:6:sombra', 'cfg:6:metas']);
  });
});

describe('avisosDoVigia', () => {
  test('so queda confirmada e em aberto', () => {
    const n = avisosDoVigia({
      'Exatidão 02': { tipo: 'caixa', desde: Date.parse('2026-09-18T12:00:00Z'), vezes: 3, avisadoEm: 1, rotulo: 'Locadora · Exatidão 02', texto: 'a caixa sumiu' },
      'Exatidão 03': { tipo: 'entrega', desde: 1, vezes: 1, avisadoEm: null },
      'Vita Audio': { tipo: 'entrega', desde: 1, vezes: 4, avisadoEm: 1, resolvidoEm: 2 },
    });
    expect(n).toHaveLength(1);
    expect(n[0]!.detalhe).toBe('a caixa sumiu');
    expect(n[0]!.chave).toBe(`wa:Exatidão 02:caixa:${Date.parse('2026-09-18T12:00:00Z')}`);
    expect(n[0]!.quando).toBe('2026-09-18 12:00:00');
  });
});

describe('ordenar', () => {
  test('erros primeiro, mais recente antes', () => {
    const base = { origem: 'evento' as const, tenant_id: 1, cliente: 'x', titulo: 't', detalhe: 'd', quantidade: 1, aba: null };
    const o = ordenar([
      { ...base, chave: 'a', tipo: 'aviso', quando: '2026-09-21 20:00:00' },
      { ...base, chave: 'b', tipo: 'erro', quando: '2026-09-20 10:00:00' },
      { ...base, chave: 'c', tipo: 'erro', quando: '2026-09-21 10:00:00' },
    ]);
    expect(o.map((x) => x.chave)).toEqual(['c', 'b', 'a']);
  });
});
