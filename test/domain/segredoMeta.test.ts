import { describe, test, expect } from 'vitest';
import { cifrarToken, decifrarToken, ultimos4 } from '../../src/domain/segredoMeta';

const MK = 'chave-mestra-de-teste';

describe('segredoMeta', () => {
  test('ida e volta', async () => {
    const c = await cifrarToken('EAAB-token-1234', MK);
    expect(await decifrarToken(c.cipher, c.iv, MK)).toBe('EAAB-token-1234');
  });

  test('IV novo a cada cifra: o mesmo token nunca vira o mesmo texto', async () => {
    const a = await cifrarToken('EAAB-token-1234', MK);
    const b = await cifrarToken('EAAB-token-1234', MK);
    expect(a.iv).not.toBe(b.iv);
    expect(a.cipher).not.toBe(b.cipher);
  });

  test('abre o token que o whatsapp-track cifrou', async () => {
    // gerado com o algoritmo de whatsapp-track/src/lib/crypto.ts, IV fixo 1..12
    const cipher = 'K8D9KD+3v4mI/o7q3fJXyAWteVJga/0yV2H7bMuaQj8b5Ey6qBMLnw==';
    expect(await decifrarToken(cipher, 'AQIDBAUGBwgJCgsM', MK)).toBe('EAAB-token-de-teste-1234');
  });

  test('cifra adulterada lanca', async () => {
    const c = await cifrarToken('EAAB-token-1234', MK);
    const adulterada = (c.cipher[0] === 'A' ? 'B' : 'A') + c.cipher.slice(1);
    await expect(decifrarToken(adulterada, c.iv, MK)).rejects.toThrow();
  });

  test('outra MASTER_KEY nao abre', async () => {
    const c = await cifrarToken('EAAB-token-1234', MK);
    await expect(decifrarToken(c.cipher, c.iv, 'outra-chave')).rejects.toThrow();
  });

  test('ultimos4 nao revela token curto', () => {
    expect(ultimos4('EAAB-token-1234')).toBe('1234');
    expect(ultimos4('1234')).toBe('');
  });
});
