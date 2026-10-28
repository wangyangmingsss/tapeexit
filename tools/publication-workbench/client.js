const $ = id => document.getElementById(id);
const wallets = new Map();
let context, preview, account, connectedProvider, busy = false, generation = 0, removeObservers = () => {};
let preparingSince = null;
let verifyingSince = null;
const CHECK_TIMEOUT_MS = 90_000;
const status = text => { $('status').textContent = text; };
const coin = wei => {
  const n = BigInt(wei), whole = n / 10n ** 18n;
  return `${whole}.${(n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '') || '0'} OKB`;
};
function field(id, name, value) {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = name; dd.textContent = String(value); $(id).append(dt, dd);
}
async function api(path, body) {
  const response = await fetch(`/api/${path}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: {
      'content-type': 'application/json', 'x-tapeexit-client': 'publication-workbench',
    }, body: JSON.stringify(body) }),
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '发布检查失败');
  return value;
}
function controls() {
  if (verifyingSince !== null) {
    const elapsed = Math.floor((Date.now() - verifyingSince) / 1000);
    const remaining = Math.max(0, Math.ceil(CHECK_TIMEOUT_MS / 1000) - elapsed);
    $('reconcile').textContent = `正在核验 · 超时倒计时 ${remaining} 秒`;
    $('verification-progress').textContent = `已等待 ${elapsed} 秒，距离本次请求超时剩余 ${remaining} 秒。正在检查双 RPC 回执、交易内容、稳定区块及文件字节；这不是预计完成时间。`;
  } else $('reconcile').textContent = '核验交易和文件';
  $('refresh').textContent = preparingSince === null ? '准备 / 刷新下一笔' :
    `正在准备 · ${Math.floor((Date.now() - preparingSince) / 1000)} 秒`;
  const authorized = context?.authorization?.expiresAt > Date.now();
  $('connect').disabled = busy || !wallets.size || !context;
  $('wallet').disabled = busy;
  $('authorize').disabled = busy || !context || !account || !$('consent').checked || !!context?.unresolved;
  $('refresh').disabled = busy || !context || !!context?.unresolved;
  $('send').disabled = busy || !authorized || !account || !preview || preview.expiresAt <= Date.now() || !!context?.unresolved;
  $('attach').disabled = busy || !context?.unresolved;
  $('reconcile').disabled = busy || !context?.unresolved;
  const pending = context?.attempts.find(a => a.id === context.unresolved);
  $('cancel-request').disabled = busy || !pending || !!pending.hash || !$('cancel-consent').checked;
  $('export').disabled = !context;
  $('badge').textContent = context?.unresolved ? '待核验 · 上传暂停' : authorized ? '费用已确认' : '未确认费用';
}
function render() {
  $('files').textContent = `${context.fileCount} 个 / ${context.totalBytes.toLocaleString()} 字节`;
  $('confirmed').textContent = `${context.attempts.filter(a => a.status === 'confirmed').length} 笔 / ${context.totalOperations} 步`;
  $('maximum').textContent = coin(context.maximumWei);
  $('reserved').textContent = coin(context.reservedWei);
  $('identity').replaceChildren();
  for (const [name, value] of [
    ['发布人', context.publisher], ['容器', context.container], ['注册表', context.registry],
    ['发行清单 SHA-256', context.manifestSha256], ['网络', 'X Layer · 196'],
    ['单笔 Gas 上限', context.maxGas], ['Gas 单价上限 / wei', context.maxGasPriceWei],
    ['本次费用确认到期', context.authorization ? new Date(context.authorization.expiresAt).toISOString() : '未确认'],
  ]) field('identity', name, value);
  $('consent-label').textContent = `我确认向上述容器上传这一发行，EVM Gas 总预算最多 ${coin(context.maximumWei)}，确认有效期一小时；不含激活及链特有附加费用。`;
  const pending = context.attempts.find(a => a.id === context.unresolved);
  $('pending-section').hidden = !pending;
  if (pending) {
    $('pending-status').textContent = `第 ${pending.operation + 1} 步的钱包请求尚未核验，其他上传已停止。`;
    if (pending.hash) $('tx-hash').value = pending.hash;
    else {
      try {
        const saved = JSON.parse(localStorage.getItem(`tapeexit-publish:${context.contextId}`) || 'null');
        if (saved?.id === pending.id && /^0x[0-9a-f]{64}$/i.test(saved.hash)) $('tx-hash').value = saved.hash;
      } catch { /* Server journal remains authoritative when local storage is unavailable. */ }
    }
  }
  $('attempts').replaceChildren();
  const names = { reserved: '待核验', confirmed: '交易与文件已核验', reverted: '交易回滚', 'cancelled-by-user': '用户确认已取消' };
  for (const attempt of context.attempts) {
    const tr = document.createElement('tr');
    for (const value of [attempt.operation + 1, names[attempt.status], attempt.hash || '等待钱包交易哈希']) {
      const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
    }
    $('attempts').append(tr);
  }
  controls();
}
async function refreshContext() { context = await api('context'); render(); }
async function run(action) {
  if (busy) return;
  busy = true; controls();
  try { await action(); }
  catch (error) { status(error instanceof Error ? error.message : '操作未完成，上传保持停止'); }
  finally {
    try { await refreshContext(); } catch { status('无法读取上传记录，停止操作并检查本地服务'); preview = null; }
    busy = false; controls();
  }
}
function invalidateWallet() {
  generation++; account = null; connectedProvider = null; preview = null;
  $('account').textContent = '账户或网络已变化，请重新连接'; controls();
}
function addWallet(id, name, provider) {
  if (typeof id !== 'string' || typeof name !== 'string' || !provider ||
      typeof provider.request !== 'function' || wallets.has(id) || wallets.size >= 20) return;
  wallets.set(id, { name, provider });
  const option = document.createElement('option'); option.value = id; option.textContent = name.slice(0, 80);
  $('wallet').append(option); controls();
}
window.addEventListener('eip6963:announceProvider', event => {
  try { const { info, provider } = event.detail || {}; addWallet(info?.uuid, info?.name, provider); } catch { /* Untrusted metadata. */ }
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
setTimeout(() => {
  try { if (!wallets.size && window.okxwallet) addWallet('okx', 'OKX Wallet', window.okxwallet); } catch { /* Injected getter. */ }
}, 500);
$('wallet').addEventListener('change', () => { removeObservers(); invalidateWallet(); });
async function assertWallet(provider, expectedGeneration) {
  const accounts = await provider.request({ method: 'eth_accounts' });
  const chain = await provider.request({ method: 'eth_chainId' });
  if (generation !== expectedGeneration || !Array.isArray(accounts) ||
      typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== context.publisher.toLowerCase() ||
      typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 196n)
    throw new Error('钱包账户或网络不匹配，停止上传');
}
$('connect').addEventListener('click', () => run(async () => {
  removeObservers(); invalidateWallet();
  const selected = wallets.get($('wallet').value);
  if (!selected) throw new Error('请选择钱包');
  const { provider } = selected;
  if (typeof provider.on === 'function' && typeof provider.removeListener === 'function') {
    const events = ['accountsChanged', 'chainChanged', 'disconnect'];
    events.forEach(name => provider.on(name, invalidateWallet));
    removeObservers = () => events.forEach(name => provider.removeListener(name, invalidateWallet));
  }
  await provider.request({ method: 'eth_requestAccounts' });
  await assertWallet(provider, generation);
  account = context.publisher; connectedProvider = provider;
  $('account').textContent = `${selected.name} · ${account} · X Layer`;
  status('发布账户已匹配；尚未请求交易签名');
}));
$('consent').addEventListener('change', controls);
$('authorize').addEventListener('click', () => run(async () => {
  if (!$('consent').checked || !connectedProvider) throw new Error('请先连接发布账户并确认费用范围');
  await assertWallet(connectedProvider, generation);
  await api('authorize', { contextId: context.contextId, maximumWei: context.maximumWei });
  status('费用范围已确认；每次仅发送你选择确认的一笔上传交易');
}));
$('refresh').addEventListener('click', () => run(async () => {
  preview = null; preparingSince = Date.now(); controls();
  $('preview').replaceChildren();
  field('preview', '状态', '正在核对两个 RPC、容器、已上传文件和费用，请等待');
  status('正在核对容器、文件前缀和当前费用');
  let result;
  try {
    result = await api('preview', {});
  } catch (error) {
    $('preview').replaceChildren();
    const message = error instanceof Error ? error.message : '检查未完成';
    field('preview', '准备未完成', `${message}；尚未请求钱包交易，可重新准备`);
    throw error;
  } finally {
    preparingSince = null; controls();
  }
  $('preview').replaceChildren();
  if (result.complete) {
    field('preview', '完成', '所有发行文件及 fallback 已回读核验；激活另行处理');
    status('实际上传文件回读通过；容器激活状态以回读报告为准'); return;
  }
  preview = result;
  for (const [name, value] of [
    ['步骤', `${result.operation + 1} / ${context.totalOperations}，剩余 ${result.remaining} 笔`],
    ['文件', result.file], ['分块序号', result.chunk], ['Gas 上限', BigInt(result.transaction.gas)],
    ['Gas 单价 / wei', BigInt(result.transaction.gasPrice)], ['本笔 EVM 费用上限', coin(result.maximumCostWei)],
    ['报价到期', new Date(result.expiresAt).toISOString()],
  ]) field('preview', name, value);
  status('本笔检查通过，等待你确认');
}));
function validateReserved(attempt, expected) {
  const tx = attempt.transaction;
  const keys = ['from', 'to', 'data', 'value', 'chainId', 'gas', 'gasPrice', 'nonce'];
  if (attempt.status !== 'reserved' || attempt.operation !== expected.operation ||
      !tx || keys.some(key => tx[key] !== expected.transaction[key]) ||
      tx.from !== context.publisher || tx.to !== context.registry || tx.value !== '0x0' ||
      tx.chainId !== '0xc4' || !/^0x(?:[0-9a-f]{2})+$/i.test(tx.data) ||
      BigInt(tx.gas) > BigInt(context.maxGas) || BigInt(tx.gasPrice) > BigInt(context.maxGasPriceWei))
    throw new Error('待签交易与预览不一致，停止上传');
}
$('send').addEventListener('click', () => run(async () => {
  if (!navigator.locks) throw new Error('浏览器不支持上传互斥锁，请使用当前版本的 Chrome');
  await navigator.locks.request('tapeexit-publication-wallet', { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一页面正在请求钱包，请先处理旧请求');
    const expected = preview, provider = connectedProvider, version = generation;
    preview = null;
    if (!expected || !provider || expected.expiresAt <= Date.now()) throw new Error('本笔预览已过期，请刷新');
    await assertWallet(provider, version);
    status('正在重新检查并保存本笔上传记录');
    const attempt = await api('reserve', { previewId: expected.id });
    validateReserved(attempt, expected);
    await refreshContext();
    await assertWallet(provider, version);
    if (expected.expiresAt <= Date.now() || !context.authorization || context.authorization.expiresAt <= Date.now())
      throw new Error('确认已过期，已保留待核验记录；未继续请求钱包');
    status('请在 OKX 钱包中核对并确认这一笔上传');
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [attempt.transaction] });
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash))
      throw new Error('钱包未返回有效交易哈希，保持停止并检查钱包记录');
    $('tx-hash').value = hash;
    try { localStorage.setItem(`tapeexit-publish:${context.contextId}`, JSON.stringify({ id: attempt.id, hash })); } catch { /* Server retains reservation. */ }
    await api('hash', { attemptId: attempt.id, hash });
    await refreshContext();
    await reconcileWithFeedback();
  });
}));
$('attach').addEventListener('click', () => run(async () => {
  const hash = $('tx-hash').value.trim();
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('请输入完整交易哈希');
  await api('hash', { attemptId: context.unresolved, hash });
  status('交易哈希已保存，等待链上核验');
}));
async function reconcileWithFeedback() {
  verifyingSince = Date.now();
  $('verification-progress').hidden = false;
  $('verification-result').hidden = true;
  controls();
  status('正在核对交易回执、稳定区块和文件字节');
  try {
    const result = await api('reconcile', {});
    context = result; render();
    const attempt = result.attempts.at(-1);
    const message = attempt?.status === 'confirmed'
      ? '核验成功：交易与文件字节均通过检查，可以准备下一笔。'
      : '交易已确认回滚，本笔上传未完成。请重新准备本笔并检查钱包结果。';
    $('verification-result').textContent = message;
    $('verification-result').hidden = false;
    status(message);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '检查未完成';
    const message = /fee envelope exceeds authorized upload budget/i.test(detail)
      ? '核验暂停：钱包最终 Gas 参数超出已确认的单笔或累计费用上限。请核对钱包最终参数；交易记录已保留，请勿重复发送。'
      : /TimeoutError|timed out|aborted/i.test(detail)
      ? '本次核验等待超时，上传记录已保留。可再次点击核验，无需重新发送交易。'
      : `核验未完成：${detail}。上传记录已保留，请勿重复发送交易。`;
    $('verification-result').textContent = message;
    $('verification-result').hidden = false;
    throw new Error(message);
  } finally {
    verifyingSince = null;
    $('verification-progress').hidden = true;
    controls();
  }
}
$('reconcile').addEventListener('click', () => run(reconcileWithFeedback));
$('cancel-consent').addEventListener('change', controls);
$('cancel-request').addEventListener('click', () => run(async () => {
  if (!$('cancel-consent').checked) throw new Error('请先在钱包取消旧请求并确认');
  await api('cancel-request', { attemptId: context.unresolved,
    acknowledgement: 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE' });
  $('cancel-consent').checked = false;
  status('已记录你的取消确认；费用预留保持不变。重新准备时会再次核对链上状态。');
}));
$('export').addEventListener('click', async () => {
  try {
    await refreshContext();
    const url = URL.createObjectURL(new Blob([JSON.stringify(context, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'tapeexit-upload-record.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { status('上传记录读取失败，未导出'); }
});
setInterval(controls, 1000);
try {
  await refreshContext();
  status(context.unresolved ? '存在未核验的钱包请求，先处理旧请求' : '发行信息已加载，尚未请求签名');
} catch { status('发行信息无法读取，停止操作'); }
