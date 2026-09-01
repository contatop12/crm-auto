import { describe, test, expect } from 'vitest';
import { parseKanbanTask } from '../../src/domain/kanbanTask';

// shape confirmado contra a instancia real (docs/api-reference.md)
const task = {
  id: 719,
  board_id: 13,
  board_step_id: 52,
  title: 'Conversa #28 - Carol Nunes',
  step_changed_at: '2026-08-19T16:20:38.181Z',
  custom_attributes: { protocolo: 'QUIZPE-1720000000000-ABC', quiz_version: 'v2' },
  labels: ['google-ads', 'mensagem'],
  conversation_ids: [28],
  conversations: [{ id: 754, display_id: 28 }],
  contacts: [{ id: 1087, name: 'Carol Nunes', phone_number: '+5511996316799' }],
  value: '2028.0',
};

describe('parseKanbanTask', () => {
  test('le a task solta', () => {
    const r = parseKanbanTask(task);
    expect(r.taskId).toBe(719);
    expect(r.boardId).toBe(13);
    expect(r.protocolo).toBe('QUIZPE-1720000000000-ABC');
  });

  test('le a task dentro do envelope kanban_task', () => {
    expect(parseKanbanTask({ kanban_task: task }).taskId).toBe(719);
  });

  test('le a task dentro de body', () => {
    expect(parseKanbanTask({ body: { task } }).taskId).toBe(719);
  });

  test('pega nome e telefone do contato', () => {
    const r = parseKanbanTask(task);
    expect(r.nome).toBe('Carol Nunes');
    expect(r.telefone).toBe('+5511996316799');
  });

  test('usa o id INTERNO da conversa, nao o display_id', () => {
    // conversation_ids guarda display_id (28); o id interno e' 754
    expect(parseKanbanTask(task).conversationId).toBe(754);
  });

  test('converte o valor, que vem como string', () => {
    expect(parseKanbanTask(task).valor).toBe(2028);
  });

  test('protocolo em caixa alta', () => {
    const t = { ...task, custom_attributes: { protocolo: 'abc-1-x' } };
    expect(parseKanbanTask(t).protocolo).toBe('ABC-1-X');
  });

  test('cai para o titulo quando nao ha contato', () => {
    const t = { ...task, contacts: [] };
    expect(parseKanbanTask(t).nome).toBe('Conversa #28 - Carol Nunes');
  });

  test('chave de deduplicacao prefere o protocolo', () => {
    expect(parseKanbanTask(task).chaveDedupe).toBe('QUIZPE-1720000000000-ABC');
  });

  test('sem protocolo, a chave cai para o id da task', () => {
    const t = { ...task, custom_attributes: {} };
    expect(parseKanbanTask(t).chaveDedupe).toBe('task:719');
  });

  test('payload sem task devolve taskId zero', () => {
    expect(parseKanbanTask({}).taskId).toBe(0);
  });

  test('expoe a versao do quiz para montar o canal', () => {
    expect(parseKanbanTask(task).quizVersion).toBe('v2');
  });
});
