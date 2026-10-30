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

链上应用：`0.2.0-0d9ff56`，完整源码提交 `0d9ff56a32b2ce36cd78c925d03f7205c169bf4a`。

名称：`2.2.289.tape`。容器：`0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D`。

发行清单 SHA-256：
`c3c4101ae075a2dd1679213776dfc2d988494cb5c407ee58f82dc490b9a455cc`。

这是一条历史发布记录，不表示刚刚重新检查了链上状态、费用有效期或在线可用性。
新版文件尚未完成链上发布时，网关包标记 `PREPARED_NOT_DEPLOYED`。

## 新版链上更新

使用已独立保存的旧清单与文件生成迁移方案：

```sh
npm run prepare:gateway-update -- <旧版文件目录> <可信旧清单SHA256>
```

保留既有交易日志。估算上传费用并获得钱包确认后，上传差异、核对逐字节回读，再检查两个公网入口。
只有实际验收对应提交与清单后，才更新已记录的链上版本。详见 [网关更新流程](GATEWAY-UPDATE.md)。
