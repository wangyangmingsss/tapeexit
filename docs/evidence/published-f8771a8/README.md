# TapeOut 新版与 Spark 金库实测证据

应用：`0.3.0-f8771a8`。
源码：`f8771a82c8de048a0ae1d6d41c43d555361dc705`。
清单 SHA-256：`4ed49b70d6352065ca402b101b5d8c3dfe420072d6aefd52bcfce1e07f800672`。
名称：`2.2.289.tape`。
容器：`0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D`。

| 文件 | 内容 |
| --- | --- |
| [profile.json](profile.json) | 固定发布版本与两个公网来源 |
| [publication.json](publication.json) | 16 个文件、647523 字节的链上完整回读与容器状态 |
| [release-manifest.json](release-manifest.json) | 实际上传文件清单 |
| [upload-summary.json](upload-summary.json) | 原上传日志中的 34 笔已确认交易；剩余 0；无需重复激活 |
| [wallet-test.json](wallet-test.json) | 原钱包四笔已最终确认交易及最新只读赎回重查 |
| [recovery-task.json](recovery-task.json) | 可导入公开应用的恢复文件，仅含公开身份和哈希 |
| [gateways.json](gateways.json) | 四个新浏览器会话、64 次文件检查与主网关阻断 |
| `netlify-*-recovery.json` / `vercel-*-recovery.json` | 各视图实际导入、刷新、重新查询并导出的核验结果 |
| [public-acceptance.json](public-acceptance.json) | 证据范围汇总 |
| `netlify-*.png` / `vercel-*.png` | 对应运行的真实公网截图 |
| [SHA256SUMS.txt](SHA256SUMS.txt) | 上述 JSON 和截图的摘要 |

成功公网运行：
https://github.com/wangyangmingsss/tapeexit/actions/runs/41184159042

验证器提交：`d353f74de094db111737ad4417338d7744501b92`。
两个入口各用桌面 1440 × 1000、移动 390 × 844 的全新 Chromium 上下文。
每个视图匹配全部 16 个文件，并核对 Tape 身份、容器激活、stores、Service Worker 与只读布局。
Vercel 两个视图均先证明 Netlify 的 HTTPS CONNECT 连接被阻断，再通过备用入口完成恢复。
各视图都从恢复 JSON 导入公开线索，刷新后重新读取链上结果，而不是信任导入文件的状态。

恢复对象为真实最终赎回
`0xaac3b6f96483f1863a865a2607bce70bdd1caddf1bacd9e630e71ff98f19d1ef`，
匹配 0.500002 USDC 到账、0.498084 spUSDC 销毁、剩余份额 0 及 finalized。
两次真实赎回合计返回 1.000002 USDC。核验过程中没有连接钱包或发送交易。

此前一次验证 `41183703316` 在最终确认尚未到达时停止，未伪造通过；最终确认后
上述运行重新完整检查并通过。未通过运行不是发行验收记录。

这是时间点上的只读发行与受限钱包测试证据。它不证明未来持续在线、网关后台相互独立、
物理手机测试、生产入口签名验收或独立安全审阅。生产签名仍关闭，独立审阅尚未完成。
历史 `2597f66` 的记录保留在[旧版证据](../published-2597f66/README.md)。
