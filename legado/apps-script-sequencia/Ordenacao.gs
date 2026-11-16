// ============================================================
// Ordenacao.gs
// Ordena a aba de cada planilha do mais recente para o mais antigo.
// Usa PLANILHAS, cfgDe(), abrirPlanilha(), acharAba(), chaveCab(),
// pegarLock() e soltarLock() do Sequencia.gs — arquivos do mesmo
// projeto compartilham o escopo.
// ============================================================

function ordenarTodas() {
  const lock = pegarLock();
  if (!lock) return;
  try {
    const cache = {};
    PLANILHAS.forEach(function (item) {
      const cfg = cfgDe(item);
      if (!cfg.ordenar) return;
      try {
        const sh = acharAba(abrirPlanilha(cache, cfg.id), cfg.aba);
        if (!sh) return;
        ordenarAba(sh);
        SpreadsheetApp.flush();  // grava aqui: erro do Sheets cai neste catch, com o id
      } catch (e) {
        console.error(cfg.id + ': ' + e.message);
      }
    });
  } finally {
    soltarLock(lock);
  }
}

function ordenarAba(sh) {
  const last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < 3 || lastCol < 1) return;

  const cab = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(chaveCab);
  const cData = cab.indexOf('DATA');
  if (cData < 0) return;
  const cHora = cab.indexOf('HORA');

  const rng = sh.getRange(2, 1, last - 1, lastCol);
  const disp = rng.getDisplayValues();

  const k = function (r) {
    const p = String(r[cData]).split('/');
    if (p.length < 3) return '';
    const h = cHora >= 0 ? String(r[cHora]).replace(/\D/g, '') : '';
    return p[2] + p[1].padStart(2, '0') + p[0].padStart(2, '0') + h.padEnd(6, '0');
  };

  const ordem = disp.map(function (_, i) { return i; })
    .sort(function (a, b) {
      return k(disp[a]) < k(disp[b]) ? 1 : k(disp[a]) > k(disp[b]) ? -1 : 0;
    });

  if (!ordem.some(function (v, i) { return v !== i; })) return;

  const vals = rng.getValues();
  rng.setValues(ordem.map(function (i) { return vals[i]; }));
}

function gatilhoOrdenacao() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'ordenarTodas'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('ordenarTodas').timeBased().everyMinutes(5).create();
}