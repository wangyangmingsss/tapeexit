import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
describe('targeted transitive dependency fixes', () => {
  it('keeps solc temporary-file creation and removal working with the patched tmp', () => {
    const solcRequire = createRequire(require.resolve('solc'));
    const tmp = solcRequire('tmp');
    expect(solcRequire('tmp/package.json').version).toBe('0.2.7');
    const file = tmp.fileSync({ postfix: '.smt2', discardDescriptor: true });
    try { expect(existsSync(file.name)).toBe(true); }
    finally { file.removeCallback(); }
    expect(existsSync(file.name)).toBe(false);
  });
  it('preserves patch generation/application for the installed Mocha diff dependency', () => {
    const hardhatRequire = createRequire(require.resolve('hardhat/package.json'));
    const mochaRequire = createRequire(hardhatRequire.resolve('mocha/package.json'));
    const diff = mochaRequire('diff');
    const oldText = 'first\nsecond\n', newText = 'first\nthird\n';
    expect(diff.applyPatch(oldText, diff.createPatch('fixture', oldText, newText))).toBe(newText);
    const serializer = mochaRequire('serialize-javascript');
    const serialized = serializer({ payload: '</script><script>bad()</script>', date: new Date(0) });
    expect(serialized).not.toContain('</script');
    expect(serialized).toContain('1970-01-01');
    // Verify the exact resolved package rather than assuming the root package is used.
    const packageFile = mochaRequire.resolve('serialize-javascript/package.json');
    expect(JSON.parse(readFileSync(packageFile, 'utf8')).version).toBe('7.1.3');
  });
});
