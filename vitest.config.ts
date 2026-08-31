import { defineConfig } from 'vitest/config';

// Fase 2 (motor): src/domain/ e' 100% funcao pura, sem I/O, roda em node.
// Fase 3 (integracao) adiciona um segundo projeto com @cloudflare/vitest-pool-workers
// para os testes que tocam D1/Queue.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
