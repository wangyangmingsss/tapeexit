import { ExternalLink, FileCheck2 } from 'lucide-react';
import { RELEASE } from './config';
import type { RuntimeStatus } from './core/runtime';
import { PRODUCT } from './product';

export default function DistributionStatus({ lang, runtime, simulated }: { lang: 'zh' | 'en'; runtime: RuntimeStatus; simulated: boolean }) {
  const zh = lang === 'zh';
  const published = PRODUCT.publication;
  return <section className="distribution-status" aria-label={zh ? 'TapeOut 与恢复路径' : 'TapeOut and recovery routes'}>
    <div className="section-top"><h2><FileCheck2 size={17} />TapeOut {zh ? '与恢复路径' : 'and recovery routes'}</h2>
      <span className="neutral-tag">{simulated ? 'DEMO' : 'READ ONLY'}</span></div>
    <dl>
      <div><dt>{zh ? '当前应用' : 'Current application'}</dt><dd><code>{RELEASE}</code></dd></div>
      <div><dt>{zh ? '当前入口' : 'Current entry'}</dt><dd>{simulated ? (zh ? '独立模拟演示' : 'Isolated simulation') :
        runtime.verified ? `${runtime.mode} · ${runtime.label}` : `${runtime.mode} · ${zh ? '未验证为 TapeOut 入口' : 'not verified as a TapeOut entry'}`}</dd></div>
      <div><dt>{zh ? '已记录链上版' : 'Recorded chain release'}</dt><dd><code>{published.release}</code> · {published.name}</dd></div>
      <div><dt>{zh ? '容器' : 'Container'}</dt><dd><code>{published.container}</code></dd></div>
      <div><dt>{zh ? '链上版清单摘要' : 'Chain manifest digest'}</dt><dd><code>{published.manifestSha256}</code></dd></div>
    </dl>
    <div className="distribution-routes">{published.gateways.map((url, index) =>
      <a className="secondary-button" href={url} target="_blank" rel="noreferrer" key={url}>
        {index === 0 ? (zh ? '主网关' : 'Primary gateway') : (zh ? '备用网关' : 'Backup gateway')}<ExternalLink size={14} /></a>)}
      <a className="secondary-button" href={PRODUCT.releases} target="_blank" rel="noreferrer">
        {zh ? '版本与恢复包' : 'Releases and recovery bundles'}<ExternalLink size={14} /></a></div>
    <p>{zh ? '网关读取同一 TapeOut 容器；本地恢复包仍需 RPC 与可用的链。当前应用更新不会自动替换已记录的链上版本。' :
      'Gateways read the same TapeOut container. Local recovery still needs RPC and a working chain. Application updates do not automatically replace the recorded chain release.'}</p>
  </section>;
}
