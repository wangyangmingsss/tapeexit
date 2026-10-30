const $ = id => document.getElementById(id), wallets = new Map();
const names = { approve: '批准本次 1 USDC', deposit: '存入 1 USDC', partial: '赎回一半份额', full: '赎回剩余份额', complete: '实测流程完成' };
let context, quote, provider, account, busy = false, generation = 0, removeObservers = () => {};
let started = 0, operation = '', nextCheck = 0, checks = 0;
const amount = value => {
  const n = BigInt(value);
  return `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, '0')}`;
};
const gasCost = value => {
  const n = BigInt(value);
  return `${n / 10n ** 18n}.${(n % 10n ** 18n).toString().padStart(18, '0')} OKB`;
};
const status = text => { $('status').textContent = text; };
function field(id, name, value) {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = name; dd.textContent = String(value); $(id).append(dt, dd);
}
async function api(path, body) {
  const response = await fetch(`/api/${path}`, { ...(body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tapeexit-client': 'controlled-test' },
    body: JSON.stringify(body),
  }), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(90000) });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || '本次核验未完成');
  return value;
}
function controls() {
  const pending = context?.attempts.find(a => a.id === context.unresolved);
  $('wallet').disabled = busy;
  $('connect').disabled = busy || !context || !wallets.size;
  $('prepare').disabled = busy || !context || !!pending || context.complete;
  $('consent').disabled = busy || !quote;
  $('send').disabled = busy || !provider || !account || !quote || !!pending ||
    quote.expiresAt <= Date.now() || !$('consent').checked;
  $('attach').disabled = busy || !pending;
  $('reconcile').disabled = busy || !pending?.hash;
  $('cancel').disabled = busy || !pending || !!pending.hash || !$('cancel-consent').checked;
  $('recheck').disabled = busy || !context?.attempts.some(a => a.status === 'confirmed');
  $('export').disabled = busy || !context;
  $('export-recovery').disabled = busy || !context?.attempts.some(a => a.outcome?.recovery);
  $('next-check').textContent = nextCheck ? `${Math.max(0, Math.ceil((nextCheck - Date.now()) / 1000))} 秒后继续只读核验，不会自动签名。` : '';
  if (started) $('progress').textContent = `${operation}：已等待 ${Math.floor((Date.now() - started) / 1000)} 秒，超时倒计时 ${Math.max(0, 90 - Math.floor((Date.now() - started) / 1000))} 秒。`;
}
function render() {
  $('identity').replaceChildren();
  for (const [name, value] of [['钱包', context.policy.account], ['金库', context.policy.vault],
    ['USDC', context.policy.asset], ['网络', 'X Layer · 196'], ['源码', context.sourceCommit],
    ['待确认交易数', context.remainingWalletConfirmations ?? '读取后计算，通常 4 笔'],
    ['生产签名', '关闭']]) field('identity', name, value);
  $('stage').textContent = names[context.stage];
  const pending = context.attempts.find(a => a.id === context.unresolved);
  $('pending-section').hidden = !pending;
  if (pending) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(`tapeexit-vault-test:${context.contextId}`) || 'null'); } catch {}
    $('hash').value = pending.hash || (saved?.id === pending.id && saved.hash) || $('hash').value;
  }
  $('record').replaceChildren();
  for (const a of context.attempts) {
    field('record', `${names[a.quote.stage]} · ${a.status === 'confirmed' ? context.freshlyVerified ? '已重新核验' : '历史确认' : a.status === 'reserved' ? '待核验，请勿重发' : a.status}`, a.hash || '尚无钱包哈希');
    if (a.outcome) {
      if (a.quote.stage !== 'approve') field('record', a.quote.stage === 'deposit' ? 'USDC 存入' : 'USDC 到账', amount(a.outcome.assets));
      field('record', '剩余 spUSDC', amount(a.outcome.remainingShares));
      field('record', '实际 EVM Gas 费用', gasCost(BigInt(a.outcome.gasUsed) * BigInt(a.outcome.effectiveGasPrice)));
    }
  }
  controls();
}
async function refresh() { context = await api('context'); render(); }
async function run(name, action) {
  if (busy) return;
  busy = true; started = Date.now(); operation = name; $('progress').hidden = false; controls();
  try { await action(); } catch (error) { status(`${error.message || '未完成'}；已有请求保留，请勿重复发送。`); }
  finally {
    try { await refresh(); } catch { quote = null; status('本地服务不可用，请保留钱包哈希，停止发送'); }
    busy = false; started = 0; $('progress').hidden = true; controls();
  }
}
function invalidate() {
  generation++; quote = null; provider = null; account = null; $('consent').checked = false;
  $('account').textContent = '请重新连接原钱包'; controls();
}
function addWallet(id, name, candidate) {
  if (typeof id !== 'string' || typeof name !== 'string' || typeof candidate?.request !== 'function' ||
      wallets.has(id) || wallets.size >= 20) return;
  wallets.set(id, { name, provider: candidate });
  const option = document.createElement('option'); option.value = id; option.textContent = name.slice(0, 80);
  $('wallet').append(option); controls();
}
window.addEventListener('eip6963:announceProvider', event => {
  try { addWallet(event.detail?.info?.uuid, event.detail?.info?.name, event.detail?.provider); } catch {}
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
setTimeout(() => { try { if (!wallets.size && window.okxwallet) addWallet('okx', 'OKX Wallet', window.okxwallet); } catch {} }, 500);
async function walletRead(p, method) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(() => p.request({ method })),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error('钱包读取超时，请打开 Chrome 中的 OKX 扩展后重试')), 90000); })]); }
  finally { clearTimeout(timer); }
}
async function assertWallet(p, version) {
  const accounts = await walletRead(p, 'eth_accounts'), chain = await walletRead(p, 'eth_chainId');
  if (version !== generation || !Array.isArray(accounts) || typeof accounts[0] !== 'string' ||
      accounts[0].toLowerCase() !== context.policy.account.toLowerCase() ||
      typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 196n)
    throw Error('请使用指定原钱包，并在 OKX 扩展中选择 X Layer');
}
$('wallet').addEventListener('change', () => { removeObservers(); invalidate(); });
$('connect').addEventListener('click', () => run('连接钱包', async () => {
  removeObservers(); invalidate();
  const selected = wallets.get($('wallet').value);
  if (!selected) throw Error('Chrome 未检测到钱包，请启用 OKX 扩展');
  const p = selected.provider, version = generation;
  if (typeof p.on === 'function' && typeof p.removeListener === 'function') {
    const events = ['accountsChanged', 'chainChanged', 'disconnect'];
    events.forEach(name => p.on(name, invalidate));
    removeObservers = () => events.forEach(name => p.removeListener(name, invalidate));
  }
  await walletRead(p, 'eth_requestAccounts'); await assertWallet(p, version);
  provider = p; account = context.policy.account;
  $('account').textContent = `${selected.name} · ${account}`; status('钱包已匹配，尚未请求交易');
}));
$('prepare').addEventListener('click', () => run('准备并模拟', async () => {
  quote = null; $('consent').checked = false; $('preview').replaceChildren();
  quote = await api('preview', {});
  const unit = quote.stage === 'deposit' ? 'spUSDC' : quote.stage === 'approve' ? 'USDC 授权' : 'USDC';
  for (const [label, value] of [['本次操作', names[quote.stage]], ['预计结果', `${amount(quote.output)} ${unit}`],
    ['核验参考下限（非链上最低到账保证）', `${amount(quote.minimumOutput)} ${unit}`],
    ['本次处理数量', `${amount(quote.amount)} ${['partial', 'full'].includes(quote.stage) ? 'spUSDC' : 'USDC'}`],
    ['收款人 / 份额持有人', context.policy.account], ['目标合约', quote.transaction.to],
    ['原生币转账', '0 OKB'], ['EVM Gas 费用上限', gasCost(quote.maximumGasCostWei)],
    ['预览到期', new Date(quote.expiresAt).toLocaleString()]]) field('preview', label, value);
  $('consent-label').textContent = `我确认未独立审阅的 1 USDC 主网实测，本笔为“${names[quote.stage]}”，金额和原钱包收款如上，EVM Gas 最多 ${gasCost(quote.maximumGasCostWei)}，链特有附加费以钱包显示为准。`;
  status('模拟通过，请核对本笔金额与费用，然后勾选确认');
}));
$('consent').addEventListener('change', controls);
$('cancel-consent').addEventListener('change', controls);
async function reconcile() {
  nextCheck = 0; checks++;
  try {
    const result = await api('reconcile', {});
    quote = null;
    status(result.complete ? '全部链上步骤核验通过；可导出恢复文件，并在本地主网界面重新核验。' : '本笔已核验，请准备下一笔。');
  } catch (error) {
    if (/^(Receipt not finalized|Transaction pending;)/.test(error.message || '') && $('auto-check').checked && checks < 20) {
      nextCheck = Date.now() + 3000;
      status('交易已提交，正在等待链上确认；保留哈希，无需重发。');
      return;
    }
    throw error;
  }
}
async function walletSend(p, attempt) {
  let timer, timedOut = false;
  const response = Promise.resolve().then(() => p.request({
    method: 'eth_sendTransaction', params: [attempt.quote.transaction],
  })).then(async value => {
    if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) throw Error('钱包未返回有效哈希，请检查钱包历史');
    $('hash').value = value;
    try { localStorage.setItem(`tapeexit-vault-test:${context.contextId}`, JSON.stringify({ id: attempt.id, hash: value })); } catch {}
    await api('hash', { id: attempt.id, hash: value });
    if (timedOut && !busy) {
      await refresh(); status('钱包稍后返回的哈希已保存，请继续核验，无需重发。');
      if ($('auto-check').checked) nextCheck = Date.now() + 3000;
    }
    return value;
  });
  try { return await Promise.race([response, new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(Error('钱包等待超过 90 秒，原请求保留；请打开扩展检查，不要重发')); }, 90000);
  })]); } finally { clearTimeout(timer); }
}
$('send').addEventListener('click', () => run('请求钱包并核验', async () => {
  if (!navigator.locks) throw Error('请在 Chrome 中使用本页');
  await navigator.locks.request('tapeexit-controlled-vault-wallet', { ifAvailable: true }, async lock => {
    if (!lock) throw Error('另一页面正在请求钱包');
    const q = quote, p = provider, version = generation;
    quote = null;
    if (!q || !p || q.expiresAt <= Date.now() || !$('consent').checked) throw Error('请重新准备并确认预览');
    await assertWallet(p, version);
    const attempt = await api('reserve', { previewId: q.id, consent: context.policy.consent, maximumGasCostWei: q.maximumGasCostWei });
    if (attempt.status !== 'reserved' || JSON.stringify(attempt.quote) !== JSON.stringify(q) ||
        q.transaction.from !== context.policy.account ||
        q.transaction.to !== (q.stage === 'approve' ? context.policy.asset : context.policy.vault) ||
        q.transaction.value !== '0x0' || q.transaction.chainId !== '0xc4') throw Error('预约不匹配，未请求钱包');
    await refresh(); await assertWallet(p, version);
    if (q.expiresAt <= Date.now()) throw Error('预览已过期，预约保留，请先在钱包核对取消');
    status('请打开 OKX 扩展，核对并确认本笔交易');
    await walletSend(p, attempt); checks = 0; await reconcile();
  });
  $('consent').checked = false;
}));
$('attach').addEventListener('click', () => run('保存哈希', async () => {
  await api('hash', { id: context.unresolved, hash: $('hash').value.trim() }); status('哈希已保存，可继续核验');
}));
for (const id of ['reconcile', 'recheck']) $(id).addEventListener('click', () => {
  checks = 0; nextCheck = 0; void run('重新核验链上记录', reconcile);
});
$('cancel').addEventListener('click', () => run('核对取消', async () => {
  if (!$('cancel-consent').checked) throw Error('请先在钱包取消或拒绝旧请求');
  await api('cancel', { id: context.unresolved, acknowledgement: 'WALLET_CANCELLED_NO_PENDING_SIGNATURE' });
  $('cancel-consent').checked = false; status('取消已记录，尚未完成本笔操作');
}));
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').addEventListener('click', () => run('导出记录', async () => {
  await refresh(); download('tapeexit-spark-wallet-test.json', context);
}));
$('export-recovery').addEventListener('click', () => run('导出恢复文件', async () => {
  await refresh();
  const attempt = context.attempts.slice().reverse().find(a => a.outcome?.recovery);
  if (!attempt) throw Error('尚无核验通过的赎回记录');
  download('tapeexit-spark-vault-recovery.json', attempt.outcome.recovery);
}));
$('auto-check').addEventListener('change', () => { if (!$('auto-check').checked) nextCheck = 0; controls(); });
setInterval(() => {
  controls();
  if (!busy && nextCheck && Date.now() >= nextCheck) { nextCheck = 0; void run('自动核验', reconcile); }
}, 1000);
try {
  await refresh();
  status(context.unresolved ? '存在待核验请求，请先处理，禁止重复发送' : '实测范围已加载，尚未请求签名');
  if (context.attempts.some(a => a.status === 'reserved' && a.hash)) nextCheck = Date.now() + 3000;
} catch { status('无法读取实测范围，停止操作'); }
