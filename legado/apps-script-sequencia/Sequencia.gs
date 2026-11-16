// ============================================================
// Sequencia.gs
// String = padrão (01SET, aba "Geral", numera e notifica)
// Objeto = { id, aba, nome, prefixo, sequencia, notificar }
//   aba:       nome da aba (padrão "Geral"), busca ignora maiúsculas
//   nome:      identificador do cliente no webhook (útil quando uma
//              planilha tem mais de um cliente, um por aba)
//   prefixo:   se preenchido, formato vira PREFIXO + MES + NN
//   sequencia: false = só ordena, não numera nem notifica
//   notificar: false = numera e ordena, mas não dispara webhook
//   ordenar:   false = numera e notifica, mas não reordena a aba
//
// A mesma planilha pode aparecer várias vezes, uma por aba.
// Cada aba tem sua própria sequência, independente das outras.
// ============================================================

const PLANILHAS = [
  '1agGk8HN98inXotnusMoxKGwyJoftzeoMQyTT55kPMuc',  // Tainã Aci
  '1mr9s_9UKShni_EakFh1ofuiU-JgTlVN3NKKRpKq0Lnw',  // Lorena
  // Vita Audio: notificar ligado em 04/11. O crm-auto (WhatsApp/Google) e o n8n (formulario) avisam a
  // Pulseboard direto, e sem a linha daqui todo aviso saia sem sequencia. Agora a Pulseboard junta a linha
  // com o aviso e sai uma mensagem so (aguardar_sequencia e espera_aviso_direto em sequencia_rotas.json).
  // Ordenacao religada em 28/10: o crm-auto grava a etapa na coluna ETAPA (M) e o Status (I)
  // ficou so com os valores do time. Se a etapa voltar para o Status, a validacao recusa a
  // reordenacao e a linha 2 e sobrescrita (Vera e Nilce se perderam assim em ~07/10).
  '1KMnwB0q2yFjpISN_QX7kr-BhhsoJoKep317qH_u3m3k',  // Vita Audio
  // Locadora e Persianas: ordenar false DE PROPOSITO (14/10). A reordenacao gravava pela
  // metade (Locadora: validacao da coluna STATUS recusava a etapa do CRM) e cada rodada
  // copiava os leads novos por cima de linhas antigas da Geral.
  { id: '1_FUKAUvlr1O8O2jMJCVbcdsWXUdjRMvDJo8fSHmQPBw', ordenar: false },  // Locadora Exatidão
  { id: '1j-w1Vw2OAV8f-HqWM7zzFMqAHgjsGgOS2aEQhaxxLn0', ordenar: false },  // Persianas Paulista
  '1dzWYVieSqrlCgRfr2M1PCtx4Z6RT261HaZrw05tNoDc',  // Debony Usinagem
  '1PpYc2hat7gbe7S-Ua1JBjVk5dRsHqPiO_sKTwFtUC2k',  // Patrícia Faro
  '16_1kLHBtzO6EeFPR37caFub4e36jQFJAJqGfZ_OhZFg',  // Consorcios Indaiatuba

  // Practical Life: a sequência é calculada pelo n8n. Aqui só ordena.
  { id: '1USb94hBZvXnejxsoRm273MU8h1scJUm5gLgMWldu53k', aba: 'GERAL', sequencia: false, ordenar: false }, // PLJP
  { id: '1cxvNc1igNZ7bJYaWVH5Qrsd5_fD7MMV5BrSaicnoAZM', aba: 'GERAL', sequencia: false }, // JP/CB unificada
  { id: '1m446aVw_p0FGdLn5x2XJ2676cm_QjY3GxcKoJ1AJOUc', aba: 'GERAL', sequencia: false }, // PLCB

  // Rafaela e Libertad: mesma planilha, um cliente por aba.
  // notificar: false DE PROPÓSITO: o fluxo "Libertad + Rafaela" do n8n já avisa a
  // Pulseboard direto. Ligar aqui duplica a mensagem no grupo (aconteceu com a Tainã).
  { id: '1EkldxEJGTpDVAUZxU_dHMeS28y_l3LyqvOMWCbicAPo', aba: 'Libertad',          nome: 'Libertad',          notificar: false },
  { id: '1EkldxEJGTpDVAUZxU_dHMeS28y_l3LyqvOMWCbicAPo', aba: 'Assessora Rafaela', nome: 'Assessora Rafaela', notificar: false },

  // Tile Serviços: Só será usada a aba "Google".
  { id: '16KENrryYmTimE_eEi37XmKxATNW0cZ2OOwA0ZEC2s2c', aba: 'Google' },  // Tile Serviços

  // Martinelli Chaves (19/10): lead so pelo crm-auto (WhatsApp). O CRM grava a Geral e a
  // Pulseboard junta o aviso do CRM com a sequencia (aguardar_sequencia em sequencia_rotas.json).
  '1Ag_e9b1Yv8BmDitREZ-WeGUTqpwO7HsqeMbxMCGcAow',  // Martinelli Chaves
];

const ABA = 'Geral';
// Notifica a linha que acabou de ser numerada se a DATA for dos ultimos N dias (29/10).
// O crm-auto grava a linha com a DATA do 1o contato, mas so quando o lead entra no Kanban:
// a Martinelli teve linhas de 27/10 gravadas em 28/10 (caio 24OUT, Ichiro 25OUT) e, com
// "so DATA de hoje", a sequencia nunca saiu e o aviso do CRM foi sem ela. Linha antiga
// solta nao vira aviso: a Pulseboard so a junta com um aviso direto e recusa o resto
// (lead_antigo, LEAD_SEQUENCIA_MAX_AGE_HOURS).
const DIAS_NOTIFICAR = 7;
const MESES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

// Pulseboard (21/09): manda a notificação com a sequência uma vez só, juntando-a
// ao lead que chegou pelo caminho direto (Make/n8n). Reserva: se ela não responder
// 2xx, o lead vai pelo fluxo Central do n8n, como antes (a deduplicação da
// Pulseboard continua a impedir a mensagem dupla).
const WEBHOOK_URL = 'https://pulseboard.sitespdoze.com.br/leads-sequencia';
const WEBHOOK_URL_RESERVA = 'https://n8n.sitespdoze.com.br/webhook/leads-sequencia';
const ENVIAR_WEBHOOK = true;

// ------------------------------------------------------------
// Helpers compartilhados (o Ordenacao.gs também usa)
// ------------------------------------------------------------

function cfgDe(item) {
  if (typeof item === 'string') {
    return { id: item, aba: ABA, nome: '', prefixo: '', sequencia: true, notificar: true, ordenar: true };
  }
  return {
    id: item.id,
    aba: item.aba || ABA,
    nome: item.nome || '',
    prefixo: item.prefixo || '',
    sequencia: item.sequencia !== false,
    notificar: item.notificar !== false,
    ordenar: item.ordenar !== false
  };
}

/** Abre cada planilha uma vez só por execução */
function abrirPlanilha(cache, id) {
  if (!cache[id]) cache[id] = SpreadsheetApp.openById(id);
  return cache[id];
}

/** Acha a aba ignorando maiúsculas/minúsculas */
function acharAba(ss, nome) {
  const alvo = String(nome).trim().toUpperCase();
  return ss.getSheets().filter(function (s) {
    return s.getName().trim().toUpperCase() === alvo;
  })[0] || null;
}

/** Compara cabeçalho ignorando acento e caixa: "Sequência" == "SEQUENCIA" */
function chaveCab(h) {
  return String(h).trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Lock do script. Se o LockService falhar (erro de storage do Google), pula a
 * rodada em vez de derrubar a execucao: o gatilho tenta de novo no minuto seguinte.
 */
function pegarLock() {
  try {
    const lock = LockService.getScriptLock();
    return lock.tryLock(30000) ? lock : null;
  } catch (e) {
    console.warn('Lock indisponivel: ' + e.message);
    return null;
  }
}

function soltarLock(lock) {
  try {
    lock.releaseLock();
  } catch (e) {
    console.warn('releaseLock: ' + e.message);
  }
}

// ------------------------------------------------------------
// Formato da sequência
// ------------------------------------------------------------

function montarSeq(cfg, n, mesNum) {
  const mes = MESES[mesNum - 1];
  const num = String(n).padStart(2, '0');
  return cfg.prefixo ? cfg.prefixo + mes + num : num + mes;
}

function numeroDe(cfg, v) {
  const t = String(v).trim().toUpperCase();
  if (!t) return null;
  if (cfg.prefixo) {
    const m = t.match(new RegExp('^' + cfg.prefixo + '[A-Z]{3}(\\d+)$'));
    return m ? parseInt(m[1], 10) : null;
  }
  const m = t.match(/^(\d{1,3})[A-Z]{3}$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Conserta "22ago." que o Sheets converteu em data */
function normSeq(cfg, v) {
  const t = String(v).trim();
  if (!t) return '';
  if (cfg.prefixo) return t.toUpperCase().replace(/\.$/, '');
  const m = t.match(/^(\d{1,3})\s*(?:de\s*)?([A-Za-zçÇ]{3,})\.?$/);
  if (m) return String(parseInt(m[1], 10)).padStart(2, '0') + m[2].substring(0, 3).toUpperCase();
  return t.toUpperCase().replace(/\.$/, '');
}

// ------------------------------------------------------------
// Rotina principal
// ------------------------------------------------------------

function gerarSequencias() {
  const lock = pegarLock();
  if (!lock) return;
  try {
    const cache = {};
    PLANILHAS.forEach(function (item) {
      const cfg = cfgDe(item);
      if (!cfg.sequencia) return;          // só ordena, não numera
      try {
        const ss = abrirPlanilha(cache, cfg.id);
        const sh = acharAba(ss, cfg.aba);
        if (!sh) return;
        const daAba = [];
        numerarAba(cfg, ss, sh, daAba);
        // O Sheets só grava de fato no flush. Sem ele a gravação ficava para depois do
        // fim da função, fora deste catch (o "server error" dos e-mails de falha), e o
        // aviso saía para a Pulseboard antes de a sequência estar na planilha.
        SpreadsheetApp.flush();
        // Avisa ja, planilha por planilha. Antes o aviso ficava para o fim da rodada: se ela
        // morresse depois de numerar (o Google derruba execucoes com "server error"), a linha
        // ficava com SEQUENCIA e nenhuma rodada seguinte avisava esse lead.
        if (ENVIAR_WEBHOOK && daAba.length) enviarWebhooks(daAba);
      } catch (e) {
        console.error(cfg.id + ': ' + e.message);
      }
    });
  } finally {
    soltarLock(lock);
  }
}

function numerarAba(cfg, ss, sh, envios) {
  const last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < 2 || lastCol < 1) return;
  if (!cfg.sequencia) return;

  const cabRaw = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const cab = cabRaw.map(chaveCab);
  const cData = cab.indexOf('DATA'), cSeq = cab.indexOf('SEQUENCIA');
  if (cData < 0 || cSeq < 0) return;
  const cHora = cab.indexOf('HORA');

  const disp = sh.getRange(2, 1, last - 1, lastCol).getDisplayValues();

  // normaliza o que já existe e detecta se algo mudou
  let mudou = false;
  const col = disp.map(function (r) {
    const antes = String(r[cSeq]);
    const depois = normSeq(cfg, antes);
    if (antes.trim() !== depois) mudou = true;
    return [depois];
  });

  const maxMes = {}, vazias = [];
  disp.forEach(function (r, i) {
    const p = String(r[cData]).split('/');
    if (p.length < 3) return;
    const mes = p[2] + p[1].padStart(2, '0');
    if (col[i][0]) {
      const n = numeroDe(cfg, col[i][0]);
      if (n !== null) maxMes[mes] = Math.max(maxMes[mes] || 0, n);
    } else {
      const h = cHora >= 0 ? String(r[cHora]).replace(/\D/g, '') : '';
      vazias.push({
        i: i, mes: mes, mesNum: parseInt(p[1], 10),
        k: mes + p[0].padStart(2, '0') + h.padEnd(6, '0')
      });
    }
  });

  if (!vazias.length && !mudou) return;

  vazias.sort(function (a, b) { return a.k < b.k ? -1 : 1; });
  const desde = Utilities.formatDate(
    new Date(Date.now() - DIAS_NOTIFICAR * 86400000), 'America/Sao_Paulo', 'yyyyMMdd');

  vazias.forEach(function (v) {
    const n = (maxMes[v.mes] || 0) + 1;
    maxMes[v.mes] = n;
    const seq = montarSeq(cfg, n, v.mesNum);
    col[v.i][0] = seq;

    // só notifica lead recente (DIAS_NOTIFICAR) — evita disparar o histórico todo
    if (cfg.notificar && v.k.substring(0, 8) >= desde) {
      const dados = {};
      cabRaw.forEach(function (h, c) {
        const nome = String(h).trim();
        if (nome) dados[nome] = disp[v.i][c];
      });
      dados['SEQUENCIA'] = seq;
      envios.push({
        cliente: cfg.nome || ss.getName(),
        planilhaId: ss.getId(),
        aba: sh.getName(),
        clienteChave: ss.getId() + '|' + sh.getName(),
        linha: v.i + 2, sequencia: seq, dados: dados
      });
    }
  });

  const alvo = sh.getRange(2, cSeq + 1, col.length, 1);
  alvo.setNumberFormat('@');
  alvo.setValues(col);
}

function pedidoWebhook(url, p) {
  return {
    url: url, method: 'post', contentType: 'application/json',
    payload: JSON.stringify(p), muteHttpExceptions: true
  };
}

/** Manda para a Pulseboard; o que ela não aceitar vai pela reserva (n8n). */
function enviarWebhooks(envios) {
  let falhas = [];
  try {
    UrlFetchApp.fetchAll(envios.map(function (p) { return pedidoWebhook(WEBHOOK_URL, p); }))
      .forEach(function (r, i) {
        const c = r.getResponseCode();
        if (c < 200 || c >= 300) {
          console.error('Webhook ' + c + ' | ' + envios[i].sequencia);
          falhas.push(envios[i]);
        }
      });
  } catch (e) {
    console.error('Webhook falhou: ' + e.message);
    falhas = envios;
  }
  if (!falhas.length || !WEBHOOK_URL_RESERVA) return;
  try {
    UrlFetchApp.fetchAll(falhas.map(function (p) { return pedidoWebhook(WEBHOOK_URL_RESERVA, p); }))
      .forEach(function (r, i) {
        const c = r.getResponseCode();
        if (c < 200 || c >= 300) console.error('Webhook reserva ' + c + ' | ' + falhas[i].sequencia);
      });
  } catch (e) {
    console.error('Webhook reserva falhou: ' + e.message);
  }
}

// ------------------------------------------------------------
// Diagnóstico e gatilho
// ------------------------------------------------------------

function verificar() {
  const cache = {};
  PLANILHAS.forEach(function (item) {
    const cfg = cfgDe(item);
    try {
      const ss = abrirPlanilha(cache, cfg.id);
      const sh = acharAba(ss, cfg.aba);
      if (!sh) {
        console.log('X ' + ss.getName() + ' — sem aba "' + cfg.aba + '". Abas: '
          + ss.getSheets().map(function (s) { return '"' + s.getName() + '"'; }).join(', '));
        return;
      }
      const cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(chaveCab);

      if (!cfg.sequencia) {
        console.log('OK (só ordena) ' + ss.getName() + ' [' + sh.getName() + ']'
          + ' | DATA=' + cab.indexOf('DATA') + ' | linhas=' + sh.getLastRow());
        return;
      }
      const ok = cab.indexOf('DATA') >= 0 && cab.indexOf('SEQUENCIA') >= 0;
      console.log((ok ? 'OK ' : 'X ') + ss.getName() + ' [' + sh.getName() + ']'
        + (cfg.notificar ? '' : ' (sem webhook)')
        + ' | exemplo: ' + montarSeq(cfg, 1, 9)
        + ' | DATA=' + cab.indexOf('DATA')
        + ' HORA=' + cab.indexOf('HORA')
        + ' SEQUENCIA=' + cab.indexOf('SEQUENCIA')
        + ' | linhas=' + sh.getLastRow());
    } catch (e) {
      console.log('X ' + cfg.id + ' — ' + e.message);
    }
  });
}

function testarWebhook() {
  const r = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({
      cliente: 'TESTE', planilhaId: 'TESTE', linha: 2, sequencia: '99TST',
      dados: { NOME: 'Teste', TELEFONE: '5511999999999', DATA: '15/09/2026' }
    }),
    muteHttpExceptions: true
  });
  console.log(r.getResponseCode() + ' | ' + r.getContentText());
}

function gatilhoSequencia() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'gerarSequencias'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('gerarSequencias').timeBased().everyMinutes(1).create();
}