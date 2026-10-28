import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { gzipSync } from 'node:zlib';

export function licensePlugin(mode: string): Plugin {
  let graphModules: string[] = [];
  let packageInventory: unknown[] = [];
  return {
    name: 'tapeexit-license-evidence',
    generateBundle(_options, bundle) {
      const modules = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') for (const id of Object.keys(output.modules)) modules.add(id);
      }
      const packages = new Set<string>();
      for (const id of modules) {
        const match = id.replaceAll('\\', '/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/);
        if (match) packages.add(match[1]);
      }
      const inventory = [];
      const notices = ['TapeExit third-party notices', 'Package inventory follows the bundler module graph; it may include tree-shaken modules.'];
      for (const dir of [...packages].sort()) {
        const metadata = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
        const licenses = readdirSync(dir).filter(name => /^(licen[cs]e|copying)(\.|-|$)/i.test(name));
        inventory.push({ name: metadata.name, version: metadata.version, license: metadata.license, licenseFiles: licenses,
          path: dir.replaceAll(resolve('.'), '<project>') });
        notices.push(`\n=== ${metadata.name}@${metadata.version} ===\nLicense: ${JSON.stringify(metadata.license)}\n`);
        if (!licenses.length) {
          // Ethers v5 scoped tarballs omit the root repository license.
          if (metadata.name.startsWith('@ethersproject/') && metadata.version.startsWith('5.'))
            notices.push(readFileSync('docs/licenses/ethers-v5-LICENSE.md', 'utf8'));
          else throw new Error(`Missing redistributable license text: ${metadata.name}`);
        }
        for (const name of licenses) notices.push(readFileSync(resolve(dir, name), 'utf8'));
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: notices.join('\n') });
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync('LICENSE', 'utf8') });
      graphModules = [...modules].map(id => id.replaceAll(resolve('.'), '<project>')).sort();
      packageInventory = inventory;
    },
    writeBundle(options, bundle) {
      if (!options.dir) throw new Error('License evidence requires a directory build');
      mkdirSync('release-artifacts', { recursive: true });
      const chunks = Object.values(bundle).filter(output => output.type === 'chunk').map(output => {
        // Vite rewrites dynamic-import preload paths after generateBundle.
        const bytes = readFileSync(resolve(options.dir!, output.fileName));
        return { path: output.fileName, sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length,
          entry: output.isEntry, imports: output.imports, dynamicImports: output.dynamicImports,
          modules: Object.keys(output.modules).map(id => id.replaceAll(resolve('.'), '<project>')).sort() };
      }).sort((a, b) => a.path.localeCompare(b.path));
      writeFileSync(`release-artifacts/bundled-modules-${mode}.json`, JSON.stringify({
        schemaVersion: 1, mode, lockSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
        chunks, modules: graphModules, packages: packageInventory,
      }, null, 2) + '\n');
    },
  };
}
