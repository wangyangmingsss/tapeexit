import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { assertGatewayRecoveryTask, type GatewayRecoveryTask } from './gateway-recovery-task';

export async function verifyBrowserRecovery(page: Page, task: GatewayRecoveryTask, mobile: boolean, output: string) {
  const chinese = page.getByRole('button', { name: '中文', exact: true });
  if (await chinese.isVisible()) await chinese.click();
  if (mobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: '恢复入口', exact: true }).click();
  await page.getByLabel('恢复仓位编号', { exact: true }).fill(task.tokenId);
  await page.getByLabel('原钱包公开地址', { exact: true }).fill(task.account);
  await page.getByLabel('已有交易完整哈希', { exact: true }).fill(task.hash);
  const attempts: { observedAt: string; status: string }[] = [];
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: '核验已有交易', exact: true }).click();
    const success = page.getByRole('status').filter({ hasText: '恢复核验完成：到账、剩余流动性及最终确认一致。' });
    const finished = page.getByRole('status').filter({ hasText: /恢复核验完成：|本次核验未完成：|本次核验超时|仍等待最终确认|核验未通过/ });
    await finished.waitFor({ timeout: 135000 });
    attempts.push({ observedAt: new Date().toISOString(), status: await finished.innerText() });
    if (await success.count()) {
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出核验结果', exact: true }).click();
      const download = await event, path = await download.path();
      if (!path) throw new Error('Recovery result export missing');
      const result = assertGatewayRecoveryTask(task, JSON.parse(await readFile(path, 'utf8')));
      await writeFile(output, JSON.stringify({ ...result, verificationAttempts: attempts }, null, 2) + '\n');
      return { status: 'FINALIZED_READ_ONLY_RECOVERY_MATCHED', tokenId: task.tokenId, hash: task.hash,
        walletConnected: false, transactionSent: false, attempts };
    }
  }
  throw new Error(`Read-only recovery task did not pass: ${JSON.stringify(attempts)}`);
}
