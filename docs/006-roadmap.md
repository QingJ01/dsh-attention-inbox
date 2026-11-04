# 006 路线图

## 先验证：技术 spike

前面几篇里标为"待验证"的点都集中在这里。每个 spike 要给出明确结论，并附上最小可运行的证据。结论如果是否定的，就按"退路"一栏调整设计。

| # | 要验证什么 | 为什么重要 | 退路 |
|---|---|---|---|
| S0 | 第三方 bundle 如何声明 Host 的 Remote 方法，以及 Client 怎样调用（参考 `cordis-plugin-development` 中的 `user-actions.md`） | 收件箱页面和 Host 服务之间的通道 | 用 `webServer.register` 注册一个本地 HTTP 路由 |
| S1 | 对**没有在主视图打开**的 Session，Client 的 `uiSession.sessionStatus` 里是否也有 `PendingApproval` 对象；在收件箱里调用 `answer()` 后，原生 composer 状态是否一致 | 审批能否在原地处理 | 审批只提供"打开 Session"，并把这个能力列为向 DSH 提交的需求 |
| S2 | 能否安全地直接回答阻塞中的问题（不经过原生卡片），以及批准计划的正确调用方式 | 提问和计划能否完全在收件箱里处理 | 保持 `reveal` / `review` 打开原生卡片 |
| S3 | Host 侧能否用 `sessionProjections.stateOf(session, 'userQuestions')` 读取 DSH 自带的问题投影；冷 Session 能否通过 `session-projection-cache` 读到本插件投影的 wire 值 | 复用已有投影，满足单一事实来源 | 本插件自己从 `tool/call` / `tool/result` / `user/message` 推导问题 |
| S4 | `user/message` 上 goal、schedule、队友消息、后台任务唤醒的 source 形态；`turn/end` 中 `aborted` 和 `interrupted` 的确切含义 | `review` 和 `turn-failed` 的判定 | 区分不了的情况标为 `certainty: 'inferred'`，并默认不产生 `review` |
| S5 | Client 如何跳转到指定 Session（以及某一轮、某个工具调用），以及能否往 composer 里预填文字 | "打开"动作的准确程度 | 只跳到 Session |
| S6 | 第三方 bundle 能否以自己的名字打开 `storageDomain`、数据存在哪里、卸载时怎么清理 | 自有数据的存储 | 存到 `DSH_PROFILE_DIR` 下的插件目录（需要确认是否允许） |
| S7 | 从 npm 或插件市场安装后，不做任何配置是否就能生效（Host 行插入、Client 模块加载、双语资源、图标） | 上手成本为零 | 把需要的步骤压缩到安装后的一步引导里（`plugins.bundle.activation` 插槽） |

## 里程碑

每个里程碑都要有可以检查的验收标准，并且做完就能装上自己用。

### M0：spike（S0–S7）

**验收**：每个 spike 有结论和证据，并且据此更新了 002、003 两篇。

### M1：只读收件箱

- Host：`attention` 服务、投影、漏斗和排序（纯函数）、内置来源 `approval`、`question`、`plan-review`、`goal-blocked`。
- Client：侧栏入口和徽标、页面，动作只有"打开"。
- **验收**：
  - 任何时刻，原生侧栏上显示 pendingInteraction 的每一个 Session 都出现在收件箱里（开发模式下有一个自检计数器，必须一直是 0）；
  - 徽标数等于列表中 `system` + `hard` 的条目数；
  - 不新增任何模型可见的工具或 prompt（用 `Tool.listTools` 和 system prompt 对比装插件前后的差异来验证）。

### M2：原地处理和账本

- 审批允许一次 / 拒绝，回答 continued 问题，`reveal` / `review` 原生卡片，忽略和稍后提醒。
- 账本：写入、页脚统计。
- **验收**：硬阻塞类型的原地处理率 ≥ 80%（在 S1、S2 结论允许的范围内）；动作失败时条目显示错误，不会被误判为已处理。

### M3：软义务、漏斗、回填

- `turn-failed`、`review`、`credential`；L1 丢弃计数；冷启动回填；静音规则；设置页。
- **验收**：用一份录制下来的真实 Session 日志集合回放，`review` 条目数不超过"自主运行轮次数"；冷启动后，回填的条目和实时推导的结果一致。

### M4：公开 API 定稿 → v1.0

- 导出类型包；[004](004-extension-api.md) 中的契约检查（拒绝无效提交、数量预算）；示例插件 `examples/hello-producer`（50 行以内，演示 `raise`、`withdraw` 和一个动作）。
- 双语资源、图标、README；发布到 npm，提交到插件市场索引。
- **验收**：一台全新的 DSH 从插件市场安装后不做任何配置，60 秒内在收件箱里看到一个真实的义务；卸载后 Session 和 preset 都没有任何变化。

### v1.1

- 异步提问开关（D4）：一键把 `tool-ask-user` 切到 `mode: timed`，开启前说明后果，可以随时关闭。
- **权限规则提议**：同一个工具 / 命令模式被允许 N 次后，提议生成一条权限规则，人确认后才生效（P6：先立边界，再放权）。
- 第一个官方 Channel：桌面系统通知，只推 `system` 和 `hard`，并且要满足"连续 2 分钟没有处理"。

## 度量

全部从账本计算，只存在本地，不上报。

| 指标 | 定义 | v1 目标 |
|---|---|---|
| 覆盖缺口 | 原生侧栏显示 pendingInteraction 但收件箱里没有的 Session 数 | 始终为 0 |
| 硬阻塞响应时长 | `hard` 义务从出现到 `acted` 的中位时长 | 自己用一周后，明显低于装插件之前（用前一周的审批日志估算基线） |
| 噪音率 | `dismissed` 的义务 / 所有关闭的义务 | < 20% |
| 降噪比 | L1、L2 丢弃的事件 / (丢弃的 + 显示的) | 只观察，不设目标；用于页脚的"已替你挡掉" |
| 原地处理率 | 在收件箱中 `acted` 的 / 所有 `acted` 的 | `hard` 类型 ≥ 80% |

噪音率持续偏高的类型或来源，在设置页里以"这个来源经常被忽略"的形式提示一次，建议去改规则，而不是加过滤器。

## 配套插件规划：用 DSH 拼出 superagent

依赖方向始终是**配套插件 → 收件箱**（可选依赖），收件箱不依赖任何配套插件。下表按建议的开发顺序排列。

| 顺序 | 插件 | 对应原型 / 文章 | 和收件箱的关系 | 用到的 DSH 能力 |
|---|---|---|---|---|
| 1 | **attention-channel-***（桌面通知、飞书、邮件） | Channel、Outbox | `registerChannel`；在 IM 里回复会调用 `act`，处理义务 | 系统通知、飞书机器人 |
| 2 | **work-item**（backlog、goal、priority） | Ticket、Mandate、Report、文章的 work item / goal / priority | 主体类型 `work-item`；原型的 `ticketStage()` 直接变成推导型来源；budget 和 deadline 进入义务的 `deadline` | `goals`、`worktrees`、`sessions`、`schedule` |
| 3 | **executor**（每个 work item 对应一个 Session 和工作目录） | Executor、Assignment、worker preset | Report（ready、blocked、failed）由 work-item 插件转成义务 | agent preset、`worktrees`、`jobs` |
| 4 | **source-github** / **source-feishu** | Source、Trigger、Thread、Eval | Eval 结果为 unavailable 时提交义务（原型 002 的 24 小时规则）；主体类型 `thread` | `webhookRuntime`、凭据 |
| 5 | **policy / capability** | Policy、准入、文章 P6 | 接收收件箱的权限规则提议；授权变更作为义务给人确认 | `permissionPresets`、`approval` |
| 6 | **superagent preset** | router / worker preset | 只做组合，不加新的概念 | Cordis 组合 |

这样拼起来的每一步都能单独交付价值：只装收件箱，你能在一个地方管理所有 Session；加上 Channel，出门在外也能处理；加上 work-item 和 executor，就有了 backlog 和派工；再加上 Source，就是原型里那个"主动式编码 agent"。

## 风险

| 风险 | 缓解 |
|---|---|
| 依赖 Client 的半公开对象（`PendingApproval`、`userQuestionPanels`），DSH 升级后可能变化 | 所有使用点集中在 `client/actions.ts`；能力检测失败时自动退回"打开 Session"；把这些对象需要稳定化列为向 DSH 提的需求 |
| DSH 升级改变事件形态 | 投影用 `stateVersion`；用录制的真实日志做回放测试，在 CI 里覆盖多个 DSH 版本 |
| `review` 类型太吵 | 条件最严（[002](002-builtin-producers.md)）；可以整体关闭；作为噪音率的重点观察对象 |
| Session 很多时冷启动慢 | 回填限定 7 天，限制并发，优先读检查点；回填过程中页面显示"正在汇总……"，并不阻塞已经推导出的实时义务 |
| 和原生侧栏的状态不一致 | 两边读同一个 `uiSession.sessionStatus`；保留自检计数器 |

## 还需要你决定

1. **包名和 scope**：暂定 `dsh-attention-inbox`；如果要发布到 npm 和插件市场，需要确定 scope。
2. **分发方式**：只走 npm 加本地 `install_bundle`，还是同时提交到插件市场索引？后者才能真正做到"很多用户直接装"。
3. **M0 的 spike 是否可以直接开始**：S0、S1、S3 决定了 v1 的上限，建议最先做。
