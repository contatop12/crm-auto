/**
 * Libera para a service account do CRM tudo que ela precisa ler e escrever.
 *
 * Roda na conta de quem administra as planilhas e o GTM (contato@p12digital.com.br)
 * e faz, uma vez, o que seria clicar "Compartilhar" em cada planilha e
 * "Adicionar usuario" em cada conta do GTM.
 *
 * Pode rodar quantas vezes quiser: o que ja' esta liberado e' pulado.
 *
 * COMO USAR
 *   1. script.google.com -> Novo projeto -> cole este arquivo inteiro
 *   2. Servicos (+) -> "Tag Manager API" -> Adicionar
 *   3. Escolha a funcao `conferir` e clique Executar: mostra o que vai mudar,
 *      sem mudar nada
 *   4. Escolha `liberar` e clique Executar. Autorize quando o Google pedir
 *   5. Veja o resultado em "Registro de execucao"
 *
 * O Google Ads (MCC) NAO da' para liberar por aqui: o Apps Script nao tem acesso
 * a gestao de usuarios do Google Ads. Esse passo e' manual (veja o fim do log).
 */

const CONTA_DO_CRM = 'crm-api@crm-p12.iam.gserviceaccount.com';

/** Banco de Dados (abas Cliques e Conversoes) e planilha geral de leads de cada cliente. */
const PLANILHAS = {
  'Banco de Dados Persianas Paulista': '1tRG6GA_L2UqJVEkoriZ5Hm8oYXeNIvw8RooYPWSKhPM',
  'Leads - Persianas Paulista': '1j-w1Vw2OAV8f-HqWM7zzFMqAHgjsGgOS2aEQhaxxLn0',
  'Banco de Dados Vita Audio': '1MMnX9FHJ_3gMs-DBD-Nj5zDB9AikcsIxSA50hsBwjHo',
  'Leads - Vita Audio': '1KMnwB0q2yFjpISN_QX7kr-BhhsoJoKep317qH_u3m3k',
  'Banco de Dados Locadora Exatidao': '1NJ6rifdIjYbqwbxvv0W1VEng9GRxfqc3TPfLtReA4aI',
  'Leads - Locadora Exatidao': '1_FUKAUvlr1O8O2jMJCVbcdsWXUdjRMvDJo8fSHmQPBw',
  'Banco de Dados Taina Aci': '1kRIQ7Yyszd49zndSddrQ7MmXOMXiPQV5zCptCYTTR1s',
  'Leads - Taina Aci': '1agGk8HN98inXotnusMoxKGwyJoftzeoMQyTT55kPMuc',
};

/**
 * Contas do GTM dos clientes do CRM, pelo nome. So' elas sao tocadas — as
 * contas de outros clientes da agencia ficam como estao.
 */
const CONTAS_GTM = [/persianas/i, /vita/i, /exatid/i, /locadora/i, /tain[aã]/i];

function conferir() {
  executar_(false);
}

function liberar() {
  executar_(true);
}

function executar_(aplicar) {
  const log = [];
  const verbo = aplicar ? 'liberado' : 'VAI liberar';

  // --- planilhas -----------------------------------------------------------
  log.push('== Planilhas');
  Object.keys(PLANILHAS).forEach(function (nome) {
    const id = PLANILHAS[nome];
    try {
      const arquivo = DriveApp.getFileById(id);
      const jaEdita = arquivo.getEditors().some(function (u) {
        return u.getEmail().toLowerCase() === CONTA_DO_CRM;
      });
      if (jaEdita) {
        log.push('  ok       ' + nome + ' (ja era editor)');
        return;
      }
      if (aplicar) arquivo.addEditor(CONTA_DO_CRM);
      log.push('  ' + verbo + ' ' + nome);
    } catch (e) {
      log.push('  ERRO     ' + nome + ': ' + e.message);
    }
  });

  // --- Tag Manager -----------------------------------------------------------
  log.push('== Tag Manager');
  let contas = [];
  try {
    contas = (TagManager.Accounts.list().account || []).filter(function (a) {
      return CONTAS_GTM.some(function (re) { return re.test(a.name); });
    });
  } catch (e) {
    log.push('  ERRO ao listar contas (adicionou o servico "Tag Manager API"?): ' + e.message);
  }
  if (!contas.length) log.push('  nenhuma conta do GTM com o nome dos clientes');

  contas.forEach(function (conta) {
    try {
      const containers = TagManager.Accounts.Containers.list(conta.path).container || [];
      const acesso = containers.map(function (c) {
        return { containerId: c.containerId, permission: 'publish' };
      });
      const usuarios = TagManager.Accounts.User_permissions.list(conta.path).userPermission || [];
      const atual = usuarios.filter(function (u) {
        return (u.emailAddress || '').toLowerCase() === CONTA_DO_CRM;
      })[0];

      const nomes = containers.map(function (c) { return c.name; }).join(', ');
      if (atual) {
        const jaPublica = containers.every(function (c) {
          return (atual.containerAccess || []).some(function (a) {
            return a.containerId === c.containerId && a.permission === 'publish';
          });
        });
        if (jaPublica) {
          log.push('  ok       ' + conta.name + ' (ja publica em: ' + nomes + ')');
          return;
        }
        if (aplicar) {
          TagManager.Accounts.User_permissions.update({
            emailAddress: CONTA_DO_CRM,
            accountAccess: { permission: 'user' },
            containerAccess: acesso,
          }, atual.path);
        }
        log.push('  ' + verbo + ' ' + conta.name + ' (publicar em: ' + nomes + ')');
        return;
      }

      if (aplicar) {
        TagManager.Accounts.User_permissions.create({
          emailAddress: CONTA_DO_CRM,
          accountAccess: { permission: 'user' },
          containerAccess: acesso,
        }, conta.path);
      }
      log.push('  ' + verbo + ' ' + conta.name + ' (publicar em: ' + nomes + ')');
    } catch (e) {
      log.push('  ERRO     ' + conta.name + ': ' + e.message);
    }
  });

  // --- Google Ads ------------------------------------------------------------
  log.push('== Google Ads (manual)');
  log.push('  Na MCC 378-061-1396: Administrador -> Acesso e seguranca -> (+)');
  log.push('  e-mail ' + CONTA_DO_CRM + ', nivel Padrao. Sem isso as conversoes');
  log.push('  continuam saindo pelo acesso antigo (funciona, so nao migra).');

  Logger.log(log.join('\n'));
}
