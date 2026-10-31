# 截图来源 / Screenshot Provenance

| 文件 | 来源与范围 |
| --- | --- |
| [v3-demo.png](v3-demo.png) | 2026-10-31 实际打开 GitHub Pages Demo，读取预填 `28491`，选择 50% 并预演。页面版本 `0.3.0-0a26413`，完整提交 `0a264131600adf0639c020f3c30a81914c3344ce`。隔离模拟，不是真实仓位或交易。 |
| [vault-demo.png](vault-demo.png) | 同一 Demo、同一提交；50 spUSDC 模拟持仓，选择 50%，预演得到 25.5 USDC 和 25 spUSDC 销毁。没有连接钱包或发送交易。 |
| [vercel-desktop.png](../evidence/published-f8771a8/vercel-desktop.png) | 公网备用网关验收的原始截图；应用 `0.3.0-f8771a8`，真实最终赎回的只读核验：本次到账 0.500002 USDC、剩余份额 0。来源与摘要见[证据目录](../evidence/published-f8771a8/README.md)。 |

前两张是浏览器完整页面截图，未改写画面中的数据。真实主网截图独立保留，不能将模拟资产当作真实余额。

SHA-256:

```text
3b3329225aa149cc01653d07cb3606fd2962119f63661bcc79c3d1e91409e0c1  v3-demo.png
d749af54e16d57213409aeecd71e59c7a69e48423f9d8ed9f78b081ac58229eb  vault-demo.png
```

The first two images are full-page browser captures of the public simulation demo at the source commit above. No wallet was connected and no transaction was sent. Their displayed balances are test data.
The third image is the original public backup-gateway acceptance screenshot of a read-only check against a real, finalized redemption. Its published application version differs from the demo; the evidence directory records the source and digest.
