# TapeExit 参赛简介

## 中文

TapeExit 是基于 TapeOut 的 X Layer DeFi 资产应急出口。原平台网站失效时，
资产可能仍在协议合约里，用户却找不到可用的操作界面。我们将应用文件发布到
TapeOut 链上容器，让多个公网网关读取同一版本，并提供可提前保存的本地恢复包。

TapeExit 已接入两种真实部署：Uniswap V3 的 NFT 流动性仓位，以及 Spark Savings
USDC 的金库份额。它按各协议规则读取仓位、模拟退出，并核对到账、剩余仓位与链的
最终确认。恢复文件只保存公开身份与交易哈希；导入后必须重新读取链上证据，不能
通过导入文件伪造“核验成功”。

本次活动期间新增了双网关与本地恢复路径、精确文件回读、多协议接口、Spark 金库
适配、受限真实钱包测试，以及阻断主网关后的金库恢复演练。各项证据按发布版本保存，
不将模拟演示当作真实主网交易。

目标用户是使用 X Layer DeFi、需要提前准备退出路径的个人，以及希望向用户提供
应急入口的协议团队。基础工具开源免费；计划通过协议适配、可复现发布、故障演练与
持续维护提供服务。用户在存入资产时保存恢复记录，并在版本更新后定期检查。
这些商业方向尚需真实访谈和试点验证，没有宣称已有客户或收入。

公开版本保持只读，生产签名关闭；已完成的受限测试不等于独立安全审阅。
后续逐个扩展 V2 LP、质押和借贷。每个协议单独适配，不声称覆盖 X Layer 全部平台，
也不能绕过协议暂停、锁定期或流动性限制。

## English

TapeExit is a TapeOut-based emergency exit interface for DeFi on X Layer.
When a protocol's website is unavailable, the assets may still exist in its
contracts while users lose their familiar interface. TapeExit publishes its
application files to a TapeOut container, accessible through two public gateways,
with a downloadable local recovery package as another entry.

Two deployed protocol types are integrated: Uniswap V3 liquidity NFTs and Spark
Savings USDC vault shares. Each adapter reads positions, simulates its own exit
rules, and checks receipts, remaining positions and finality. Recovery files
contain public identifiers and transaction hashes. Importing one never restores
a trusted success flag: the application must obtain fresh chain evidence.

Development during the event includes gateway and local recovery paths, exact
publication readback, a shared adapter interface, the Spark integration,
restricted real-wallet testing and recovery with the primary gateway blocked.
Evidence is tied to its application version. Simulation footage is labelled
and is never presented as a mainnet transaction.

The target users are X Layer DeFi holders preparing an exit path and protocol
teams offering emergency access. The basic tool is open source and free.
Potential paid services include protocol integration, reproducible deployment,
recovery drills and maintenance. These are hypotheses, without claimed customers
or revenue. Future adapters will address V2 LPs, staking and lending individually.

The public application is read only and production signing remains disabled.
Restricted test evidence does not constitute an independent security review.
TapeExit cannot bypass protocol pauses, lockups or liquidity constraints.
