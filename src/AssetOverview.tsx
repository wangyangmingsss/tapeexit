import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, RefreshCw, Wallet, X } from 'lucide-react';
import type { Address } from 'viem';
import type { V3Adapter } from './core/adapter';
import { readPortfolio, type PortfolioPage } from './core/portfolio';
import { isExcludedAsset } from './core/asset-policy';
import type { DemoEngine, Fault } from './demo/engine';
import { PROTOCOL_COVERAGE } from './product';

export default function AssetOverview({ account, adapter, demo, simulated, fault, lang, locked, onSelect, onConnect, onOpenVault }:
  { account?: Address; adapter: V3Adapter; demo?: DemoEngine; simulated: boolean; fault: Fault;
    lang: 'zh' | 'en'; locked: boolean; onSelect: (id: string) => void; onConnect: () => void; onOpenVault?: () => void }) {
  const zh = lang === 'zh';
  const [page, setPage] = useState<PortfolioPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  async function load(offset = 0n, pinned?: PortfolioPage['block']) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true); setError(false); setPage(undefined);
    try {
      if (!account) return;
      let result: PortfolioPage;
      if (simulated) {
        if (!demo) return;
        const snapshot = await demo.demoSnapshot(28491n, fault);
        result = { owner: account, block: snapshot.block, total: 1n, offset: 0n, next: null,
          tokenIds: [snapshot.tokenId], entries: [{ tokenId: snapshot.tokenId, state: 'ready', snapshot }] };
      } else {
        result = await readPortfolio(adapter, account, { offset, block: pinned, signal: current.signal });
      }
      if (!current.signal.aborted) setPage(result);
    } catch { if (!current.signal.aborted) setError(true); }
    finally { if (!current.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    setPage(undefined); setError(false); setLoading(false);
    if (account && (!simulated || demo)) void load();
    return () => controller.current?.abort();
    // Each identity or demo-source change starts a fresh pinned scan.
  }, [account, adapter, demo, simulated, fault]);
  return <section className="asset-overview" aria-label={zh ? '资产总览列表' : 'Asset overview list'}>
    <div className="overview-toolbar">
      <div><h2>{zh ? '已接入协议的仓位' : 'Positions in connected protocols'}</h2>
        <span>{simulated ? (zh ? '模拟资产' : 'Simulated assets') : (zh ? 'Uniswap V3 · 钱包直接持有' : 'Uniswap V3 · directly owned')}</span></div>
      <div className="overview-actions">
        {loading ? <button className="icon-button" title={zh ? '取消扫描' : 'Cancel scan'} aria-label={zh ? '取消扫描' : 'Cancel scan'}
          onClick={() => { controller.current?.abort(); setLoading(false); }}><X size={18} /></button> :
          <button className="icon-button" title={zh ? '刷新资产' : 'Refresh assets'} aria-label={zh ? '刷新资产' : 'Refresh assets'}
            disabled={!account || locked || (simulated && !demo)} onClick={() => void load()}><RefreshCw size={18} /></button>}
        <button className="secondary-button" disabled={locked} onClick={() => onSelect('')}>
          {zh ? '输入仓位编号' : 'Enter position ID'}<ArrowRight size={15} /></button>
      </div>
    </div>
    {!account ? <div className="overview-empty"><Wallet size={26} /><p>{zh ? '连接钱包查看仓位' : 'Connect a wallet to view positions'}</p>
      <button className="primary-button" onClick={onConnect}>{zh ? '连接钱包' : 'Connect wallet'}</button></div> :
      <div className="overview-results" aria-busy={loading}>
        {loading && <p className="overview-message" role="status"><LoaderCircle size={16} className="spin" />{zh ? '正在核对所有权与仓位…' : 'Checking ownership and positions…'}</p>}
        {error && <p className="overview-message" role="alert">{zh ? '资产查询未完成，请重试或输入仓位编号。' : 'Asset query incomplete. Retry or enter a position ID.'}</p>}
        {!loading && !error && !page && <p className="overview-message" role="status">{zh ? '查询已取消，可刷新重试。' : 'Query cancelled. Refresh to retry.'}</p>}
        {page && <>
          <div className="overview-summary" role="status"><strong>{page.total.toString()} {zh ? '个仓位 NFT' : 'position NFTs'}</strong>
            <span>{zh ? '区块' : 'Block'} {BigInt(page.block.number).toString()}</span></div>
          {page.total === 0n && <p className="overview-message">{zh ? '未发现直接持有的 V3 仓位。Spark USDC 份额可从金库入口查询。' : 'No directly owned V3 positions found. Check Spark USDC shares from the vault entry.'}</p>}
          <ul className="portfolio-list">{page.entries.map(entry => {
            const snapshot = entry.state === 'ready' ? entry.snapshot : undefined;
            const excluded = snapshot && (isExcludedAsset(snapshot.token0.address) || isExcludedAsset(snapshot.token1.address));
            return <li key={entry.tokenId.toString()}>
              <div className="portfolio-identity"><strong>{snapshot ? `${snapshot.token0.symbol} / ${snapshot.token1.symbol}` : (zh ? '仓位读取未完成' : 'Position unavailable')}</strong>
                <code>#{entry.tokenId.toString()}</code><span>Uniswap V3{snapshot ? ` · ${snapshot.fee / 10000}%` : ''}</span></div>
              <div className="portfolio-state"><span>{!snapshot ? (zh ? '需重新读取' : 'Retry required') : excluded ? (zh ? 'WOKB · 仅查看' : 'WOKB · view only') :
                snapshot.liquidity === 0n ? (zh ? '无剩余流动性' : 'No remaining liquidity') :
                snapshot.tick >= snapshot.tickLower && snapshot.tick < snapshot.tickUpper ? (zh ? '区间内' : 'In range') : (zh ? '区间外' : 'Out of range')}</span>
                {snapshot && <code>L {snapshot.liquidity.toString()}</code>}</div>
              <button className="icon-button" disabled={locked} title={zh ? '打开仓位' : 'Open position'} aria-label={`${zh ? '打开仓位' : 'Open position'} ${entry.tokenId}`}
                onClick={() => onSelect(entry.tokenId.toString())}><ArrowRight size={19} /></button>
            </li>;
          })}</ul>
          <div className="overview-pagination"><button className="icon-button" title={zh ? '上一页资产' : 'Previous assets'} aria-label={zh ? '上一页资产' : 'Previous assets'}
            disabled={page.offset === 0n || locked} onClick={() => void load(page.offset >= 5n ? page.offset - 5n : 0n, page.block)}><ArrowLeft size={18} /></button>
            <span>{page.total === 0n ? '0' : `${page.offset + 1n}–${page.offset + BigInt(page.entries.length)}`} / {page.total.toString()}</span>
            <button className="icon-button" title={zh ? '下一页资产' : 'Next assets'} aria-label={zh ? '下一页资产' : 'Next assets'}
              disabled={page.next === null || locked} onClick={() => void load(page.next!, page.block)}><ArrowRight size={18} /></button></div>
        </>}
      </div>}
    <div className="protocol-coverage"><h2>{zh ? '协议覆盖' : 'Protocol coverage'}</h2>
      {PROTOCOL_COVERAGE.map(protocol => <div key={protocol.id}><span>{protocol.name}</span>
        {protocol.id === 'spark-spusdc' && onOpenVault && <button className="text-link" disabled={locked} onClick={onOpenVault}>
          {zh ? '查询金库' : 'Open vault'}<ArrowRight size={15} /></button>}
        <span className={protocol.status === 'readonly' ? 'green' : 'muted'}>{protocol.status === 'readonly' ? (zh ? '已接入 · 主网只读' : 'Connected · mainnet read only') : (zh ? '规划中' : 'Planned')}</span></div>)}</div>
  </section>;
}
