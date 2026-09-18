import { describe, test, expect, vi } from 'vitest';
import { assinarAssercao, lerChave, comConta } from '../../src/clients/googleSa';

async function chaveDeTeste(): Promise<{ pem: string; publica: CryptoKey }> {
  const par = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', par.privateKey)) as ArrayBuffer);
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publica: par.publicKey };
}

function decodificar(parte: string): Record<string, unknown> {
  const b = parte.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4)));
}

describe('lerChave', () => {
  test('aceita o JSON que o Google entrega', () => {
    const k = lerChave(JSON.stringify({
      type: 'service_account', client_email: 'crm-api@x.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----\n',
      token_uri: 'https://oauth2.googleapis.com/token',
    }));
    expect(k?.client_email).toBe('crm-api@x.iam.gserviceaccount.com');
  });

  test('sem chave ou chave quebrada vira null, nao erro', () => {
    expect(lerChave(undefined)).toBeNull();
    expect(lerChave('nao e json')).toBeNull();
    expect(lerChave(JSON.stringify({ type: 'authorized_user' }))).toBeNull();
  });
});

describe('assinarAssercao', () => {
  test('monta o JWT que o Google troca por token, assinado com a chave', async () => {
    const { pem, publica } = await chaveDeTeste();
    const jwt = await assinarAssercao(
      { client_email: 'crm-api@x.iam.gserviceaccount.com', private_key: pem, token_uri: 'https://oauth2.googleapis.com/token' },
      ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/datamanager'],
      1_800_000_000,
    );
    const [cab, corpo, assinatura] = jwt.split('.');
    expect(decodificar(cab!)).toMatchObject({ alg: 'RS256', typ: 'JWT' });
    expect(decodificar(corpo!)).toEqual({
      iss: 'crm-api@x.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/datamanager',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });

    const sig = Uint8Array.from(atob(assinatura!.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (assinatura!.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publica, sig, new TextEncoder().encode(`${cab}.${corpo}`));
    expect(ok).toBe(true);
  });
});

describe('comConta', () => {
  const resposta = (status: number) => new Response('{}', { status });

  test('usa a service account quando ela tem permissao', async () => {
    const chamar = vi.fn(async (_t: string) => resposta(200));
    const legado = vi.fn(async () => 'legado');
    const r = await comConta(async () => 'sa', legado, chamar);
    expect(r.status).toBe(200);
    expect(chamar).toHaveBeenCalledTimes(1);
    expect(chamar).toHaveBeenCalledWith('sa');
    expect(legado).not.toHaveBeenCalled();
  });

  test('sem permissao na service account, tenta o acesso antigo', async () => {
    const chamar = vi.fn(async (t: string) => resposta(t === 'sa' ? 403 : 200));
    const r = await comConta(async () => 'sa', async () => 'legado', chamar);
    expect(r.status).toBe(200);
    expect(chamar.mock.calls.map((c) => c[0])).toEqual(['sa', 'legado']);
  });

  test('erro que nao e de permissao nao troca de credencial', async () => {
    const chamar = vi.fn(async () => resposta(400));
    const r = await comConta(async () => 'sa', async () => 'legado', chamar);
    expect(r.status).toBe(400);
    expect(chamar).toHaveBeenCalledTimes(1);
  });

  test('sem service account configurada, vai direto no acesso antigo', async () => {
    const chamar = vi.fn(async () => resposta(200));
    await comConta(async () => null, async () => 'legado', chamar);
    expect(chamar).toHaveBeenCalledWith('legado');
  });

  test('sem acesso antigo, devolve a recusa da service account', async () => {
    const chamar = vi.fn(async () => resposta(403));
    const r = await comConta(async () => 'sa', null, chamar);
    expect(r.status).toBe(403);
    expect(chamar).toHaveBeenCalledTimes(1);
  });
});
