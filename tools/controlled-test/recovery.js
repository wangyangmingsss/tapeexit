const $ = id => document.getElementById(id);
let context, busy = false, started = 0, nextCheck = 0;
const units = value => {
  const n = BigInt(value);
  return `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, '0')}`;
};
async function api(body) {
  const response = await fetch(body === undefined ? '/api/context' : '/api/reconcile', {
    ...(body === undefined ? {} : { method: 'POST', headers: {
      'content-type': 'application/json', 'x-tapeexit-client': 'controlled-test',
    }, body: '{}' }),
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(90000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '链上检查未完成');
  return result;
}
function field(label, value) {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = label; dd.textContent = String(value); $('record').append(dt, dd);
}
function render() {
  $('record').replaceChildren();
  field('钱包', context.policy.account);
  field('源码版本', context.sourceCommit);
  for (const a of context.attempts) {
    field('已保存交易', a.hash || '尚无哈希');
    field('记录状态', a.status === 'confirmed' ? '历史成功记录' : a.status === 'reserved' ? '等待核验' : a.status);
    if (context.freshlyVerified && a.status === 'confirmed' && a.outcome) {
      for (const b of a.outcome.balances) field(`${b.symbol} 到账`, units(b.delta));
      field('剩余流动性', a.outcome.liquidity.after);
    }
  }
  if (context.finality) {
    field('交易所在区块', context.finality.receiptBlock);
    field('网络已最终确认至', context.finality.finalizedBlock);
    field('最终确认尚差区块数', context.finality.remainingBlocks);
    field('检查时间', new Date(context.finality.observedAt).toLocaleString());
  }
  $('check').disabled = busy;
  $('export').disabled = busy;
}
async function check() {
  if (busy) return;
  busy = true; started = Date.now(); $('check').disabled = true; $('export').disabled = true;
  $('status').textContent = '正在核验已保存交易';
  let error;
  try { await api({}); } catch (e) { error = e; }
  try {
    context = await api();
    if (!context.readOnly) throw new Error('恢复服务模式不匹配');
    render();
    if (error) {
      $('status').textContent = error.message.startsWith('Receipt not finalized') && context.finality
        ? '交易已上链，等待网络最终确认；无需再次交易。'
        : `本次核验未完成：${error.message}`;
    } else {
      $('status').textContent = context.complete && context.freshlyVerified
        ? '恢复核验完成：到账、剩余仓位及最终确认均匹配。'
        : '交易未完成退出，请保留记录。';
    }
  } catch (e) {
    context = null; $('status').textContent = `无法读取恢复记录：${e.message}`;
    $('export').disabled = true;
  } finally {
    busy = false; started = 0; $('check').disabled = !context;
    $('export').disabled = !context;
    nextCheck = Date.now() + 30000; tick();
  }
}
function tick() {
  if (busy) {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    $('progress').textContent = `本次检查已等待 ${elapsed} 秒，请求超时倒计时 ${Math.max(0, 90 - elapsed)} 秒。`;
  } else if ($('auto').checked && context && !context.freshlyVerified) {
    const seconds = Math.max(0, Math.ceil((nextCheck - Date.now()) / 1000));
    $('progress').textContent = `${seconds} 秒后重新检查；此倒计时是下次检查时间。`;
    if (!seconds) void check();
  } else $('progress').textContent = '';
}
$('check').addEventListener('click', check);
$('auto').addEventListener('change', () => { nextCheck = Date.now() + 30000; tick(); });
$('export').addEventListener('click', () => {
  if (!context || busy) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...context,
    exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'tapeexit-readonly-recovery-67042.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
setInterval(tick, 1000);
await check();
