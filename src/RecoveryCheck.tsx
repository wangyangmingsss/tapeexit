import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { formatUnits } from 'viem';
import { SOURCES } from './config';
import { StrictRpc, httpRequest } from './core/rpc';
import { downloadJson } from './core/storage';
import { clearRecoveryTask, importRecoveryTask, loadRecoveryTask, recoveryTask, saveRecoveryTask, type RecoveryTask } from './core/recovery-task';
import type { inspectRecoveryOutcome } from './core/recovery-outcome';

type Outcome = Awaited<ReturnType<typeof inspectRecoveryOutcome>>;
const RETRY_DELAY = 3000, MAX_CHECKS = 10;
export default function RecoveryCheck({ lang }: { lang: 'zh' | 'en' }) {
  const zh = lang === 'zh';
  const [saved] = useState(loadRecoveryTask);
  const [id, setId] = useState(saved?.tokenId ?? ''), [owner, setOwner] = useState(saved?.account ?? ''), [hash, setHash] = useState(saved?.hash ?? '');
  const [result, setResult] = useState<{ task: RecoveryTask; outcome: Outcome; observedAt: string }>();
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [elapsed, setElapsed] = useState(0);
  const [auto, setAuto] = useState(true), [retryAt, setRetryAt] = useState<number>();
  const [retrySeconds, setRetrySeconds] = useState(0), [storageFailed, setStorageFailed] = useState(false);
  const checks = useRef(0), autoEnabled = useRef(true);
  const importGeneration = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { importGeneration.current++; active.current?.abort(); active.current = null; }, []);
  useEffect(() => {
    if (retryAt === undefined || !auto) return;
    const remaining = () => setRetrySeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    remaining();
    const interval = setInterval(remaining, 1000);
    const timer = setTimeout(() => { setRetryAt(undefined); void check(true); }, Math.max(0, retryAt - Date.now()));
    return () => { clearInterval(interval); clearTimeout(timer); };
  }, [retryAt, auto]);
  const clear = () => { importGeneration.current++; setRetryAt(undefined); setResult(undefined); setMessage(''); };
  const cancel = () => {
    active.current?.abort(); active.current = null; setRetryAt(undefined); setBusy(false); setResult(undefined);
    setMessage(zh ? '核验已取消，尚无本次结果。' : 'Check cancelled; no current result.');
  };
  async function check(automatic = false) {
    if (active.current) return;
    importGeneration.current++;
    setRetryAt(undefined); setResult(undefined); setMessage(''); setElapsed(0);
    if (!automatic) checks.current = 0;
    let task: RecoveryTask;
    try {
      task = recoveryTask(id, owner, hash);
    } catch {
      setMessage(zh ? '请填写有效的仓位编号、原钱包地址和完整交易哈希。' : 'Enter a valid position ID, original wallet address and full transaction hash.');
      return;
    }
    setStorageFailed(!saveRecoveryTask(task));
    checks.current++;
    const controller = new AbortController(); active.current = controller; setBusy(true);
    const start = Date.now();
    const timer = setInterval(() => {
      if (active.current === controller) setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    const timeout = setTimeout(() => controller.abort(), 120000);
    const current = () => active.current === controller;
    let abortCheck = () => {};
    const aborted = new Promise<never>((_, reject) => {
      abortCheck = () => reject(new Error('Recovery check aborted'));
      controller.signal.addEventListener('abort', abortCheck, { once: true });
    });
    try {
      const rpc = new StrictRpc(SOURCES, async (source, method, params) => {
        controller.signal.throwIfAborted();
        const value = await httpRequest(source, method, params);
        controller.signal.throwIfAborted();
        return value;
      });
      const outcome = await Promise.race([(async () => {
        const { inspectRecoveryOutcome: inspect } = await import('./core/recovery-outcome');
        controller.signal.throwIfAborted();
        return inspect(rpc, task.hash, BigInt(task.tokenId), task.account);
      })(), aborted]);
      if (current() && !controller.signal.aborted) {
        setResult({ task, outcome, observedAt: new Date().toISOString() });
        setMessage(outcome.state === 'block-state-matched' && outcome.receipt.finalized
          ? (zh ? '恢复核验完成：到账、剩余流动性及最终确认一致。' : 'Recovery verified: arrivals, remaining liquidity and finality match.')
          : outcome.state === 'block-state-matched'
            ? (zh ? '到账与流动性匹配，仍等待最终确认。' : 'Arrivals and liquidity match; finality pending.')
            : outcome.state === 'pending'
              ? (zh ? '交易尚未确认，保留哈希等待核验，无需重发。' : 'Transaction pending; retain the hash and do not resend.')
              : outcome.state === 'reverted'
                ? (zh ? '交易已回滚，未完成退出。' : 'Transaction reverted; exit not completed.')
                : (zh ? '核验未通过，请保留记录后复核。' : 'Verification incomplete; retain the record for review.'));
        const waiting = outcome.state === 'pending' ||
          outcome.state === 'block-state-matched' && !outcome.receipt.finalized;
        if (waiting && autoEnabled.current) {
          if (checks.current < MAX_CHECKS) setRetryAt(Date.now() + RETRY_DELAY);
          else setMessage(zh ? '自动核验已达到 10 次，记录保留；请稍后手动重新核验，无需重发。'
            : 'Automatic checks paused after 10 attempts. Keep the record and retry verification later; do not resend.');
        }
      }
    } catch (error) {
      if (current()) setMessage(controller.signal.aborted
        ? (zh ? '本次核验超时，请稍后重试。' : 'Check timed out; retry later.')
        : (zh ? '本次核验未完成：' : 'Check incomplete: ') + (error instanceof Error ? error.message.slice(0, 240) : 'RPC error'));
    } finally {
      clearInterval(timer); clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abortCheck);
      if (current()) { active.current = null; setBusy(false); }
    }
  }
  async function importRecord(file: File) {
    const generation = ++importGeneration.current;
    setRetryAt(undefined); setResult(undefined); setMessage('');
    try {
      if (file.size > 65536) throw new Error('Recovery record too large');
      const text = await file.text();
      if (importGeneration.current !== generation || active.current) return;
      const task = importRecoveryTask(text);
      setId(task.tokenId); setOwner(task.account); setHash(task.hash);
      setStorageFailed(!saveRecoveryTask(task));
      setMessage(zh ? '交易信息已导入，请重新核验到账和最终确认。' : 'Transaction details imported; verify arrivals and finality again.');
    } catch {
      if (importGeneration.current === generation && !active.current)
        setMessage(zh ? '恢复记录无效、过大或不属于当前链与管理器。' : 'Invalid or oversized recovery record, or deployment mismatch.');
    }
  }
  return <section className="recovery-check" aria-label={zh ? '已有交易恢复核验' : 'Verify an existing transaction'}>
    <h3>{zh ? '已有交易恢复核验' : 'Verify an existing transaction'}</h3>
    <form onSubmit={event => { event.preventDefault(); void check(); }}>
      <label htmlFor="recovery-check-id">{zh ? '恢复仓位编号' : 'Recovery position ID'}</label>
      <input id="recovery-check-id" inputMode="numeric" value={id} disabled={busy} onChange={e => { clear(); setId(e.target.value); }} />
      <label htmlFor="recovery-check-owner">{zh ? '原钱包公开地址' : 'Original public wallet address'}</label>
      <input id="recovery-check-owner" autoComplete="off" spellCheck={false} value={owner} disabled={busy} onChange={e => { clear(); setOwner(e.target.value.trim()); }} />
      <label htmlFor="recovery-check-hash">{zh ? '已有交易完整哈希' : 'Existing transaction hash'}</label>
      <input id="recovery-check-hash" autoComplete="off" spellCheck={false} maxLength={66} value={hash} disabled={busy} onChange={e => { clear(); setHash(e.target.value.trim()); }} />
      <div className="recovery-actions">
        <button className="secondary-button" type="submit" disabled={busy || !id || !owner || !hash}><RefreshCw size={15} className={busy ? 'spin' : ''} />{zh ? '核验已有交易' : 'Verify existing transaction'}</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden disabled={busy}
          aria-label={zh ? '交易恢复记录文件' : 'Transaction recovery record file'}
          onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
            if (file) void importRecord(file);
          }} />
        <button type="button" className="secondary-button" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload size={15} />{zh ? '导入交易恢复记录' : 'Import transaction recovery record'}
        </button>
        {(busy || retryAt !== undefined) && <button type="button" className="icon-button" aria-label={zh ? '取消恢复核验' : 'Cancel recovery check'} onClick={cancel}><X size={16} /></button>}
        <label><input type="checkbox" checked={auto} disabled={busy} onChange={event => {
          autoEnabled.current = event.target.checked; setAuto(event.target.checked);
          if (!event.target.checked) setRetryAt(undefined);
        }} />{zh ? '自动核验' : 'Automatic verification'}</label>
        <button type="button" className="icon-button" disabled={busy || !id && !owner && !hash}
          aria-label={zh ? '清除恢复线索' : 'Clear recovery hints'} title={zh ? '清除恢复线索' : 'Clear recovery hints'}
          onClick={() => {
            clear(); setId(''); setOwner(''); setHash(''); setStorageFailed(!clearRecoveryTask());
          }}><Trash2 size={16} /></button>
        {result && <button type="button" className="secondary-button" onClick={() => downloadJson('tapeexit-recovery-verification.json', {
          schemaVersion: 1, environment: 'MAINNET_READ_ONLY', signingApproved: false, ...result,
        })}><Download size={15} />{zh ? '导出核验结果' : 'Export verification'}</button>}
      </div>
    </form>
    <p role="status" aria-live="polite">{busy
      ? (zh ? `核验已等待 ${elapsed} 秒，超时倒计时 ${Math.max(0, 120 - elapsed)} 秒。` : `Checking for ${elapsed}s; timeout in ${Math.max(0, 120 - elapsed)}s.`)
      : message}</p>
    {retryAt !== undefined && <p role="status">{zh ? `${retrySeconds} 秒后自动进行第 ${checks.current + 1} 次核验。` : `Check ${checks.current + 1} starts in ${retrySeconds}s.`}</p>}
    {saved && id === saved.tokenId && owner === saved.account && hash === saved.hash && !result && !message &&
      <p className="field-hint">{zh ? '已恢复上次填写的交易信息，请重新核验链上状态。' : 'Previous transaction details restored; verify the current chain state.'}</p>}
    {storageFailed && <p role="alert">{zh ? '浏览器未保存恢复线索，请保留交易哈希；当前链上核验不受影响。' : 'Recovery hints could not be saved. Retain the hash; chain verification remains available.'}</p>}
    {result && result.outcome.receipt && <dl>
      <dt>{zh ? '最终确认' : 'Finalized'}</dt><dd>{String(result.outcome.receipt.finalized)}</dd>
      <dt>{zh ? '剩余流动性' : 'Remaining liquidity'}</dt><dd>{result.outcome.liquidity.after}</dd>
      {result.outcome.balances.map(asset => <div key={asset.address}>
        <dt>{asset.symbol}</dt><dd>{formatUnits(BigInt(asset.delta), asset.decimals)}</dd>
      </div>)}
    </dl>}
    <p className="field-hint">{zh ? '仅核对公开链上记录；区块末余额核对不能隔离同区块的其他活动。' : 'Public chain records only; block-end balances cannot isolate other activity in the same block.'}</p>
  </section>;
}
