const $ = id => document.getElementById(id);
const wallets = new Map();
let context, preview, account, connectedProvider, busy = false, generation = 0, removeObservers = () => {};
let preparingSince = null;
let verifyingSince = null;
let submissionSince = null, submissionPhase = '';
let activationPreview = null, activationSince = null, activationAction = '';
const CHECK_TIMEOUT_MS = 90_000;
const NEXT_CHECK_DELAY_MS = 3000;
let automaticTimer = null, automaticAction = null, automaticAt = null, verificationRetries = 0;
let publicationComplete = false, automaticError = '';
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
  activationControls();
  if (submissionSince !== null) {
    const elapsed = Math.floor((Date.now() - submissionSince) / 1000);
    if (submissionPhase === 'recheck') {
      const remaining = Math.max(0, Math.ceil(CHECK_TIMEOUT_MS / 1000) - elapsed);
      $('send').textContent = `提交前复核 · ${remaining} 秒`;
      $('submission-progress').textContent = `正在重新核对链上文件、nonce 和费用，尚未请求钱包。已等待 ${elapsed} 秒，本次复核超时倒计时 ${remaining} 秒。`;
    } else if (submissionPhase === 'wallet') {
      $('send').textContent = '等待钱包确认';
      $('submission-progress').textContent = `已向所选钱包发出确认请求，已等待 ${elapsed} 秒。若没有弹窗，请打开浏览器扩展中的钱包查看待处理请求；请勿重复提交。`;
    } else {
      $('send').textContent = '正在核对钱包';
      $('submission-progress').textContent = '正在核对钱包账户与 X Layer 网络，尚未请求交易；单次钱包状态查询最多等待 15 秒。';
    }
  } else $('send').textContent = '在钱包中确认这一笔';
  if (verifyingSince !== null) {
    const elapsed = Math.floor((Date.now() - verifyingSince) / 1000);
    const remaining = Math.max(0, Math.ceil(CHECK_TIMEOUT_MS / 1000) - elapsed);
    $('reconcile').textContent = `正在核验 · 超时倒计时 ${remaining} 秒`;
    $('verification-progress').textContent = `已等待 ${elapsed} 秒，距离本次请求超时剩余 ${remaining} 秒。正在检查双 RPC 回执、交易内容、稳定区块及文件字节；这不是预计完成时间。`;
  } else $('reconcile').textContent = '核验交易和文件';
  $('refresh').textContent = preparingSince === null ? '准备 / 刷新下一笔' :
    `正在准备 · ${Math.floor((Date.now() - preparingSince) / 1000)} 秒`;
  if (automaticAt !== null && !busy) {
    const seconds = Math.max(0, Math.ceil((automaticAt - Date.now()) / 1000));
    if (automaticAction === 'prepare') $('refresh').textContent = `${seconds} 秒后自动准备下一笔`;
    if (automaticAction === 'reconcile') $('reconcile').textContent = `${seconds} 秒后自动再次核验`;
  }
  const autoStatus = $('automatic-status');
  if (automaticAt !== null) {
    const seconds = Math.max(0, Math.ceil((automaticAt - Date.now()) / 1000));
    autoStatus.textContent = `${seconds} 秒后自动${automaticAction === 'prepare' ? '准备下一笔' : '再次核验已有交易'}；钱包确认仍由你操作。`;
  } else if (preparingSince !== null) autoStatus.textContent = '自动衔接正在准备：链上读取进行中，3 秒是启动间隔，实际读取时间以 RPC 返回为准。';
  else if (verifyingSince !== null) autoStatus.textContent = '自动衔接等待本次核验完成。';
  else if (automaticError) autoStatus.textContent = `自动衔接已暂停：${automaticError}`;
  else if (publicationComplete) autoStatus.textContent = '全部文件及入口已核验，自动衔接已完成。';
  else if (!connectedProvider) autoStatus.textContent = '自动衔接等待连接原发布钱包。';
  else if (context?.activation?.unresolved) autoStatus.textContent = '自动衔接暂停：请先处理待核验的激活请求。';
  else if (context?.unresolved) autoStatus.textContent = '自动衔接暂停：请先核验已有钱包请求，尚未准备下一笔。';
  else if (!(context?.authorization?.expiresAt > Date.now())) autoStatus.textContent = '自动衔接等待确认上传费用范围。';
  else if (preview) autoStatus.textContent = '本笔已准备完成，等待你点击“在钱包中确认这一笔”；不会自动签名。';
  else if (busy) autoStatus.textContent = '自动衔接等待当前操作完成。';
  else autoStatus.textContent = '自动衔接已就绪。';
  const authorized = context?.authorization?.expiresAt > Date.now();
  $('connect').disabled = busy || !wallets.size || !context;
  $('wallet').disabled = busy;
  $('authorize').disabled = busy || !context || !account || !$('consent').checked || !!context?.unresolved;
  $('refresh').disabled = busy || !context || !!context?.unresolved;
  $('send').disabled = busy || !authorized || !account || !preview || preview.expiresAt <= Date.now() || !!context?.unresolved;
  $('attach').disabled = busy || !context?.unresolved;
  $('reconcile').disabled = busy || !context?.unresolved;
  const pending = context?.attempts.find(a => a.id === context.unresolved);
  $('cancel-request').disabled = busy || !pending || !!pending.hash || (pending.batch && !pending.batch.offchainFailure) || !$('cancel-consent').checked;
  $('recover-batch').disabled = busy || !pending?.batch || !account;
  $('export').disabled = !context;
  if (context?.activation?.unresolved)
    ['refresh', 'send'].forEach(id => { $(id).disabled = true; });
  $('badge').textContent = context?.activation?.unresolved ? '激活待核验' :
    context?.unresolved ? '待核验 · 上传暂停' : authorized ? '费用已确认' : '未确认费用';
}
function render() {
  renderActivation();
  $('files').textContent = `${context.fileCount} 个 / ${context.totalBytes.toLocaleString()} 字节`;
  const completed = context.completedOperations ?? context.attempts.filter(a => a.status === 'confirmed')
    .reduce((n, a) => n + (a.batch?.operations.length || 1), 0);
  $('confirmed').textContent = context.requiredOperations != null
    ? `${completed} / ${context.requiredOperations} 步，剩余 ${context.remainingTransactions} 笔`
    : Object.hasOwn(context, 'requiredOperations') ? `${completed} 步；剩余次数待链上核对`
      : `${completed} / ${context.totalOperations} 步`;
  $('maximum').textContent = coin(context.maximumWei);
  $('reserved').textContent = coin(context.reservedWei);
  $('identity').replaceChildren();
  for (const [name, value] of [
    ['发布人', context.publisher], ['容器', context.container], ['注册表', context.registry],
    ['发行清单 SHA-256', context.manifestSha256], ['网络', 'X Layer · 196'],
    ['单笔 Gas 上限', context.maxGas], ['Gas 单价上限 / wei', context.maxGasPriceWei],
    ['本次费用确认到期', context.authorization ? new Date(context.authorization.expiresAt).toISOString() : '未确认'],
  ]) field('identity', name, value);
  $('consent-label').textContent = `${context.migration
    ? `本次升级会逐笔移除 ${context.migration.removalCount} 个已核对的旧文件，迁移期间网站可能暂时不可用。旧版备份已保留。` : ''
  }我确认向上述容器上传这一发行，EVM Gas 总预算最多 ${coin(context.maximumWei)}，确认有效期一小时；不含激活及链特有附加费用。`;
  const pending = context.attempts.find(a => a.id === context.unresolved);
  $('pending-section').hidden = !pending;
  $('bundle-label').hidden = !pending?.batch;
  $('recover-batch').hidden = !pending?.batch;
  if (pending) {
    $('pending-status').textContent = `第 ${pending.batch ? pending.batch.operations.map(n => n + 1).join('、') : pending.operation + 1} 步的钱包请求尚未核验，其他上传已停止。`;
    if (pending.batch) {
      let saved;
      try { saved = JSON.parse(localStorage.getItem(`tapeexit-batch:${context.contextId}`) || 'null'); } catch { /* Journal is authoritative. */ }
      $('bundle-id').value = pending.batch.bundleId || (saved?.attemptId === pending.id && saved.bundleId) || pending.batch.requestId;
    }
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
    for (const value of [attempt.batch ? attempt.batch.operations.map(n => n + 1).join('、') : attempt.operation + 1,
      names[attempt.status], attempt.hash || attempt.batch?.bundleId || '等待钱包交易哈希']) {
      const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
    }
    $('attempts').append(tr);
  }
  controls();
}
async function refreshContext() { context = await api('context'); render(); }
function cancelAutomatic() {
  if (automaticTimer !== null) clearTimeout(automaticTimer);
  automaticTimer = null; automaticAt = null; automaticAction = null;
}
function scheduleAutomatic(action) {
  cancelAutomatic();
  automaticAction = action; automaticAt = Date.now() + NEXT_CHECK_DELAY_MS;
}
function startAutomaticTimer() {
  if (!automaticAction) return;
  const action = automaticAction, version = generation, attemptId = context?.unresolved;
  automaticTimer = setTimeout(() => {
    cancelAutomatic();
    if (busy || version !== generation || !connectedProvider || context?.activation?.unresolved) {
      controls(); return;
    }
    if (action === 'prepare' && !context?.unresolved && context?.authorization?.expiresAt > Date.now())
      $('refresh').click();
    else if (action === 'reconcile' && context?.unresolved === attemptId && attemptId)
      $('reconcile').click();
    controls();
  }, Math.max(0, automaticAt - Date.now()));
}
async function run(action, resumeAfterConnection = false) {
  if (busy) return;
  cancelAutomatic();
  automaticError = '';
  let succeeded = false;
  busy = true; controls();
  try { await action(); succeeded = true; }
  catch (error) {
    automaticError = error instanceof Error ? error.message : '操作未完成，上传保持停止';
    status(automaticError);
  }
  finally {
    try { await refreshContext(); } catch {
      automaticError = '无法读取上传记录，请检查本地服务';
      status(automaticError); preview = null; cancelAutomatic(); succeeded = false;
    }
    // Reconnection and renewed fee consent resume read-only preparation after reload.
    if (succeeded && resumeAfterConnection && !automaticAction && connectedProvider && !context?.activation?.unresolved) {
      if (!context?.unresolved && context?.authorization?.expiresAt > Date.now() && !preview && !publicationComplete)
        scheduleAutomatic('prepare');
      else if (context?.unresolved && verificationRetries < 4 &&
          context.attempts.find(a => a.id === context.unresolved)?.hash)
        scheduleAutomatic('reconcile');
    }
    busy = false; controls();
    startAutomaticTimer();
  }
}
function invalidateWallet() {
  cancelAutomatic(); verificationRetries = 0;
  generation++; account = null; connectedProvider = null; preview = null;
  activationPreview = null; $('activation-consent').checked = false;
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
  const accounts = await walletRead(provider, 'eth_accounts', []);
  const chain = await walletRead(provider, 'eth_chainId', []);
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
}, true));
$('consent').addEventListener('change', controls);
$('authorize').addEventListener('click', () => run(async () => {
  if (!$('consent').checked || !connectedProvider) throw new Error('请先连接发布账户并确认费用范围');
  await assertWallet(connectedProvider, generation);
  await api('authorize', { contextId: context.contextId, maximumWei: context.maximumWei });
  status('费用范围已确认；仅在你点击提交并在钱包确认后发送');
}, true));
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
    publicationComplete = true;
    field('preview', '完成', '所有发行文件及 fallback 已回读核验；激活另行处理');
    status('实际上传文件回读通过；容器激活状态以回读报告为准'); return;
  }
  publicationComplete = false;
  preview = result;
  for (const [name, value] of [
    ['剩余交易', `${result.remaining} 笔钱包确认（包含当前这一笔）`],
    ['文件', result.file], ['操作', result.chunk === -1 ? '移除已核验的旧文件' : '上传文件分块'],
    ['分块序号', result.chunk === -1 ? '不适用' : result.chunk], ['Gas 上限', BigInt(result.transaction.gas)],
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
  let walletRequested = false;
  $('submission-progress').hidden = false;
  submissionSince = Date.now(); submissionPhase = 'wallet-check'; controls();
  try {
  if (!navigator.locks) throw new Error('浏览器不支持上传互斥锁，请使用当前版本的 Chrome');
  await navigator.locks.request('tapeexit-publication-wallet', { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一页面正在请求钱包，请先处理旧请求');
    const expected = preview, provider = connectedProvider, version = generation;
    preview = null;
    if (!expected || !provider || expected.expiresAt <= Date.now()) throw new Error('本笔预览已过期，请刷新');
    await assertWallet(provider, version);
    status('正在重新检查并保存本笔上传记录');
    submissionSince = Date.now(); submissionPhase = 'recheck'; controls();
    let attempt;
    try { attempt = await api('reserve', { previewId: expected.id }); }
    finally { submissionSince = Date.now(); submissionPhase = 'wallet-check'; controls(); }
    validateReserved(attempt, expected);
    await refreshContext();
    await assertWallet(provider, version);
    if (expected.expiresAt <= Date.now() || !context.authorization || context.authorization.expiresAt <= Date.now())
      throw new Error('确认已过期，已保留待核验记录；未继续请求钱包');
    status('请在 OKX 钱包中核对并确认这一笔上传');
    walletRequested = true;
    submissionSince = Date.now(); submissionPhase = 'wallet'; controls();
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [attempt.transaction] });
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash))
      throw new Error('钱包未返回有效交易哈希，保持停止并检查钱包记录');
    $('tx-hash').value = hash;
    try { localStorage.setItem(`tapeexit-publish:${context.contextId}`, JSON.stringify({ id: attempt.id, hash })); } catch { /* Server retains reservation. */ }
    await api('hash', { attemptId: attempt.id, hash });
    submissionSince = null;
    $('submission-progress').textContent = '钱包已返回交易哈希并保存，正在核验交易和文件；无需再次提交。';
    await refreshContext();
    await reconcileWithFeedback();
  });
  } catch (error) {
    let message = error instanceof Error ? error.message : '提交未完成';
    if (/Upload preview expired|本笔预览已过期/.test(message))
      message = '本笔报价已过期，请点击“准备 / 刷新下一笔”重新核对';
    else if (/Upload state or quote changed/.test(message))
      message = '链上状态或费用已变化，请重新准备并核对报价';
    $('submission-progress').textContent = `${message}。${walletRequested
      ? '钱包请求已发出；请检查扩展钱包及交易记录，勿重复发送。'
      : '尚未发起钱包交易调用。如页面已有待核验记录，请先处理该记录。'}`;
    throw new Error(message);
  } finally { submissionSince = null; submissionPhase = ''; controls(); }
}));
async function walletRead(provider, method, params) {
  let timer;
  try {
    return await Promise.race([provider.request({ method, params }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('钱包状态查询超时，请再次核验，无需重新发送')), 15000); })]);
  } finally { clearTimeout(timer); }
}
async function recoverBatchHash() {
  const a = context.attempts.find(a => a.id === context.unresolved);
  if (!a?.batch || a.hash) return;
  const provider = connectedProvider, version = generation;
  if (!provider) throw new Error('请先连接原发布钱包，再查询批量结果');
  await assertWallet(provider, version);
  const id = $('bundle-id').value.trim() || a.batch.bundleId || a.batch.requestId;
  const result = await walletRead(provider, 'wallet_getCallsStatus', [id]);
  await assertWallet(provider, version);
  if (!result || result.version !== '2.0.0' || result.id !== id || typeof result.chainId !== 'string' ||
      !/^0x[0-9a-f]+$/i.test(result.chainId) || BigInt(result.chainId) !== 196n || !Number.isSafeInteger(result.status))
    throw new Error('钱包批量状态格式不匹配，记录保持待核验');
  await api('bundle', { attemptId: a.id, bundleId: id });
  if (result.status === 400 && (!result.receipts || result.receipts.length === 0)) {
    await api('batch-failure', { attemptId: a.id, reason: 'WALLET_STATUS_400' });
    throw new Error('钱包报告链外失败，请核对钱包后勾选取消旧请求；没有自动重新发送');
  }
  if (result.status >= 100 && result.status < 200) throw new Error('批量仍在钱包处理中，请稍后再次核验');
  if (![200, 500].includes(result.status) || result.atomic !== true ||
      !Array.isArray(result.receipts) || result.receipts.length !== 1 ||
      !/^0x[0-9a-f]{64}$/i.test(result.receipts[0].transactionHash))
    throw new Error('当前批量结果含中继、多回执、部分失败或未知格式，需检查钱包；不会自动补发');
  const hash = result.receipts[0].transactionHash;
  $('tx-hash').value = hash;
  await api('hash', { attemptId: a.id, hash });
}
$('recover-batch').addEventListener('click', () => run(reconcileWithFeedback));
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
    if (context.attempts.find(a => a.id === context.unresolved)?.batch) await recoverBatchHash();
    const result = await api('reconcile', {});
    context = result; render();
    const attempt = result.attempts.at(-1);
    verificationRetries = 0;
    if (attempt?.status === 'confirmed' && !result.unresolved && connectedProvider &&
        result.authorization?.expiresAt > Date.now()) scheduleAutomatic('prepare');
    const message = attempt?.status === 'confirmed'
      ? `核验成功：${attempt.batch ? `本批 ${attempt.batch.operations.length} 步` : '交易'}与文件字节均通过检查。${automaticAction === 'prepare' ? '3 秒后自动准备下一笔，仍需你点击并在钱包确认。' : '可以准备下一笔。'}`
      : '交易已确认回滚，本笔上传未完成。请重新准备本笔并检查钱包结果。';
    $('verification-result').textContent = message;
    $('verification-result').hidden = false;
    status(message);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '检查未完成';
    const pending = context?.attempts.find(a => a.id === context.unresolved);
    if (pending?.hash && connectedProvider && verificationRetries < 4 &&
        /transaction not confirmed|transaction block is not yet stable/i.test(detail)) {
      verificationRetries++;
      scheduleAutomatic('reconcile');
      const message = `交易等待链上确认，3 秒后自动再次核验（${verificationRetries}/4）；无需重新发送。`;
      $('verification-result').textContent = message;
      $('verification-result').hidden = false;
      status(message);
      return;
    }
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
function activationControls() {
  const a = context?.activation, pending = a?.attempts.find(item => item.id === a.unresolved);
  $('activation-section').hidden = !a;
  $('activation-check').disabled = busy || !a;
  $('activation-prepare').disabled = busy || !a || !!a.unresolved || !!context?.unresolved;
  $('activation-consent').disabled = busy || !activationPreview;
  $('activation-send').disabled = busy || !a || !account || !activationPreview ||
    activationPreview.expiresAt <= Date.now() || !$('activation-consent').checked ||
    !!a?.unresolved || !!context?.unresolved;
  $('activation-attach').disabled = busy || !pending;
  $('activation-reconcile').disabled = busy || !pending;
  $('activation-cancel').disabled = busy || !pending || !!pending.hash || !$('activation-cancel-consent').checked;
  $('activation-export').disabled = busy || !a;
  if (activationSince !== null) {
    const elapsed = Math.floor((Date.now() - activationSince) / 1000), remaining = Math.max(0, 90 - elapsed);
    $('activation-progress').textContent = `${activationAction}：已等待 ${elapsed} 秒，本次请求超时倒计时 ${remaining} 秒。`;
    $('activation-progress').hidden = false;
  }
}
function renderActivation() {
  const a = context.activation;
  if (!a) return;
  const observed = a.observed;
  $('activation-state').textContent = observed
    ? `${a.name} · ${observed.nameLive && observed.containerLive ? '链上已激活' : '链上尚未激活或已到期'} · 名称到期：${expiry(observed.paidUntil)} · 查询区块 ${BigInt(observed.block.number)}`
    : `${a.name} · 请查询链上状态或准备激活报价`;
  const pending = a.attempts.find(item => item.id === a.unresolved);
  $('activation-pending').hidden = !pending;
  if (pending) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(`tapeexit-activation:${a.contextId}`) || 'null'); } catch { /* Durable journal is authoritative. */ }
    $('activation-hash').value = pending.hash || (saved?.id === pending.id ? saved.hash : '') || '';
  }
  $('activation-record').replaceChildren();
  const names = { reserved: '请求待核验，请勿重复发送', confirmed: '激活交易与到期时间已核验',
    reverted: '激活交易回滚，可重新准备', 'cancelled-by-user': '用户确认已取消' };
  for (const item of a.attempts) {
    field('activation-record', names[item.status], item.hash || '钱包尚未返回哈希');
    if (item.state) field('activation-record', '核验时名称到期', expiry(item.state.paidUntil));
    if (item.gasUsed) field('activation-record', '实际 EVM Gas 费用',
      coin(BigInt(item.gasUsed) * BigInt(item.effectiveGasPriceWei)));
  }
}
function expiry(seconds) {
  return BigInt(seconds) === 0n ? '未激活' : new Date(Number(seconds) * 1000).toLocaleString();
}
async function activationCheck(action, fn) {
  activationSince = Date.now(); activationAction = action;
  $('activation-result').hidden = true; activationControls();
  try { return await fn(); }
  catch (error) {
    $('activation-result').textContent = `${action}未完成：${error instanceof Error ? error.message : '检查失败'}。已有请求记录会保留；可再次核验，请勿重复发送。`;
    $('activation-result').hidden = false;
    throw error;
  } finally { activationSince = null; $('activation-progress').hidden = true; activationControls(); }
}
$('activation-consent').addEventListener('change', controls);
$('activation-cancel-consent').addEventListener('change', controls);
$('activation-check').addEventListener('click', () => run(() => activationCheck('查询激活状态', async () => {
  context.activation = await api('activation/refresh', {}); renderActivation();
})));
$('activation-prepare').addEventListener('click', () => run(() => activationCheck('准备激活报价', async () => {
  activationPreview = null; $('activation-consent').checked = false;
  $('activation-preview').replaceChildren(); field('activation-preview', '状态', '正在核对完整上传、容器身份、激活服务费和双 RPC 模拟');
  const q = await api('activation/preview', {});
  $('activation-preview').replaceChildren();
  if (q.live) {
    field('activation-preview', '已激活', `名称及容器激活有效，名称到期 ${expiry(q.state.paidUntil)}`);
    status('已激活，无需再次付款'); return;
  }
  activationPreview = q;
  for (const [name, value] of [
    ['名称', context.activation.name], ['激活时长', '30 天'], ['目标合约', context.activation.binding],
    ['服务费', coin(q.serviceFeeWei)], ['EVM Gas 费用上限', coin(q.maximumGasCostWei)],
    ['合计上限（不含链特有附加费用）', coin(q.maximumTotalWei)],
    ['Gas 上限 / 单价 wei', `${BigInt(q.transaction.gas)} / ${BigInt(q.transaction.gasPrice)}`],
    ['报价到期', new Date(q.expiresAt).toLocaleString()],
  ]) field('activation-preview', name, value);
  $('activation-consent-label').textContent = `我确认 ${context.activation.name} 激活 30 天，服务费 ${coin(q.serviceFeeWei)}，EVM Gas 最多 ${coin(q.maximumGasCostWei)}，合计最多 ${coin(q.maximumTotalWei)}；不含链特有附加费用。代码摘要来自观察，尚未经过独立安全审阅。`;
  status('激活模拟通过，核对费用后勾选并在钱包确认');
})));
async function reconcileActivation() {
  return activationCheck('核验激活结果', async () => {
    const result = await api('activation/reconcile', {});
    context.activation = result; renderActivation();
    const a = result.attempts.at(-1);
    const message = a.status === 'confirmed'
      ? `激活核验成功：名称及容器均有效，名称到期 ${expiry(a.state.paidUntil)}。`
      : '激活交易已回滚，没有完成激活。请核对钱包后重新准备。';
    $('activation-result').textContent = message; $('activation-result').hidden = false; status(message);
  });
}
$('activation-send').addEventListener('click', () => run(async () => {
  try {
  if (!navigator.locks) throw new Error('请使用支持页面互斥锁的 Chrome');
  await navigator.locks.request('tapeexit-publication-wallet', { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一页面正在请求钱包');
    const q = activationPreview, provider = connectedProvider, version = generation;
    activationPreview = null;
    if (!q || !provider || !$('activation-consent').checked || q.expiresAt <= Date.now())
      throw new Error('请重新准备激活报价并确认本次费用');
    await assertWallet(provider, version);
    const a = await activationCheck('重新核对并保存激活请求', () =>
      api('activation/reserve', { previewId: q.id, consent: context.activation.consent, maximumTotalWei: q.maximumTotalWei }));
    if (a.status !== 'reserved' || JSON.stringify(a.quote.transaction) !== JSON.stringify(q.transaction) ||
        a.quote.maximumTotalWei !== q.maximumTotalWei || a.quote.transaction.from !== context.publisher ||
        a.quote.transaction.to !== context.activation.binding || a.quote.transaction.chainId !== '0xc4' ||
        BigInt(a.quote.transaction.gas) > BigInt(context.activation.gasCap) ||
        BigInt(a.quote.transaction.gasPrice) > BigInt(context.activation.gasPriceCapWei))
      throw new Error('激活预约与预览不一致，未请求钱包');
    await refreshContext(); await assertWallet(provider, version);
    if (q.expiresAt <= Date.now()) throw new Error('报价已到期，预约已保留，未请求钱包；核对钱包后可取消预约');
    status('请在钱包核对激活 30 天、服务费及网络费用');
    $('activation-result').textContent = '等待钱包确认激活 30 天；预约已保存，结果不明时请先检查钱包交易记录。';
    $('activation-result').hidden = false;
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [a.quote.transaction] });
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash))
      throw new Error('钱包未返回有效激活哈希，预约已保留，请检查钱包记录');
    $('activation-hash').value = hash;
    try { localStorage.setItem(`tapeexit-activation:${context.activation.contextId}`, JSON.stringify({ id: a.id, hash })); } catch { /* Reservation survives. */ }
    await api('activation/hash', { attemptId: a.id, hash });
    await refreshContext();
    // Retry read-only verification briefly while waiting for the stable two-source snapshot.
    for (let i = 0; i < 4; i++) {
      try { await reconcileActivation(); break; }
      catch (error) {
        if (i === 3 || !/not confirmed|not yet stable/i.test(error.message)) throw error;
        status('激活交易等待稳定区块，将自动再次核验；无需重新发送');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  });
  } catch (error) {
    $('activation-result').textContent = `${error instanceof Error ? error.message : '激活请求未完成'}。如已出现钱包请求，请先核对钱包记录并恢复哈希，勿重复发送。`;
    $('activation-result').hidden = false;
    throw error;
  } finally { $('activation-consent').checked = false; }
}));
$('activation-attach').addEventListener('click', () => run(async () => {
  const hash = $('activation-hash').value.trim();
  await api('activation/hash', { attemptId: context.activation.unresolved, hash });
  status('激活哈希已保存，可核验激活结果');
}));
$('activation-reconcile').addEventListener('click', () => run(reconcileActivation));
$('activation-cancel').addEventListener('click', () => run(async () => {
  if (!$('activation-cancel-consent').checked) throw new Error('请先在钱包取消此激活请求并确认');
  await api('activation/cancel', { attemptId: context.activation.unresolved,
    acknowledgement: 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE' });
  $('activation-cancel-consent').checked = false;
  status('已记录激活请求取消；重新准备会再次核对 nonce 和费用');
}));
$('activation-export').addEventListener('click', () => run(async () => {
  await refreshContext();
  const url = URL.createObjectURL(new Blob([JSON.stringify({ uploadContextId: context.contextId,
    manifestSha256: context.manifestSha256, ...context.activation }, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'tapeexit-activation-record.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
setInterval(controls, 1000);
try {
  await refreshContext();
  status(context.unresolved ? '存在未核验的钱包请求，先处理旧请求' : '发行信息已加载，尚未请求签名');
} catch { status('发行信息无法读取，停止操作'); }
