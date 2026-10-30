import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { licensePlugin } from './tools/license-plugin.ts';
import pkg from './package.json' with { type: 'json' };
let sourceCommit = 'development', sourceDirty = true;
try {
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  sourceDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
} catch { /* First build before initial commit. */ }
const commit = sourceCommit.slice(0, 7);
export default defineConfig(({ mode }) => ({
  plugins: [react(), licensePlugin(mode), {
    name: 'release-identity',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'release-info.json', source: JSON.stringify({
        app: 'TapeExit', version: pkg.version, release: `${pkg.version}-${commit}`, sourceCommit, sourceDirty,
        channel: mode === 'demo' ? 'simulation' : 'readonly', signingApproved: false,
      }, null, 2) + '\n' });
    },
  }],
  base: './',
  define: { __RELEASE__: JSON.stringify(`${pkg.version}-${commit}`) },
  build: { sourcemap: false, target: 'es2022' },
  server: { strictPort: true },
}));
