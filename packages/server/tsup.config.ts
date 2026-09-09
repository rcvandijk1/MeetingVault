import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The core package is TypeScript source in the workspace; inline it into the bundle.
  noExternal: ['@kfr/core'],
});
