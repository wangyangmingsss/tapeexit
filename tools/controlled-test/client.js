const $ = id => document.getElementById(id), wallets = new Map();
let context, quote, provider, account, busy = false, generation = 0, removeObservers = () => {};
let since = 0, actionName = '';
const status = value => { $('status').textContent = value; };
const coin = value => {
  const n = BigInt(value), unit = 10n ** 18n;
  return `${n / unit}.${(n % unit).toString().padStart(18, '0').replace(/0+$/, '') || '0'} OKB`;
};
const units = value => `${BigInt(value) / 1000000n}.${(BigInt(value) % 1000000n).toString().padStart(6, '0')}`;
function field(id, label, value) {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = label; dd.textContent = String(value); $(id).append(dt, dd);
}
async function api(path, body) {
  const r = await fetch(`/api/${path}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: {
      'content-type': 'application/json', 'x-tapeexit-client': 'controlled-test',
    }, body: JSON.stringify(body) }),
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(90000),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || '检查未完成');
  return value;
}
function controls() {
  const pending = context?.attempts.find(a => a.id === context.unresolved);
  $('connect').disabled = busy || !context || !wallets.size;
  $('wallet').disabled = busy;
  $('prepare').disabled = busy || !context || !!pending || context.complete;
  $('consent').disabled = busy || !quote;
  $('send').disabled = busy || !account || !quote || quote.expiresAt <= Date.now() ||
    !$('consent').checked || !!pending || !!context?.complete;
  $('attach').disabled = busy || !pending;
  $('reconcile').disabled = busy || !pending;
  $('cancel').disabled = busy || !pending || !!pending.hash || !$('cancel-consent').checked;
  $('export').disabled = busy || !context;
  $('recheck').disabled = busy || !context?.complete;
  if (since) $('progress').textContent =
    `${actionName}：已等待 ${Math.floor((Date.now() - since) / 1000)} 秒，本次请求超时倒计时 ${Math.max(0, 90 - Math.floor((Date.now() - since) / 1000))} 秒。`;
}
function render() {
  const p = context.policy;
  $('identity').replaceChildren();
  for (const [name, value] of [['钱包', p.account], ['仓位', `Uniswap V3 #${p.tokenId}`],
    ['USDt0', p.token0], ['USDC', p.token1], ['池', p.pool], ['目标合约', context.manager],
    ['网络', 'X Layer · 196'], ['源码版本', context.sourceCommit || '测试夹具'],
    ['生产签名', '保持关闭'], ['独立审阅', '未完成']]) field('identity', name, value);
  const pending = context.attempts.find(a => a.id === context.unresolved);
  $('pending-section').hidden = !pending;
  if (pending) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(`tapeexit-test:${context.contextId}`) || 'null'); } catch { /* Journal is authoritative. */ }
    $('hash').value = pending.hash || (saved?.id === pending.id && saved.hash) || '';
  }
  $('record').replaceChildren();
  if (context.finality) {
    field('record', '交易所在区块', context.finality.receiptBlock);
    field('record', '网络已最终确认至', context.finality.finalizedBlock);
    field('record', '最终确认尚差区块数', context.finality.remainingBlocks);
  }
  for (const a of context.attempts) {
    field('record', { reserved: '待核验，请勿重发', confirmed: context.freshlyVerified
      ? '到账、余额、剩余流动性与最终确认已核验' : '历史成功记录，本次会话尚未重新核验',
      reverted: '交易回滚', cancelled: '用户确认已取消' }[a.status], a.hash || '尚无钱包交易哈希');
    if (a.outcome) {
      for (const b of a.outcome.balances) field('record', `${b.symbol} 实际到账`, units(b.delta));
      field('record', '剩余流动性', a.outcome.liquidity.after);
    }
    if (a.gasUsed) field('record', '实际 EVM Gas 费用', coin(BigInt(a.gasUsed) * BigInt(a.effectiveGasPriceWei)));
  }
  controls();
}
async function refresh() { context = await api('context'); render(); }
async function run(name, action) {
  if (busy) return;
  busy = true; since = Date.now(); actionName = name; $('progress').hidden = false; controls();
  try { await action(); }
  catch (error) { status(error.message?.startsWith('Receipt not finalized')
    ? '交易已上链，正在等待网络最终确认。请稍后重新核验，无需重发交易。'
    : `${error.message || '检查未完成'}。已有请求记录保留，请勿重复发送。`); }
  finally {
    try { await refresh(); } catch { quote = null; status('无法读取测试记录，停止发送并检查本地服务'); }
    busy = false; since = 0; $('progress').hidden = true; controls();
  }
}
function invalidate() {
  generation++; provider = null; account = null; quote = null; $('consent').checked = false;
  $('account').textContent = '账户或网络已变化，请重新连接'; controls();
}
function addWallet(id, name, value) {
  if (typeof id !== 'string' || typeof name !== 'string' || !value ||
      typeof value.request !== 'function' || wallets.has(id) || wallets.size >= 20) return;
  wallets.set(id, { name, provider: value });
  const option = document.createElement('option'); option.value = id; option.textContent = name.slice(0, 80);
  $('wallet').append(option); controls();
}
window.addEventListener('eip6963:announceProvider', event => {
  try { addWallet(event.detail?.info?.uuid, event.detail?.info?.name, event.detail?.provider); } catch { /* Untrusted metadata. */ }
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
setTimeout(() => {
  try { if (!wallets.size && window.okxwallet) addWallet('okx', 'OKX Wallet', window.okxwallet); } catch { /* Injected getter. */ }
}, 500);
$('wallet').addEventListener('change', () => { removeObservers(); invalidate(); });
async function assertWallet(p, version) {
  const accounts = await p.request({ method: 'eth_accounts' }), chain = await p.request({ method: 'eth_chainId' });
  if (version !== generation || !Array.isArray(accounts) || typeof accounts[0] !== 'string' ||
      accounts[0].toLowerCase() !== context.policy.account.toLowerCase() ||
      typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 196n)
    throw new Error('钱包账户或网络不匹配');
}
$('connect').addEventListener('click', () => run('连接钱包', async () => {
  removeObservers(); invalidate();
  const selected = wallets.get($('wallet').value);
  if (!selected) throw new Error('请选择钱包');
  const p = selected.provider, version = generation;
  if (typeof p.on === 'function' && typeof p.removeListener === 'function') {
    const events = ['accountsChanged', 'chainChanged', 'disconnect'];
    events.forEach(name => p.on(name, invalidate));
    removeObservers = () => events.forEach(name => p.removeListener(name, invalidate));
  }
  await p.request({ method: 'eth_requestAccounts' }); await assertWallet(p, version);
  provider = p; account = context.policy.account; $('account').textContent = `${selected.name} · ${account}`;
  status('钱包已匹配，尚未请求交易');
}));
$('prepare').addEventListener('click', () => run('准备退出预览', async () => {
  quote = null; $('consent').checked = false; $('preview').replaceChildren();
  const q = await api('preview', {}); quote = q;
  for (const [label, value] of [
    ['减少流动性', context.policy.removeLiquidity], ['USDt0 预估到账', units(q.estimatedAmounts[0])],
    ['USDC 预估到账', units(q.estimatedAmounts[1])], ['USDt0 最低本金', units(q.minimums[0])],
    ['USDC 最低本金', units(q.minimums[1])], ['每币领取上限', units(context.policy.maximumCollectionPerToken)],
    ['原生币转账', '0 OKB'], ['EVM Gas 费用上限', coin(q.maximumGasCostWei)],
    ['收款地址', context.policy.account], ['预览到期', new Date(q.expiresAt).toLocaleString()],
  ]) field('preview', label, value);
  $('consent-label').textContent = `我确认这是未独立审阅的主网测试：只减少 #67042 的 1% 流动性，最低本金 ${units(q.minimums[0])} USDt0 / ${units(q.minimums[1])} USDC，每币最多领取 0.05，收款为上述原钱包，EVM Gas 最多 ${coin(q.maximumGasCostWei)}；链特有附加费用以钱包为准。`;
  status('模拟通过，核对数量和费用后勾选确认');
}));
$('consent').addEventListener('change', controls);
$('cancel-consent').addEventListener('change', controls);
async function reconcile() {
  const result = await api('reconcile', {});
  status(result.complete ? '实测成功：到账、剩余仓位和最终确认已核验。可导出记录，并在恢复入口重新核验。' : '交易已确认回滚，未完成退出');
}
$('send').addEventListener('click', () => run('提交并核验退出', async () => {
  if (!navigator.locks) throw new Error('请使用支持页面互斥锁的 Chrome');
  await navigator.locks.request('tapeexit-controlled-test-wallet', { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一页面正在请求钱包');
    const q = quote, p = provider, version = generation;
    quote = null;
    if (!q || !p || q.expiresAt <= Date.now() || !$('consent').checked) throw new Error('请重新准备并确认本次预览');
    await assertWallet(p, version);
    const a = await api('reserve', { previewId: q.id, consent: context.policy.consent,
      maximumGasCostWei: q.maximumGasCostWei });
    if (a.status !== 'reserved' || JSON.stringify(a.quote) !== JSON.stringify(q) ||
        q.transaction.from !== context.policy.account || q.transaction.to !== context.manager ||
        q.transaction.value !== '0x0' || q.transaction.chainId !== '0xc4')
      throw new Error('预约与预览不一致，未请求钱包');
    await refresh(); await assertWallet(p, version);
    if (q.expiresAt <= Date.now()) throw new Error('预览已过期，预约保留，请核对后取消');
    status('请在钱包确认本次小额退出');
    const hash = await p.request({ method: 'eth_sendTransaction', params: [a.quote.transaction] });
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('钱包未返回有效哈希，请检查钱包记录');
    $('hash').value = hash;
    try { localStorage.setItem(`tapeexit-test:${context.contextId}`, JSON.stringify({ id: a.id, hash })); } catch { /* Reservation persists. */ }
    await api('hash', { id: a.id, hash }); await reconcile();
  });
  $('consent').checked = false;
}));
$('attach').addEventListener('click', () => run('保存交易哈希', async () => {
  await api('hash', { id: context.unresolved, hash: $('hash').value.trim() }); status('哈希已保存，可以核验');
}));
$('reconcile').addEventListener('click', () => run('核验到账与剩余仓位', reconcile));
$('recheck').addEventListener('click', () => run('恢复后重新核验', reconcile));
$('cancel').addEventListener('click', () => run('核对钱包取消', async () => {
  if (!$('cancel-consent').checked) throw new Error('请先在钱包拒绝或取消旧请求');
  await api('cancel', { id: context.unresolved, acknowledgement: 'WALLET_CANCELLED_NO_PENDING_SIGNATURE' });
  $('cancel-consent').checked = false; status('已记录取消，尚未退出');
}));
$('export').addEventListener('click', () => run('导出恢复记录', async () => {
  await refresh();
  const url = URL.createObjectURL(new Blob([JSON.stringify(context, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'tapeexit-controlled-test-67042.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
setInterval(controls, 1000);
try { await refresh(); status(context.unresolved ? '存在未核验交易，请先处理旧请求' : context.complete ? '测试已完成，可重新核验或导出' : '测试范围已加载，尚未请求签名'); }
catch { status('无法读取测试范围，停止操作'); }
