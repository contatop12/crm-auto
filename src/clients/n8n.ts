/**
 * Entrega um registro ao webhook do n8n que escreve na planilha.
 *
 * O fluxo do n8n responde so' depois de gravar (Respond to Webhook no fim), e
 * erro na planilha volta como 500. Por isso 2xx aqui quer dizer "gravou" ou
 * "o fluxo decidiu nao gravar", nunca "recebi e vou ver depois".
 */
export async function postarNaPlanilha(
  url: string,
  registro: Record<string, unknown>,
): Promise<{ gravado: boolean | null; resposta: string }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registro),
    // a planilha nao pode segurar a fila: dez segundos e desiste
    signal: AbortSignal.timeout(10_000),
  });
  const texto = (await r.text()).slice(0, 300);
  if (!r.ok) throw new Error(`n8n respondeu ${r.status}: ${texto}`);

  let gravado: boolean | null = null;
  try {
    const j = JSON.parse(texto) as { gravado?: unknown };
    if (typeof j.gravado === 'boolean') gravado = j.gravado;
  } catch {
    // resposta sem JSON: o fluxo rodou, so' nao disse o que fez
  }
  return { gravado, resposta: texto };
}
