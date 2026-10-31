# Spark USDC 金库

第二个适配模块接入 X Layer 主网的 **Spark Savings USDC（spUSDC）**。它使用真实部署的金库读取和调用规则，不要求 NFT 或两个底层代币，和 V3 一起实现 `ProtocolAdapter`。

## 使用

1. 打开新版应用的“USDC 金库”。
2. 输入持有人公开地址，或连接钱包后使用填入的地址，点击“读取金库份额”。
3. 查看 spUSDC 份额、USDC 折算资产、当前最大可赎回份额和最大可提取资产。
4. 选择比例，点击“预演金库赎回”。当前只模拟，不发送交易或请求授权。
5. 已有直接赎回交易可填写原钱包地址及哈希，核验到账、份额与最终确认；保存恢复记录后可在其他入口导入重查。

不需要私钥，也不需要为了查询而存款。地址没有持仓时显示零份额；RPC 查询失败显示未完成，二者区分。
Demo 的份额是模拟数据，不查询主网，也不会产生真实交易。

## 部署身份

| 项目 | 固定身份 |
| --- | --- |
| 链 | X Layer，196 |
| 协议标识 | `spark-spusdc` |
| 金库代理 | `0xf90E63079D97a0A1f479b2b168457F420CAFf6ba` |
| 实现 | `0xdCe929A335C75a1676EF5957A4D7a3b928C48820` |
| 底层 USDC | `0xB6CEceAB302E2E4948951eE7843FC24E92933061` |
| 份额与资产精度 | 均为 6 |
| 官方地址库提交 | `a26016637516fd4475cd846800835e30cc1027a2` |
| 官方实现源码提交 | `0a686ba2fcf874bc1542171a323779ba73ac2dc5` |

原始资料：

- [Spark 官方 X Layer 地址库](https://github.com/sparkdotfi/spark-address-registry/blob/a26016637516fd4475cd846800835e30cc1027a2/src/XLayer.sol)
- [SparkVault 实现源码](https://github.com/sparkdotfi/spark-vaults-v2/blob/0a686ba2fcf874bc1542171a323779ba73ac2dc5/src/SparkVault.sol)

每次读取核对链 ID、ERC-1967 实现槽、实现 getter、代理/实现/资产的 runtime code hash、asset() 与精度。实现升级或字节码变化会阻止预览，须重新核对后才更新配置。
这些是官方登记与链上观测的对应关系，没有宣称完成可复现编译匹配或独立安全审阅。

## 读取与预览

固定区块上读取 `balanceOf`、`convertToAssets`、`maxRedeem`、`maxWithdraw`、`totalAssets` 和金库 USDC 可用余额。
金额使用整数基础单位。`maxRedeem` 受实际流动性限制，即使持有份额，也可能暂时无法全部赎回。

预览生成唯一的 `redeem(shares, owner, owner)`，收款人与份额持有人固定一致，不进行代币兑换或追加授权。
先重新核对部署与额度，再比较 `previewRedeem` 与带 from 地址的实际 `eth_call` 结果，随后估算 Gas。
预览区块超过五分钟或明显超前时须重新读取。预计到账不是最低到账保证；当前界面不提供发送按钮。

## 结果核验与恢复

支持已有、直接发往该金库的 `redeem` 和 `withdraw` 交易。路由器、第三方代领、异步赎回与其他金库不在范围内。

核验同时检查：

- 两个 RPC 返回一致的交易与收据身份，交易链、from、to、value 和规范编码匹配。
- 唯一的 Withdraw 事件匹配本人、收款人、资产和份额。
- 金库份额销毁事件与 USDC 向本人转账事件分别匹配。
- 父区块与收据区块的份额、USDC 余额变化及剩余份额相符。
- safe/finalized 标签、固定区块身份，以及读取结束后的收据和交易复核。

区分待确认、已回滚、等待最终确认、区块状态不一致和核验通过。余额是区块末状态的佐证，不能隔离同一区块的其他活动；不一致时不显示核验通过。

恢复 JSON 只保存公开的协议、链、金库、地址与交易哈希。导入不会信任旧的“通过”字段，也不会恢复任何签名权限。
文件大小、地址、协议版本和链必须匹配；V3 恢复文件不能作为金库恢复文件使用。

## 验证命令

```sh
npm run verify:vault
npm run verify:vault-fork
npx vitest run tests/vault-adapter.test.ts tests/vault-recovery.test.ts tests/vault-workspace.test.tsx
```

第一条通过两个主网 RPC 核对固定区块上的真实部署和公开地址状态。
第二条在同一固定区块创建隔离分叉，以真实代理和实现完成存入、部分赎回、全部赎回、到账/份额核验及恢复文件重查。
测试在分叉中模拟资助与账户签名，不修改合约代码或存储槽，不发送主网交易。
两个本地 RPC 标签共享同一分叉，不能当作两个独立主网来源；主网基线另行使用两个 RPC 核对。

报告写入 `release-artifacts/spark-vault/`。GitHub Actions 的 `Verify Spark vault deployment` 可重复执行。

## 发布范围

金库模块已随 TapeOut `0.3.0-f8771a8` 发布。16 个文件、647523 字节完整回读，
双公网桌面/手机与主入口阻断后的金库恢复均通过，见[发行证据](evidence/published-f8771a8/README.md)。

固定钱包已完成批准、存入 1 USDC、半额赎回、剩余赎回四笔受限真实测试交易，
全部最终确认。两次合计返回 1.000002 USDC，份额归零；原日志保留且由协调器重新核验。
这不是公开入口的生产签名验收。生产签名保持关闭：
`RELEASE_APPROVED=false`、`SUPPORTED_TOKENS=[]`，独立安全审阅尚未完成。

受限真实钱包测试的独立工具、固定 1 USDC 范围与操作步骤见 [金库钱包实测](SPARK-WALLET-TEST.md)。它不向公开应用添加签名入口。
