# TapeExit

为用户自持的 X Layer Uniswap V3 仓位保留独立退出路径。

当原站和专属后台不可用时，应用直接从公共 RPC 读取仓位，由用户钱包直接调用原 NonfungiblePositionManager，减少流动性并领取资产。代码不申请新授权，不托管资产，不转移仓位 NFT，不执行兑换。

**当前候选版本是开发预览，主网退出签名关闭。** 可运行隔离演示、主网只读查询、官方 V3 本地合约与 X Layer 分叉测试和本地恢复入口。先前只读发行版本已上传、激活并完成文件回读及双网关只读故障验证；目标钱包真实退出、支持资产批准及独立安全审阅仍待完成。

已发布入口为 `tape://2.2.289.tape/`，公网网关为 `https://2-2-289.netlify.app` 和 `https://2-2-289.vercel.app`。保存的历史证据对应源码 `733ca795d9216ea43038e386ee652c1a84f112b5`，见 `evidence/historical/`。本次候选源码没有自动覆盖线上版本；历史观测不证明当前可用性、新版部署或真实钱包退出。

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
npm run vendor:tapekit
npm run test:tapekit
npx playwright install chromium firefox webkit
npm run test:e2e
npm run verify:deployment
npm run verify:fork
npm run report:dependencies
```

`npm test` 包含 SDK/整数边界、双来源冲突、钱包失效、收据转账证据、恢复包完整性、服务器边界、DOM 交互，以及 Anvil 上官方 V3 工厂和管理器字节码的实际执行。测试夹具的两个来源标签连接同一个本地 EVM，不是两个独立运营方。

DOM 测试不验证视觉布局。Playwright 必须能启动真实浏览器；受限 macOS 沙箱可能在 Mach IPC 初始化阶段阻止启动。三浏览器结果、截图与测试数量以当前提交的 GitHub Actions 报告为准。

`test:tapekit` 在校验过的固定上游源码上运行发布路径兼容测试，检查实际编码生成的入口、资源、清单与 fallback 能被客户端解析。它不启动浏览器，也不证明链上部署成功。

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

提交取得交易哈希后立即保存记录。刷新后，操作记录中的“重新核对交易”会从两个来源重新读取实际调用、收据、历史仓位及领取事件，不信任旧的成功标签，也不恢复发送能力。历史状态不可用、仓位已在同一区块销毁或发生重组时，核对会停止并显示未确认。

正式发送路径在请求钱包前保存独立的待处理标记，用 Web Locks 协调同源标签页。普通历史清空不会删除它；刷新后仍阻止再次发送，已知交易可通过“核对待处理交易”检查实际账户、目标、调用摘要及 canonical/finalized 状态后解除。存储不可用、浏览器不支持 Web Locks、提交未知无哈希或无法取得最终性时保持发送关闭。模拟演示不创建该标记。

钱包响应丢失或哈希补写失败后，可在待处理区域补入从钱包交易记录查到的哈希。输入只作为查询线索，不替换原提交身份；发送者、管理器、零 value、调用摘要及最终性仍须全部核对。错误交易不写入待处理记录，格式错误不发起 RPC 查询；候选输入绑定当前待处理标识，另一标签页替换记录后不沿用旧输入。

生产入口检查只允许无控制器的 loopback 本地模式，或状态与首页身份一致、文件验证成功的 TapeOut 客户端模式。预检后重查入口，异步钱包检查后、真正发送前再核对控制器及操作代次；控制器切换会废弃旧计划和入口状态。服务器模式和未验证客户端保持只读。这些检查保留对浏览器、控制器及启动文件的信任，不替代真实钱包和独立发行审阅。

RPC 区块读取除双来源一致外，还检查字段格式和请求高度；两方一致返回其他高度也会拒绝。新快照允许相对本机时间最多落后 300 秒、超前 30 秒；本机时钟不准时应先校时，不能放宽窗口绕过检查。历史收据验证仍允许读取旧区块。

## 发行证据与参赛材料

`npm run report:dependencies` 保存带 lockfile 摘要的扫描结果；生产构建后运行 `npm run report:dependency-scope`，将告警对应到当前模块图和发行文件。报告只判断图中是否出现，不认定漏洞不可利用；详见 `docs/DEPENDENCY-REVIEW.md`。

从干净提交完成生产构建后，运行 `npm run verify:reproducibility`。工具创建临时 Git 副本，以 `npm ci --ignore-scripts` 安装固定依赖，在同一系统连续构建两次，再与当前 `dist/` 逐文件比较，保存 `release-artifacts/reproducibility.json`。这不等于另一台独立设备复现，也不代替测试或审阅。

Playwright 已配置演示、生产恢复、备用恢复、发布台和只读钱包接入台，包含 360/390/768/1280/1440 px、键盘焦点、未知提交恢复、受控网络故障与显式钱包夹具，并验证 Web Locks 跨标签页竞争、持久阻止、取消恢复及 Service Worker 身份变化。另验证 HTTPS 代理确实阻断 SW 内发起的主入口请求。SW 身份响应和钱包 provider 仍为明确夹具。先从干净提交构建，再执行 `npm run test:e2e`；本机 Chromium 限制仍在，使用 GitHub Ubuntu 环境执行并保留截图。夹具测试不替代实际扩展钱包验收；独立保存的历史公网网关观察另见 `evidence/historical/`。

参赛项目说明、2 分 50 秒录制脚本及用户任务记录模板位于 `docs/competition/`。`record:demo` 录制短静音隔离演示，`package:entry` 生成源码/清单/视频绑定的草稿包，并摘要核对先前真实发布证据、保留新旧源码区分。公开仓库为 `wangyangmingsss/tapeexit`；正式提交仍需已审候选版本发布、目标钱包验收、独立审阅、当前规则/表单、团队信息及如实披露的用户证据。

## 后续验收工具

完整命令及输入见 [发行操作](docs/OPERATIONS.md)：

- `inspect:assets`：采集候选代币代码、精度和代理槽，不自动批准资产。
- `verify:runtime-source`：按输入摘要和精确安装编译器核对完整部署 runtime，不裁剪元数据，不批准资产。
- `inspect:runtime-metadata`：双 RPC 保存完整字节码和旧版 Swarm 元数据指针，不据此推断源码或编译器。
- `prepare:review` / `verify:review`：冻结源码、依赖锁与发行文件，校验外部审阅者签名的报告；身份和独立性仍需人工确认，不打开签名门禁。详见 [审阅交接](docs/SECURITY-REVIEW-PACKET.md)。
- `prepare:recovery`：只读核对真实仓位、资产身份与 USDt0 冻结状态，生成 1% 提议和待审条件，不生成签名调用。
- `verify:recovery`：退出后复核真实交易、收据及相邻区块末余额/流动性；记录同区块其他操作可能影响比较的限制。
- `inspect:publication`：核对容器/处理器/持有人、固定实现和显式预算，只模拟首笔。
- `plan:resume`：逐字节核对链上前缀后生成未签名剩余调用，不盲目重放。
- `accept:wallet`：启动本地 EIP-6963 接入台；不请求交易或消息签名。
- `report:users`：只汇总实际同意的用户记录；无数据时明确输出零证据。
- `report:readiness`：绑定当前发行和依赖审计，保持主网未批准状态。
- `verify:gateways`：两个实际 HTTPS 入口的客户端身份与全部发行字节核对，备用入口测试时阻断主入口。
- `preflight:release`：绑定干净源提交、容器、资产、钱包、网关与审阅证据；拒绝混用、过期或被篡改的记录，保持签名关闭。输入和验收边界见 [正式发行检查](docs/RELEASE-PREFLIGHT.md)。

公开演示可由 GitHub Pages 工作流发布；其模拟环境标签与生产隔离不变。网关 HTTPS 模板和独立审阅资料分别位于 `deploy/` 与 `docs/SECURITY-REVIEW-PACKET.md`，并不代表已经部署或审阅。

此保护仅限同一浏览器存储和同源页面。不同网关、设备、清除站点数据或同源恶意脚本不受其协调；它不是链上幂等性保证。不提供无哈希未知提交、替换/取消交易的自动解锁，必须先核查钱包及链上状态，不能靠清除存储重试。

已知交易恢复完成后，应用同步保存真实核对结果，清除旧仓位与可发送预览，区分领取已核对、证据不足和回滚。当前会话保留最近核对的收据区块高度；读取、预演和发送前重查均拒绝更早的快照。若首次收据成功但后续最终性复核失败，会立即撤回成功展示并恢复锁定。该高度下限只存在于当前会话，不替代链上状态和最终性检查。

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

该命令只接受带干净源提交的发行清单，拒绝重复/保留路径、缺失/额外文件、符号链接及摘要不符，按 24,000 字节分块编码 `putFile` / `appendChunk`，读取当前激活费用和容器状态，输出 `release-artifacts/publish-plan.json`。它不签名、不上传、不付费；生成的数据不能跳过所有权、实现版本、预算及逐文件回读验收。详见 [发布手册](docs/PUBLISHING.md)。

上传后用 `npm run verify:publication -- <容器地址> <此前独立保存的清单SHA256>` 执行只读验收。它在固定区块用两来源核对完整路径、fallback、元数据和每个文件的全部字节，单独记录激活状态。先前 `733ca79` 版本已有 9 文件、587,736 字节回读记录；当前候选需自己的发布证据。生成的报告不能替代钱包和独立安全验收。小额演练准备及退出后核验见 [受控恢复交接](docs/CONTROLLED-RECOVERY.md)。

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
