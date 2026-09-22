import { describe, test, expect } from 'vitest';
import {
  SEM_NOME, limparNome, nomeUtil, nomeParaExibir, lerNumerosProprios, ehNumeroProprio,
} from '../../src/domain/nomeLead';
import { abasDoLead, montarRegistro } from '../../src/domain/planilha';

// Nomes reais da Geral da Vita (agosto e setembro de 2026)
describe('nome de perfil do WhatsApp', () => {
  test.each([
    ['😊'],
    ['.'],
    ['5519990177608'],
    ['🤜🏼🤛🏼'],
    ['  '],
  ])('%s nao identifica ninguem', (bruto) => {
    expect(nomeUtil(bruto, { telefone: '5519990177608' })).toBeNull();
    expect(nomeParaExibir(bruto, { telefone: '5519990177608' })).toBe(SEM_NOME);
  });

  test('o telefone do proprio lead no lugar do nome nao e nome', () => {
    expect(nomeUtil('+55 19 99936-0206', { telefone: '5519999360206' })).toBeNull();
  });

  test('o perfil da propria empresa nao e lead', () => {
    expect(nomeUtil('Vita Audio Aparelhos Auditivos', { nomesProprios: ['Vita Audio'] })).toBeNull();
    expect(nomeUtil('Vita Áudio', { nomesProprios: ['Vita Audio'] })).toBeNull();
  });

  test('tira emoji e espaco sobrando, sem cortar letra', () => {
    expect(limparNome('Wandenberg (Wando)🤜🏼🤛🏼')).toBe('Wandenberg (Wando)');
    expect(limparNome('ferro & Cia.     Lima')).toBe('ferro & Cia. Lima');
    expect(nomeUtil('Maria Irene Justino De Ol')).toBe('Maria Irene Justino De Ol');
    expect(nomeUtil('Amelia Teles  Kit Boqueirão')).toBe('Amelia Teles Kit Boqueirão');
  });

  test('nome com acento e numero junto continua valendo', () => {
    expect(nomeUtil('Áurea')).toBe('Áurea');
    expect(nomeUtil('João 2')).toBe('João 2');
  });
});

describe('numeros da propria empresa', () => {
  test('le a lista do cadastro e compara pela chave do telefone', () => {
    const proprios = lerNumerosProprios('["5519991460270","5519990177608"]');
    expect(ehNumeroProprio('+5519990177608', proprios)).toBe(true);
    expect(ehNumeroProprio('19990177608', proprios)).toBe(true);
    expect(ehNumeroProprio('+5511984738894', proprios)).toBe(false);
  });

  test('cadastro vazio ou quebrado nao derruba nada', () => {
    expect(lerNumerosProprios(null)).toEqual([]);
    expect(lerNumerosProprios('nao e json')).toEqual([]);
    expect(ehNumeroProprio('+5519990177608', [])).toBe(false);
  });
});

describe('abas da planilha de leads', () => {
  const abas = { geral: 'Geral', google: 'Google Mensagem', meta: null, direto: 'WhatsApp Direto' };

  test('Google vai para a Geral e a Google Mensagem', () => {
    expect(abasDoLead(abas, 'google')).toEqual(['Geral', 'Google Mensagem']);
  });

  test('sem anuncio vai para a Geral e a de lead direto', () => {
    expect(abasDoLead(abas, 'outro')).toEqual(['Geral', 'WhatsApp Direto']);
  });

  test('cliente sem aba de lead direto fica so com a Geral, como antes', () => {
    expect(abasDoLead({ geral: 'Geral', google: 'Google Mensagem', meta: null }, 'outro')).toEqual(['Geral']);
  });

  test('formulario sem anuncio nao entra em nenhuma (a automacao do form grava)', () => {
    expect(abasDoLead(abas, 'outro', 'formulario')).toEqual([]);
  });
});

describe('registro da planilha: nome e canal', () => {
  const ctx = { tipo: 'entrada' as const, cliente: 'Vita Audio', protocolo: 'VITA-X', ensaio: false };

  test('nome ruim com telefone vira o aviso claro, na planilha e no Banco', () => {
    const r = montarRegistro(ctx, { nome: '😊', phone_e164: '+5511954687762', gclid: 'Cj0' });
    expect(r.nome).toBe(SEM_NOME);
    expect(r.cliques.lead_name).toBe(SEM_NOME);
  });

  test('clique sem conversa fica sem nome, nao com o aviso', () => {
    const r = montarRegistro(ctx, { gclid: 'Cj0' });
    expect(r.nome).toBe('');
    expect(r.cliques.lead_name).toBe('');
  });

  test('protocolo do site sem anuncio nao diz "Campanha ... - Direto"', () => {
    const r = montarRegistro(ctx, { phone_e164: '+5511996083369', origem: 'clique', evento: 'whatsapp_click' });
    expect(r.canal).toBe('Mensagem Direta (site)');
  });

  test('Google continua "Campanha de Mensagem - Google"', () => {
    const r = montarRegistro(ctx, { phone_e164: '+5511996083369', gclid: 'Cj0' });
    expect(r.canal).toBe('Campanha de Mensagem - Google');
  });
});
