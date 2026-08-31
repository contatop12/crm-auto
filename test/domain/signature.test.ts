import { describe, test, expect } from 'vitest';
import { signPayload, verifySignature } from '../../src/domain/signature';

const SECRET = 'LnxuD2RcskS3iw5hkh2M2orP';
const BODY = '{"event":"conversation_created","id":123}';
const AGORA = 1_787_770_925;

async function assinaturaValida(ts = AGORA, body = BODY, secret = SECRET) {
  return signPayload(secret, ts, body);
}

describe('verifySignature', () => {
  test('aceita assinatura correta', async () => {
    const sig = await assinaturaValida();
    const r = await verifySignature({
      secret: SECRET,
      signatureHeader: sig,
      timestampHeader: String(AGORA),
      rawBody: BODY,
      agoraSegundos: AGORA,
    });
    expect(r.valid).toBe(true);
  });

  test('recusa quando o corpo foi adulterado', async () => {
    const sig = await assinaturaValida();
    const r = await verifySignature({
      secret: SECRET,
      signatureHeader: sig,
      timestampHeader: String(AGORA),
      rawBody: '{"event":"conversation_created","id":999}',
      agoraSegundos: AGORA,
    });
    expect(r.valid).toBe(false);
  });

  test('recusa assinatura de outro segredo', async () => {
    const sig = await assinaturaValida(AGORA, BODY, 'segredo-errado');
    const r = await verifySignature({
      secret: SECRET,
      signatureHeader: sig,
      timestampHeader: String(AGORA),
      rawBody: BODY,
      agoraSegundos: AGORA,
    });
    expect(r.valid).toBe(false);
  });

  test('recusa replay fora da janela de tolerancia', async () => {
    const sig = await assinaturaValida();
    const r = await verifySignature({
      secret: SECRET,
      signatureHeader: sig,
      timestampHeader: String(AGORA),
      rawBody: BODY,
      agoraSegundos: AGORA + 301,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('tolerancia');
  });

  test('aceita dentro da janela de tolerancia', async () => {
    const sig = await assinaturaValida();
    const r = await verifySignature({
      secret: SECRET,
      signatureHeader: sig,
      timestampHeader: String(AGORA),
      rawBody: BODY,
      agoraSegundos: AGORA + 299,
    });
    expect(r.valid).toBe(true);
  });

  test('recusa quando falta o header de assinatura', async () => {
    const r = await verifySignature({
      secret: SECRET,
      signatureHeader: null,
      timestampHeader: String(AGORA),
      rawBody: BODY,
      agoraSegundos: AGORA,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('assinatura');
  });

  test('recusa quando falta o timestamp', async () => {
    const sig = await assinaturaValida();
    const r = await verifySignature({
      secret: SECRET,
      signatureHeader: sig,
      timestampHeader: null,
      rawBody: BODY,
      agoraSegundos: AGORA,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('timestamp');
  });

  test('recusa timestamp nao numerico', async () => {
    const sig = await assinaturaValida();
    const r = await verifySignature({
      secret: SECRET,
      signatureHeader: sig,
      timestampHeader: 'ontem',
      rawBody: BODY,
      agoraSegundos: AGORA,
    });
    expect(r.valid).toBe(false);
  });

  test('assina no formato que o Chatwoot envia', async () => {
    const sig = await signPayload(SECRET, AGORA, BODY);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});
