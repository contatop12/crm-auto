-- Padronizacao de etiquetas e atributos personalizados do Chatwoot.
--
-- Substitui o workflow "Chatwoot - Criacao automatica de Atributos e Etiquetas",
-- que tinha as listas coladas dentro de um no de codigo e o numero da conta
-- fixo em dois lugares. Aqui a lista e' linha de banco, editavel pelo painel, e
-- a conta e' o cliente que voce escolher.
--
-- Sao catalogos GLOBAIS, sem tenant_id: a graca e' todo cliente novo nascer com
-- os mesmos nomes. Cliente que precise de algo proprio recebe na mao depois.

CREATE TABLE padrao_etiquetas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,   -- e' o titulo no Chatwoot e a chave no vocabulario
  cor        TEXT    NOT NULL DEFAULT '#999999',
  descricao  TEXT,
  posicao    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE padrao_atributos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo     TEXT    NOT NULL CHECK (modelo IN ('contact_attribute','conversation_attribute','task_attribute')),
  chave      TEXT    NOT NULL,
  nome       TEXT    NOT NULL,          -- rotulo que aparece na tela do Chatwoot
  tipo       TEXT    NOT NULL DEFAULT 'text'
             CHECK (tipo IN ('text','number','currency','percent','link','date','list','checkbox')),
  descricao  TEXT,
  posicao    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (modelo, chave)
);

INSERT INTO padrao_etiquetas (slug, cor, descricao, posicao) VALUES
  ('mensagem',   '#8e44ad', 'Lead iniciou por mensagem/WhatsApp', 1),
  ('google-ads', '#4285F4', 'Lead veio do Google Ads',            2),
  ('meta-ads',   '#1877F2', 'Lead veio do Meta Ads',              3),
  ('formulario', '#16a085', 'Lead preencheu formulario no site',  4),
  ('p-max',      '#e67e22', 'Campanha Performance Max',           5),
  ('search',     '#27ae60', 'Campanha de Pesquisa',               6),
  ('display',    '#f39c12', 'Campanha de Display',                7);

-- Contato: a atribuicao mais recente da pessoa.
INSERT INTO padrao_atributos (modelo, chave, nome, tipo, descricao, posicao) VALUES
  ('contact_attribute','protocolo',   'Protocolo',   'text','Chave que liga o clique no anuncio ao lead', 1),
  ('contact_attribute','gclid',       'GCLID',       'text','Click ID do Google Ads',                     2),
  ('contact_attribute','gbraid',      'GBRAID',      'text','Click ID (campanhas de App iOS)',            3),
  ('contact_attribute','wbraid',      'WBRAID',      'text','Click ID (iOS com restricao de rastreio)',   4),
  ('contact_attribute','utm_source',  'UTM Source',  'text','Origem do trafego',                          5),
  ('contact_attribute','utm_medium',  'UTM Medium',  'text','Midia',                                      6),
  ('contact_attribute','utm_campaign','UTM Campaign','text','Campanha',                                   7),
  ('contact_attribute','utm_id',      'UTM ID',      'text','ID da campanha',                             8),
  ('contact_attribute','utm_term',    'UTM Term',    'text','Termo / palavra-chave',                      9),
  ('contact_attribute','utm_content', 'UTM Content', 'text','Criativo / anuncio',                        10);

-- Conversa: a atribuicao DAQUELE atendimento. O lead que volta meses depois por
-- um anuncio novo sobrescreve o contato, mas cada conversa mantem a sua origem.
INSERT INTO padrao_atributos (modelo, chave, nome, tipo, descricao, posicao) VALUES
  ('conversation_attribute','protocolo',   'Protocolo',   'text','Protocolo do clique que originou esta conversa', 1),
  ('conversation_attribute','gclid',       'GCLID',       'text','Click ID desta conversa',                        2),
  ('conversation_attribute','utm_source',  'UTM Source',  'text','Origem desta conversa',                          3),
  ('conversation_attribute','utm_medium',  'UTM Medium',  'text','Midia desta conversa',                           4),
  ('conversation_attribute','utm_campaign','UTM Campaign','text','Campanha desta conversa',                        5);

-- Tarefa do Kanban e' a NEGOCIACAO: cada card carrega a sua propria origem.
INSERT INTO padrao_atributos (modelo, chave, nome, tipo, descricao, posicao) VALUES
  ('task_attribute','protocolo',   'Protocolo',   'text','Protocolo do clique que originou esta negociacao', 1),
  ('task_attribute','gclid',       'GCLID',       'text','Click ID desta negociacao',                        2),
  ('task_attribute','utm_source',  'UTM Source',  'text','Origem do trafego desta negociacao',               3),
  ('task_attribute','utm_medium',  'UTM Medium',  'text','Midia',                                            4),
  ('task_attribute','utm_campaign','UTM Campaign','text','Nome da campanha',                                 5),
  ('task_attribute','utm_id',      'UTM ID',      'text','ID da campanha',                                   6),
  ('task_attribute','utm_term',    'UTM Term',    'text','Termo',                                            7),
  ('task_attribute','utm_content', 'UTM Content', 'text','Anuncio / criativo',                               8);
