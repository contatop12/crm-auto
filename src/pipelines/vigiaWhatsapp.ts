import type { Env } from '../env';
import { EvolutionClient, type InstanciaEvo } from '../clients/evolution';
import { ChatwootClient } from '../clients/chatwoot';
import {
  contarRecebidas,
  instanciaDoWebhook,
  diagnosticar,
  caixaParaCorrigir,
  planejarAvisos,
  horarioDeAviso,
  JANELA_LONGA_MIN,
  JANELA_CURTA_MIN,
  type Achado,
  type CaixaCw,
  type EstadoVigia,
  type LeituraInstancia,
  type MensagemEvo,
} from '../domain/vigiaWhatsapp';

/** Onde o vigia guarda o que ja' avisou entre uma rodada e outra. */
const CHAVE_ESTADO = 'vigia:whatsapp';

/** O Evolution leva uns segundos para entregar: a ponta da janela fica de fora. */
const FOLGA_S = 3 * 60;

export interface RelatorioVigia {
  leituras: Array<LeituraInstancia & { problema: string | null }>;
  corrigidas: string[];
  avisos: string[];
  enviado: boolean;
}

/**
 * Uma rodada do vigia (cron a cada 15 min).
 *
 * Instancias vigiadas = as dos clientes ativos no CRM (`inbox_instances` e o
 * padrao de `tenant_config`). Nome de caixa desatualizado com a caixa certa
 * provada pelo webhook e' corrigido na hora — foi exatamente o que derrubou a
 * Locadora por quatro dias.
 *
 * `enviar: false` so' le': nao corrige, nao avisa e nao grava estado (a previa
 * do painel).
 */
export async function vigiarWhatsapp(
  env: Env,
  opcoes: { enviar?: boolean; agora?: number } = {},
): Promise<RelatorioVigia> {
  const enviar = opcoes.enviar ?? true;
  const agora = opcoes.agora ?? Date.now();
  const evo = EvolutionClient.fromEnv(env);
  const cw = ChatwootClient.fromEnv(env);

  const alvos = await instanciasVigiadas(env);
  const achados: Achado[] = [];
  const leituras: RelatorioVigia['leituras'] = [];
  const corrigidas: string[] = [];
  const avisosDiretos: string[] = [];

  let instancias: InstanciaEvo[] | null = null;
  try {
    instancias = await evo.instancias();
  } catch (e) {
    achados.push({
      chave: 'evolution',
      rotulo: 'Servidor do Evolution',
      problema: {
        tipo: 'servidor',
        texto: `não respondeu (${String((e as Error).message).slice(0, 80)}). Nenhum número está entregando mensagens ao Chatwoot.`,
      },
    });
  }

  if (instancias) {
    achados.push({ chave: 'evolution', rotulo: 'Servidor do Evolution', problema: null });
    const caixasPorConta = new Map<number, Promise<CaixaCw[] | null>>();
    const caixasDa = (conta: number) => {
      if (!caixasPorConta.has(conta)) {
        caixasPorConta.set(
          conta,
          cw.caixas(conta).then(
            (l) => l.map((c) => ({ id: c.id, nome: c.name, instancia: instanciaDoWebhook(c.webhook_url) })),
            () => null,
          ),
        );
      }
      return caixasPorConta.get(conta)!;
    };

    for (const alvo of alvos) {
      const l = await lerInstancia(evo, cw, alvo, instancias, caixasDa, agora);

      const nova = caixaParaCorrigir(l);
      if (nova && enviar) {
        try {
          const cfg = await evo.chatwoot(alvo.instancia);
          if (cfg) {
            const antiga = String(cfg.nameInbox ?? '');
            await evo.definirChatwoot(alvo.instancia, { ...cfg, nameInbox: nova });
            l.chatwoot = { ...l.chatwoot!, caixa: nova };
            corrigidas.push(alvo.instancia);
            avisosDiretos.push(
              `🔧 *Corrigido sozinho* — ${rotulo(alvo)}\nA caixa do Chatwoot tinha sido renomeada ("${antiga}" → "${nova}") ` +
                'e o Evolution parou de entregar as mensagens deste número. O nome foi atualizado no Evolution; ' +
                'as mensagens que chegaram enquanto estava errado podem não aparecer no Chatwoot.',
            );
          }
        } catch (e) {
          console.log(JSON.stringify({ acao: 'vigia_corrigir_caixa', instancia: alvo.instancia, erro: String((e as Error).message).slice(0, 200) }));
        }
      }

      const problema = diagnosticar(l);
      leituras.push({ ...l, problema: problema?.texto ?? null });
      achados.push({ chave: alvo.instancia, rotulo: rotulo(alvo), problema });
    }
  }

  const anterior = ((await env.CACHE.get(CHAVE_ESTADO, 'json')) ?? {}) as EstadoVigia;
  const plano = planejarAvisos(anterior, achados, agora);
  // a correcao automatica e' noticia na hora, dentro ou fora do horario
  const avisos = [...avisosDiretos, ...plano.avisos];

  let enviado = false;
  if (enviar) {
    if (avisos.length) {
      try {
        await evo.enviarTexto(env.EVOLUTION_ALERT_INSTANCE, env.EVOLUTION_ALERT_GROUP_ID, avisos.join('\n\n'));
        enviado = true;
      } catch (e) {
        // sem gravar o estado: o aviso que nao saiu tenta de novo na proxima rodada
        console.log(JSON.stringify({ acao: 'vigia_aviso_falhou', erro: String((e as Error).message).slice(0, 200) }));
      }
    }
    if (!avisos.length || enviado) await env.CACHE.put(CHAVE_ESTADO, JSON.stringify(plano.estado));
  }

  console.log(
    JSON.stringify({
      acao: 'vigia_whatsapp',
      horario_de_aviso: horarioDeAviso(agora),
      instancias: leituras.map((l) => ({
        i: l.instancia,
        estado: l.estado,
        recebidas: l.recebidas,
        entregues: l.entregues,
        problema: l.problema,
      })),
      corrigidas,
      avisos: avisos.length,
      enviado,
    }),
  );
  return { leituras, corrigidas, avisos, enviado };
}

interface Alvo {
  instancia: string;
  cliente: string;
}

const rotulo = (a: Alvo) => `${a.cliente} · ${a.instancia}`;

async function instanciasVigiadas(env: Env): Promise<Alvo[]> {
  const r = await env.DB.prepare(
    `SELECT i.evo_instancia AS instancia, t.nome AS cliente
       FROM inbox_instances i JOIN tenants t ON t.id = i.tenant_id
      WHERE t.ativo = 1 AND i.ativa = 1
     UNION
     SELECT c.evo_instancia AS instancia, t.nome AS cliente
       FROM tenant_config c JOIN tenants t ON t.id = c.tenant_id
      WHERE t.ativo = 1 AND c.evo_instancia IS NOT NULL AND c.evo_instancia <> ''`,
  ).all<Alvo>();
  const vistas = new Set<string>();
  return (r.results ?? []).filter((a) => (vistas.has(a.instancia) ? false : (vistas.add(a.instancia), true)));
}

async function lerInstancia(
  evo: EvolutionClient,
  cw: ChatwootClient,
  alvo: Alvo,
  instancias: InstanciaEvo[],
  caixasDa: (conta: number) => Promise<CaixaCw[] | null>,
  agora: number,
): Promise<LeituraInstancia> {
  const inst = instancias.find((i) => i.name === alvo.instancia);
  const l: LeituraInstancia = {
    instancia: alvo.instancia,
    cliente: alvo.cliente,
    estado: inst ? String(inst.connectionStatus ?? 'desconhecido') : null,
    viva: null,
    chatwoot: null,
    caixas: null,
  };
  if (l.estado !== 'open') return l;

  const [viva, cfg] = await Promise.all([
    evo.viva(alvo.instancia),
    evo.chatwoot(alvo.instancia).catch(() => null),
  ]);
  l.viva = viva.viva;
  if (!viva.viva || !cfg) return l;

  const conta = Number(cfg.accountId);
  l.chatwoot = { ligado: cfg.enabled === true, conta, caixa: String(cfg.nameInbox ?? '') };
  if (!l.chatwoot.ligado || !conta) return l;
  l.caixas = await caixasDa(conta);

  const caixa = l.caixas?.find((c) => c.nome === l.chatwoot!.caixa);
  if (!caixa) return l;

  const ate = Math.floor(agora / 1000);
  const longa = ate - JANELA_LONGA_MIN * 60;
  const curta = ate - JANELA_CURTA_MIN * 60;
  try {
    const [msgs, entLonga, entCurta] = await Promise.all([
      evo.mensagensRecentes(alvo.instancia),
      cw.recebidasNaCaixa(conta, caixa.id, longa, ate),
      cw.recebidasNaCaixa(conta, caixa.id, curta, ate),
    ]);
    const m = msgs as MensagemEvo[];
    l.recebidas = {
      longa: contarRecebidas(m, longa, ate - FOLGA_S),
      curta: contarRecebidas(m, curta, ate - FOLGA_S),
    };
    l.entregues = { longa: entLonga, curta: entCurta };
  } catch (e) {
    // sem os numeros nao da' para julgar a entrega; o resto do diagnostico vale
    console.log(JSON.stringify({ acao: 'vigia_contagem', instancia: alvo.instancia, erro: String((e as Error).message).slice(0, 200) }));
  }
  return l;
}
