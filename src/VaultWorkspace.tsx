import { useEffect, useRef, useState } from 'react';
import { Download, Landmark, LoaderCircle, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { formatUnits, type Address } from 'viem';
import { SOURCES } from './config';
import { StrictRpc, httpRequest } from './core/rpc';
import { SparkVaultAdapter, vaultAccount, vaultPlan, type VaultSnapshot, type VaultPreview } from './core/vault-adapter';
import { SPARK_USDC } from './core/vault-config';
import { clearVaultRecovery, importVaultRecovery, inspectVaultRecovery, loadVaultRecovery,
  saveVaultRecovery, vaultRecoveryTask, type VaultRecoveryTask } from './core/vault-recovery';
import { downloadJson } from './core/storage';
import './vault.css';

const DEMO = import.meta.env.VITE_DEMO === 'true';
const demoVault = DEMO ? import('./demo/vault') : null;
type Outcome = Awaited<ReturnType<typeof inspectVaultRecovery>>;
const TIMEOUT = 90000;
export default function VaultWorkspace({ account, lang, simulated = false }:
  { account?: Address; lang: 'zh' | 'en'; simulated?: boolean }) {
  const zh = lang === 'zh';
  const [owner, setOwner] = useState(account ?? '');
  const [snapshot, setSnapshot] = useState<VaultSnapshot>();
  const [preview, setPreview] = useState<VaultPreview>();
  const [bps, setBps] = useState(10000);
  const [saved] = useState(() => simulated ? undefined : loadVaultRecovery());
  const [recoveryOwner, setRecoveryOwner] = useState(saved?.account ?? '');
  const [hash, setHash] = useState(saved?.hash ?? '');
  const [outcome, setOutcome] = useState<Outcome>();
  const [busy, setBusy] = useState(false), [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState(''), [storageFailed, setStorageFailed] = useState(false);
  const active = useRef<AbortController | null>(null), epoch = useRef(0), input = useRef<HTMLInputElement>(null);
  const amount = (value: bigint | string) => formatUnits(BigInt(value), 6);
  const cancel = () => {
    epoch.current++; active.current?.abort(); active.current = null; setBusy(false);
    setMessage(zh ? '已取消，本次结果未保存。' : 'Cancelled; no current result saved.');
  };
  useEffect(() => {
    epoch.current++; active.current?.abort(); active.current = null;
    setOwner(account ?? ''); setSnapshot(undefined); setPreview(undefined); setOutcome(undefined);
    setBusy(false); setMessage('');
    return () => { epoch.current++; active.current?.abort(); active.current = null; };
  }, [account]);
  function invalidate() { epoch.current++; setPreview(undefined); setMessage(''); }
  async function perform<T>(work: (rpc: StrictRpc) => Promise<T>, accept: (value: T) => void) {
    if (active.current) return;
    const controller = new AbortController(), current = ++epoch.current;
    active.current = controller; setBusy(true); setElapsed(0); setMessage('');
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);
    let rejectAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error('Verification timed out'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
      const rpc = new StrictRpc(SOURCES, async (source, method, params) => {
        controller.signal.throwIfAborted();
        const value = await httpRequest(source, method, params);
        controller.signal.throwIfAborted();
        return value;
      });
      const value = await Promise.race([work(rpc), aborted]);
      if (epoch.current === current && !controller.signal.aborted) accept(value);
    } catch (error) {
      if (epoch.current === current) setMessage(
        (zh ? '本次查询未完成：' : 'Query incomplete: ') +
        (error instanceof Error ? error.message.slice(0, 220) : 'RPC error'));
    } finally {
      clearInterval(interval); clearTimeout(timeout);
      controller.signal.removeEventListener('abort', rejectAbort);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  function readPosition() {
    setSnapshot(undefined); setPreview(undefined);
    void perform(async rpc => {
      const address = vaultAccount(owner.trim());
      if (simulated) {
        if (!demoVault) throw new Error('Simulation unavailable');
        return (await demoVault).snapshot(address);
      }
      return new SparkVaultAdapter(rpc).snapshot(address);
    }, value => {
      setSnapshot(value);
      setMessage(value.shares === 0n ? (zh ? '查询完成：该地址未持有 spUSDC 份额。' : 'No spUSDC shares held by this address.') :
        value.maxRedeem === 0n ? (zh ? '已读取份额，当前无可赎回额度。' : 'Shares found; no redeemable capacity currently available.') : '');
    });
  }
  function simulateExit() {
    if (!snapshot) return;
    setPreview(undefined);
    void perform(async rpc => {
      const plan = vaultPlan(snapshot, snapshot.shares * BigInt(bps) / 10000n);
      if (simulated) {
        if (!demoVault) throw new Error('Simulation unavailable');
        return (await demoVault).simulate(plan);
      }
      return new SparkVaultAdapter(rpc).simulate(plan);
    }, value => setPreview(value));
  }
  function checkRecovery() {
    setOutcome(undefined);
    void perform(async rpc => {
      if (simulated) throw new Error('Existing mainnet transactions are checked in the read-only application');
      const task = vaultRecoveryTask(recoveryOwner.trim(), hash.trim());
      setStorageFailed(!saveVaultRecovery(task));
      return inspectVaultRecovery(rpc, task);
    }, value => {
      setOutcome(value);
      setMessage(value.state === 'verified' ? (zh ? '核验完成：USDC 到账、份额销毁、剩余份额及最终确认一致。' : 'Verified: USDC receipt, burned and remaining shares, and finality match.') :
        value.state === 'pending' ? (zh ? '交易尚未确认，请保留哈希稍后核验。' : 'Pending; retain the hash and check again later.') :
        value.state === 'reverted' ? (zh ? '交易已回滚，未完成赎回。' : 'Transaction reverted; redemption not completed.') :
        value.state === 'awaiting-finality' ? (zh ? '到账与份额匹配，等待最终确认。' : 'Assets and shares match; finality pending.') :
        (zh ? '事件已匹配，但区块余额变化不一致，需复核同区块其他活动。' : 'Events match, but block balance changes differ. Review other activity in the same block.'));
    });
  }
  function exportHints() {
    try {
      const task = vaultRecoveryTask(recoveryOwner.trim(), hash.trim());
      downloadJson('tapeexit-spark-vault-recovery.json', task);
    } catch { setMessage(zh ? '请填写原钱包地址和完整交易哈希。' : 'Enter the original wallet address and complete hash.'); }
  }
  async function importRecord(file: File) {
    const current = ++epoch.current; setOutcome(undefined); setMessage('');
    try {
      if (file.size > 16384) throw new Error('Record too large');
      const task: VaultRecoveryTask = importVaultRecovery(await file.text());
      if (current !== epoch.current || active.current) return;
      setRecoveryOwner(task.account); setHash(task.hash); setStorageFailed(!saveVaultRecovery(task));
      setMessage(zh ? '恢复线索已导入，请重新核验链上状态。' : 'Recovery hints imported. Recheck the chain state.');
    } catch { if (current === epoch.current) setMessage(zh ? '恢复文件无效或不属于本链上的 Spark USDC 金库。' : 'Invalid recovery file or a different vault or chain.'); }
  }
  const selected = snapshot ? snapshot.shares * BigInt(bps) / 10000n : 0n;
  return <section className="vault-workspace" aria-label={zh ? 'Spark USDC 金库' : 'Spark USDC vault'}>
    <div className="vault-header"><Landmark size={23} /><div><h2>Spark Savings USDC</h2><span>spUSDC / USDC · X Layer · {simulated ? (zh ? '模拟资产' : 'Simulated assets') : (zh ? '主网只读' : 'Mainnet read only')}</span></div></div>
    <dl className="vault-identity"><div><dt>{zh ? '金库合约' : 'Vault contract'}</dt><dd><code>{SPARK_USDC.vault}</code></dd></div>
      <div><dt>{zh ? '底层资产' : 'Underlying asset'}</dt><dd><code>{SPARK_USDC.asset}</code></dd></div></dl>
    <form className="vault-query" onSubmit={e => { e.preventDefault(); readPosition(); }}>
      <label htmlFor="vault-owner">{zh ? '持有人公开地址' : 'Holder public address'}</label>
      <div className="input-row"><input id="vault-owner" value={owner} disabled={busy} autoComplete="off" spellCheck={false}
        onChange={e => { invalidate(); setOwner(e.target.value); setSnapshot(undefined); }} />
        <button className="secondary-button" disabled={busy || !owner.trim()}><RefreshCw size={15} />{zh ? '读取金库份额' : 'Read vault shares'}</button></div>
    </form>
    {snapshot && <div className="vault-position">
      <dl className="vault-metrics">
        <div><dt>{zh ? '读取区块' : 'Read at block'}</dt><dd>{BigInt(snapshot.block.number).toString()}</dd></div>
        <div><dt>{zh ? '持有份额' : 'Shares held'}</dt><dd>{amount(snapshot.shares)} spUSDC</dd></div>
        <div><dt>{zh ? '折算资产' : 'Asset equivalent'}</dt><dd>{amount(snapshot.assets)} USDC</dd></div>
        <div><dt>{zh ? '当前最多可赎回份额' : 'Currently redeemable shares'}</dt><dd>{amount(snapshot.maxRedeem)} spUSDC</dd></div>
        <div><dt>{zh ? '当前最多可提取资产' : 'Currently withdrawable assets'}</dt><dd>{amount(snapshot.maxWithdraw)} USDC</dd></div>
      </dl>
      <div className="vault-controls"><label htmlFor="vault-percentage">{zh ? '赎回比例' : 'Redeem percentage'} <strong>{bps / 100}%</strong></label>
        <input id="vault-percentage" type="range" min="100" max="10000" step="100" value={bps} disabled={busy}
          onChange={e => { invalidate(); setBps(Number(e.target.value)); }} />
        <div className="segments">{[2500, 5000, 7500, 10000].map(n => <button type="button" key={n} disabled={busy}
          className={bps === n ? 'selected' : ''} onClick={() => { invalidate(); setBps(n); }}>{n / 100}%</button>)}</div>
        <button className="primary-button" disabled={busy || selected === 0n || selected > snapshot.maxRedeem} onClick={simulateExit}>
          <RefreshCw size={16} />{zh ? '预演金库赎回' : 'Simulate vault redemption'}</button>
        {selected > snapshot.maxRedeem && <p role="status">{zh ? '选定份额超过当前可赎回额度，请降低比例。' : 'Selected shares exceed current capacity. Reduce the percentage.'}</p>}
      </div>
    </div>}
    {preview && <section className="vault-preview" aria-label={zh ? '金库退出预览' : 'Vault exit preview'}>
      <h3>{zh ? '赎回预览' : 'Redemption preview'}</h3><dl className="vault-metrics">
        <div><dt>{zh ? '预计到账' : 'Estimated receipt'}</dt><dd>{amount(preview.assets)} USDC</dd></div>
        <div><dt>{zh ? '销毁份额' : 'Shares burned'}</dt><dd>{amount(preview.shares)} spUSDC</dd></div>
        <div><dt>{zh ? '预计剩余份额' : 'Expected remaining shares'}</dt><dd>{amount(preview.remainingShares)} spUSDC</dd></div>
        <div><dt>{zh ? '网络费估算（Gas 部分）' : 'Estimated fee (EVM gas portion)'}</dt><dd>{formatUnits(preview.gas * preview.gasPrice, 18)} OKB</dd></div>
      </dl><p>{zh ? '本次为只读模拟，不会发送交易。预估到账不构成最低到账保证。' : 'Read-only simulation; no transaction is sent. The estimate is not a minimum receipt guarantee.'}</p>
    </section>}
    {!simulated && <section className="vault-recovery" aria-label={zh ? '金库交易恢复' : 'Vault transaction recovery'}>
      <h3>{zh ? '已有赎回交易核验' : 'Verify an existing redemption'}</h3>
      <form onSubmit={e => { e.preventDefault(); checkRecovery(); }}>
        <label htmlFor="vault-recovery-owner">{zh ? '赎回钱包公开地址' : 'Redemption public wallet address'}</label>
        <input id="vault-recovery-owner" value={recoveryOwner} disabled={busy} autoComplete="off" spellCheck={false}
          onChange={e => { invalidate(); setOutcome(undefined); setRecoveryOwner(e.target.value); }} />
        <label htmlFor="vault-recovery-hash">{zh ? '金库赎回交易哈希' : 'Vault redemption transaction hash'}</label>
        <input id="vault-recovery-hash" value={hash} disabled={busy} maxLength={66} autoComplete="off" spellCheck={false}
          onChange={e => { invalidate(); setOutcome(undefined); setHash(e.target.value); }} />
        <div className="recovery-actions">
          <button className="secondary-button" disabled={busy || !hash || !recoveryOwner}><RefreshCw size={15} />{zh ? '核验金库赎回' : 'Verify vault redemption'}</button>
          <button type="button" className="secondary-button" disabled={busy || !hash || !recoveryOwner} onClick={exportHints}><Download size={15} />{zh ? '保存金库恢复记录' : 'Save vault recovery record'}</button>
          <input ref={input} type="file" accept=".json,application/json" hidden disabled={busy}
            aria-label={zh ? '金库恢复文件' : 'Vault recovery file'}
            onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void importRecord(file); }} />
          <button type="button" className="secondary-button" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} />{zh ? '导入金库恢复记录' : 'Import vault recovery record'}</button>
          <button type="button" className="icon-button" disabled={busy} title={zh ? '清除金库线索' : 'Clear vault hints'} aria-label={zh ? '清除金库线索' : 'Clear vault hints'}
            onClick={() => { invalidate(); setOutcome(undefined); setRecoveryOwner(''); setHash(''); setStorageFailed(!clearVaultRecovery()); }}><Trash2 size={16} /></button>
        </div>
      </form>
      {outcome && 'assets' in outcome && <dl className="vault-metrics">
        <div><dt>{zh ? '核对到账' : 'Checked receipt'}</dt><dd>{amount(outcome.assets!)} USDC</dd></div>
        <div><dt>{zh ? '剩余份额' : 'Remaining shares'}</dt><dd>{amount(outcome.remainingShares!)} spUSDC</dd></div>
        <div><dt>{zh ? '最终确认' : 'Finalized'}</dt><dd>{String(outcome.finalized)}</dd></div>
      </dl>}
      {outcome && <button className="secondary-button" onClick={() => downloadJson('tapeexit-spark-vault-verification.json', outcome)}><Download size={15} />{zh ? '导出金库核验结果' : 'Export vault verification'}</button>}
      {storageFailed && <p role="alert">{zh ? '浏览器未能保存线索，请导出恢复记录。' : 'Browser storage unavailable; export the recovery record.'}</p>}
    </section>}
    {busy && <div className="vault-progress"><LoaderCircle size={16} className="spin" /><span role="status">{zh ? `查询已等待 ${elapsed} 秒，超时倒计时 ${Math.max(0, 90 - elapsed)} 秒。` : `Checking for ${elapsed}s; timeout in ${Math.max(0, 90 - elapsed)}s.`}</span>
      <button className="icon-button" onClick={cancel} title={zh ? '取消金库查询' : 'Cancel vault query'} aria-label={zh ? '取消金库查询' : 'Cancel vault query'}><X size={17} /></button></div>}
    {message && <p className="vault-message" role="status" aria-live="polite">{message}</p>}
  </section>;
}
