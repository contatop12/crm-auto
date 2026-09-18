import { describe, test, expect } from 'vitest';
import { CAMPOS_PLANILHA, montarRegistro, dataHoraBrasilia, urlDoWebhook, montarLinhaPorCabecalho, campoDaColunaLeads, linhaDeLeads, idDaPlanilha, indiceParaColuna, jaTemTelefone } from '../../src/domain/planilha';

const lead = {
  nome: 'Amanda Constantino',
  email: 'amanda@teste.com',
  phone_e164: '+5511971036500',
  gclid: 'Cj0KCQ',
  gbraid: '0AAAA',
  wbraid: null,
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'cortinas_blackout',
  utm_id: '23513049590',
  utm_term: 'cortina blackout',
  utm_content: 'grupo_1',
  fbp: 'fb.2.1',
  fbc: null,
  client_id: 'persianas',
  origem: 'clique',
  evento: 'whatsapp_click',
  page_url: 'https://persianaspaulista.com.br/cortinas?gclid=Cj0KCQ',
  whatsapp_url: 'https://wa.me/551140000000',
  referrer: 'https://www.google.com/',
  user_agent: 'Mozilla/5.0',
  quiz_version: null,
  quiz_valor: null,
  quiz_form_id: null,
  valor_proposta: null,
  // 2026-09-09 17:00:00 UTC = 14:00:00 em Brasilia
  created_at: '2026-09-09 17:00:00',
};

const conversao = {
  tipo: 'conversao' as const,
  cliente: 'Persianas Paulista',
  protocolo: 'PERSI-MTN0F6ANNIUP',
  ensaio: false,
  conversao: {
    evento: 'conversa',
    etapa: 'Novo Lead',
    valor: null,
    moeda: 'BRL',
    // 2026-09-09 17:32:05 UTC = 14:32:05 em Brasilia
    quando: Date.UTC(2026, 8, 9, 17, 32, 5),
    acao: '7712794954',
    requestId: 'req-1',
    match: 'click_id+user_data',
    enviadoEm: Date.UTC(2026, 8, 9, 17, 32, 7),
  },
};

const clique = {
  tipo: 'clique' as const,
  cliente: 'Persianas Paulista',
  protocolo: 'PERSI-MTN0F6ANNIUP',
  ensaio: false,
};

describe('dataHoraBrasilia', () => {
  test('data e hora no fuso de Brasilia', () => {
    expect(dataHoraBrasilia(Date.UTC(2026, 8, 9, 17, 32, 5))).toEqual({
      data: '09/09/2026',
      hora: '14:32:05',
      timestamp: '09/09/2026 14:32:05',
    });
  });

  test('antes das 3h UTC ainda e o dia anterior em Brasilia', () => {
    expect(dataHoraBrasilia(Date.UTC(2026, 8, 10, 1, 0, 0)).data).toBe('09/09/2026');
  });
});

describe('montarRegistro — planilha de leads', () => {
  test('traz cada campo que a tela promete', () => {
    const r = montarRegistro(conversao, lead);
    for (const { campo } of CAMPOS_PLANILHA) expect(r).toHaveProperty(campo);
  });

  test('data e hora sao as do clique, quando o lead chegou', () => {
    const r = montarRegistro(conversao, lead);
    expect(r.data).toBe('09/09/2026');
    expect(r.hora).toBe('14:00:00');
  });

  test('sem data do clique, usa a da conversao', () => {
    expect(montarRegistro(conversao, { ...lead, created_at: null }).hora).toBe('14:32:05');
  });

  test('telefone vai so com digitos, como a planilha ja usava', () => {
    expect(montarRegistro(conversao, lead).telefone).toBe('5511971036500');
  });

  test('link do WhatsApp aponta para o numero do lead', () => {
    expect(montarRegistro(conversao, lead).link_whatsapp).toBe('https://wa.me/5511971036500');
  });

  test('pagina e o caminho, sem dominio e sem parametros', () => {
    expect(montarRegistro(conversao, lead).pagina).toBe('/cortinas');
  });

  test('canal diz de onde o lead veio', () => {
    expect(montarRegistro(conversao, lead).canal).toBe('Campanha de Mensagem - Google');
  });

  test('valor com moeda quando existe, vazio quando nao', () => {
    expect(montarRegistro(conversao, lead).valor).toBe('');
    const comValor = { ...conversao, conversao: { ...conversao.conversao, valor: 2028 } };
    expect(montarRegistro(comValor, lead).valor).toBe('BRL 2028');
  });

  test('lead sem dado vira texto vazio, nunca "null"', () => {
    const r = montarRegistro(conversao, null);
    expect(r.nome).toBe('');
    expect(r.telefone).toBe('');
    expect(r.link_whatsapp).toBe('');
    expect(JSON.stringify(r)).not.toContain('null');
  });

  test('ensaio e teste sao sinalizados para o n8n poder filtrar', () => {
    const r = montarRegistro({ ...conversao, ensaio: true }, lead);
    expect(r.ensaio).toBe(true);
    expect(r.teste).toBe(false);
  });
});

describe('montarRegistro — banco de dados, aba Cliques', () => {
  test('usa os nomes de coluna do Banco de Dados', () => {
    const c = montarRegistro(clique, lead).cliques;
    expect(c).toMatchObject({
      protocol: 'PERSI-MTN0F6ANNIUP',
      lead_name: 'Amanda Constantino',
      gclid: 'Cj0KCQ',
      utm_id: '23513049590',
      page_url: 'https://persianaspaulista.com.br/cortinas?gclid=Cj0KCQ',
      origem: 'clique',
      event: 'whatsapp_click',
      valido: 'TRUE',
    });
  });

  test('telefone sem o 55, como a aba sempre guardou', () => {
    expect(montarRegistro(clique, lead).cliques.phone_number).toBe('11971036500');
  });

  test('created_at no formato de Brasilia que a aba usa', () => {
    expect(montarRegistro(clique, lead).cliques.created_at).toBe('09/09/2026 14:00:00');
  });

  test('status: pendente no clique, a etapa depois da conversao', () => {
    expect(montarRegistro(clique, lead).cliques.status).toBe('pendente');
    expect(montarRegistro(conversao, lead).cliques.status).toBe('Novo Lead');
  });

  test('protocolo nunca vai vazio: e a chave que casa a linha', () => {
    expect(montarRegistro(clique, null).cliques.protocol).toBe('PERSI-MTN0F6ANNIUP');
  });
});

describe('montarRegistro — banco de dados, aba Conversoes', () => {
  test('so existe quando e conversao', () => {
    expect(montarRegistro(clique, lead).conversoes).toBeNull();
  });

  test('protocol da aba e a chave de dedup, protocolo + evento', () => {
    expect(montarRegistro(conversao, lead).conversoes?.protocol).toBe('PERSI-MTN0F6ANNIUP-conversa');
  });

  test('traz o que o Google recebeu e respondeu', () => {
    expect(montarRegistro(conversao, lead).conversoes).toMatchObject({
      event_type: 'conversa',
      conversion_action: '7712794954',
      conversion_time: '2026-09-09T17:32:05.000Z',
      qualified_at: '2026-09-09T17:32:05.000Z',
      google_ads_uploaded_at: '2026-09-09T17:32:07.000Z',
      click_created_at: '09/09/2026 14:00:00',
      request_id: 'req-1',
      status: 'enviado',
      phone_number: '11971036500',
    });
  });

  test('match_type no vocabulario antigo da aba', () => {
    expect(montarRegistro(conversao, lead).conversoes?.match_type).toBe('gclid');
    const semClique = { ...conversao, conversao: { ...conversao.conversao, match: 'user_data_only' } };
    expect(montarRegistro(semClique, lead).conversoes?.match_type).toBe('enhanced_only');
  });
});

describe('urlDoWebhook', () => {
  test('aceita https', () => {
    expect(urlDoWebhook(' https://n8n.exemplo.com/webhook/abc ')).toBe('https://n8n.exemplo.com/webhook/abc');
  });

  test('recusa http: o corpo leva nome e telefone do lead', () => {
    expect(urlDoWebhook('http://n8n.exemplo.com/webhook/abc')).toBeNull();
  });

  test('recusa o que nao e URL', () => {
    expect(urlDoWebhook('')).toBeNull();
    expect(urlDoWebhook(null)).toBeNull();
    expect(urlDoWebhook('n8n.exemplo.com/webhook')).toBeNull();
  });
});

describe('escrita direta: linha pelo cabecalho', () => {
  const cab = ['protocol', 'lead_name', 'Observação', 'phone_number'];

  test('cada dado vai para a coluna de mesmo nome', () => {
    expect(montarLinhaPorCabecalho(cab, { protocol: 'P-1', lead_name: 'Ana', phone_number: '11999' }))
      .toEqual(['P-1', 'Ana', '', '11999']);
  });

  test('na atualizacao, coluna sem dado nosso mantem o que o time escreveu', () => {
    const atual = ['P-1', 'Ana antiga', 'ligar de tarde', '11888'];
    expect(montarLinhaPorCabecalho(cab, { protocol: 'P-1', lead_name: 'Ana', phone_number: '' }, atual))
      .toEqual(['P-1', 'Ana', 'ligar de tarde', '11888']);
  });

  test('cabecalho com espaco ou maiuscula ainda casa', () => {
    expect(montarLinhaPorCabecalho([' Protocol '], { protocol: 'P-1' })).toEqual(['P-1']);
  });
});

describe('escrita direta: colunas da planilha de leads', () => {
  test('reconhece os nomes que os clientes usam', () => {
    expect(campoDaColunaLeads('Link do WhatsApp')).toBe('link_whatsapp');
    expect(campoDaColunaLeads('Link do Whatsapp')).toBe('link_whatsapp');
    expect(campoDaColunaLeads('URL WHATSAPP')).toBe('link_whatsapp');
    expect(campoDaColunaLeads('DATA')).toBe('data');
    expect(campoDaColunaLeads('Página')).toBe('pagina');
    expect(campoDaColunaLeads('Canal de Anuncio')).toBe('canal');
    expect(campoDaColunaLeads('EMAIL')).toBe('email');
  });

  test('coluna do time fica de fora', () => {
    expect(campoDaColunaLeads('Qualidade do Lead')).toBeNull();
    expect(campoDaColunaLeads('Comprou aparelho?')).toBeNull();
  });

  test('linha da planilha de leads sai do registro pelo cabecalho', () => {
    const r = montarRegistro(conversao, lead);
    expect(linhaDeLeads(['Link do WhatsApp', 'DATA', 'HORA', 'NOME', 'TELEFONE', 'Status'], r))
      .toEqual(['https://wa.me/5511971036500', '09/09/2026', '14:00:00', 'Amanda Constantino', '5511971036500', '']);
  });
});

describe('idDaPlanilha e colunas', () => {
  test('aceita a URL inteira ou so o id', () => {
    const ID = '1tRG6GA_L2UqJVEkoriZ5Hm8oYXeNIvw8RooYPWSKhPM';
    expect(idDaPlanilha(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
    expect(idDaPlanilha(ID)).toBe(ID);
    expect(idDaPlanilha('nao e planilha')).toBeNull();
  });

  test('indice vira letra de coluna', () => {
    expect(indiceParaColuna(0)).toBe('A');
    expect(indiceParaColuna(25)).toBe('Z');
    expect(indiceParaColuna(26)).toBe('AA');
  });
});

describe('planilha de leads: uma linha por lead', () => {
  test('acha o telefone em qualquer formato que a planilha tenha', () => {
    const coluna = ['https://wa.me/5511971036500', '', '(11) 98888-7777'];
    expect(jaTemTelefone(coluna, '5511971036500')).toBe(true);
    expect(jaTemTelefone(coluna, '11988887777')).toBe(true);
  });

  test('nono digito e DDI nao atrapalham', () => {
    expect(jaTemTelefone(['1171036500'], '5511971036500')).toBe(true);
  });

  test('telefone novo nao esta na planilha', () => {
    expect(jaTemTelefone(['5511971036500'], '5521999990000')).toBe(false);
  });

  test('sem telefone nao ha como saber: nao bloqueia', () => {
    expect(jaTemTelefone(['5511971036500'], '')).toBe(false);
  });
});
