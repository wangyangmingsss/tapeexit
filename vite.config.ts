import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { licensePlugin } from './tools/license-plugin.ts';
import { version } from './package.json';
let commit = 'development';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* First build before initial commit. */ }
export default defineConfig(({ mode }) => ({
  plugins: [react(), licensePlugin(mode)],
  base: './',
  define: { __RELEASE__: JSON.stringify(`${version}-${commit}`) },
  build: { sourcemap: false, target: 'es2022' },
  server: { strictPort: true },
}));
