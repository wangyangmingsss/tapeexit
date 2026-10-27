# TapeExit

为用户自持的 X Layer Uniswap V3 仓位保留独立退出路径。

当原站和专属后台不可用时，应用直接从公共 RPC 读取仓位，由用户钱包直接调用原 NonfungiblePositionManager，减少流动性并领取资产。代码不申请新授权，不托管资产，不转移仓位 NFT，不执行兑换。

**当前版本是开发预览，主网签名关闭。** 可运行隔离演示、主网只读查询、官方 V3 本地合约与 X Layer 分叉测试和本地恢复入口。真实 TapeOut 容器发布、目标钱包实测、支持资产审阅和独立安全审阅尚未完成。

## 本地运行

要求 Node.js 22.12 或更新版本。仓库使用精确版本与 lockfile。

```sh
npm ci
npm run dev:demo
```

打开 `http://127.0.0.1:4174`。演示中的资产、来源与交易结果均为模拟。它不连接钱包、不发送交易，不能用来证明链上部署或真实故障下的可用性。

主网只读界面：

```sh
npm run dev
```

输入自己直接持有的仓位 Token ID。已存入农场或托管合约的 NFT 不在范围内。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm run check:release
npm run build:demo
npx playwright install chromium
npm run test:e2e
npm run verify:deployment
npm run verify:fork
npm run report:dependencies
```

`npm test` 包含 SDK/整数边界、双来源冲突、钱包失效、收据转账证据、恢复包完整性、服务器边界、DOM 交互，以及 Anvil 上官方 V3 工厂和管理器字节码的实际执行。测试夹具的两个来源标签连接同一个本地 EVM，不是两个独立运营方。

DOM 测试不验证视觉布局。Playwright 必须能启动真实浏览器；受限 macOS 沙箱可能在 Mach IPC 初始化阶段阻止启动。本次环境尚未完成截图和浏览器断言，不能将 CI 配置等同于已经通过 CI。

`verify:deployment` 仅执行读取，核对链 ID、固定区块、管理器/工厂代码摘要与 getter。摘要匹配不是安全审计，也没有证明所有运行行为。

`verify:fork` 从两个主网来源固定区块，在 loopback Anvil 中分叉实际部署、选择直接持有的非小额仓位，并仅在本地模拟持有人执行退出；检查真实合约收据、余额增量和剩余流动性。主网接口仅用于读取。可用 `npm run verify:fork -- --block=74312664` 指定已记录区块；公共节点是否继续提供历史状态会影响复现。测试选中的资产不因此进入生产允许名单。

依赖检查仍有已知告警。查看 [威胁模型](docs/THREAT-MODEL.md) 和生成的 `release-artifacts/dependencies.json`；不能把 tree-shaking 或未调用签名代码当成漏洞已经修复。

## 恢复包

`npm run build` 生成静态应用 `dist/` 和无运行时 npm 依赖的 `recovery/`。

提前通过可信渠道保存 `dist/release-manifest.json` 的 SHA-256，然后进入恢复目录：

```sh
node tools/verify-bundle.mjs <此前独立保存的清单摘要>
node tools/local-server.mjs
```

打开 `http://localhost:4173`。验证器拒绝缺失、篡改和未声明文件。服务器仅绑定 loopback，核对 Host，拒绝写请求、路径穿越和符号链接逃逸。恢复包仍需要 Node、浏览器钱包、RPC 和可用的链。

恢复卡只导入公开身份和仓位线索。它不能覆盖管理器、接收地址或交易 calldata。历史记录仅保存公开结果，不保存可再次发送的计划。

## TapeOut 网关与发布

```sh
npm run vendor:tapekit
npm run build:gateway
npm run gateway
```

源码固定到 TapeKit `37c617e7e332787c8a32a81e4d7d05a28a06c156`，下载包另有 SHA-256 校验。已有 vendor 文件变化会中止校验，不自动覆盖。

网关本地三段主机名为 `http://<ID>-2-<processor>.localhost:8096`。`dist-gateway/` 保留上游 Service Worker、内核和保留路径，为应用响应收紧 CSP，只允许同源代码与两个指定 RPC。网关构建成功不等于 TapeExit 已上链。

已有容器地址后可生成待审阅发布数据：

```sh
npm run plan:publish -- <容器地址>
```

该命令核对发行文件，按 24,000 字节分块编码 `putFile` / `appendChunk`，读取当前激活费用和容器状态，输出 `release-artifacts/publish-plan.json`。它不签名、不上传、不付费；生成的数据不能跳过所有权、实现版本、预算及逐文件回读验收。详见 [发布手册](docs/PUBLISHING.md)。

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/core/rpc.ts` | 两运营方读取、固定区块、分歧阻断 |
| `src/core/protocol.ts` | 部署身份、仓位快照、SDK 数学、calldata 解码核对 |
| `src/core/wallet.ts` | EIP-6963、账户/链监听、过期检查、用户钱包发送 |
| `src/core/receipt.ts` | 交易输入、池 Collect、ERC20 Transfer 与最终性 |
| `src/core/storage.ts` | 有限本地历史与严格恢复卡导入 |
| `src/App.tsx` | 中英文仓位工作区、复核与结果界面 |
| `src/demo/` | 独立演示引擎，生产构建剔除 |
| `tools/` | 构建、恢复、网关、依赖和未签名发布工具 |
| `tests/` | 单元、DOM、合约集成和 Playwright 测试 |

当前范围和未完成验收见 [实施状态](docs/IMPLEMENTATION-STATUS.md)。本项目没有取得获奖承诺，也未以模拟数据代替真实用户验证。
