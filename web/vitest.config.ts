import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // .tsx too: the icon cell is a component, and what it renders is worth asserting rather
    // than inferring from its props.
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
