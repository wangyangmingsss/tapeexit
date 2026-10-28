import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
it('closes the actual IPC request client so a standalone tool exits without lingering timers', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--eval',
    "import {startLocalEvm} from './tools/local-evm'; void(async()=>{const evm=await startLocalEvm();" +
    "try{await evm.request('eth_blockNumber');}finally{await evm.close();}console.log('closed');})();",
  ], { timeout: 15000 });
  expect(stdout.trim()).toBe('closed');
}, 20000);
