import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// `node:sqlite` ainda nao esta na lista de builtins do Vite: o import estatico
// vira um pedido pelo pacote "sqlite", que nao existe. O require em tempo de
// execucao escapa da analise estatica.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (caminho: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      get(...a: unknown[]): unknown;
      all(...a: unknown[]): unknown[];
      run(...a: unknown[]): { changes: number | bigint };
    };
  };
};

/**
 * D1 de mentira sobre `node:sqlite`, para os testes que dependem de semantica
 * de banco de verdade: a UNIQUE de deduplicacao, o `INSERT OR IGNORE` e o
 * `meta.changes`. Mockar isso a mao testaria o mock, nao o SQL.
 *
 * Roda as mesmas migrations que vao para producao — schema divergente entre
 * teste e producao e' a forma mais cara de descobrir um erro.
 */
export function fakeD1(migrations = ['migrations/0001_init.sql', 'migrations/0002_notificacoes.sql']) {
  const db = new DatabaseSync(':memory:');
  for (const m of migrations) db.exec(readFileSync(m, 'utf8'));

  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const api = {
      bind(...a: unknown[]) {
        args = a;
        return api;
      },
      first<T>(): Promise<T | null> {
        const row = db.prepare(sql).get(...(args as never[]));
        return Promise.resolve((row as T) ?? null);
      },
      all<T>(): Promise<{ results: T[] }> {
        return Promise.resolve({ results: db.prepare(sql).all(...(args as never[])) as T[] });
      },
      run(): Promise<{ meta: { changes: number } }> {
        const r = db.prepare(sql).run(...(args as never[]));
        return Promise.resolve({ meta: { changes: Number(r.changes) } });
      },
    };
    return api;
  };

  return {
    d1: { prepare } as unknown as D1Database,
    /** Atalho para montar o cenario do teste. */
    exec: (sql: string) => db.exec(sql),
    consultar: <T>(sql: string): T[] => db.prepare(sql).all() as T[],
  };
}
