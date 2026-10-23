# 作品集

## 编号总览

**现役（6）**：G003 / G006 / G009 / G013 / G014 / G015
**SHELVED（9）**：G001 / G002 / G004 / G005 / G007 / G008 / G010 / G011 / G012

> 各作品的标题、玩法、文档位置见 `structured/game-design/` 下对应目录；本表**只维护「现役 / 搁置」的取舍状态**，不复制内容。
> **SHELVED ≠ 废弃**：搁置理由会随时间过期。月度体检每月检查一次「当初否决的理由是否仍成立」。
> **G002（灯灭之后）** 2026-10-23 移出作品集首页并转入 SHELVED，理由：创新点不足（`game-g002-design.html` 仍在部署副本内，只是不再陈列）。
> **G 编号只发给走 `codex-game-pipeline` 产线的项目。** 手写单文件 Demo 不进此表、不占编号（夜班电台 / 方言 / 心跳 / 声音回路 / 灯声回路 / 余埠）——给它们补编号只会让台账更假。

## 立项与验收教训

**规格全绿 ≠ 好玩。** 工单前三问：

1. 核心动作是**选择**还是操作？
2. 风险收益是否**同动作绑定**？
3. 去掉核心机制还剩什么动机？

已固化的立项标准见 `structured/game-design/` 的 ideas/ v3/v4：压迫感驱动 / 定价式暴露 / 层级可辨性。

## 部署

真相源 `portfolio/` → 部署副本 `portfolio-site/` → `capability/github-mcp/publish.sh`
GitHub Pages：`hukaidi1224-cloud.github.io/portfolio/`（主力渠道）
