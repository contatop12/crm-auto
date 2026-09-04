import { describe, test, expect } from 'vitest';
import { conferirNoChatwoot, conferirNoGtm, type RegraWebhook } from '../../src/domain/conferencia';

const ENTRADA = 'https://crm.sitespdoze.com.br/ingest/persianas/kanban?k=ABC123';
const CONVERSAO = 'https://crm.sitespdoze.com.br/ingest/persianas/kanban?k=ABC123&evento=conversao';

const regra = (nome: string, url: string, ativa = true): RegraWebhook => ({ nome, ativa, urls: [url] });

describe('conferirNoChatwoot', () => {
  test('regra ativa apontando para o endereco certo', () => {
    const r = conferirNoChatwoot(ENTRADA, [regra('[PAINEL] Lead novo no funil', ENTRADA)]);
    expect(r.estado).toBe('ok');
    expect(r.detalhe).toContain('[PAINEL] Lead novo no funil');
  });

  test('sem regra nenhuma: nao esta configurado', () => {
    const r = conferirNoChatwoot(ENTRADA, []);
    expect(r.estado).toBe('falta');
    expect(r.detalhe).toContain('nenhuma regra');
  });

  test('a regra de conversao NAO conta como a de entrada', () => {
    // as duas so' diferem pelo `&evento=conversao`; casar por prefixo daria
    // a entrada como configurada quando so' a conversao existe
    const r = conferirNoChatwoot(ENTRADA, [regra('Evento Compra', CONVERSAO)]);
    expect(r.estado).toBe('falta');
  });

  test('a regra de entrada NAO conta como a de conversao', () => {
    const r = conferirNoChatwoot(CONVERSAO, [regra('[PAINEL] Lead novo no funil', ENTRADA)]);
    expect(r.estado).toBe('falta');
  });

  test('varias regras ativas no mesmo endereco sao todas listadas', () => {
    const r = conferirNoChatwoot(CONVERSAO, [
      regra('Evento Qualificado 1', CONVERSAO),
      regra('Evento Compra', CONVERSAO),
    ]);
    expect(r.estado).toBe('ok');
    expect(r.detalhe).toContain('Evento Qualificado 1');
    expect(r.detalhe).toContain('Evento Compra');
  });

  test('chave antiga e o erro que se parece com "nunca recebeu"', () => {
    // o endereco existe na regra, o Chatwoot dispara, e o Worker devolve 401.
    // Sem apontar isso, a tela mostra "nunca recebeu" e ninguem sabe por que.
    const r = conferirNoChatwoot(ENTRADA, [
      regra('[PAINEL] Lead novo no funil', 'https://crm.sitespdoze.com.br/ingest/persianas/kanban?k=CHAVE-VELHA'),
    ]);
    expect(r.estado).toBe('erro');
    expect(r.detalhe).toContain('chave');
  });

  test('regra certa porem desligada', () => {
    const r = conferirNoChatwoot(ENTRADA, [regra('[PAINEL] Lead novo no funil', ENTRADA, false)]);
    expect(r.estado).toBe('erro');
    expect(r.detalhe).toContain('desligada');
  });

  test('uma ativa certa perdoa outra desligada', () => {
    const r = conferirNoChatwoot(ENTRADA, [
      regra('velha', ENTRADA, false),
      regra('[PAINEL] Lead novo no funil', ENTRADA, true),
    ]);
    expect(r.estado).toBe('ok');
  });

  test('a ordem dos parametros na URL nao importa', () => {
    const trocada = 'https://crm.sitespdoze.com.br/ingest/persianas/kanban?evento=conversao&k=ABC123';
    expect(conferirNoChatwoot(CONVERSAO, [regra('Evento Compra', trocada)]).estado).toBe('ok');
  });

  test('endereco apontando para outro cliente nao conta', () => {
    const outro = 'https://crm.sitespdoze.com.br/ingest/vita/kanban?k=ABC123';
    expect(conferirNoChatwoot(ENTRADA, [regra('x', outro)]).estado).toBe('falta');
  });

  test('regra com varias acoes de webhook: basta uma casar', () => {
    const r = conferirNoChatwoot(ENTRADA, [
      { nome: 'Mista', ativa: true, urls: ['https://outro.servico/hook', ENTRADA] },
    ]);
    expect(r.estado).toBe('ok');
  });
});

describe('conferirNoGtm', () => {
  const ESPERADA = 'https://crm.sitespdoze.com.br/ingest/persianas/click?k=ABC123';

  test('a constante aponta para o endereco certo', () => {
    expect(conferirNoGtm(ESPERADA, ESPERADA).estado).toBe('ok');
  });

  test('constante ainda com o exemplo do modelo', () => {
    const r = conferirNoGtm(ESPERADA, 'https://SEU-N8N/webhook/COLE-AQUI');
    expect(r.estado).toBe('erro');
    expect(r.detalhe).toContain('modelo');
  });

  test('constante apontando para o n8n antigo', () => {
    const r = conferirNoGtm(ESPERADA, 'https://n8n.sitespdoze.com.br/webhook/persianas-click');
    expect(r.estado).toBe('erro');
    // e' o pior caso: o container coleta, e os cliques vao para o fluxo desligado
    expect(r.detalhe).toContain('outro endereço');
  });

  test('chave antiga na constante', () => {
    const r = conferirNoGtm(ESPERADA, 'https://crm.sitespdoze.com.br/ingest/persianas/click?k=VELHA');
    expect(r.estado).toBe('erro');
    expect(r.detalhe).toContain('chave');
  });

  test('constante que nao existe no container', () => {
    const r = conferirNoGtm(ESPERADA, null);
    expect(r.estado).toBe('falta');
    expect(r.detalhe).toContain('não existe');
  });

  test('constante vazia', () => {
    const r = conferirNoGtm(ESPERADA, '   ');
    expect(r.estado).toBe('falta');
  });
});
