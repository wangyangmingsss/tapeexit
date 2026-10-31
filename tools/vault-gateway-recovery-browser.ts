import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { assertVaultGatewayRecoveryTask, type VaultGatewayRecoveryTask } from './vault-gateway-recovery-task';

export async function verifyVaultBrowserRecovery(page: Page, task: VaultGatewayRecoveryTask,
  mobile: boolean, output: string) {
  const chinese = page.getByRole('button', { name: '中文', exact: true });
  if (await chinese.isVisible()) await chinese.click();
  if (mobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'USDC 金库', exact: true }).click();
  await page.getByLabel('金库恢复文件', { exact: true }).setInputFiles({
    name: 'tapeexit-spark-vault-recovery.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(task.recovery)),
  });
  await page.getByRole('status').filter({ hasText: '恢复线索已导入，请重新核验链上状态。' }).waitFor();
  if (await page.getByRole('button', { name: '导出金库核验结果', exact: true }).count())
    throw new Error('Import incorrectly restored a verified outcome');
  // A fresh page must retain only the recovery hints, then obtain new chain evidence.
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await chinese.isVisible()) await chinese.click();
  if (mobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'USDC 金库', exact: true }).click();
  const owner = page.getByLabel('赎回钱包公开地址', { exact: true });
  const hash = page.getByLabel('金库赎回交易哈希', { exact: true });
  if (await owner.inputValue() !== task.recovery.account || await hash.inputValue() !== task.recovery.hash ||
      await page.getByRole('button', { name: '导出金库核验结果', exact: true }).count())
    throw new Error('Recovery hints or unverified state did not survive reload');
  const attempts: { observedAt: string; status: string }[] = [];
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: '核验金库赎回', exact: true }).click();
    const finished = page.getByRole('status').filter({
      hasText: /核验完成：USDC|本次查询未完成：|等待最终确认|区块余额变化不一致|交易尚未确认|交易已回滚/,
    });
    await finished.waitFor({ timeout: 100000 });
    const status = await finished.innerText();
    attempts.push({ observedAt: new Date().toISOString(), status });
    if (!status.startsWith('核验完成：USDC')) continue;
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出金库核验结果', exact: true }).click();
    const download = await event, path = await download.path();
    if (!path) throw new Error('Vault verification export missing');
    const outcome = assertVaultGatewayRecoveryTask(task, JSON.parse(await readFile(path, 'utf8')));
    const result = { schemaVersion: 1, observedAt: new Date().toISOString(), outcome,
      verificationAttempts: attempts, importedRecoveryFile: true, persistedAfterReload: true,
      walletConnected: false, transactionSent: false, signingApproved: false };
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    return { status: 'FINALIZED_READ_ONLY_RECOVERY_MATCHED', protocolId: task.protocolId,
      hash: task.recovery.hash, importedRecoveryFile: true, persistedAfterReload: true,
      walletConnected: false, transactionSent: false, attempts };
  }
  throw new Error(`Vault recovery did not pass: ${JSON.stringify(attempts)}`);
}
