# 版本与交付

每个新版使用 `版本号-提交前七位` 作为应用标识，例如 `0.3.0-abcdef0`。
`release-info.json` 记录完整提交、构建渠道和源码是否干净。恢复包与主网只读应用使用相同的发行清单。

## 各入口的含义

| 渠道 | 内容 | 何时更新 |
| --- | --- | --- |
| GitHub 源码 | 对应提交的实现与文档 | 提交推送后 |
| GitHub Pages Demo | 相同源码的隔离模拟版本，使用测试资产 | 该提交 Validate 成功后自动部署 |
| 本地恢复包 | 主网只读应用、清单与本地启动工具 | 从同一干净提交构建并打包 |
| 两个公网网关 | 加载 TapeOut 容器中的文件 | 需要链上上传、逐字节回读；单独部署启动文件不会更新应用 |

Demo 的 `release-info.json` 渠道为 `simulation`；主网应用为 `readonly`。
这些版本都保持生产签名关闭。发布清单或文件摘要不代表独立安全审阅通过。

## 生成同源交付包

在干净的指定提交中运行：

```sh
npm ci
npm run vendor:tapekit
npm run build:gateway
npm run build
npm run check:release
npm run build:demo -- --base=/tapeexit/
npm run package:delivery
```

`release-artifacts/delivery/` 包含应用、Demo、恢复包、Netlify 和 Vercel 网关压缩包，以及：

- `release-status.json`：候选提交、清单摘要、各渠道状态和已记录的链上版本。
- `SHA256SUMS`：五个压缩包的 SHA-256。
- `docs/`：对应源码版本的首页、参赛说明、演示脚本与本说明。

打包会拒绝脏源码、不同提交的产物或与应用不同的恢复清单。CI 同样执行这一步，并保留在 verification 工件中。
压缩包的渠道状态表示构建时状态；部署是否完成应另外以 GitHub Pages 部署记录或真实网关验收记录为准。

## 当前已记录的 TapeOut 版本

链上应用：`0.3.0-f8771a8`，完整源码提交 `f8771a82c8de048a0ae1d6d41c43d555361dc705`。

名称：`2.2.289.tape`。容器：`0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D`。

发行清单 SHA-256：
`4ed49b70d6352065ca402b101b5d8c3dfe420072d6aefd52bcfce1e07f800672`。

2026-10-31 已核对新版 34 笔更新交易全部确认、剩余 0 笔，16 个文件共 647523 字节逐字节回读通过，容器已激活。
同日 08:22 UTC 的公网运行中，四个桌面与移动视图完成 64 次文件检查，
导入金库恢复文件、刷新重查及主入口阻断后的备用恢复均通过。
详细记录见[发行证据](evidence/published-f8771a8/README.md)和[公网验收](public-gateway-acceptance.md)。
指定钱包的 1 USDC 受限实测已全部完成；独立审阅与审阅后生产签名验收不在此结果范围内。
生产签名保持关闭，这些时间点观察不保证未来在线。

发行压缩包内的 `PREPARED_NOT_DEPLOYED` 表示打包时的状态；后续发布状态以本次验收记录与交付目录的 `deployment-receipt.json` 为准。
旧版 `0.3.0-2597f66` 与 `0.2.0-0d9ff56` 的证据继续保留，不作为新版验收结果。

### 对应恢复包

[固定版本 Release：v0.3.0-f8771a8](https://github.com/wangyangmingsss/tapeexit/releases/tag/v0.3.0-f8771a8)
提供原始 `TapeExit-0.3.0-f8771a8-recovery.zip`，与上述链上应用使用相同的发行清单。
原压缩包未重新构建或改写，SHA-256 为
`69dcdfefdf591c956dafde061dcef167c91c3b09657c64975fc0c3f1891c1c2b`。
本次核对压缩包摘要、解压后逐文件校验，并对比固定清单和源码中的启动、校验工具。

旧 `v0.3.0-readonly` Release 的附件仍对应 `2597f66`，作为历史记录保留。
首页下载指向上述固定版本；[中英文快速开始](RECOVERY-QUICKSTART.md)说明校验、启动与只读恢复方式。
文档与下载入口更新不要求钱包交互，也不会改变 TapeOut 中的应用文件。

## 新版链上更新

使用已独立保存的旧清单与文件生成迁移方案：

```sh
npm run prepare:gateway-update -- <旧版文件目录> <可信旧清单SHA256>
```

保留既有交易日志。估算上传费用并获得钱包确认后，上传差异、核对逐字节回读，再检查两个公网入口。
只有实际验收对应提交与清单后，才更新已记录的链上版本。详见 [网关更新流程](GATEWAY-UPDATE.md)。
