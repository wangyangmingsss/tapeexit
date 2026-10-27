import { mkdir, readFile, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { CHAIN_ID, MANAGER } from '../src/config';
import { importRecoveryCard } from '../src/core/storage';
import { loadPublication } from './publish-core';

const publication = await loadPublication('dist');
const manifest = JSON.parse(await readFile('dist/release-manifest.json', 'utf8'));
const input = process.argv[2];
const tokenIds = input ? importRecoveryCard(await readFile(input, 'utf8')).tokenIds : [];
if (tokenIds.length > 1) throw new Error('Print one position per card');
const card = { schemaVersion: 1, app: 'TapeExit', chainId: CHAIN_ID, manager: MANAGER,
  releaseId: `${manifest.version}-${manifest.sourceCommit.slice(0, 7)}`,
  manifestSha256: publication.manifestSha256, tokenIds };
const payload = JSON.stringify(card);
const qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', width: 800, margin: 4 });
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dir = 'release-artifacts/recovery-card';
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/card.json`, JSON.stringify(card, null, 2) + '\n');
await writeFile(`${dir}/card.html`, `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>TapeExit Recovery Card</title><style>
*{box-sizing:border-box}body{margin:0;font:14px/1.6 system-ui,sans-serif;color:#202820;background:white;letter-spacing:0}
main{max-width:700px;margin:32px auto;padding:24px}h1{font-size:30px;margin:0}h2{font-size:18px;margin:24px 0 8px}
p{margin:8px 0}.status{color:#8c3b23}dl{margin:20px 0}dt{font-weight:650;margin-top:12px}
dd{margin:2px 0;overflow-wrap:anywhere;font:12px/1.6 monospace}img{display:block;width:100%;max-width:360px;height:auto;margin:auto}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:10px/1.5 monospace;border-top:1px solid #ccc;padding-top:16px}
@page{size:A4;margin:15mm}@media print{main{margin:0;padding:0}img{max-width:80mm}}@media(max-width:450px){main{padding:16px;margin:0}}
</style><main><h1>TapeExit</h1><p>公开信息恢复卡 / Public Recovery Card</p>
<p class="status">开发候选版 · 主网发送未批准 / Development candidate · mainnet sending not approved</p>
<dl><dt>网络 / Network</dt><dd>X Layer · ${CHAIN_ID}</dd><dt>仓位 / Position</dt>
<dd>${tokenIds.length ? `#${escape(tokenIds[0])}` : '未填写 / Not specified'}</dd>
<dt>管理器 / Manager</dt><dd>${MANAGER}</dd><dt>源提交 / Source</dt><dd>${escape(manifest.sourceCommit)}</dd>
<dt>发行清单 SHA-256 / Manifest</dt><dd>${publication.manifestSha256}</dd></dl>
<img alt="包含公开恢复 JSON 的二维码 / Public recovery JSON QR" src="${qr}">
<p>二维码仅包含下方 JSON。它不提供网页托管，不包含私钥、签名或交易调用。先独立核对发行摘要；恢复仍需可用的链、RPC 和钱包。</p>
<p>QR contains only the JSON below. It does not host the app or authorize a transaction. Verify the release digest independently.</p>
<h2>恢复数据 / Recovery data</h2><pre>${escape(payload)}</pre></main></html>`);
console.log('Printable public recovery card created; no container or live transaction asserted.');
