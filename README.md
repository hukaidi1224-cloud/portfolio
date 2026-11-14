# 作品集

## 编号总览

**现役（6）**：G003 / G006 / G009 / G013 / G014 / G015
**SHELVED（9）**：G001 / G002 / G004 / G005 / G007 / G008 / G010 / G011 / G012

> **G 编号作品的标题与否决/搁置理由在 `capability/codex-game-pipeline/README.md`**（产线教训台账，按日期逐条记「试玩否决 → SHELVED」及源码级根因），单件工单与复盘在同目录 `specs/G0XX-*.md`（如 `G012-postmortem.md`、`G011-playtest2-notes.md`）。**`structured/game-design/` 里没有 G 编号条目**——它放的是不走该产线的手写单文件项目（一笔画塔防 / 余埠）与方法论。本表**只维护「现役 / 搁置」的取舍状态**，不复制内容。（2026-11-01 月度体检改正：此行原写「见 `structured/game-design/` 下对应目录」，对 G 编号作品不成立。）
> **台账缺口**：**G004《字》只有 TASKS.md 一行「实现风险大，视产线成熟度决定」，无任务书、无展开文档**（`specs/` 里没有 G004 文件），且 TASKS.md 本体已进归档包 `structured/archive/codex-game-pipeline-20261018.tar.gz`。「实现风险」具体指什么在库里无处可查——要重估须先重做一轮可行性分析。
> **SHELVED ≠ 废弃**：搁置理由会随时间过期。月度体检每月检查一次「当初否决的理由是否仍成立」。最近一次＝2026-11-01（结论见 `structured/notes/2026-11-体系体检.md`）：9 件中 6 件「仍成立」、2 件「已被吸收」（G001→G003、G010→一笔画塔防）、**1 件「前提已变，可重估」＝G004**（否决理由是产线能力而非设计缺陷，而 codex 工单产线已于 10-17 冻结、单体产线已验证 30–40 分钟交付）。
> **G002（灯灭之后）** 2026-10-23 移出作品集首页并转入 SHELVED，理由：创新点不足（`game-g002-design.html` 仍在部署副本内，只是不再陈列）。
> **《方言》** 2026-11-09 移出作品集首页、不再陈列：`dialect.html` 与 `dialect-design.html` 从部署树移入 `structured/game-design/dialect/` 归档。**这两份是该作品的唯一副本**（无源码仓、无异地备份），勿删。
> **首页陈列（2026-11-12 改版，11-14 加组）**：原「游戏策划案」与「试玩 Demo」合并为「游戏作品」，按设计方向分组：战斗设计 / 系统与数值 / 任务与关卡 / AI 与规则 / 玩法机制 / 互动叙事（置底）。组内可玩在前、纯文档在后；旧锚点 `#games`、`#demos` 保留。方向索引与卡片标签约定：品类用中性 chip，状态用 `在线试玩` / `Windows 下载` / `仅文档` / `开发中`。
> **11-14 二次改版（已发布 `262aeca`）**：删除「短篇小说」组，并把 `files/短篇小说/` 用 rsync exclude 移出部署树（`capability/github-mcp/publish.sh`；真相源 `portfolio/files/短篇小说/` 868K 不动，线上直接 URL 已 404）；新增「游戏拆解」组 `#analysis`，位置在「游戏作品」之后、「内容创作」之前；顶部统计第三格由「13+ 短篇小说」改为「2+ 游戏拆解」。拆解图纸从飞书画板导出为 **SVG 矢量图**（`files/analysis/img/`），说明页按原始比例显示、图框内拖动滚动——画板字号为 14 单位，缩放进容器会让文字糊到 3.6px，**不要改成 `width:100%`**。同时修复 `files/combat-model/design.html` 的两处返回链接（`../index.html` → `../../index.html`，原为 404）。
> **街霸 6 战斗系统拆解已入册（11-14）**：`files/analysis/street-fighter-6.html` + 两张画板 SVG（`sf6-loop.svg` 1344×936、`sf6-resources.svg` 983×690），置于 `#analysis` 组首位。四层框架与循环图口径见 `structured/game-design/sf6-combat/街霸6-战斗系统拆解.md`；**页面收录 26 条边表全列**，§4.5 的可复用检查表与向自己项目的迁移**不外发**。表格样式沿用 `combat-model/design.html` 的 `.table-wrap`＋`min-width:0` 移动端口径。
> **死亡细胞拆解已撤下（11-14）**：该画板标题为「死亡细胞拆解案例 副本HKD」，分支结构与 `structured/game-design-course/上学期/上学期14_死亡细胞拆解_笔记.md` 记录的课程案例重合，**署名归属无法确认**，说明页与 SVG 已删除，不再陈列。作品集里的拆解只放能确认是自己做的东西。
> **拆解组的下一件**：街霸6 战斗系统（战斗循环／帧级动作／斗气资源／博弈链），推演与对照的口径见 `structured/game-design/sf6-combat/PLAN.md`；影之刃零另做单任务细拆，不套用本框架。
> **灰烬之王 · 类魂战斗模型** 2026-11-14 入册，居新增的「战斗设计」组首位：`files/combat-model/` 是 `projects/combat-model/`（v0.33）的发布固化副本（`index.html` + `src/*.js`，文件级相对引用），**不随本体改版自动跟进**；设计说明 `files/combat-model/design.html` 写六个对手的推导与迭代，不进冻结规则。
> **一笔画塔防** 2026-11-09 挂进首页，标注「开发中」（核心作品），现居「系统与数值」组首位。`files/one-stroke-td.html` ＝ `structured/game-design/versions/one-stroke-tower-defense-v6.8.2.html` 的逐字节副本，**这份副本是 v6.8.2 的发布固化，不随游戏本体改版自动跟进**（凯迪 11-09 定）；要更新线上版本只在凯迪主动提出时重新复制一遍。
> **谈薪模拟器** 2026-11-12 入册：`files/salary-battle.html` ＝ `projects/salary-battle/index.html` v3.0 的逐字节副本，**冻结规则同一笔画塔防，本体改版不自动跟进**。设计说明＝`files/salary-battle-design.html`，截图在 `files/salary-battle-shots/`；原 `劳资拉扯模拟器.pdf` 作为 2026-05 原始概念稿保留。
> **看海的猫** 2026-11-12 补开发存档试玩视频：https://www.bilibili.com/video/BV1LR4M6QERR/
> **G 编号只发给走 `codex-game-pipeline` 产线的项目。** 手写单文件 Demo 不进此表、不占编号（夜班电台 / 方言 / 心跳 / 声音回路 / 灯声回路 / 余埠 / 一笔画塔防）——给它们补编号只会让台账更假。

## 立项与验收教训

**规格全绿 ≠ 好玩。** 工单前三问：

1. 核心动作是**选择**还是操作？
2. 风险收益是否**同动作绑定**？
3. 去掉核心机制还剩什么动机？

已固化的立项标准见 `structured/game-design/` 的 ideas/ v3/v4：压迫感驱动 / 定价式暴露 / 层级可辨性。

## 部署

真相源 `portfolio/` → 部署副本 `portfolio-site/` → `capability/github-mcp/publish.sh`
GitHub Pages：`hukaidi1224-cloud.github.io/portfolio/`（主力渠道）
