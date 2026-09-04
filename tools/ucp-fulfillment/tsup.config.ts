import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/core.ts'],
  format: ['esm'],
  dts: true,
  target: 'node20',
  clean: true,
  sourcemap: true,
  esbuildOptions(options) {
    // Leave node: prefixes and bare dependency specifiers alone. Rewriting node:crypto to
    // crypto would let a non-Node bundler silently substitute a browser shim.
    options.packages = 'external';
  },
});
