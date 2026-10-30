import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleHelp, Copy,
  Download, ExternalLink, FileCheck2, History, LoaderCircle, LockKeyhole, Menu,
  Radio, RefreshCw, ShieldCheck, Upload, Wallet as WalletIcon, X, XCircle,
} from 'lucide-react';
import { formatUnits, getAddress, type Address, type Hex } from 'viem';
import { CHAIN_ID, DEPLOYMENT, MANAGER, RELEASE, RELEASE_APPROVED, SOURCES, SUPPORTED_TOKENS } from './config';
import { isExcludedAsset } from './core/asset-policy';
import { StrictRpc, ExitError } from './core/rpc';
import type { Plan, Preview, Snapshot } from './core/protocol';
import { V3Adapter } from './core/adapter';
import { parseTokenId } from './core/token-id';
import { loadPlan } from './core/plan-loader';
import { assertWallet, connect, discoverWallets, observeWallet, type Wallet } from './core/wallet';
import { reconcileSubmission, sendGuarded, submissionState, SUBMISSION_KEY, type SubmissionState } from './core/submission';
import { inspectReceipt, pendingState, type Result } from './core/receipt';
import { recheckHistory } from './core/history';
import { clearHistory, downloadJson, importRecoveryCard, loadHistory, recoveryCard, saveHistory, type HistoryItem } from './core/storage';
import { assertSigningRuntime, canSignRuntime, manifestDigest, runtimeStatus, type RuntimeStatus } from './core/runtime';
import type { DemoEngine, Fault } from './demo/engine';
import { discoverPositions, type PositionPage } from './core/discovery';
import RecoveryCheck from './RecoveryCheck';

const DEMO = import.meta.env.VITE_DEMO === 'true';
const demoModule = DEMO ? import('./demo/engine') : null;
type Stage = 'idle' | 'reading' | 'ready' | 'simulating' | 'review' | 'preflight' | 'wallet' | 'submitted' | 'done' | 'unknown';
type Tab = 'exit' | 'history' | 'recovery';
const texts = {
  zh: {
    exit: '退出仓位', history: '操作记录', recovery: '恢复入口', connect: '连接钱包', disconnect: '断开连接',
    title: '独立退出，资产回到自己手中。', sub: 'X Layer · Uniswap V3', workspace: '仓位工作区',
    id: '仓位 Token ID', idHint: '输入你直接持有的 Uniswap V3 仓位编号', load: '读取仓位',
    readOnly: '只读模式', readOnlyHint: '连接钱包后可核对所有权。当前发行尚未批准主网签名。',
    owner: '持有地址', pool: '流动性池', range: '价格区间', liquidity: '仓位流动性',
    amount: '退出比例', onlyCollect: '仅领取资产', slip: '滑点上限', preview: '预演退出',
    review: '核对交易', sign: DEMO ? '确认模拟退出' : '在钱包中确认', cancel: '返回修改',
    output: '预估领取', minimum: '最低本金输出', gas: '网络费用预估', recipient: '收款地址',
    target: '目标合约', deadline: '交易有效期', version: '应用版本', sources: '读取来源',
    origin: '入口状态', dependencies: '运行依赖', code: '开源代码', support: '适用范围',
    empty: '读取仓位后，查看退出预览', emptySub: '资产会由原协议直接发送到当前签名账户。',
    check1: '直接调用原协议', check2: '不转移仓位 NFT', check3: '不新增代币授权',
    done: '领取证据已核对', included: '交易已执行，领取证据待核对', finality: '已纳入区块 · 等待最终确认',
    export: '导出记录', refresh: '刷新结果', newExit: '读取剩余仓位', nothing: '暂无本地操作记录',
    saveCard: '保存恢复卡', importCard: '导入恢复卡', clear: '清除本地记录',
    recoveryTitle: '提前保存，保留退出路径。', recoverySub: '恢复卡保存公开入口与仓位编号，不包含私钥或签名。',
    local: '本地恢复包', localSub: '通过发行包在 localhost 运行，读取与交易仍需要钱包、RPC 和可用的链。',
    scope: '支持用户自持的 X Layer Uniswap V3 仓位。无法恢复丢失私钥，也无法绕过合约锁定或协议损失。',
    demo: '隔离演示 · 测试资产 · 不连接真实钱包，不发送链上交易',
    live: '主网只读 · 部署、代币与发行审阅通过前禁止签名',
    fault: '故障演练', none: '正常读取', conflict: '注入 RPC 分歧', unavailable: '注入来源中断',
    original: '原站 / 专属后台', blocked: '已隔离', notRequired: '无需连接',
    details: '核对详情', awaiting: '等待钱包确认', simulating: '正在预演', reading: '正在核对链上仓位',
    submitted: '交易已提交', unknown: '提交结果未知，请先检查钱包记录，勿重复发送',
    receipt: '交易哈希', remaining: '剩余仓位需重新读取', feeNote: '预估领取包含本次退出本金与当前可领取费用。',
    disclaimer: '链上字节核对不等于安全审计。入口仍依赖浏览器、启动文件、RPC、钱包及底层合约。',
  },
  en: {
    exit: 'Exit position', history: 'Activity', recovery: 'Recovery', connect: 'Connect wallet', disconnect: 'Disconnect',
    title: 'An independent way back to your assets.', sub: 'X Layer · Uniswap V3', workspace: 'Position workspace',
    id: 'Position token ID', idHint: 'Enter a Uniswap V3 NFT position you directly own', load: 'Read position',
    readOnly: 'Read-only mode', readOnlyHint: 'Connect to check ownership. This release is not approved for mainnet signing.',
    owner: 'Owner', pool: 'Liquidity pool', range: 'Tick range', liquidity: 'Position liquidity',
    amount: 'Exit percentage', onlyCollect: 'Collect only', slip: 'Slippage limit', preview: 'Simulate exit',
    review: 'Review transaction', sign: DEMO ? 'Confirm simulated exit' : 'Confirm in wallet', cancel: 'Back to edit',
    output: 'Estimated collection', minimum: 'Minimum principal output', gas: 'Estimated network fee', recipient: 'Recipient',
    target: 'Target contract', deadline: 'Transaction deadline', version: 'App release', sources: 'Read sources',
    origin: 'Entry status', dependencies: 'Dependencies', code: 'Source code', support: 'Scope',
    empty: 'Read a position to preview your exit', emptySub: 'The original protocol sends assets directly to the signing account.',
    check1: 'Direct protocol call', check2: 'No NFT transfer', check3: 'No new token approval',
    done: 'Collection evidence checked', included: 'Executed; collection evidence pending', finality: 'Included · final confirmation pending',
    export: 'Export record', refresh: 'Refresh result', newExit: 'Read remaining position', nothing: 'No local activity yet',
    saveCard: 'Save recovery card', importCard: 'Import recovery card', clear: 'Clear local activity',
    recoveryTitle: 'Save your route before you need it.', recoverySub: 'A recovery card stores public entry details and position IDs, never keys or signatures.',
    local: 'Local recovery bundle', localSub: 'Run the release bundle on localhost. Reading and transactions still require RPC, a wallet, and a functioning chain.',
    scope: 'For directly owned X Layer Uniswap V3 positions. Cannot recover lost keys, bypass locks, or undo protocol losses.',
    demo: 'Isolated demo · test assets · no real wallet or on-chain transaction',
    live: 'Mainnet read-only · signing disabled until deployment, assets and release are reviewed',
    fault: 'Fault rehearsal', none: 'Healthy reads', conflict: 'Inject RPC conflict', unavailable: 'Interrupt operator',
    original: 'Original site / private API', blocked: 'Isolated', notRequired: 'Not required',
    details: 'Review details', awaiting: 'Awaiting wallet', simulating: 'Simulating', reading: 'Checking on-chain position',
    submitted: 'Transaction submitted', unknown: 'Submission unknown. Check wallet activity before trying again.',
    receipt: 'Transaction hash', remaining: 'Read again to check remaining position', feeNote: 'Includes principal removed and currently collectable fees.',
    disclaimer: 'Matching on-chain bytes is not a security audit. Browser, bootstrap, RPC, wallet and protocol remain dependencies.',
  },
};
function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function units(value: bigint | string, decimals: number) {
  const text = formatUnits(BigInt(value), decimals);
  const [a, b] = text.split('.');
  return `${BigInt(a).toLocaleString('en-US')}${b ? `.${b.slice(0, 6).replace(/0+$/, '')}` : ''}`.replace(/\.$/, '');
}
function AddressValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <span className="address-value"><code title={value}>{value}</code><button className="icon-button" title="Copy address" aria-label="Copy address" onClick={async () => {
    await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200);
  }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></span>;
}
function AssetBadge({ symbol, index }: { symbol: string; index: number }) {
  return <span className={`asset-badge asset-${index}`} aria-hidden="true">{symbol.includes('USDC') ? '$' : symbol.includes('USDT') ? '₮' : symbol.slice(0, 1)}</span>;
}
export default function App() {
  const [lang, setLang] = useState<'zh' | 'en'>(() => navigator.language.startsWith('zh') ? 'zh' : 'en');
  const t = texts[lang];
  const [tab, setTab] = useState<Tab>('exit');
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [wallet, setWallet] = useState<Wallet>();
  const [account, setAccount] = useState<Address>();
  const [walletPicker, setWalletPicker] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState<string>();
  const walletConnection = useRef<{ controller: AbortController; id: string } | undefined>(undefined);
  const [tokenId, setTokenId] = useState(DEMO ? '28491' : '');
  const [recoveryIds, setRecoveryIds] = useState<string[]>([]);
  const recoveryImport = useRef(0);
  const recoveryExport = useRef(0);
  const [positionPage, setPositionPage] = useState<PositionPage>();
  const [discovering, setDiscovering] = useState(false);
  const discoveryController = useRef<AbortController | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [plan, setPlan] = useState<Plan>();
  const [preview, setPreview] = useState<Preview>();
  const [stage, setStage] = useState<Stage>('idle');
  const [bps, setBps] = useState(10000);
  const [slippage, setSlippage] = useState(50);
  const [collectOnly, setCollectOnly] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result>();
  const [outcome, setOutcome] = useState<Awaited<ReturnType<
    typeof import('./core/recovery-outcome').inspectRecoveryOutcome>>>();
  const [checkingOutcome, setCheckingOutcome] = useState(false);
  const outcomeLock = useRef(false);
  const outcomeRequest = useRef(0);
  const [hash, setHash] = useState<Hex>();
  const [runtime, setRuntime] = useState<RuntimeStatus>({ mode: 'web', label: 'Checking entry', verified: false });
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [historyChecks, setHistoryChecks] = useState<Record<string, string>>({});
  const historyLocks = useRef(new Set<string>());
  const historyGeneration = useRef(0);
  const [submission, setSubmission] = useState<SubmissionState>(() => DEMO ? { state: 'empty' } : submissionState());
  const [checkingSubmission, setCheckingSubmission] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [recoveryHash, setRecoveryHash] = useState({ id: '', value: '' });
  const submissionCheckLock = useRef(false);
  const submissionBlocked = !DEMO && submission.state !== 'empty';
  const candidateHash = submission.state === 'blocked' && recoveryHash.id === submission.submission.id ?
    recoveryHash.value.trim() : '';
  const validCandidateHash = /^0x[0-9a-f]{64}$/i.test(candidateHash);
  const [fault, setFault] = useState<Fault>('none');
  const [accepted, setAccepted] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const generation = useRef(0);
  const txLock = useRef(false);
  const receiptLock = useRef(false);
  const submittedPlan = useRef<Plan | undefined>(undefined);
  const submittedNonce = useRef<bigint | undefined>(undefined);
  const receiptFloor = useRef(0n);
  const [demo, setDemo] = useState<DemoEngine>();
  const adapter = useRef(new V3Adapter(new StrictRpc(SOURCES), DEPLOYMENT, SUPPORTED_TOKENS)).current;
  const importInput = useRef<HTMLInputElement>(null);
  const busy = ['reading', 'simulating', 'preflight', 'wallet', 'submitted'].includes(stage);
  useEffect(() => {
    discoveryController.current?.abort(); setPositionPage(undefined); setDiscovering(false);
    return () => { discoveryController.current?.abort(); };
  }, [account]);
  async function findPositions(next = false) {
    if (!account || DEMO || txLock.current) return;
    discoveryController.current?.abort();
    const controller = new AbortController();
    discoveryController.current = controller;
    setDiscovering(true); setError('');
    try {
      const page = await discoverPositions(adapter, account, {
        ...(next && positionPage ? { offset: positionPage.next ?? 0n, block: positionPage.block } : {}),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setPositionPage(page);
    } catch (err) { if (!controller.signal.aborted) showError(err); }
    finally { if (discoveryController.current === controller) setDiscovering(false); }
  }
  function checkSnapshotFloor(s: Snapshot) {
    if (BigInt(s.block.number) < receiptFloor.current)
      throw new ExitError('STALE', 'Snapshot is older than the last checked receipt; wait for RPC heads to advance');
  }
  function invalidate() {
    generation.current++; setPlan(undefined); setPreview(undefined); setAccepted(false);
    outcomeRequest.current++; setOutcome(undefined);
    if (!txLock.current) setStage(snapshot ? 'ready' : 'idle');
  }
  function closeWalletPicker() {
    walletConnection.current?.controller.abort();
    walletConnection.current = undefined;
    setConnectingWallet(undefined); setWalletPicker(false);
  }
  useEffect(() => () => {
    walletConnection.current?.controller.abort(); recoveryImport.current++; recoveryExport.current++;
    outcomeRequest.current++;
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);
  useEffect(() => {
    if (DEMO) {
      void demoModule!.then(engine => { setDemo(engine); setAccount(engine.DEMO_OWNER); });
      return;
    }
    return discoverWallets(w => setWallets(current => current.some(v => v.id === w.id) ? current : [...current, w]));
  }, []);
  useEffect(() => {
    let version = 0;
    const refresh = async () => {
      const current = ++version;
      const status = await runtimeStatus();
      if (current === version) setRuntime(status);
    };
    const handler = () => {
      generation.current++; setPlan(undefined); setPreview(undefined); setAccepted(false);
      if (!txLock.current && !submittedPlan.current) setStage('idle');
      setRuntime({ mode: 'web', label: 'Checking entry', verified: false });
      setError(lang === 'zh' ? '入口控制器已更新，请重新读取。' : 'Entry controller changed. Read again.');
      void refresh();
    };
    void refresh();
    navigator.serviceWorker?.addEventListener('controllerchange', handler);
    return () => { version++; navigator.serviceWorker?.removeEventListener('controllerchange', handler); };
  }, [lang]);
  useEffect(() => {
    if (DEMO) return;
    const update = () => { setSubmission(submissionState()); setSubmissionMessage(''); };
    const storage = (event: StorageEvent) => { if (event.key === SUBMISSION_KEY || event.key === null) update(); };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', update);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('focus', update); };
  }, []);
  useEffect(() => {
    if (!walletPicker && !detailsOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], select') || []);
    controls()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeWalletPicker(); setDetailsOpen(false); }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [walletPicker, detailsOpen]);
  useEffect(() => wallet ? observeWallet(wallet.provider, () => {
    walletConnection.current?.controller.abort();
    generation.current++; setAccount(undefined); setPlan(undefined); setPreview(undefined); setAccepted(false);
    if (!txLock.current && !submittedPlan.current) setStage('idle');
    setError(lang === 'zh' ? '钱包账户、网络或连接发生变化，请重新连接和核对。' : 'Wallet changed. Reconnect and review again.');
  }) : undefined, [wallet, lang]);
  const showError = (err: unknown) => {
    const code = err instanceof ExitError ? err.code : (err as { code?: number })?.code;
    const map: Record<string, string> = lang === 'zh' ? {
      CONFLICT: '读取结果不一致，已停止生成交易。', QUORUM: '独立读取来源不足，请稍后重试。',
      RPC_INVALID: '读取来源返回的数据无效，已停止处理，请稍后重试。',
      IMPORT: '恢复卡格式或字段无效，请检查文件。',
      MANIFEST: '发行清单读取失败，未保存恢复卡，请检查入口后重试。',
      CALCULATION: '计算模块加载失败，请核对恢复包或入口并刷新后重试。',
      OWNER: '当前钱包不是该仓位的直接持有人。', STALE: '快照或预览已过期，请重新读取。',
      UNSUPPORTED: '该资产尚未通过当前发行验证，暂时只读。', 4001: '你已取消钱包确认。',
      ASSET_EXCLUDED: '当前版本不支持 WOKB 仓位交易，请使用替代验收仓位。',
      4100: '钱包尚未授权此站点，请在钱包中检查连接权限。',
      4200: '钱包不支持所请求的方法，请更换兼容钱包。',
      4900: '钱包已断开，请重新连接。',
      4901: '钱包未连接到 X Layer，请检查网络。',
      WALLET_RESPONSE: '钱包返回的数据无效，已停止连接或发送，请检查钱包。',
      WALLET_CHANGED: '钱包账户或网络已变化，请重新连接并核对。',
      EMPTY: '当前没有可执行的退出或领取数量。', DUST: '最低输出因金额过小而归零，暂不支持。',
      SUBMISSION_LOCK: '另一个标签页正在处理交易，或浏览器不支持发送互斥。',
      SUBMISSION_STORAGE: '无法可靠保存待处理状态，已停止发送。请检查浏览器存储。',
      SUBMISSION_BLOCKED: '存在未解决的提交，请先核对待处理交易。',
      SUBMISSION_UNKNOWN: '未保存匹配的交易哈希，请检查钱包记录，勿重复发送。',
      SUBMISSION_MISMATCH: '实际交易与待处理记录不匹配，保持发送锁定。',
      ENTRY_CHANGED: '入口已变化或未通过验证，请重新读取和核对。',
    } : {};
    setError(map[String(code)] || String(err instanceof Error ? err.message : err).slice(0, 240));
  };
  async function readPosition() {
    if (txLock.current) return;
    submittedPlan.current = undefined; submittedNonce.current = undefined;
    const id = ++generation.current;
    setError(''); setPlan(undefined); setPreview(undefined); setResult(undefined); setHash(undefined); setAccepted(false); setStage('reading');
    try {
      const parsed = parseTokenId(tokenId);
      const s = DEMO ? await demo!.demoSnapshot(parsed, fault) : await adapter.snapshot(parsed);
      if (id !== generation.current) return;
      checkSnapshotFloor(s);
      setSnapshot(s); setCollectOnly(s.liquidity === 0n); setStage('ready');
    } catch (e) { if (id === generation.current) { showError(e); setStage('idle'); setSnapshot(undefined); } }
  }
  async function simulate() {
    if (!snapshot || !account || txLock.current) return;
    const id = ++generation.current;
    setError(''); setAccepted(false); setStage('simulating'); setPlan(undefined); setPreview(undefined);
    try {
      const fresh = DEMO ? await demo!.demoSnapshot(snapshot.tokenId, fault) : await adapter.snapshot(snapshot.tokenId);
      checkSnapshotFloor(fresh);
      const { makePlan } = await loadPlan();
      if (id !== generation.current) return;
      const next = makePlan(fresh, account, bps, slippage, collectOnly);
      const p = DEMO ? await demo!.demoPreview(next, fault) : await adapter.simulate(next);
      if (id !== generation.current) return;
      setSnapshot(fresh); setPlan(next); setPreview(p); setStage('review');
    } catch (e) { if (id === generation.current) { showError(e); setStage('ready'); } }
  }
  async function refreshReceipt(transactionHash = hash, currentPlan = submittedPlan.current) {
    if (!transactionHash || !currentPlan || DEMO || receiptLock.current) return;
    receiptLock.current = true;
    const id = generation.current;
    const revokeHistory = (state: string) => {
      const previous = loadHistory().find(item => item.hash === transactionHash);
      if (previous) setHistory(saveHistory({ ...previous, state }));
    };
    try {
      const r = await inspectReceipt(adapter.rpc, transactionHash, currentPlan);
      if (id !== generation.current) return;
      if (!r) {
        revokeHistory('pending-recheck');
        setResult(undefined); setStage('submitted'); txLock.current = true;
        const pending = await pendingState(adapter.rpc, transactionHash, currentPlan.account, submittedNonce.current);
        if (id !== generation.current) return;
        submittedNonce.current = pending.nonce;
        if (pending.state === 'replaced-or-dropped') {
          setStage('unknown');
          setError(lang === 'zh' ? '原交易的 nonce 已被消耗，请检查钱包中的替换或取消交易，勿重复发送。' : 'The original nonce was consumed. Check the wallet for a replacement or cancellation before sending again.');
        }
        return;
      }
      setResult(r); setStage('done'); txLock.current = false;
      receiptFloor.current = BigInt(r.blockNumber) > receiptFloor.current ? BigInt(r.blockNumber) : receiptFloor.current;
      setHistory(saveHistory({ tokenId: currentPlan.tokenId.toString(), hash: transactionHash,
        time: new Date().toISOString(), environment: 'mainnet', state: r.state }));
      if (r.finalized) {
        try {
          const recovery = await reconcileSubmission(adapter.rpc, transactionHash);
          if (id !== generation.current) return;
          if (recovery.state === 'resolved') {
            if (recovery.verification.state === 'reverted') throw new ExitError('REVERTED', 'Transaction reverted');
            const latest = { ...recovery.verification.result, safe: true, finalized: true };
            setResult(latest);
            receiptFloor.current = BigInt(latest.blockNumber) > receiptFloor.current ?
              BigInt(latest.blockNumber) : receiptFloor.current;
            setHistory(saveHistory({ tokenId: currentPlan.tokenId.toString(), hash: transactionHash,
              time: recovery.submission.startedAt, environment: 'mainnet', state: latest.state }));
          } else if (recovery.state === 'pending' || recovery.state === 'confirming') {
            setResult(undefined); setStage('submitted'); txLock.current = true;
            revokeHistory('verification-pending');
          }
        } finally { setSubmission(submissionState()); }
      }
    } catch (e) {
      if (id !== generation.current) return;
      showError(e);
      setResult(undefined);
      revokeHistory(e instanceof ExitError && e.code === 'REVERTED' ? 'reverted' : 'verification-pending');
      if (!(e instanceof ExitError && e.code === 'REVERTED')) { setStage('submitted'); txLock.current = true; }
      if (e instanceof ExitError && e.code === 'REVERTED') { setStage('ready'); txLock.current = false; }
    } finally { receiptLock.current = false; }
  }
  async function execute() {
    if (!plan || !preview || !accepted || txLock.current) return;
    if (!DEMO && submissionState().state !== 'empty') {
      setSubmission(submissionState());
      setError(lang === 'zh' ? '存在未解决的提交，请先核对待处理交易。' : 'Resolve the pending submission before sending.');
      return;
    }
    if (!DEMO && (!RELEASE_APPROVED || !wallet || !canSignRuntime(runtime))) {
      setError(t.readOnlyHint); return;
    }
    txLock.current = true; setError(''); setStage('preflight');
    const id = generation.current;
    const controller = navigator.serviceWorker?.controller;
    let requested = false;
    try {
      if (DEMO) {
        if (fault !== 'none') throw new ExitError('CONFLICT', 'Fault injected; no execution');
        const r = await demo!.demoExecute(plan, preview);
        setHash(r.hash); setResult(r); setStage('done'); txLock.current = false;
        receiptFloor.current = BigInt(r.blockNumber) > receiptFloor.current ? BigInt(r.blockNumber) : receiptFloor.current;
        setHistory(saveHistory({ tokenId: plan.tokenId.toString(), hash: r.hash, time: new Date().toISOString(), environment: 'demo', state: r.state }));
        return;
      }
      await assertWallet(wallet!.provider, plan);
      const fresh = await adapter.snapshot(plan.tokenId);
      checkSnapshotFloor(fresh);
      if (fresh.owner !== plan.account || fresh.liquidity !== plan.snapshot.liquidity)
        throw new ExitError('STALE', 'Position changed; read again');
      const checked = await adapter.simulate(plan, fresh.block);
      const entry = await runtimeStatus();
      if (id !== generation.current || controller !== navigator.serviceWorker?.controller)
        throw new ExitError('STALE', 'Wallet or entry changed during preflight');
      setRuntime(entry);
      assertSigningRuntime(runtime, entry);
      if (Date.now() - plan.createdAt > 30000) throw new ExitError('STALE', 'Preview expired');
      setStage('wallet'); requested = true;
      const transactionHash = await sendGuarded(wallet!.provider, plan, checked.gas, () => {
        if (id !== generation.current || controller !== navigator.serviceWorker?.controller)
          throw new ExitError('STALE', 'Wallet or entry changed before the wallet request');
      });
      setSubmission(submissionState());
      submittedPlan.current = plan;
      submittedNonce.current = undefined;
      setHash(transactionHash); setStage('submitted');
      setHistory(saveHistory({ tokenId: plan.tokenId.toString(), hash: transactionHash,
        time: new Date().toISOString(), environment: 'mainnet', state: 'submitted' }));
      await refreshReceipt(transactionHash, plan);
    } catch (e) {
      showError(e);
      if (requested && (e as { code?: number })?.code !== 4001 &&
          !(e instanceof ExitError && ['WALLET_CHANGED', 'WALLET_RESPONSE', 'STALE', 'SUBMISSION_LOCK',
            'SUBMISSION_BLOCKED', 'SUBMISSION_STORAGE', 'ENTRY_CHANGED'].includes(e.code))) {
        setStage('unknown');
      } else { setStage('ready'); txLock.current = false; }
    } finally { if (!DEMO) setSubmission(submissionState()); }
  }
  useEffect(() => {
    if (DEMO || !hash || !submittedPlan.current || !['submitted', 'done'].includes(stage)) return;
    const timer = setInterval(() => { void refreshReceipt(); }, 8000);
    return () => clearInterval(timer);
  }, [hash, plan, stage]);
  async function chooseWallet(w: Wallet) {
    if (walletConnection.current?.id === w.id) return;
    walletConnection.current?.controller.abort();
    const controller = new AbortController();
    walletConnection.current = { controller, id: w.id };
    setConnectingWallet(w.id); setError('');
    setAccount(undefined); setWallet(undefined); invalidate();
    try {
      const connected = await connect(w.provider, CHAIN_ID, controller.signal);
      if (controller.signal.aborted || walletConnection.current?.controller !== controller) return;
      setAccount(connected); setWallet(w); setWalletPicker(false); invalidate();
    } catch (e) { if (!controller.signal.aborted) showError(e); }
    finally {
      if (walletConnection.current?.controller === controller) {
        walletConnection.current = undefined; setConnectingWallet(undefined);
      }
    }
  }
  async function checkSubmission() {
    if (submissionCheckLock.current) return;
    submissionCheckLock.current = true; setCheckingSubmission(true); setError('');
    try {
      const saved = submissionState();
      const candidate = saved.state === 'blocked' && recoveryHash.id === saved.submission.id ?
        recoveryHash.value.trim() : '';
      const check = await reconcileSubmission(adapter.rpc,
        saved.state === 'blocked' && saved.submission.hash ? undefined :
          /^0x[0-9a-f]{64}$/i.test(candidate) ? candidate as Hex : hash);
      setSubmissionMessage(check.state === 'pending' ?
        (lang === 'zh' ? '交易仍未确认，保持发送锁定。' : 'Transaction pending; sending remains blocked.') :
        check.state === 'confirming' ?
          (lang === 'zh' ? '交易已纳入区块，等待最终确认。' : 'Included; waiting for finality.') : '');
      if (check.state === 'resolved') {
        const verification = check.verification;
        const blockNumber = verification.state === 'checked' ? verification.result.blockNumber :
          verification.state === 'reverted' ? verification.blockNumber : undefined;
        if (blockNumber !== undefined) receiptFloor.current = BigInt(blockNumber) > receiptFloor.current ?
          BigInt(blockNumber) : receiptFloor.current;
        const state = verification.state === 'checked' ? verification.result.state : 'reverted';
        setHistory(saveHistory({ tokenId: check.submission.tokenId, hash: check.submission.hash,
          time: check.submission.startedAt, environment: 'mainnet', state }));
        const message = verification.state === 'reverted' ?
          (lang === 'zh' ? '交易已回滚并最终确认，已解除待处理锁定。' : 'Reverted and finalized; pending block cleared.') :
          verification.state === 'checked' && verification.result.state === 'received-checked' ?
            (lang === 'zh' ? '交易及领取证据已核对并最终确认，已解除待处理锁定。' :
              'Collection checked and finalized; pending block cleared.') :
            (lang === 'zh' ? '交易已最终确认，领取证据仍待核对；已解除待处理锁定。' :
              'Transaction finalized; collection evidence unverified. Pending block cleared.');
        setSubmissionMessage(message);
        setHistoryChecks(current => ({ ...current, [check.submission.hash]: message }));
        generation.current++;
        txLock.current = false;
        submittedPlan.current = undefined; submittedNonce.current = undefined;
        setSnapshot(undefined); setResult(undefined); setHash(undefined);
        setRecoveryHash({ id: '', value: '' });
        setPlan(undefined); setPreview(undefined); setAccepted(false);
        setStage('idle');
      }
    } catch (error) { showError(error); }
    finally {
      setSubmission(submissionState()); setCheckingSubmission(false); submissionCheckLock.current = false;
    }
  }
  async function verifyHistory(item: HistoryItem) {
    if (historyLocks.current.has(item.hash)) return;
    historyLocks.current.add(item.hash);
    const id = historyGeneration.current;
    setHistoryChecks(current => ({ ...current, [item.hash]: lang === 'zh' ? '正在重新核对' : 'Rechecking' }));
    try {
      const verification = await recheckHistory(adapter.rpc, item);
      if (id !== historyGeneration.current) return;
      const state = verification.state === 'checked' ? verification.result.state :
        verification.state === 'reverted' ? 'reverted' : 'pending-recheck';
      const message = verification.state === 'pending' ? (lang === 'zh' ? '暂无收据，结果未确认' : 'No receipt; outcome unconfirmed') :
        verification.state === 'reverted' ? (lang === 'zh' ? '链上执行已回滚' : 'Reverted on chain') :
        verification.result.state === 'received-checked' ?
          (lang === 'zh' ? `领取已复核 · ${verification.result.finalized ? 'Finalized' : verification.result.safe ? 'Safe' : '等待最终确认'}` :
            `Collection rechecked · ${verification.result.finalized ? 'Finalized' : verification.result.safe ? 'Safe' : 'Finality pending'}`) :
          (lang === 'zh' ? '已执行，领取证据仍待核对' : 'Included; collection evidence unverified');
      setHistory(saveHistory({ ...item, state }));
      setHistoryChecks(current => ({ ...current, [item.hash]: message }));
    } catch (err) {
      if (id !== historyGeneration.current) return;
      setHistory(saveHistory({ ...item, state: 'verification-pending' }));
      setHistoryChecks(current => ({ ...current, [item.hash]: lang === 'zh' ? '复核失败，结果未确认' : 'Verification failed; outcome unconfirmed' }));
      showError(err);
    } finally { historyLocks.current.delete(item.hash); }
  }
  async function saveCard() {
    const request = ++recoveryExport.current, current = generation.current;
    const ids = recoveryIds.length && recoveryIds.includes(tokenId) ? recoveryIds : tokenId;
    const identity = {
      ...(runtime.name ? { tapeName: runtime.name } : {}),
      ...(runtime.container ? { container: runtime.container } : {}),
    };
    try {
      let digest: string | undefined;
      try { digest = await manifestDigest(); } catch (err) {
        if (!import.meta.env.DEV && !DEMO) throw err;
      }
      if (request !== recoveryExport.current || current !== generation.current) return;
      downloadJson('tapeexit-recovery-card.json', recoveryCard(ids, {
        ...identity, ...(digest ? { manifestSha256: digest } : {}),
      }));
      setError('');
    } catch (err) {
      if (request === recoveryExport.current && current === generation.current) showError(err);
    }
  }
  async function importCard(file: File) {
    const request = ++recoveryImport.current, current = generation.current;
    if (txLock.current) { setError(t.unknown); return; }
    try {
      if (file.size > 16000) throw new ExitError('IMPORT', 'Recovery card too large');
      const text = await file.text();
      if (request !== recoveryImport.current || current !== generation.current || txLock.current) return;
      const card = importRecoveryCard(text);
      discoveryController.current?.abort(); setDiscovering(false); setPositionPage(undefined);
      setRecoveryIds(card.tokenIds); setTokenId(card.tokenIds[0] ?? '');
      setSnapshot(undefined); setResult(undefined); setHash(undefined); setError('');
      invalidate(); setStage('idle'); setDetailsOpen(false); setTab('exit');
    } catch (err) {
      if (request === recoveryImport.current && current === generation.current && !txLock.current) showError(err);
    }
  }
  function record() {
    downloadJson('tapeexit-operation.json', {
      schemaVersion: 1, environment: DEMO ? 'isolated-demo' : 'mainnet', releaseId: RELEASE,
      chainId: CHAIN_ID, tokenId: snapshot?.tokenId, result, runtime,
      recoveryOutcome: outcome && 'hash' in outcome && outcome.hash === result?.hash &&
        outcome.receipt?.blockHash === result?.blockHash ? outcome : undefined,
      operators: DEMO ? ['simulated-a', 'simulated-b'] : SOURCES.map(s => s.operator),
      fault: DEMO ? fault : undefined,
      limitations: ['No independent security audit', 'Not a cryptographic state proof'],
    });
  }
  async function checkOutcome() {
    if (DEMO || !result || !snapshot || !account || outcomeLock.current) return;
    outcomeLock.current = true; setCheckingOutcome(true); setOutcome(undefined); setError('');
    const current = generation.current, request = ++outcomeRequest.current, expectedHash = result.hash;
    try {
      const { inspectRecoveryOutcome } = await import('./core/recovery-outcome');
      const checked = await inspectRecoveryOutcome(adapter.rpc, expectedHash, snapshot.tokenId, account);
      if (current === generation.current && request === outcomeRequest.current) setOutcome(checked);
    } catch (err) { if (current === generation.current && request === outcomeRequest.current) showError(err); }
    finally { outcomeLock.current = false; setCheckingOutcome(false); }
  }
  const own = account && snapshot && getAddress(account) === snapshot.owner;
  const excludedPosition = snapshot && [snapshot.token0, snapshot.token1].some(asset => isExcludedAsset(asset.address));
  const canPreview = !excludedPosition && !!own && !!snapshot?.token0.verified && !!snapshot.token1.verified && (DEMO || RELEASE_APPROVED);
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <a className="brand" href="./" aria-label="TapeExit"><img src="./tapeexit-icon.png" width="31" height="31" alt="" /><span>Tape<span className="brand-light">Exit</span></span></a>
      <div className="sidebar-caption">SELF-CUSTODY, CONTINUED</div>
      <nav aria-label="Main navigation">{([
        ['exit', ArrowDownLeft, t.exit], ['history', History, t.history], ['recovery', LockKeyhole, t.recovery],
      ] as const).map(([key, Icon, label]) => <button key={key} className={`nav-item ${tab === key ? 'active' : ''}`} onClick={() => { setTab(key); setMenuOpen(false); }}><Icon size={18} />{label}{key === 'exit' && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="network-mark"><img src="./xlayer.png" width="29" height="29" alt="" /><div><strong>X Layer</strong><span>Chain 196</span></div><span className="live-dot" /></div>
        <button className="text-link" onClick={() => setDetailsOpen(true)}><CircleHelp size={15} />{t.support}<ArrowRight size={14} /></button>
        <div className="sidebar-version">TAPEEXIT <code>{RELEASE}</code></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button><span>TapeExit</span><span>/</span><strong>{t[tab]}</strong></div>
        <div className="top-actions"><button className="language-button" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>{lang === 'zh' ? 'EN' : '中文'}</button>
          <span className="chain-pill"><img src="./xlayer.png" width="17" height="17" alt="" />X Layer</span>
          <button className={`wallet-button ${account ? 'connected' : ''}`} disabled={busy || DEMO} onClick={() => account ? (setAccount(undefined), setWallet(undefined), invalidate()) : setWalletPicker(true)}><WalletIcon size={16} />{account ? short(account) : t.connect}{!DEMO && <ChevronDown size={13} />}</button>
        </div></header>
      <div className={`environment-banner ${DEMO ? 'demo-banner' : ''}`}><Radio size={14} /><span>{DEMO ? t.demo : t.live}</span><span className="banner-badge">{DEMO ? 'DEMO' : 'READ ONLY'}</span></div>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" />{t.sub}</div><h1>{tab === 'exit' ? t.exit : tab === 'history' ? t.history : t.recovery}</h1><p>{tab === 'exit' ? t.title : tab === 'history' ? (lang === 'zh' ? '记录保存在当前浏览器。' : 'Stored only in this browser.') : t.recoveryTitle}</p></div>
          <button className="secondary-button save-button" onClick={() => void saveCard()}><Download size={15} />{t.saveCard}</button></div>
        {error && <div className="error-notice" role="alert"><XCircle size={18} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        {!submissionBlocked && submissionMessage && <div className="transaction-status" role="status"><CheckCircle2 size={18} /><span>{submissionMessage}</span></div>}
        {submissionBlocked && <section className="pending-submission" aria-label={lang === 'zh' ? '待处理提交' : 'Pending submission'}>
          <div><LockKeyhole size={18} /><strong>{lang === 'zh' ? '存在未解决的提交，已锁定发送' : 'Unresolved submission; sending blocked'}</strong></div>
          <p>{submission.state === 'unavailable' ?
            (lang === 'zh' ? '待处理记录无法读取，请检查当前浏览器的存储状态。' : 'Pending record unreadable. Check browser storage.') :
            (lang === 'zh' ? `仓位 #${submission.submission.tokenId} · ${submission.submission.account}` :
              `Position #${submission.submission.tokenId} · ${submission.submission.account}`)}</p>
          {submission.state === 'blocked' && submission.submission.hash && <AddressValue value={submission.submission.hash} />}
          {submission.state === 'blocked' && !submission.submission.hash && !hash && <p>{lang === 'zh' ?
            '未保存交易哈希，请先检查钱包交易记录；不会自动解除锁定。' :
            'No saved transaction hash. Inspect wallet activity; the block will remain.'}</p>}
          {submission.state === 'blocked' && !submission.submission.hash && <div className="submission-hash">
            <label htmlFor="submission-hash">{lang === 'zh' ? '钱包交易哈希' : 'Wallet transaction hash'}</label>
            <input id="submission-hash" value={candidateHash} maxLength={66} autoComplete="off" spellCheck={false}
              placeholder="0x..." disabled={checkingSubmission} aria-describedby="submission-hash-hint"
              aria-invalid={candidateHash.length > 0 && !validCandidateHash}
              onChange={event => setRecoveryHash({ id: submission.submission.id, value: event.target.value })} />
            <p id="submission-hash-hint">{lang === 'zh' ? '交易须匹配原提交并最终确认，才能解除锁定。' :
              'The transaction must match the original submission and be finalized to clear the block.'}</p>
          </div>}
          <button className="secondary-button" disabled={checkingSubmission || submission.state === 'unavailable' ||
            (submission.state === 'blocked' && !submission.submission.hash &&
              (candidateHash ? !validCandidateHash : !hash))} onClick={() => void checkSubmission()}>
            <RefreshCw size={15} className={checkingSubmission ? 'spin' : ''} />{lang === 'zh' ? '核对待处理交易' : 'Check pending transaction'}</button>
          {submissionMessage && <p role="status">{submissionMessage}</p>}
        </section>}
        {tab === 'exit' && <>
          <div className="workspace-grid">
            <section className="position-section" aria-labelledby="workspace-title">
              <div className="section-top"><h2 id="workspace-title">{t.workspace}</h2><span className="neutral-tag">UNISWAP V3</span></div>
              <div className="position-search"><label htmlFor="position-id">{t.id}</label><div className="input-row"><div className="token-input"><span>#</span><input id="position-id" inputMode="numeric" value={tokenId} placeholder="e.g. 28491" disabled={busy || stage === 'unknown'} onChange={e => { setTokenId(e.target.value); setSnapshot(undefined); invalidate(); }} onKeyDown={e => { if (e.key === 'Enter' && !busy) void readPosition(); }} /></div><button className="primary-button" disabled={busy || !tokenId || stage === 'unknown' || (DEMO && !demo)} onClick={() => void readPosition()}>{stage === 'reading' ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={15} />}{t.load}</button></div><p className="field-hint">{t.idHint}</p></div>
              {recoveryIds.length > 1 && <div className="position-discovery">
                <label htmlFor="recovery-position">{lang === 'zh' ? '恢复卡仓位' : 'Recovery card positions'}</label>
                <div className="discovery-actions"><select id="recovery-position"
                  value={recoveryIds.includes(tokenId) ? tokenId : ''}
                  disabled={busy || stage === 'unknown' || submissionBlocked}
                  onChange={event => { setTokenId(event.target.value); setSnapshot(undefined); setResult(undefined); invalidate(); }}>
                  {!recoveryIds.includes(tokenId) && <option value="">{lang === 'zh' ? '选择仓位' : 'Select position'}</option>}
                  {recoveryIds.map(id => <option key={id} value={id}>#{id}</option>)}
                </select></div>
              </div>}
              {!DEMO && account && <div className="position-discovery">
                <div className="discovery-actions"><button className="text-link" disabled={busy || discovering} onClick={() => void findPositions()}><RefreshCw size={14} />{lang === 'zh' ? '查找我的仓位' : 'Find my positions'}</button>
                  {discovering && <button className="icon-button" title={lang === 'zh' ? '取消查询' : 'Cancel discovery'} aria-label={lang === 'zh' ? '取消查询' : 'Cancel discovery'} onClick={() => { discoveryController.current?.abort(); setDiscovering(false); }}><X size={16} /></button>}
                </div>
                <div role="status">{discovering ? (lang === 'zh' ? '正在查询仓位…' : 'Finding positions…') : positionPage ?
                  (lang === 'zh' ? `共 ${positionPage.total} 个 · 区块 ${BigInt(positionPage.block.number)}` : `${positionPage.total} positions · block ${BigInt(positionPage.block.number)}`) : ''}</div>
                {positionPage && positionPage.tokenIds.length > 0 && <div className="discovery-actions">
                  <select aria-label={lang === 'zh' ? '已发现的仓位' : 'Discovered positions'} value="" disabled={busy || stage === 'unknown'}
                    onChange={event => { setTokenId(event.target.value); setSnapshot(undefined); invalidate(); }}>
                    <option value="">{lang === 'zh' ? '选择仓位' : 'Select position'}</option>
                    {positionPage.tokenIds.map(id => <option key={id.toString()} value={id.toString()}>#{id.toString()}</option>)}
                  </select>
                  {positionPage.next !== null && <button className="icon-button" title={lang === 'zh' ? '下一页' : 'Next page'} aria-label={lang === 'zh' ? '下一页' : 'Next page'} disabled={busy || discovering} onClick={() => void findPositions(true)}><ArrowRight size={16} /></button>}
                </div>}
              </div>}
              {snapshot ? <>
                <div className="position-identity"><div className="asset-pair"><AssetBadge symbol={snapshot.token0.symbol} index={0} /><AssetBadge symbol={snapshot.token1.symbol} index={1} /></div><div><h3>{snapshot.token0.symbol} / {snapshot.token1.symbol}</h3><span>#{snapshot.tokenId.toString()} <span className="middot">·</span> {snapshot.fee / 10000}%</span></div><span className="success-tag">{own ? <><Check size={12} />{lang === 'zh' ? '直接持有' : 'Directly owned'}</> : t.readOnly}</span></div>
                {excludedPosition && <p role="status" className="field-hint">{lang === 'zh'
                  ? '当前版本不支持 WOKB 仓位交易。此仓位仍可查看，验收请使用替代代币对。'
                  : 'WOKB positions are view-only in this release. Use the replacement token pair for acceptance.'}</p>}
                <dl className="position-facts"><div><dt>{t.owner}</dt><dd><AddressValue value={snapshot.owner} /></dd></div><div><dt>{t.pool}</dt><dd><AddressValue value={snapshot.pool} /></dd></div><div><dt>{t.range}</dt><dd><code>{snapshot.tickLower} → {snapshot.tickUpper}</code><span className="small-tag">{snapshot.tick >= snapshot.tickLower && snapshot.tick < snapshot.tickUpper ? (lang === 'zh' ? '区间内' : 'In range') : (lang === 'zh' ? '区间外' : 'Out of range')}</span></dd></div><div><dt>{t.liquidity}</dt><dd><code>{snapshot.liquidity.toLocaleString()}</code></dd></div></dl>
                <div className="exit-controls"><div className="control-heading"><label htmlFor="exit-range">{t.amount}</label><strong>{bps / 100}%</strong></div>
                  <input id="exit-range" className="range" type="range" min="1" max="10000" step="1" value={bps} disabled={busy || collectOnly || stage === 'unknown'} onChange={e => { setBps(Number(e.target.value)); invalidate(); }} />
                  <div className="segments">{[2500, 5000, 7500, 10000].map(value => <button key={value} className={bps === value ? 'selected' : ''} disabled={busy || collectOnly || stage === 'unknown'} onClick={() => { setBps(value); invalidate(); }}>{value / 100}%</button>)}</div>
                  <div className="setting-line"><label className="checkbox-label"><input type="checkbox" checked={collectOnly} disabled={busy || stage === 'unknown' || snapshot.liquidity === 0n} onChange={e => { setCollectOnly(e.target.checked); invalidate(); }} />{t.onlyCollect}</label><label className="slippage-label">{t.slip}<select aria-label={t.slip} disabled={busy || stage === 'unknown'} value={slippage} onChange={e => { setSlippage(Number(e.target.value)); invalidate(); }}><option value={10}>0.1%</option><option value={50}>0.5%</option><option value={100}>1.0%</option><option value={300}>3.0%</option></select></label></div>
                </div>
                {!canPreview && <div className="readonly-note"><LockKeyhole size={16} /><span>{t.readOnlyHint}</span></div>}
                <button className="primary-button simulate-button" disabled={!canPreview || busy || stage === 'unknown'} onClick={() => void simulate()}>{stage === 'simulating' ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={17} />}{stage === 'simulating' ? t.simulating : t.preview}<ArrowRight size={16} /></button>
              </> : <div className="position-placeholder"><div className="placeholder-icon"><ArrowDownLeft size={29} /></div><p>{stage === 'reading' ? t.reading : (lang === 'zh' ? '从链上读取你的仓位' : 'Read your position from the chain')}</p><span>{lang === 'zh' ? '无需原站账号或专属 API' : 'No original-site account or private API'}</span></div>}
              <div className="assurance-row"><span><Check size={13} />{t.check1}</span><span><Check size={13} />{t.check2}</span><span><Check size={13} />{t.check3}</span></div>
            </section>
            <aside className="preview-section" aria-labelledby="preview-title"><div className="section-top"><h2 id="preview-title">{t.output}</h2><FileCheck2 size={17} className="muted" /></div>
              {preview && plan && snapshot ? <><div className="output-assets">{[snapshot.token0, snapshot.token1].map((asset, i) => <div className="output-asset" key={asset.address}><AssetBadge symbol={asset.symbol} index={i} /><div><span>{asset.symbol}</span><strong>{units(i === 0 ? preview.amount0 : preview.amount1, asset.decimals)}</strong></div><CheckCircle2 size={16} className="green" /></div>)}</div>
                <p className="preview-footnote">{t.feeNote}</p><div className="preview-lines"><div><span>{t.minimum}</span><strong>{units(plan.amount0Min, snapshot.token0.decimals)} / {units(plan.amount1Min, snapshot.token1.decimals)}</strong></div><div><span>{t.gas}</span><strong>{formatUnits(preview.gas * preview.gasPrice, 18)} OKB</strong></div><div><span>{t.deadline}</span><strong>{plan.deadline ? new Date(Number(plan.deadline) * 1000).toLocaleTimeString() : '—'}</strong></div></div>
                <button className="primary-button review-button" disabled={busy || submissionBlocked || stage === 'unknown' || stage === 'done'} onClick={() => { setAccepted(false); setStage('review'); setDetailsOpen(true); }}>{t.review}<ArrowRight size={16} /></button>
              </> : <div className="preview-empty"><div className="receipt-illustration"><FileCheck2 size={36} strokeWidth={1.1} /><span><Check size={11} /></span></div><h3>{t.empty}</h3><p>{t.emptySub}</p></div>}
              <div className="recipient-preview"><LockKeyhole size={14} /><span>{t.recipient}</span><code>{account ? short(account) : '—'}</code></div>
            </aside>
          </div>
          {result && <section className="result-section" aria-live="polite"><div className="result-title"><CheckCircle2 size={24} /><div><h2>{result.state === 'received-checked' ? t.done : t.included}</h2><p>{DEMO ? (lang === 'zh' ? '模拟结果，不代表真实链上交易。' : 'Simulated result. Not an on-chain transaction.') : result.finalized ? 'Finalized' : result.safe ? 'Safe · finalization pending' : t.finality}</p></div></div><div className="result-assets">{snapshot && [snapshot.token0, snapshot.token1].map((a, i) => <span key={a.address}>{units(i === 0 ? result.amount0 : result.amount1, a.decimals)} <strong>{a.symbol}</strong></span>)}</div><label>{t.receipt}</label><AddressValue value={result.hash} /><div className="result-actions"><button className="secondary-button" onClick={record}><Download size={15} />{t.export}</button><button className="secondary-button" onClick={() => DEMO ? void readPosition() : void refreshReceipt()}><RefreshCw size={15} />{DEMO ? t.newExit : t.refresh}</button>{!DEMO && <button className="secondary-button" disabled={checkingOutcome || !account} onClick={() => void checkOutcome()}><RefreshCw size={15} />{checkingOutcome ? (lang === 'zh' ? '正在核对余额与流动性…' : 'Checking balances and liquidity…') : (lang === 'zh' ? '核对余额与流动性' : 'Check balances and liquidity')}</button>}</div>
            {outcome && 'hash' in outcome && outcome.hash === result.hash && outcome.receipt?.blockHash === result.blockHash && <div role="status">
              <p>{outcome.state === 'block-state-matched' ?
                (lang === 'zh' ? '区块状态与收据一致' : 'Block state matches receipt') :
                (lang === 'zh' ? '区块状态存在差异，需要复核' : 'Block state differs; review required')}</p>
              <p>{lang === 'zh' ? '剩余流动性' : 'Remaining liquidity'}: {outcome.liquidity.after}</p>
              {outcome.balances.map(asset => <p key={asset.address}>{asset.symbol}: {units(asset.before, asset.decimals)} → {units(asset.after, asset.decimals)}</p>)}
              <p>{lang === 'zh' ? '比较相邻区块末状态；同区块的其他操作可能影响结果。' : 'Compares adjacent block-end states; other activity in the same block may affect results.'}</p>
            </div>}
            {outcome && !('hash' in outcome) && <p role="status">{lang === 'zh' ? '交易尚未成功确认，状态核对未完成。' : 'Transaction is pending or reverted; state check incomplete.'}</p>}
          </section>}
          {['wallet', 'preflight', 'submitted', 'unknown'].includes(stage) && <div className="transaction-status" role="status"><LoaderCircle className={stage === 'unknown' ? '' : 'spin'} size={18} /><span>{stage === 'wallet' ? t.awaiting : stage === 'preflight' ? t.simulating : stage === 'unknown' ? t.unknown : t.submitted}</span>{hash && <code>{short(hash)}</code>}</div>}
          <section className="dependency-section"><div className="section-top"><h2>{t.dependencies}</h2><button className="text-link" onClick={() => { setDetailsOpen(true); }}>{t.details}<ArrowRight size={13} /></button></div><div className="dependency-grid"><div><span className="dependency-icon"><FileCheck2 size={17} /></span><div><strong>{t.origin}</strong><span>{DEMO ? 'Isolated local demo' : runtime.label}</span></div><span className={`status-dot ${runtime.verified || DEMO ? 'healthy' : ''}`} /></div><div><span className="dependency-icon"><Radio size={17} /></span><div><strong>{t.sources}</strong><span>{DEMO ? 'Simulated A + B' : 'OKX + dRPC'}</span></div><span className={`status-dot ${fault === 'none' && snapshot ? 'healthy' : ''}`} /></div><div><span className="dependency-icon"><LockKeyhole size={17} /></span><div><strong>{t.original}</strong><span>{t.notRequired}</span></div><Check size={16} className="green" /></div></div></section>
          {DEMO && <section className="fault-section"><span><Radio size={15} />{t.fault}</span><select aria-label={t.fault} value={fault} disabled={busy || stage === 'unknown'} onChange={e => { setFault(e.target.value as Fault); invalidate(); }}><option value="none">{t.none}</option><option value="conflict">{t.conflict}</option><option value="unavailable">{t.unavailable}</option></select></section>}
        </>}
        {tab === 'history' && <section className="history-section"><div className="section-top"><h2>{t.history}</h2><button className="text-link" onClick={() => { historyGeneration.current++; clearHistory(); setHistory([]); setHistoryChecks({}); }}>{t.clear}</button></div>{history.length ? <div className="history-list">{history.map(h => <div key={h.hash}><span className="history-icon"><ArrowDownLeft size={18} /></span><div><strong>#{h.tokenId}</strong><span>{new Date(h.time).toLocaleString()} · {h.environment}</span><span className="history-verification" role="status">{historyChecks[h.hash] || (h.environment === 'demo' ? (lang === 'zh' ? '模拟记录' : 'Simulated record') : (lang === 'zh' ? '已保存，尚未重新核对' : 'Saved; not rechecked'))}</span></div><code title={h.hash}>{short(h.hash)}</code><span className="neutral-tag">{h.state}</span><div className="history-actions">{h.environment === 'mainnet' && <button className="icon-button" title={lang === 'zh' ? '重新核对交易' : 'Recheck transaction'} aria-label={lang === 'zh' ? '重新核对交易' : 'Recheck transaction'} disabled={historyLocks.current.has(h.hash)} onClick={() => void verifyHistory(h)}><RefreshCw size={16} /></button>}<button className="icon-button" title={t.export} aria-label={t.export} onClick={() => downloadJson('tapeexit-history.json', h)}><Download size={16} /></button></div></div>)}</div> : <div className="empty-history"><History size={28} /><p>{t.nothing}</p></div>}</section>}
        {tab === 'recovery' && <section className="recovery-section"><div className="recovery-header"><LockKeyhole size={27} /><div><h2>{t.recoveryTitle}</h2><p>{t.recoverySub}</p></div></div><div className="recovery-facts"><div><span>{t.version}</span><code>{RELEASE}</code></div><div><span>{t.target}</span><AddressValue value={MANAGER} /></div><div><span>{t.origin}</span><strong>{runtime.label}</strong></div></div><div className="recovery-actions"><button className="primary-button" onClick={() => void saveCard()}><Download size={16} />{t.saveCard}</button><button className="secondary-button" onClick={() => importInput.current?.click()}><Upload size={16} />{t.importCard}</button></div><div className="local-bundle"><h3>{t.local}</h3><p>{t.localSub}</p><code>node tools/local-server.mjs</code></div></section>}
        {tab === 'recovery' && !DEMO && <RecoveryCheck lang={lang} />}
        <footer><span><ShieldCheck size={15} />{t.scope}</span><code>{RELEASE}</code></footer>
      </main>
    </div>
    <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={e => {
      const file = e.target.files?.[0]; if (!file) return;
      e.target.value = ''; void importCard(file);
    }} />
    {walletPicker && <div className="modal-overlay" onClick={closeWalletPicker}><section className="modal wallet-modal" role="dialog" aria-modal="true" aria-label={t.connect} onClick={e => e.stopPropagation()}><div className="section-top"><h2>{t.connect}</h2><button className="icon-button" aria-label="Close" onClick={closeWalletPicker}><X size={20} /></button></div>{wallets.length ? wallets.map(w => <button key={w.id} className="wallet-choice" disabled={connectingWallet === w.id} aria-busy={connectingWallet === w.id} onClick={() => void chooseWallet(w)}><WalletIcon size={22} />{w.name}{connectingWallet === w.id ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}</button>) : <p>{lang === 'zh' ? '未发现注入钱包。请安装兼容的浏览器钱包后刷新。' : 'No injected wallet found. Install a compatible browser wallet, then refresh.'}</p>}</section></div>}
    {detailsOpen && <div className="modal-overlay" onClick={() => setDetailsOpen(false)}><section className="modal review-modal" role="dialog" aria-modal="true" aria-label={t.review} onClick={e => e.stopPropagation()}><div className="section-top"><h2>{plan && preview ? t.review : t.details}</h2><button className="icon-button" aria-label="Close" onClick={() => setDetailsOpen(false)}><X size={20} /></button></div><dl className="review-facts"><div><dt>{t.version}</dt><dd><code>{RELEASE}</code></dd></div><div><dt>Chain ID</dt><dd>196 · X Layer</dd></div><div><dt>{t.target}</dt><dd><AddressValue value={MANAGER} /></dd></div><div><dt>{t.recipient}</dt><dd>{account ? <AddressValue value={account} /> : '—'}</dd></div>{snapshot && <><div><dt>Token ID</dt><dd>#{snapshot.tokenId.toString()}</dd></div><div><dt>{t.amount}</dt><dd>{collectOnly ? t.onlyCollect : `${bps / 100}%`}</dd></div><div><dt>Token 0</dt><dd><AddressValue value={snapshot.token0.address} /></dd></div><div><dt>Token 1</dt><dd><AddressValue value={snapshot.token1.address} /></dd></div></>}{plan && <div><dt>Plan hash</dt><dd><AddressValue value={plan.hash} /></dd></div>}<div><dt>{t.origin}</dt><dd>{DEMO ? 'Isolated demo' : `${runtime.mode} · ${runtime.label}`}</dd></div></dl><p className="modal-note">{t.disclaimer}</p>{plan && preview && stage === 'review' && <><label className="confirm-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />{lang === 'zh' ? '我已核对目标、仓位和收款地址；此操作由我确认。' : 'I checked the target, position and recipient, and approve this operation.'}</label><button className="primary-button full-width" disabled={!accepted || (!DEMO && !RELEASE_APPROVED)} onClick={() => { setDetailsOpen(false); void execute(); }}><LockKeyhole size={16} />{t.sign}</button></>}</section></div>}
  </div>;
}
