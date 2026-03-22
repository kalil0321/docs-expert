import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const isDev = process.env.npm_lifecycle_event === 'dev';
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['./src/index.ts', './src/cli.ts'],
  format: ['esm'],
  minify: !isDev,
  target: 'esnext',
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __NAME__: JSON.stringify(pkg.name),
  },
});
