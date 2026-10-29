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

```sh
npm run verify:asset-fork -- <实际仓位编号> --block=<十进制区块号>
```

可省略区块参数以使用当前固定区块。命令先以双来源观察实际仓位，再启动私有 IPC 一次性分叉，比较持有人、资产和流动性。六场景分别从 snapshot 恢复：部分退出、全部退出、有/无流动性的仅领取、最低输出回滚、过期回滚。核对资产余额增量、领取事件、剩余流动性和 NFT 所有权；回滚时要求余额、流动性及欠款不变。仅在子 EVM impersonate 和填充测试余额，不接受远程写入地址、不使用私钥。报告 `asset-fork-matrix.json` 不批准资产，也不证明升级治理、暂停、税费、重基准或未来行为。

## 2. 容器身份与预算

先观察公共环境，无需钱包：

```sh
npm run inspect:tapeout
npm run inspect:tapeout -- 5
```

输出 `release-artifacts/tapeout-environment.json`；每次先删除旧结果，双来源固定区块记录 factory/registry/binding/opener 的代码和已固定实现、处理器总数、最多 5 个登记条目及当时月费。可用返回的下一偏移继续分页；列出不等于选择或批准处理器，代码摘要不证明封印与治理安全。月费为零也不等于上传、容器获取和未来费用为零。下一步的真实输入及任务见 `REAL-ACCEPTANCE.md`。

将 `docs/publication-profile.example.json` 作为填写模板。所有 `null` 必须替换成真实公开身份、独立核对过的代码摘要或明确预算。不得填写私钥。金额使用最小单位十进制字符串；预算上限不代表预估成本。gas 数量上限必须为正；明确的价格/总费用上限允许为 `"0"`，只接受当时实际报价也为零的演练，不推断主网费用总是为零。

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

演练使用双 RPC 当前报价的较大值作为每笔本地交易的明确 gas price，报告另记 `observedGasPriceWei`。不采用 Anvil 默认的费用建议，因为它可能与上游链报价不同；本地执行仍须满足分叉 base fee 和 profile 费用上限。该报价仅用于模拟，不保证主网未来的实际收据费用。

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

### 实际文件上传台

```sh
npm run publish:wallet -- <上传profile.json> <独立保存的manifest-sha256> <持久journal.json> 4183 <发行文件目录>
```

默认发行目录为 `dist`，也可指定已经固定并核对过的发行快照，避免工具更新后意外切换发行。启动时加载并验证所有文件字节；独立摘要不匹配就停止。禁止使用标记为 `LOCAL_REHEARSAL_ONLY_NOT_APPROVED` 的分叉填充余额配置。上传 profile 的代码摘要仅用于核对具体部署，不自动构成独立审阅。

在安装 OKX 扩展的 Chrome 打开输出的准确 `http://127.0.0.1:4183/` 地址。连接当前发布账户，勾选并确认页面列出的 EVM Gas 预算范围，再准备下一笔并逐笔在钱包确认。费用确认只对这个容器、发行摘要、代码摘要及预算生效，有效一小时；不会自动弹出后续签名。激活使用单独的预览、确认及 journal；上传台不支持代币批准或 V3 仓位操作，不改变应用本身的签名许可。

上传仅使用逐笔 `eth_sendTransaction`：准备一笔、钱包确认、核验交易及文件、再准备下一笔。已移除能力检测、新批量预览及批量提交入口，相关 HTTP 接口返回 404。不会请求账户升级。删除工具功能不会撤销账户已有的 EIP-7702 委托，也不会重置上传、激活或费用记录。

历史 journal 的 `walletCapabilities` 仅作为旧元数据保留，不再产生或用于决定新上传模式。原有批量记录继续按原步骤及全部费用预留核验。应用内 V3 退出所需的 `decreaseLiquidity + collect` 原子 multicall 不受此次上传工具简化影响。

待处理的历史批量可用“恢复历史批量请求”及已保存 ID 查询 `wallet_getCallsStatus`，也能填入钱包提供的 ID；状态查询有 15 秒超时，整体核验显示 90 秒倒计时。钱包状态只用于发现哈希，成功必须经过双 RPC 回执、交易、稳定区块、账户实现代码和所有原始步骤的字节回读。历史实现地址及代码摘要仍固定在 `tools/publication-batch.ts`，对应 `okxlabs/okx-smart-wallet-evm` 源提交 `9751ea4ba31e977c0a8743423ac711f9c97469f4` 的观察记录，不能代替独立审阅。核验支持发布账户直接调用自身 `execute` 的单交易批量，包含 legacy、EIP-1559 及一项由发布账户签名、当前链且指向固定实现的 EIP-7702 authorization。中继、其他包装、多回执和部分成功保持暂停，不自动补发。历史已记录的明确拒绝或新查询得到的链外失败（400），仍须用户核对钱包、确认取消并通过 nonce 检查才能解除暂停；未知状态不能取消。回滚保留全部预算，完成数量按步骤数统计。

每次准备都检查原始字节前缀、容器身份和代码、已有收据区块、当前报价及 pending/latest nonce。估算 gas 加 20% 缓冲。报价有效 30 秒，钱包请求前再做一次检查；费用、nonce 或步骤变化要求重新准备。发送参数固定到注册表、当前容器、原始 calldata、零 value 和明确 nonce。服务器没有钱包、私钥、签名、广播或任意 RPC 代理接口。

本地 journal 在释放待签参数前原子写入并 fsync，进程锁防止两个上传台同时使用它。每笔预留 Gas 上限乘报价，已取消或回滚也不退还预留额，保证重启后预算仍保守。不要删除或换 journal 来绕过预算；它不跨其他机器、其他 journal 或其他工具约束钱包。应用确认有效期仅限制本地新请求，不能撤销已打开的钱包弹窗或已经签名的交易。

OKX 扩展可能重新估算 Gas，或将报价中的 legacy 请求改成 EIP-1559 交易。核验允许这些调整，但要求实际 Gas 上限、最高单价和累计预留均在已确认 profile 预算内，收据单价与交易实际单价一致，实际 Gas 用量不超过链上交易上限。journal 保留原请求，另记已核验的实际费用参数，按原预留与实际最高费用中的较大值继续计账。两个 RPC 必须对所有参与核验的交易及收据字段达成一致；忽略节点附带的无关元数据。账户、目标、金额、nonce、网络、calldata、区块和逐字节回读仍须匹配。超限或关键内容不符会停止后续上传，但工具无法撤销已经签名的修改，请在钱包中核对最终费用。

对于已经入块且通过双来源稳定区块与文件回读的交易，如果钱包提高了未用完的 Gas 或单价上限，但收据实际 Gas 用量不超过原请求的 Gas 预留、实际单价不超过原请求报价，可按已结算交易完成核验。journal 的 `minedEnvelope.settledWithinReservation` 记录此情况及原始、实际两套参数，继续保留完整的原预留费用，不退款、不提高后续签名上限。实际用量或单价超过原预留时仍暂停。恢复 journal 时重检这条结算约束；下一笔签名前仍复核已记录区块，发现重组即停止。

钱包响应丢失、收据未出现、RPC 分歧或参数不符时保持待核验；刷新不会重新发送。完整交易哈希可从钱包记录填入；两个 RPC 核对实际交易、收据、gas、nonce、chainId、稳定观察区块以及对应文件前缀后才继续。这里的“稳定”是 head 减两个区块的双来源观察，不等于共识最终性。上传完成后再运行 `verify:publication` 保存完整报告，激活与来源验收另行处理。

没有返回哈希而且用户已亲自在钱包拒绝/取消请求时，可勾选取消声明。工具要求 pending/latest nonce 仍等于原 nonce，记录 `cancelled-by-user`，不退还预算；这只是用户声明和两来源当前观察，不证明所有 mempool 中没有交易。下次请求仍明确使用当前 nonce，并重新验证文件。已附交易哈希的请求不能用该方式清除，必须核验。不要在未知的钱包弹窗或待广播交易仍存在时声明取消。

进程异常退出留下 `.lock` 目录时，先确认原进程已结束、钱包请求状态已核对，再由维护人员移除该锁目录；保留原 JSON journal。工具不自动回收锁，不自动清空未知交易。证据导出包含公开交易记录和 unsigned 调用参数，不含钱包密钥。

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

真实网关工具的文件读取以独立清单中每个文件的大小为流式上限，状态读取限 64 KiB，严格 UTF-8/JSON；禁止重定向、省略凭据，超时覆盖响应体。过大、失败或停滞会终止并释放响应体。这些检查同时通过 loopback HTTP 和三引擎浏览器用例验证，不等于已取得实际网关。

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

## 9. 性能与商业假设

```sh
npm run report:performance
npm run model:business
npm run model:business -- <私有假设.json>
npm run report:pilots -- <私有试点记录.json>
npm run report:compatibility
```

性能报告要求干净提交与同版本生产构建，核对初始/延后加载 chunk、文件摘要、gzip 估计和预算；官方 SDK 仅在预演/验证时加载，仍包含在完整发行中。模块缺失会停止操作。报告不测网速或设备时间，也不提供链上费用结论。

商业示例的 13 个数值均为 null；未获得报价、测量或明确假设前不填零。输入金额为 USD 整数美分，时间为整数分钟，成本计算使用精确整数。输出保留 `ASSUMPTIONS_ONLY`，不能作为客户、收入或市场验证。实际试点及比较方法见 `competition/PILOT-PLAN.md`；需要指定联系人和明确发送授权后才联系第三方。

试点记录格式见 `competition/PILOT-RECORD.example.json`。记录放在公开仓库之外，以匿名编号和明确同意记录；各阶段分别要求访谈、协议、结果、付款文件的相对路径及独立保存摘要。工具核对实际文件字节、大小和目录边界，按源提交/发行/环境分组；摘要不认证同意、签署者或付款真实性。没有输入时为 `NO_PILOT_EVIDENCE`。

兼容报告读取三引擎完整 JSON 结果，并绑定干净源提交、发行清单和结果摘要；拒绝缺引擎、跳过、失败或重试通过。版本及 Web Locks、Service Worker、SubtleCrypto、流和 BigInt 来自实际浏览器观察。WebKit 不等于真实 Safari 或手机，provider 夹具不等于 OKX 扩展。

# Wallet Publication: 30-Day Activation

After the original release has finished uploading, the loopback publication workbench
offers a separate **容器激活 · 30 天** section. Keep using the original publication
directory and trusted manifest digest. Do not replace the uploaded release with a
new local build.

1. Connect the original publishing account on X Layer (196).
2. Choose **准备激活 30 天**. The server verifies complete publication bytes,
   the container holder, contract pins, current service fee, pending nonce and
   a simulation through both configured RPC operators.
3. Review the exact name, container, service fee and EVM gas ceiling. Check the
   separate activation fee checkbox, then choose **在钱包确认激活 30 天**.
   The browser requests one `DomainBinding.bind(name, container, 1)` transaction.
   Upload authorization never authorizes activation. Each month is 30 days.
4. The workbench saves a reservation before requesting the wallet, then verifies
   the returned transaction hash, calldata, value, nonce, chain, receipt and stable
   block through both RPC operators. Success also requires the exact name and
   container to be live and their expiry to cover the purchased 30 days.
5. Use **导出激活核验记录** for the transaction and expiry evidence. Query
   **查询激活状态** to obtain a fresh observation after restarting.

Activation uses `<upload-journal>.activation.json` and its own lock. Never delete
either journal to clear an unknown result. A missing wallet response remains
reserved across reloads and restarts. Recover the hash from the wallet and use
**保存激活哈希**, then **核验激活结果**. The workbench does not automatically
resubmit, renew an active name, upgrade an account, approve tokens or sign anything.
Cancellation requires an explicit user attestation and unchanged latest/pending
nonce; a hashed request must be reconciled instead.

Quotes last two minutes. Any increased fee or gas quote, changed nonce, changed
name expiry or expired quote requires a fresh preview and checkbox confirmation.
Activation has a separate 500,000 gas / 30,000,000 wei gas-price ceiling.
Receipt verification accepts a larger unused wallet gas envelope only if the
actual settled usage and price fit the exact quoted reservation. EVM gas bounds
exclude chain-specific fees; review the final wallet total. Observed code pins
remain observations rather than an independent security review.
