import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { formatUnits, getAddress, zeroAddress, type Hex } from 'viem';
import { SOURCES } from './config';
import { StrictRpc, httpRequest } from './core/rpc';
import { parseTokenId } from './core/token-id';
import { downloadJson } from './core/storage';
import type { inspectRecoveryOutcome } from './core/recovery-outcome';

type Outcome = Awaited<ReturnType<typeof inspectRecoveryOutcome>>;
export default function RecoveryCheck({ lang }: { lang: 'zh' | 'en' }) {
  const zh = lang === 'zh';
  const [id, setId] = useState(''), [owner, setOwner] = useState(''), [hash, setHash] = useState('');
  const [result, setResult] = useState<{ outcome: Outcome; observedAt: string }>();
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [elapsed, setElapsed] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const clear = () => { setResult(undefined); setMessage(''); };
  const cancel = () => {
    active.current?.abort(); active.current = null; setBusy(false); setResult(undefined);
    setMessage(zh ? '核验已取消，尚无本次结果。' : 'Check cancelled; no current result.');
  };
  async function check() {
    if (active.current) return;
    setResult(undefined); setMessage(''); setElapsed(0);
    let tokenId: bigint, account: ReturnType<typeof getAddress>, tx: Hex;
    try {
      tokenId = parseTokenId(id); account = getAddress(owner);
      if (account === zeroAddress || !/^0x[a-f0-9]{64}$/i.test(hash)) throw new Error();
      tx = hash.toLowerCase() as Hex;
    } catch {
      setMessage(zh ? '请填写有效的仓位编号、原钱包地址和完整交易哈希。' : 'Enter a valid position ID, original wallet address and full transaction hash.');
      return;
    }
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
        return inspect(rpc, tx, tokenId, account);
      })(), aborted]);
      if (current() && !controller.signal.aborted) {
        setResult({ outcome, observedAt: new Date().toISOString() });
        setMessage(outcome.state === 'block-state-matched' && outcome.receipt.finalized
          ? (zh ? '恢复核验完成：到账、剩余流动性及最终确认一致。' : 'Recovery verified: arrivals, remaining liquidity and finality match.')
          : outcome.state === 'block-state-matched'
            ? (zh ? '到账与流动性匹配，仍等待最终确认。' : 'Arrivals and liquidity match; finality pending.')
            : (zh ? '核验未通过，请保留记录后复核。' : 'Verification incomplete; retain the record for review.'));
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
        {busy && <button type="button" className="icon-button" aria-label={zh ? '取消恢复核验' : 'Cancel recovery check'} onClick={cancel}><X size={16} /></button>}
        {result && <button type="button" className="secondary-button" onClick={() => downloadJson('tapeexit-recovery-verification.json', {
          schemaVersion: 1, environment: 'MAINNET_READ_ONLY', signingApproved: false, ...result,
        })}><Download size={15} />{zh ? '导出核验结果' : 'Export verification'}</button>}
      </div>
    </form>
    <p role="status" aria-live="polite">{busy
      ? (zh ? `核验已等待 ${elapsed} 秒，超时倒计时 ${Math.max(0, 120 - elapsed)} 秒。` : `Checking for ${elapsed}s; timeout in ${Math.max(0, 120 - elapsed)}s.`)
      : message}</p>
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
