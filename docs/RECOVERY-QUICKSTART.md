# 恢复包快速开始

[中文首页](../README.md) · [English instructions](#english)

这个恢复包对应已发布至 TapeOut 的 **`0.3.0-f8771a8` 主网只读应用**，包含 V3 和 Spark USDC 金库。不需要重新上传应用、激活容器或签名交易。运行需要 Node.js 22.12 或更新版本，不需要 `npm install`。

## 下载与校验

从[固定版本 Release](https://github.com/wangyangmingsss/tapeexit/releases/tag/v0.3.0-f8771a8)下载：

- `TapeExit-0.3.0-f8771a8-recovery.zip`：应用及本地校验、启动工具。
- `SHA256SUMS`：下载文件的摘要。
- `release-manifest.json`、`public-acceptance.json`：固定版本清单及真实公网验收记录。

请从之前独立保存的可信记录核对摘要；同一次下载中的文件和摘要，不能单独证明来源可信。以下是本版本的固定值：

| 项目 | SHA-256 |
| --- | --- |
| 恢复 ZIP | `69dcdfefdf591c956dafde061dcef167c91c3b09657c64975fc0c3f1891c1c2b` |
| 应用发行清单 | `4ed49b70d6352065ca402b101b5d8c3dfe420072d6aefd52bcfce1e07f800672` |

在下载目录执行，第一条输出须与上表恢复 ZIP 摘要一致：

```sh
shasum -a 256 TapeExit-0.3.0-f8771a8-recovery.zip
unzip TapeExit-0.3.0-f8771a8-recovery.zip -d TapeExit-Recovery-f8771a8
cd TapeExit-Recovery-f8771a8
node tools/verify-bundle.mjs 4ed49b70d6352065ca402b101b5d8c3dfe420072d6aefd52bcfce1e07f800672
```

预期输出：`Verified 15 files against the supplied manifest digest.`（另有清单文件，共 16 个应用文件。）不匹配时停止，不启动包内程序。Linux 如无 `shasum`，可用 `sha256sum`；Windows 可通过系统解压工具解压，再在解压目录使用 Node.js 运行相同校验命令。

## 启动与使用

校验通过后，在同一目录执行：

```sh
node tools/local-server.mjs
```

打开 `http://localhost:4173`，保持终端运行。若端口被占用，先检查原服务，避免误以为打开了本次恢复包。

- V3：按提示连接钱包，输入自己直接持有的仓位编号，读取与预演。
- USDC 金库：输入持有人公开地址，读取份额与赎回预览。
- 已有金库赎回：导入恢复记录，或输入原钱包公开地址与交易哈希，再点击“核验金库赎回”。核验只读，不重复赎回。

公开[金库恢复示例](evidence/published-f8771a8/recovery-task.json)可用于重查已完成的实测。输入文件的“成功”标签不会被当作证明；刷新后仍须重新读链。

这个包需要可用的 RPC 和区块链，不是离线转账工具。生产签名保持关闭，独立安全审阅尚未完成。旧 `v0.3.0-readonly` Release 中的 `2597f66` 附件为历史版本；不要与本版文件混用。源码和 Demo 的后续文档更新也不自动改变本包。

## English

This bundle contains the **published `0.3.0-f8771a8` mainnet read-only application**, with V3 and Spark USDC support. It requires **Node.js 22.12 or later**, but no dependency installation. It does not require another upload, container activation or wallet signature.

1. Download `TapeExit-0.3.0-f8771a8-recovery.zip` from the [pinned release](https://github.com/wangyangmingsss/tapeexit/releases/tag/v0.3.0-f8771a8).
2. Check the ZIP against a previously saved, trusted digest: `69dcdfefdf591c956dafde061dcef167c91c3b09657c64975fc0c3f1891c1c2b`. A digest obtained only alongside the download is not independent proof of provenance.
3. Extract it and verify application files against the trusted manifest digest:

```sh
shasum -a 256 TapeExit-0.3.0-f8771a8-recovery.zip
unzip TapeExit-0.3.0-f8771a8-recovery.zip -d TapeExit-Recovery-f8771a8
cd TapeExit-Recovery-f8771a8
node tools/verify-bundle.mjs 4ed49b70d6352065ca402b101b5d8c3dfe420072d6aefd52bcfce1e07f800672
```

Expect `Verified 15 files against the supplied manifest digest.` There are 16 application files including the manifest. Stop on a mismatch. On Linux, `sha256sum` can replace `shasum -a 256`. On Windows, extract with the system archive tool and run the same Node.js verification command from the extracted directory.

After successful verification:

```sh
node tools/local-server.mjs
```

Open `http://localhost:4173` and keep the terminal running. Check any existing process if the port is already in use.

Use **EN** to switch the interface to English. Enter a directly held V3 position ID, or enter a public holder address on the USDC vault page. To recover an existing vault transaction, import a [recovery record](evidence/published-f8771a8/recovery-task.json), then select **Verify vault redemption**. The application rechecks the chain; importing or reloading does not resend a redemption.

Network RPC access and a functioning chain are still required. Production signing remains disabled and independent review is pending. The old `v0.3.0-readonly` release contains historical `2597f66` artifacts; do not mix them with this bundle. Later source and demo updates do not automatically update this pinned package.
