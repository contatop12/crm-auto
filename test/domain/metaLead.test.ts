import { describe, test, expect } from 'vitest';
import { parseMetaLead, protocoloMeta } from '../../src/domain/metaLead';

/** Corpo no formato que o Meta manda no `leadgen`, achatado pela automação. */
const cru = {
  leadgen_id: '1234567890',
  form_id: '987654',
  campaign_name: 'Persianas | Blackout | SP',
  adset_name: 'Interesse - Decoração',
  ad_name: 'Video 15s',
  full_name: 'Amanda Constantino',
  phone_number: '+55 11 97103-6500',
  email: 'Amanda.Constantino@Gmail.com',
};

describe('parseMetaLead', () => {
  test('le os campos do formulario nativo', () => {
    const r = parseMetaLead(cru);
    expect(r).toMatchObject({
      leadgenId: '1234567890',
      nome: 'Amanda Constantino',
      telefone: '+5511971036500',
      // o gmail ignora pontos, entao `normEmail` canoniza: e' o que faz o
      // mesmo endereco casar escrito de duas formas
      email: 'amandaconstantino@gmail.com',
      campanha: 'Persianas | Blackout | SP',
    });
  });

  test('o telefone vira E.164 e ganha a chave de casamento', () => {
    // é por esta chave que o lead do formulário encontra a conversa do WhatsApp
    const r = parseMetaLead(cru);
    expect(r!.telefone).toBe('+5511971036500');
    expect(r!.phoneKey).toBe('11971036500'.slice(0, 2) + '971036500'.slice(-8));
  });

  test('aceita o formato aninhado do webhook do Meta', () => {
    // o Meta manda `field_data: [{name, values}]`; a automação pode repassar cru
    const r = parseMetaLead({
      leadgen_id: '55',
      field_data: [
        { name: 'full_name', values: ['João Silva'] },
        { name: 'phone_number', values: ['11988887777'] },
        { name: 'email', values: ['joao@teste.com'] },
      ],
    });
    expect(r).toMatchObject({ nome: 'João Silva', email: 'joao@teste.com' });
    expect(r!.telefone).toBe('+5511988887777');
  });

  test('nomes alternativos de campo tambem servem', () => {
    // formulário do Meta deixa renomear o campo; "telefone" e "nome" são comuns
    const r = parseMetaLead({ leadgen_id: '9', nome: 'Ana', telefone: '11999998888' });
    expect(r).toMatchObject({ nome: 'Ana' });
    expect(r!.telefone).toBe('+5511999998888');
  });

  test('sem telefone nao serve: o cruzamento e por telefone', () => {
    expect(parseMetaLead({ leadgen_id: '9', full_name: 'Ana', email: 'a@b.com' })).toBeNull();
  });

  test('telefone impossivel de normalizar tambem nao serve', () => {
    expect(parseMetaLead({ leadgen_id: '9', phone_number: '123' })).toBeNull();
  });

  test('corpo vazio nao derruba nada', () => {
    expect(parseMetaLead({})).toBeNull();
    expect(parseMetaLead(null)).toBeNull();
    expect(parseMetaLead('texto')).toBeNull();
  });

  test('e-mail invalido some em vez de sujar o lead', () => {
    const r = parseMetaLead({ ...cru, email: 'nao-e-email' });
    expect(r!.email).toBeNull();
  });
});

describe('protocoloMeta', () => {
  test('deriva do leadgen_id, que e unico no Meta', () => {
    expect(protocoloMeta('PERSI', '1234567890')).toBe('PERSI-META-1234567890');
  });

  test('o mesmo lead reenviado da o mesmo protocolo', () => {
    // a automação pode repetir o disparo; repetir não pode criar um lead novo
    expect(protocoloMeta('PERSI', '55')).toBe(protocoloMeta('PERSI', '55'));
  });

  test('sem leadgen_id cai no telefone, que e o que sempre existe', () => {
    expect(protocoloMeta('PERSI', null, '11971036500')).toBe('PERSI-META-11971036500');
  });

  test('sem prefixo ainda produz chave utilizavel', () => {
    expect(protocoloMeta('', '55')).toBe('META-55');
  });
});
