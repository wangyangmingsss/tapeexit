# TapeExit 发行操作

开发工具、只读证据、实际执行分开记录。本手册不会批准主网签名。钱包、容器、支持代币、独立审阅和费用仍需真实输入。

## 1. 支持资产候选采集

连接钱包后可在工作区选择“查找我的仓位”，每页读取 10 个直接持有的 NFT，下一页复用相同固定区块。查询先验证管理器部署，再逐个核对 owner；最多每页 20 个，可取消。取消会丢弃结果并停止后续请求，已发出的 RPC 请求仍受原来的超时限制。枚举失败不影响手动编号读取；发现 NFT 不表示其资产获准交易。

```sh
npm run inspect:assets -- <候选代币地址> <另一候选代币地址>
```

输出 `release-artifacts/asset-candidates.json`，记录双来源固定区块、代码摘要、symbol/decimals 和 ERC-1967 implementation/beacon/admin 槽。最多 20 个地址。

每个资产包含代理依赖观察图和图摘要。工具追踪标准 implementation 槽、beacon 槽及其 `implementation()` 返回地址，采集依赖合约代码和标准槽、管理员地址及其 runtime 摘要。beacon 调用分别使用零地址和根资产作为 `from` 取样；结果不同、零地址、缺失/畸形代码、冲突槽、依赖环、来源分歧或超过 4 层/12 节点限制会停止。单个 runtime 上限 256 KiB，beacon 调用 gas 上限 300,000。

独立保存候选报告的 SHA-256 后，可重新观察并比较：

```sh
npm run verify:assets -- <保存的候选报告.json> <独立保存的报告SHA256>
```

命令限制基线为 2 MiB，核对摘要、完整图与根代码、地址集合和区块；旧版缺少代理图的报告必须重新采集。两来源重新核对基线区块哈希，采集当前状态，比较根代码、精度、symbol、依赖图（含实现、beacon 和管理员）。变化会返回非零退出码并写 `ASSET_IDENTITY_CHANGED` 差异报告；一致为 `OBSERVED_IDENTITY_UNCHANGED`。输出 `release-artifacts/asset-identity-verification.json`；新尝试先删除旧结果，读取失败不保留旧成功。

这是候选观察记录，不是安全判断。依赖合约的槽在各自地址读取，不代表 delegatecall 实际使用的存储；两个 caller 取样不证明对所有 caller 都相同。空槽不能证明非代理，标准槽也不能证明实际执行路径；管理员无 runtime 不能证明无升级权限。治理权限、暂停/黑名单、税费、重基准、桥和发行人身份仍需人工追溯。两次观察之间及之后的变化不在结论内。实际转账行为必须在官方合约测试或固定区块分叉中验证。不自动修改 `SUPPORTED_TOKENS`；复核一致报告不能替代正式资产审阅证据。

## 2. 容器身份与预算

将 `docs/publication-profile.example.json` 作为填写模板。所有 `null` 必须替换成真实公开身份、独立核对过的代码摘要或明确预算。不得填写私钥。金额使用最小单位十进制字符串；预算上限不代表预估成本。

```sh
npm run inspect:publication -- <已填写的profile.json>
```

检查 processor 编号、工厂登记、容器派生、NFT owner、已开通状态、容器 `token()`、六个代码摘要，以及 registry/binding/factory 的固定实现地址。检查每笔目标、value、容器参数和 calldata 内在 gas 下限。总预算按交易数 × 单笔 gas 上限 × gas price 上限计算，不含 activation。

只有第一笔调用能在不应用此前写入的前提下模拟，遇到挂牌/锁定等拒绝会停止。不能把首笔成功等同于所有分块成功。处理器 beacon/工厂封印、实现代码及权限、逐笔当前 gas 和状态仍需审阅。此工具不提供发送功能。

### 顺序发布分叉演练

```sh
npm run rehearse:publication -- <同一个publication-profile.json>
```

此命令要求有效的真实容器、发布人、代码摘要与预算；没有这些输入时会停止。它先双来源检查已有文件的精确前缀和容器身份，再从已固定的区块启动一次性 Anvil，核对分叉起点哈希。所有写操作仅通过该子进程的随机临时 IPC socket 发送，不接受远程写入端点，不需要钱包或私钥。

演练重新检查本地分叉身份与剩余调用，逐项 `eth_call`、估算 gas、增加 20% gas 缓冲，再执行 `putFile`、`appendChunk` 和最后的 fallback。单笔和总预算均受 profile 上限限制。每次提交只发送一次；只有收据读取允许最多 20 次、每次间隔 100ms 的轮询。响应丢失、回滚、收据缺失、实际输入/账户/金额/gas 不符、区块不一致或预算超限即停止。成功后在本地分叉逐字节回读所有文件。

报告为 `release-artifacts/publication-rehearsal.json`，绑定源码、清单、profile、起点区块以及每笔本地交易的估算/实际 gas。失败会先移除旧报告；退出时关闭子进程并删除临时目录。已完全上传的容器请直接使用 `verify:publication`。

这是本地模拟：发布人被 impersonate，余额被替换为测试余额；本地两个读取标签指向同一个 EVM，并非独立来源。分叉状态从一个上游获取，初始文件前缀另与双来源观察比较。费用不含 activation、域名和链特有费用；不代表主网未来 gas、授权和状态，不作为正式发行预检的实际发布证据。自动化使用显式注册表协议夹具验证顺序和回读，真实 TapeOut 分叉演练仍需填写真实 profile。

## 3. 首次计划和中断恢复

```sh
npm run plan:publish -- <实际容器地址>
npm run plan:resume -- <同一容器地址>
```

续传工具先枚举链上路径，拒绝未知/重复路径。已存在文件必须有完全相同的 MIME、目标 SHA-256、原始 chunk 边界及实际字节前缀。只保留缺失的原始调用，入口与 fallback 在后。内容不同就停止，不覆盖陌生发行。

结果为 `release-artifacts/resume-plan.json`；没有提交交易。数据是固定区块观察，不是持久锁。另一发布者更改容器后必须重读；不能跨发行复用旧计划。交易提交仍通过经审阅的发布钱包逐项确认，不导入签名私钥，不让代理自动接受钱包请求。

```sh
npm run verify:publication -- <容器地址> <独立保存的清单SHA256>
```

回读必须在真实发布后完成，内容匹配与 activation 可访问性分别报告。

## 4. 钱包接入台

从干净提交构建生产包后：

```sh
npm run accept:wallet
```

访问 `http://127.0.0.1:4180/`，使用安装了目标扩展的钱包浏览器。接入台支持 EIP-6963 发现、公开账户请求、Chain ID 读取、用户点击后的切链、拒绝与账户/链变更事件，以及经同意导出记录。只允许四种 provider 方法：`eth_requestAccounts`、`eth_accounts`、`eth_chainId`、`wallet_switchEthereumChain`。

本地接入不证明真实 TapeOut 来源、交易参数、签名、收据或刷新流程验收完成。自动化中的 provider 是显式夹具，不能当作 OKX Wallet 实测。需要实际入口和用户控制的仓位后，按 `ACCEPTANCE.md` 补齐完整流程。

## 5. 网关与故障证据

`deploy/nginx.conf.example` 提供 HTTPS 通配主机的保留路径与 bootstrap 回退模板。需要真实域名、证书和两个主机，替换占位符后先运行 `nginx -t`。模板尚未在真实服务器部署或验证；两个域名不代表独立基础设施。

浏览器套件另有可复现的 loopback 网络故障：由 Playwright 拒绝主入口导航，记录失败请求，打开相同摘要的备用恢复包。它证明受控本地场景中的备用只读入口可达，不证明真实公共网关、RPC 或资金退出在故障下可用。

真实演练必须记录阻断范围、生效的失败请求、两个入口共享的 DNS/CDN/云/RPC、源码与摘要、钱包请求和结果。在不同 origin 的浏览器中，待处理标记不共享；必须先核查原入口钱包交易，不能在备用入口直接重试。

## 6. 视频、用户记录与参赛包

```sh
npm run print:card
npm run print:card -- <从应用导出的恢复卡.json>
```

输出离线可打开、可打印的 `release-artifacts/recovery-card/card.html` 及规范化 JSON，二维码仅包含该 JSON。每张限一个仓位；无输入时明确留空。源版本与清单摘要来自当前已验证构建；不沿用输入里的入口或容器，不生成虚构的已部署地址。二维码不能替代保存应用包、验证清单和独立保存可信摘要。CI 另检查移动视口并生成 PDF。

```sh
npm run record:demo
npm run report:users
npm run report:readiness
npm run package:entry
```

录制工具需要能运行 Chromium 的环境。输出短静音 WebM、封面和带源码/摘要的元数据；全程保留隔离演示标签。它不是最终 2:50 路演视频，不包含真钱包或真实部署。CI 保存这些产物。

没有参与者输入时，用户报告输出 `NO_USER_EVIDENCE`。有经许可的实际记录后，使用 `npm run report:users -- <sessions.json>`；模板和方法见 `competition/USER-VALIDATION.md`。不要提交真实参与者数据到公开 Git。

参赛打包要求源码干净，清单、准备度报告、视频均匹配同一提交。输出 `release-artifacts/TapeExit-Competition-Draft.tar.gz`，团队、联系方式、正式入口、提交链接等缺失字段保留 `null`；它不会自动向比赛表单提交。

## 7. 公开演示

`Publish Isolated Demo` 工作流在主分支 Validate 成功后构建独立 demo 并部署 GitHub Pages。页面保留模拟标签，不连接钱包或发送链上交易。Pages 演示不作为正式 TapeOut 部署证据。

## 8. 不自动豁免的条件

`report:readiness` 将发行绑定到干净提交、清单摘要和当前 lockfile 的审计结果。报告保持 `NOT_MAINNET_APPROVED`，不会把人工填写的检查项视作独立审阅，不修改签名开关。`--require-approved` 会以失败退出，供正式流水线阻止误发布。

只有实际身份、支持资产、独立审阅、目标钱包、活跃容器和故障证据齐全后，才能另行审阅正式发送发行。
