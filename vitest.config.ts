import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    server: {
      deps: {
        // `node:sqlite` e' builtin experimental; o Vite tenta resolver como
        // pacote e falha. Externalizar entrega ao require do proprio node.
        external: [/^node:sqlite$/],
      },
    },
  },
});
