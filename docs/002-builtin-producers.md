# 002 内置义务来源

本篇列出 v1 从**现有 DSH 事实**推导出的义务：每种类型由什么事实打开、由什么事实关闭、在收件箱里能怎么处理，以及依据。不依赖任何其他插件，也不要求 agent 配合。

依据按证据层次标注：**源码/契约已核实**只表示在 DSH 0.2.1-rc.5 的编译产物、README 或 Inspect 中确认；**真实录制/运行时已核实**另有可回放日志或原生 runtime 运行记录；**真实 GUI 待验收**仍须实际交互。完整原标准与证据缺口以 [008 验收表](008-acceptance.md) 为准，不能将前两者视为第三者通过。

## M0 结论索引（S0–S7）

| Spike | 当前已验证的结论及其边界 |
|---|---|
| S0 | 已有 `connection.fetch.register` Host 路由与 Client 调用的受控集成证据；第三方自定义 Remote 反射通道不作为已通过结论。实际传输选择及剩余 GUI 验证见 [003](003-architecture.md) 与 [008](008-acceptance.md)。 |
| S1 | 源码和注入测试确认 PendingApproval.answer 接口；“未在主视图打开”的真实审批对象与 composer 一致性仍待 GUI 验收。 |
| S2 | 原地作答复用原生 PendingQuestion.answer/engage，计划批准使用原生 intent.approve；受控失败保留测试通过，真实 open/continued/计时/多选/计划交互仍待验收。 |
| S3 | 真实 ProjectionRegistry 能冷恢复本插件 wire 并与实时增量一致；原生 userQuestions 的冷 Session cache 回读仍缺独立真实证据。 |
| S4 | 授权真实结构录制出现 user、agent-message、subagent-settled，受控原生 goal driver 出现 goal；schedule/tool-jobs 及 aborted/interrupted 仍只有源码或待补录制。匿名化与 hash 见 [008](008-acceptance.md)。 |
| S5 | 使用现有 Client Session 打开能力并可退回仅打开；指定轮次/调用和 composer 预填的真实 GUI 证据未齐，不能宣称已验证。 |
| S6 | `attention_inbox` 自有 domain 的 schema、事务失败和关闭已通过 runtime/受控测试；真实 profile 路径及卸载前后 Session/preset 无改动由 lead 验收。 |
| S7 | 当前 profile 的既往安装/Slot 记录不能替代全新 DSH 零配置市集安装；双语/图标真实展示及 60 秒义务标准仍按 [008](008-acceptance.md) 保留。 |

## 可用的事实

| 事实 | 位置 | 说明 | 依据 |
|---|---|---|---|
| `approval/asked`、`approval/decided` | Session 日志（仅日志，模型不可见） | 每次审批请求和结果都会记两条 | 已核实：`dsh-user-approval` README |
| `tool/call`、`tool/result` | Session 日志 | `ask_user_question`、`exit_plan_mode` 的调用和结果 | 已核实：`dsh-session` 事件类型表 |
| `userQuestions` 投影 | `sessionProjections` | DSH 已经从日志里推导出 open、continued、settled 三种状态的问题，不另存状态 | 已核实：`dsh-user-questions` README（Runtime invariant） |
| `goal/change` | Session 日志 | 每次变化都携带完整快照：`active | paused | blocked | complete`，受阻时带原因 | 已核实：`dsh-goal` README |
| `user/message` 的 source | Session 日志 | goal 续轮带 `GoalMessageSource`；后续作答是 `answer_to_pending_question` 类型的消息 | 已核实：`dsh-goal`、`dsh-tool-ask-user` README。schedule 和队友消息的 source 形态待验证 |
| `turn/end.reason.kind` | Session 日志 | `completed | interrupted | max-tokens | error | aborted` | 已核实（编译产物）；每个值的确切语义待验证 |
| `uiSession.sessionStatus` | Client | 每个 Session 的 `running`、`pendingInteraction`、`completionUnread`；原生侧栏读的就是它 | 已核实：`dsh-client-ui-session` 编译产物 |
| `PendingApproval.answer(outcome)` | Client 的 pendingInteraction 对象 | `kind: 'approval'`；`answer('allowed-once' | 'rejected')` 把结果交还给 Host 等待中的审批 | 已核实（编译产物）；属于半公开形态，见 spike S1 |
| `userQuestions.answer(agent, callId, answer)` | Host `@Remote` | 回答 continued 状态的问题；如果 Session 已关闭，先恢复它的根 agent | 已核实：`dsh-user-questions` README |
| `userQuestionPanels.reveal(sessionId, callId)` | Client `ctx.reflect` | 打开指定提问卡片 | 已核实（编译产物） |
| `deepseek-account/model-sign-in-required`、`deepseek-account/session-expired`、`authorization/settled` | Host 事件 | 账户和凭据状态 | 已核实：Event 目录 |

## 各类型的推导规则

### `approval`：审批（hard）

- **打开**：日志里有 `approval/asked`，同一个请求还没有 `approval/decided`，并且所在的轮次仍然打开。
- **关闭**：`approval/decided` 写入（`acted`，如果是在收件箱里处理的，否则 `withdrawn`），或者轮次结束（`withdrawn`）。
- **原地处理**：Client 在 `uiSession.sessionStatus` 里找到该 Session 的 `pendingInteraction`，满足 `kind === 'approval'` 且 `answerable` 时，调用 `answer('allowed-once')` 或 `answer('rejected')`。找不到的话（例如审批由 ACP 等其他应答方处理），只提供"打开 Session"。
- **重启**：DSH 审批只在打开的轮次内有效（`dsh-user-approval` README 的已知限制），进程重启后不会再有待审批，收件箱也不显示（P2 诚实）。
- **内容**：工具名、`displayReason` 或 `reason`、对应的工具调用（如果有 callId 就提供跳转）。

### `question`：提问（hard）

- **打开**：`userQuestions` 投影里有状态为 open（工具调用仍在等待）或 continued（定时提问超时后转为待回答）的问题，并且不是 plan-review。
- **关闭**：投影中变为 settled。
- **原地处理**：
  - continued：在收件箱里渲染选项，直接调用 Host 的 `userQuestions.answer`，Session 关闭时也能回答。
  - open（阻塞中）：调用 `userQuestionPanels.reveal(sessionId, callId)` 打开原生提问卡片。v1 不自己复刻提问表单，避免和原生的草稿、倒计时、占用逻辑冲突（spike S2 会验证能否安全地直接作答）。
- **合并**：同一次调用里的多个问题合并成一个条目。

### `plan-review`：计划审批（hard）

- 规则和 `question` 一样，判别条件是 intent `plan-review`（`exit_plan_mode` 会设置）。
- **原地处理**：显示计划摘要（`detail` 的前几行），提供"批准"（使用 intent 中 `approve` 指定的选项）和"打开完整计划"（`userQuestionPanels.review`）。返回修改意见需要输入较长文字，跳转到 Session 里完成。

### `goal-blocked`：goal 受阻（soft）

- **打开**：最新的 `goal/change` 快照里 phase 是 `blocked`。
- **关闭**：phase 变成其他值，或者 goal 被清除。
- **内容**：goal 的目标、受阻原因（DSH 保存的人类可读说明）、已经跑了多少轮 / 上限。
- **处理**：打开 Session。恢复 goal 需要人在 Session 里直接发起（`update_goal` 的 resume 要求人的直接请求），所以 v1 只提供"打开并在输入框预填‘继续’"（spike S5），不代替人发出指令。

### `review`：自主运行的产出待验收（soft）

这是最容易变吵的类型，所以条件最严：

- **打开**（同时满足）：
  1. `turn/end.reason.kind === 'completed'`；
  2. 这一轮**不是由人刚发的消息触发的**：触发它的 `user/message` 来自 goal 续轮、schedule、队友消息，或者后台任务、子代理完成后的唤醒；
  3. 这一轮结束时，该 Session 没有在任何已连接的浏览器的主视图里打开。
- goal 进入 `complete` 不能单独绕过上述自主轮次条件。若该完成属于已证自主完成轮，与该轮共用同一 review key；人工完成 goal 不额外产生 review。真实录制曾暴露人工完成产生 1 review / 0 自主轮的失败，修复后同一 hash 重跑通过，见 [008](008-acceptance.md)。
- **关闭**：人打开该 Session（记为 `acted`）、向它发消息，或者它又开始了新一轮。
- **和原生的关系**：原生的 `completionUnread` 只存在浏览器本地，范围是所有结束的轮次；本类型存在 Host 上，只针对自主运行。这样重启和换设备后都还在，也避免了"每轮结束都提醒"。
- `certainty: 'inferred'`：轮次来源的判定依赖 `user/message` 的 source 形态（spike S4）。

### `turn-failed`：轮次失败（soft）

- **打开**：
  - `turn/end.reason.kind === 'error'`，此时 DSH 的模型重试（`dsh-llm-retry`）已经用尽；或
  - `'max-tokens'`，并且之后没有新的一轮；或
  - `'interrupted'` 且原因是进程关闭或崩溃，之后没有恢复。
- **不打开**：`'aborted'`。原生 agent-loop 在识别到取消原因时记录此值，原因也可能来自 parent/hook/disposed，不能一概解释为“人按停止”；`interrupted` 可由崩溃恢复为未闭合轮次补出的结束事件。此结论来自源码，真实录制尚未覆盖这两类，见 [008](008-acceptance.md)。
- **关闭**：同一个 Session 开始新的一轮。
- **处理**：打开 Session；显示最后的错误信息。

### `credential`：凭据失效（system）

- **打开**：Host 事件 `deepseek-account/model-sign-in-required` 或 `deepseek-account/session-expired`。主体是 `system:account`。
- **关闭**：账户状态恢复（`deepseek-account` 的 `watch`），或者 `authorization/settled` 成功。
- **处理**：跳到 DSH 的账户设置页。

## 明确不进入收件箱的（L1 丢弃，只计数）

| 事实 | 原因 |
|---|---|
| 进度类消息、`todo/write` | 不需要人 |
| 一轮之内工具报错后 agent 自己修复 | 系统内部的事 |
| 模型请求失败、仍在自动重试 | 瞬时错误；只有重试用尽才算 `turn-failed` |
| 人自己停止的轮次（`aborted`） | 人已经知道 |
| 子代理、workflow 中间步骤失败 | 由父 Session 消化；只有父 Session 自己停下来时才可能产生义务 |
| 已归档的 Session | 人已经明确不再关心它；如果义务仍然是硬阻塞，例外：显示，并标出"已归档" |

人**正在看着**的 Session 里出现的义务不属于上表：它照样进入收件箱并计入徽标（P2 完整），但原生 UI 已经接管了交互（composer 被审批或提问取代），所以收件箱不对它做任何额外提醒。

## 历史回填

装上插件或重启之后：

- **实时 Session**：直接从投影推导，不需要回填。
- **已持久化但不在内存中的 Session**：用 `sessionQuery.listSessions()`（轻量）列出最近 7 天的 Session，只回填**到现在仍然有效**的义务：continued 状态的问题、受阻的 goal、48 小时以内的失败轮次。
- **`review` 保持冷热一致**：对同一日志和仍有效事实，冷回填与实时推导使用同一来源判定，不能仅因冷启动就过滤 review；已查看的 revision 按持久化处置隐藏。旧版“不回填 review”的策略不能替代 [006](006-roadmap.md) 的一致性标准；实际 Host 回放证据见 [008](008-acceptance.md)。
- 回填的条目标注为"装上插件前就存在"，不计入账本的响应时长。
