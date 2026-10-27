# TapeExit 发行操作

开发工具、只读证据、实际执行分开记录。本手册不会批准主网签名。钱包、容器、支持代币、独立审阅和费用仍需真实输入。

## 1. 支持资产候选采集

连接钱包后可在工作区选择“查找我的仓位”，每页读取 10 个直接持有的 NFT，下一页复用相同固定区块。查询先验证管理器部署，再逐个核对 owner；最多每页 20 个，可取消。取消会丢弃结果并停止后续请求，已发出的 RPC 请求仍受原来的超时限制。枚举失败不影响手动编号读取；发现 NFT 不表示其资产获准交易。

```sh
npm run inspect:assets -- <候选代币地址> <另一候选代币地址>
```

输出 `release-artifacts/asset-candidates.json`，记录双来源固定区块、代码摘要、symbol/decimals 和 EIP-1967 implementation/beacon 槽。最多 20 个地址。

这是候选观察记录，不是安全判断。空槽不能证明非代理；beacon 实现、治理权限、暂停/黑名单、税费、重基准、桥和发行人身份都需人工追溯。实际转账行为必须在官方合约测试或固定区块分叉中验证。不自动修改 `SUPPORTED_TOKENS`。

## 2. 容器身份与预算

将 `docs/publication-profile.example.json` 作为填写模板。所有 `null` 必须替换成真实公开身份、独立核对过的代码摘要或明确预算。不得填写私钥。金额使用最小单位十进制字符串；预算上限不代表预估成本。

```sh
npm run inspect:publication -- <已填写的profile.json>
```

检查 processor 编号、工厂登记、容器派生、NFT owner、已开通状态、容器 `token()`、六个代码摘要，以及 registry/binding/factory 的固定实现地址。检查每笔目标、value、容器参数和 calldata 内在 gas 下限。总预算按交易数 × 单笔 gas 上限 × gas price 上限计算，不含 activation。

只有第一笔调用能在不应用此前写入的前提下模拟，遇到挂牌/锁定等拒绝会停止。不能把首笔成功等同于所有分块成功。处理器 beacon/工厂封印、实现代码及权限、逐笔当前 gas 和状态仍需审阅。此工具不提供发送功能。

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
