const byId = id => document.getElementById(id);
const wallets = new Map();
const events = [];
const observations = {};
let context, selected, generation = 0;
const removers = [];
const addressPattern = /^0x[a-f0-9]{40}$/i;
const status = text => { byId('status').textContent = text; };
function record(kind, data = null) {
  const entry = { at: new Date().toISOString(), kind, data };
  events.push(entry);
  if (events.length > 200) events.shift();
  const li = document.createElement('li');
  li.textContent = `${entry.at} · ${kind}${data === null ? '' : ` · ${JSON.stringify(data)}`}`;
  byId('events').append(li);
  while (byId('events').children.length > 200) byId('events').firstElementChild.remove();
}
function accountState(accounts) {
  if (!Array.isArray(accounts) || accounts.some(a => typeof a !== 'string' || !addressPattern.test(a)))
    throw new Error('钱包返回了无效账户');
  byId('account').textContent = accounts.join(', ') || '未授权账户';
  return accounts;
}
function chainState(chain) {
  if (typeof chain !== 'string' || !/^0x(?:0|[1-9a-f][a-f0-9]{0,15})$/i.test(chain))
    throw new Error('钱包返回了无效 Chain ID');
  byId('chain').textContent = `${chain} · ${BigInt(chain)}`;
  return chain;
}
function errorRecord(error) {
  const code = Number.isSafeInteger(error?.code) ? error.code : null;
  record('provider-error', { code });
  if (code === 4001) observations.userRejected = true;
  // Provider messages are not exported: they may contain private request data.
  status(code === 4001 ? '用户拒绝了请求，未发送交易' : `钱包请求失败${code === null ? '' : `（${code}）`}`);
}
function selectWallet() {
  generation++;
  while (removers.length) removers.pop()();
  selected = wallets.get(byId('wallet').value);
  for (const key of Object.keys(observations)) delete observations[key];
  byId('account').textContent = '—';
  byId('chain').textContent = '—';
  for (const id of ['connect', 'refresh', 'switch']) byId(id).disabled = !selected;
  byId('export').disabled = !context || !selected || !byId('consent').checked;
  if (!selected) return;
  record('wallet-selected', { uuid: selected.info.uuid, name: selected.info.name, rdns: selected.info.rdns });
  const provider = selected.provider;
  if (typeof provider.on === 'function' && typeof provider.removeListener === 'function') {
    for (const [name, handler] of Object.entries({
      accountsChanged: accounts => { accountState(accounts); observations.accountsChanged = true; return accounts; },
      chainChanged: chain => { chainState(chain); observations.chainChanged = true; return chain; },
      disconnect: () => { observations.disconnected = true; byId('account').textContent = '已断开'; return null; },
    })) {
      const listener = value => { try { record(name, handler(value)); } catch (error) { errorRecord(error); } };
      provider.on(name, listener);
      removers.push(() => provider.removeListener(name, listener));
    }
  }
  status('已选择钱包；点击连接后会请求公开账户');
}
async function query(method) {
  const current = selected, version = generation;
  if (!current) return;
  try {
    const accounts = await current.provider.request({ method });
    const chain = await current.provider.request({ method: 'eth_chainId' });
    if (version !== generation) return;
    const result = { accounts: accountState(accounts), chain: chainState(chain) };
    observations.connection = result.accounts.length ? 'observed' : 'no-authorized-account';
    record(method, result);
    status(BigInt(chain) === 196n ? '已读取 X Layer 钱包状态；未请求签名' : '当前钱包不在 X Layer');
  } catch (error) { if (version === generation) errorRecord(error); }
}
byId('wallet').addEventListener('change', selectWallet);
byId('connect').addEventListener('click', () => query('eth_requestAccounts'));
byId('refresh').addEventListener('click', () => query('eth_accounts'));
byId('switch').addEventListener('click', async () => {
  const current = selected, version = generation;
  if (!current) return;
  try {
    await current.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xc4' }] });
    if (version === generation) { observations.switchRequest = 'completed'; await query('eth_accounts'); }
  } catch (error) { if (version === generation) errorRecord(error); }
});
byId('consent').addEventListener('change', () => {
  byId('export').disabled = !byId('consent').checked || !context || !selected;
});
byId('export').addEventListener('click', () => {
  if (!context || !selected || !byId('consent').checked) return;
  const report = { ...context, kind: 'wallet-provider-connectivity', status: 'OBSERVATIONS_ONLY',
    observedAt: new Date().toISOString(), origin: location.origin,
    wallet: selected.info, observations: { ...observations }, events,
    consentToExport: true, transactionAcceptance: 'NOT_TESTED', tapeOutOriginAcceptance: 'NOT_TESTED' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'tapeexit-wallet-connectivity.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('eip6963:announceProvider', event => {
  const { info, provider } = event.detail || {};
  if (!info || typeof info.uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(info.uuid) ||
      typeof info.name !== 'string' || typeof info.rdns !== 'string' || typeof provider?.request !== 'function' ||
      wallets.has(info.uuid) || wallets.size >= 20) return;
  // Treat wallet metadata as text; never load an advertised icon or HTML.
  const safeInfo = { uuid: info.uuid, name: info.name.slice(0, 128), rdns: info.rdns.slice(0, 128) };
  wallets.set(info.uuid, { info: safeInfo, provider });
  const option = document.createElement('option');
  option.value = info.uuid; option.textContent = `${safeInfo.name} · ${safeInfo.rdns}`;
  byId('wallet').append(option);
  if (!selected) { byId('wallet').value = info.uuid; selectWallet(); }
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
try {
  const response = await fetch('context.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('发行信息读取失败');
  context = await response.json();
  if (!/^[a-f0-9]{40}$/.test(context.sourceCommit) || !/^[a-f0-9]{64}$/.test(context.manifestSha256))
    throw new Error('发行身份无效');
  byId('commit').textContent = context.sourceCommit;
  byId('digest').textContent = context.manifestSha256;
  byId('export').disabled = !selected || !byId('consent').checked;
} catch {
  context = null; status('无法确认发行身份，禁止导出验收记录');
}
