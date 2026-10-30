<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/tapeexit-wordmark-dark.png" />
    <img src="docs/brand/tapeexit-wordmark.png" alt="TapeExit" width="320" />
  </picture>
</p>

# TapeExit

**原平台打不开时，给你的链上资产留一条退出路径。**

TapeExit 基于 **TapeOut 协议**构建，目标是成为 **X Layer 的 DeFi 资产应急出口**，逐步覆盖流动性池、质押、收益金库和借贷平台。

**当前源码已有两类适配：Uniswap V3 流动性仓位，以及 Spark Savings USDC 金库。** 前者读取仓位 NFT，后者读取 spUSDC 份额；两者各自预览退出、核对到账并保留恢复路径。

**公网 TapeOut 入口目前仍是 `0.3.0-2597f66`，只包含 V3。** 新增金库模块先在新版源码、Demo 和本地应用中提供，完成单独的链上发布后才会出现在这两个公网入口。

**TapeOut 保留链上应用入口，TapeExit 提供退出与恢复流程。** 应用文件发布在 X Layer 的 TapeOut 容器中，资产继续由原有钱包和协议合约管理，TapeExit 不接管资金。

[**在线演示 · 无需钱包**](https://wangyangmingsss.github.io/tapeexit/) · [主网只读入口](https://2-2-289.netlify.app/) · [备用入口](https://2-2-289.vercel.app/) · [下载新版恢复包](https://github.com/wangyangmingsss/tapeexit/releases/tag/v0.3.0-readonly) · [详细文档](#文档导航)

首次体验可先打开在线演示：资产总览 → 打开模拟仓位 `28491` → 读取 → 选择比例 → 预演并确认模拟退出。“恢复入口”展示 TapeOut 版本和备用路径；“故障演练”展示异常处理。演示使用测试资产，不发送真实交易。

> **当前公开版本为只读版，生产交易签名关闭。** 可以查看仓位、核对已有交易和使用恢复入口。演示模式使用模拟数据；真实退出曾在单独的受限测试中完成。完整钱包验收与独立安全审阅的证据状态见[实施状态](docs/IMPLEMENTATION-STATUS.md)。

## 它解决什么问题

资产存入 DeFi 协议后，如果原来的交易网站打不开，仓位和资产可能仍然在链上，但你失去了熟悉的操作页面。

TapeExit 为这种情况准备了三个入口：

| 入口 | 使用方式 |
| --- | --- |
| 在线入口 | 通过 TapeOut 网关访问链上发布的应用 |
| 备用入口 | 主入口不可用时，换一个网关读取同一容器 |
| 本地恢复包 | 提前下载，在自己的电脑上运行 |

本地恢复包仍然需要联网读取区块链，不是离线转账工具。

## 为什么结合 TapeOut

应急工具本身也需要一个能找回的入口。TapeExit 使用 TapeOut，把应用文件放进链上容器，让多个网关能够读取同一份已发布内容；本地恢复包则提供另一种运行方式。

| 组成 | 负责什么 |
| --- | --- |
| **TapeOut** | 承载应用文件，提供链上名称、容器与网关读取机制 |
| **TapeExit** | 读取资产、适配退出规则、展示预览并核对交易结果 |
| **用户钱包与原协议合约** | 由用户确认交易，按协议规则处理资产 |

各部分的关系：

```mermaid
flowchart TD
  T["TapeOut 链上容器"] --> G["在线 / 备用网关"]
  G --> A["TapeExit"]
  A --> R["公共 RPC：读取仓位与核验结果"]
  A --> W["可签名版本：用户钱包确认"]
  W --> P["原 DeFi 协议合约"]
```

TapeOut 保存的是应用文件。它不托管用户资金，也不替原 DeFi 协议执行赎回。未来接入的协议模块，也会随 TapeExit 的具体版本构建、校验和发布，而不是临时加载未核验的第三方代码。

**已有真实集成：** `0.3.0-2597f66` 已发布至 `2.2.289.tape`，容器已激活，12 个文件逐字节回读通过，两个公网网关的桌面、手机访问及主入口故障时的已有交易恢复检查均通过。发布身份、文件摘要和记录见[链上发行证据](docs/evidence/published-2597f66/README.md)。

容器内容可以更新，所以每次发行需要保留对应版本的文件摘要并重新核对。访问仍依赖可用的网关或本地入口、容器状态、RPC 和链；链上发布不等于永久可用。

## 可以做什么

- **查看仓位**：读取币对、流动性和钱包所有权。
- **资产总览**：按页展示已接入的 V3 仓位、币对及状态；保留手动输入编号。读取失败不会当作余额为零。
- **预览退出**：计算部分退出、全部退出或仅领取的结果，展示待核对的交易内容。
- **核对到账**：根据交易哈希，检查链上交易、领取记录和剩余流动性。
- **恢复查询**：导出公开的交易恢复文件，在其他入口导入后重新核验；新版源码支持刷新后恢复查询信息。
- **USDC 金库**：按公开地址读取 Spark spUSDC 份额、资产折算与赎回上限，预演按比例赎回，并核验已有直接赎回交易的 USDC 到账和份额销毁。见[金库说明](docs/SPARK-USDC-VAULT.md)。

V3 退出计划只调用原仓位管理合约；金库计划只调用指定 Spark 金库。接收地址固定为用户本人。应用不申请新授权、不托管资产、不转移仓位 NFT，也不进行代币兑换。

**适用范围：** X Layer 主网的自持 Uniswap V3 仓位，以及指定 Spark USDC 金库的自持份额。V3 NFT 已存入农场或其他托管合约的情况仍不在范围内。金库模块保持只读，不提供主网交易签名。

## 未来方向

V3 是起点。我们希望用户以后只需要：**连接钱包 → 查看已接入协议的资产 → 按协议规则退出 → 核对到账**。

| 模块 | 当前进度 | 后续目标 |
| --- | --- | --- |
| Uniswap V3 | 已有实现；公开版只读 | 沿用现有仓位、退出预览与恢复能力 |
| TapeOut 链上入口 | 已完成一次实际发布与双网关检查 | 后续协议模块随应用版本发布并重新核验 |
| 多协议适配接口 | V3 与 Spark 金库均已实现 | 复用固定区块读取与退出模拟边界，保留各协议的核验规则 |
| V2 类流动性池 | 规划中 | 按 LP 份额移除流动性 |
| 质押与收益农场 | 规划中 | 解除质押、提取本金、领取奖励 |
| Spark Savings USDC 金库 | 新版源码已接入读取、预览及交易恢复；尚未发布到 TapeOut | 完成该版本的链上发行；生产签名单独评估 |
| 借贷平台 | 规划中 | 核对存款与债务，按协议条件提取资产 |
| 需要等待的赎回产品 | 规划中 | 申请退出、跟踪等待进度、到期领取 |

每个平台需要单独核对合约和退出规则，逐个接入。**上表中的规划项尚未支持，也不表示已覆盖 X Layer 全部平台。** 应急入口不能绕过协议锁定期、暂停或偿付条件。

开发者可从 [ProtocolAdapter 接口](src/core/protocol-adapter.ts)和[扩展说明](docs/PROTOCOL-ADAPTERS.md)了解两个实际实现。当前按明确登记的协议接入，尚无自动发现全部协议或加载第三方插件的功能。

## 先体验，再看代码

### 在线演示

打开 [Demo 网站](https://wangyangmingsss.github.io/tapeexit/)，无需安装或连接钱包，即可体验仓位读取、退出预览、模拟确认与故障演练。
新版 Demo 增加“USDC 金库”：读取模拟份额 → 选择比例 → 预演赎回。模拟份额不是你的主网余额。

### 在线查看

1. 打开[在线入口](https://2-2-289.netlify.app/)。
2. 按页面提示选择钱包，输入自己的仓位编号（Token ID）。
3. 查看仓位信息；已有交易可以通过恢复入口核验。

在线与备用入口已更新为 `0.3.0-2597f66`，对应同一发行版本的恢复包。Demo 属于 `0.3.0` 系列，随源码更新；仓库中的后续改进仍需单独发布，才会出现在 TapeOut 公网入口。每份构建都有完整提交与版本标识，见[版本与交付](docs/RELEASE-CHANNELS.md)。

### 本地演示

需要 **Node.js 22.12 或更新版本**，以及 Git。

```sh
git clone https://github.com/wangyangmingsss/tapeexit.git
cd tapeexit
npm ci
npm run dev:demo
```

打开 **http://127.0.0.1:4174**。演示不连接钱包、不发送真实交易，可以先熟悉仓位、退出预览和恢复流程。

### 本地主网只读界面

在项目目录运行：

```sh
npm run dev
```

打开终端显示的本地地址，查询自己直接持有的真实仓位。生产签名仍保持关闭。

## 已有的实际验证

| 项目 | 已有记录 |
| --- | --- |
| 链上发布 | `0.3.0-2597f66` 的 34 笔更新交易全部确认；12 个文件、620917 字节回读通过，容器已激活 |
| 双网关访问 | 新版桌面、移动视图共 48 次文件检查通过；主入口阻断后，备用入口的已有交易恢复检查通过 |
| 小额真实退出 | USDt0 / USDC 仓位完成过一次受限退出，到账与剩余流动性已核对 |
| 自动化测试 | 包含核心计算、交易核验、恢复流程及 Chromium / Firefox / WebKit 浏览器测试 |

实际记录见[发行证据](docs/evidence/published-2597f66/README.md)、[公网网关验收](docs/public-gateway-acceptance.md)和[小额退出测试](docs/CONTROLLED-TEST-67042.md)。不同版本的测试结果分别记录，自动化测试不替代独立安全审阅。

## 开发与检查

常用命令：

```sh
npm run typecheck       # 检查类型
npm test               # 运行单元与集成测试
npm run build          # 构建应用和本地恢复包
npm run check:release  # 检查构建产物
```

运行浏览器测试前，先安装浏览器并完成构建：

```sh
npx playwright install chromium firefox webkit
npm run build
npm run build:demo
npm run test:e2e
```

部分测试需要本地 EVM；浏览器测试需要系统允许启动浏览器。环境受限时，查看对应提交的 [GitHub Actions](https://github.com/wangyangmingsss/tapeexit/actions) 结果。

构建后，`dist/` 是静态应用，`recovery/` 是本地恢复包。恢复包的摘要校验、启动和发布步骤见[发行操作手册](docs/OPERATIONS.md)。

## 文档导航

| 想了解什么 | 从这里开始 |
| --- | --- |
| 项目思路与参赛介绍 | [项目说明](docs/competition/PROJECT.md) |
| 已实现内容、版本与实际证据状态 | [实施状态](docs/IMPLEMENTATION-STATUS.md) |
| 多协议扩展接口与后续方向 | [协议适配说明](docs/PROTOCOL-ADAPTERS.md) |
| TapeOut 实际集成与发布身份 | [链上发行证据](docs/evidence/published-2597f66/README.md) |
| 退出后如何核对、刷新和恢复查询 | [交易恢复流程](docs/EXIT-RECOVERY-WORKFLOW.md) |
| 网关、本地恢复包和开发工具 | [发行操作手册](docs/OPERATIONS.md) |
| Demo、恢复包与链上版如何对应 | [版本与交付](docs/RELEASE-CHANNELS.md) |
| 如何发布到 TapeOut | [链上发布手册](docs/PUBLISHING.md) |
| 风险、信任边界与依赖 | [威胁模型](docs/THREAT-MODEL.md) · [依赖审查](docs/DEPENDENCY-REVIEW.md) |
| 独立安全审阅需要哪些资料 | [审阅交接](docs/SECURITY-REVIEW-PACKET.md) |

## 代码结构

```text
src/              应用界面与核心逻辑
src/core/         链上读取、钱包连接、交易核验与恢复
src/demo/         独立的模拟演示
tools/            构建、发布、网关和验证工具
tests/            单元、集成与浏览器测试
docs/             操作手册、设计说明与证据
```

## 许可证

[MIT](LICENSE)。补充许可文本见 [docs/licenses/](docs/licenses/)，构建产物另附第三方许可清单。
