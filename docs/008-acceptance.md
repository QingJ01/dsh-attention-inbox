# 008 验收证据与缺口

本表以 [006 路线图](006-roadmap.md) 原标准为准；[007 实现记录](007-implementation.md) 的功能说明和既往测试结果仅作为待复核证据，不能覆盖、降低或替代路线图验收。状态“待补齐”不表示通过。本文先建立基线，随后记录本轮独立复核。

## M0：逐项 spike

原文总验收：**“每个 spike 有结论和证据，并且据此更新了 002、003 两篇。”** 原文要求每个 spike “给出明确结论，并附上最小可运行的证据”。

| 项 | 原文要验证什么 | 现有证据（未等同验收通过） | 待补齐证据 |
|---|---|---|---|
| S0 | 第三方 bundle 如何声明 Host 的 Remote 方法，以及 Client 怎样调用（参考 `cordis-plugin-development` 中的 `user-actions.md`） | 007 声称 Host route、Client VM 和实际 runtime 集成已验证；现有 runtime 测试调用 `/api/attention-inbox` | Remote 的明确可用性结论、最小运行记录及实际 Client 调用；若采用原文退路，记录 `webServer.register` 与当前路线差异及 002/003 更新 |
| S1 | 对**没有在主视图打开**的 Session，Client 的 `uiSession.sessionStatus` 里是否也有 `PendingApproval` 对象；在收件箱里调用 `answer()` 后，原生 composer 状态是否一致 | 007 声称使用原生对象；Client 测试属注入对象测试 | 真实未打开 Session 审批对象证据，原地 answer 后原生 composer 一致性实际浏览器记录 |
| S2 | 能否安全地直接回答阻塞中的问题（不经过原生卡片），以及批准计划的正确调用方式 | 007 声称 PendingQuestion.answer、原生卡片降级 | 真问题（continued/阻塞）、多选、计时 engage、计划批准的真实 UI 操作及失败保留证据；明确安全边界 |
| S3 | Host 侧能否用 `sessionProjections.stateOf(session, 'userQuestions')` 读取 DSH 自带的问题投影；冷 Session 能否通过 `session-projection-cache` 读到本插件投影的 wire 值 | 007 声称复用 userQuestions；runtime 测试挂载 ProjectionRegistry | 冷 Session 真实 cache wire 读取与实时投影一致的运行记录；002/003 中对应结论 |
| S4 | `user/message` 上 goal、schedule、队友消息、后台任务唤醒的 source 形态；`turn/end` 中 `aborted` 和 `interrupted` 的确切含义 | 007 记录最终失败策略；原有测试主要使用构造事件 | 授权真实匿名结构事件、runtime 源码语义证据、各 source 覆盖表；未能区分时严格按原文 inferred 且默认无 review |
| S5 | Client 如何跳转到指定 Session（以及某一轮、某个工具调用），以及能否往 composer 里预填文字 | 007 描述打开动作 | API 可用性明确结论、真实跳转与预填运行证据；采用仅 Session 退路时记录原因 |
| S6 | 第三方 bundle 能否以自己的名字打开 `storageDomain`、数据存在哪里、卸载时怎么清理 | 007 记录 attention_inbox domain 和卸载保留自有数据 | runtime 存储位置与所有权、真实卸载前后 Session/preset 无改动对照；说明保留/清理策略与原标准关系 |
| S7 | 从 npm 或插件市场安装后，不做任何配置是否就能生效（Host 行插入、Client 模块加载、双语资源、图标） | 007 声称当前 profile 已安装且 Slot 注册 | 干净 profile 经 npm/市场实际安装、零配置 Host/Client/双语/图标证据；当前 profile 不能代替全新安装 |
| M0 总项 | 每个 spike 有结论和证据，并且据此更新了 002、003 两篇。 | [002](002-builtin-producers.md) 与 [003](003-architecture.md) 已新增 S0–S7 逐项结论索引并引用本表；修正人工 goal 完成产生额外 review、冷启动过滤 review 以及 aborted 一概视为人按停止的描述 | S0–S7 各项剩余真实对象/GUI/安装证据仍须补齐；文档同步本身不表示所有 spike 完成 |

## M1–M4

| 项 | 原文验收标准（逐字） | 现有证据（未等同验收通过） | 待补齐证据 |
|---|---|---|---|
| M1.1 | 任何时刻，原生侧栏上显示 pendingInteraction 的每一个 Session 都出现在收件箱里（开发模式下有一个自检计数器，必须一直是 0）； | 007 声称原生交互对象复用、去重测试 | 开发自检计数器存在且持续为 0；真实 UI 多 Session/冷 Session/故障与恢复覆盖 |
| M1.2 | 徽标数等于列表中 `system` + `hard` 的条目数； | 007 声称领域计数测试 | 测试断言复核及真实 UI 徽标/列表逐状态对照 |
| M1.3 | 不新增任何模型可见的工具或 prompt（用 `Tool.listTools` 和 system prompt 对比装插件前后的差异来验证）。 | 007 声称不创建 request_attention | 同一基线装前/装后的 Tool.listTools 与 system prompt 规范化 diff；源码无新增不代替实际对比 |
| M2 | 硬阻塞类型的原地处理率 ≥ 80%（在 S1、S2 结论允许的范围内）；动作失败时条目显示错误，不会被误判为已处理。 | 007 声称失败保留与原生作答测试、账本 | 明确分母/分子、真实 hard 动作样本与账本计算 ≥80%；真实失败显示且未处理的 UI/持久化证据 |
| M3.1 | 用一份录制下来的真实 Session 日志集合回放，`review` 条目数不超过“自主运行轮次数”； | 本轮真实 live-preferred 录制 3 Session / 3142 事件：review 0、自主完成轮 0；另有隔离原生 AgentLoop + goal driver 受控录制 1 Session / 13 事件：review 1、自主完成轮 1。SHA-256 与来源见下文，4 项回放测试通过 | 已有样本满足上界且受控正例非空；仍缺真实长期生产日志的自主 goal/schedule/后台唤醒分支、失败/重试边界、多个 DSH 版本覆盖，不能把受控固定模型正例称为生产样本 |
| M3.2 | 冷启动后，回填的条目和实时推导的结果一致。 | 本轮上述 4 份录制：实际 ProjectionRegistry 每个 prefix 冷恢复 vs 增量一致、检查点 tail 一致；挂载实际 Host 冷回填 vs 实时推导条目一致 | 录制中审批/问题 payload 已移除，未覆盖 native userQuestions cache、硬交互冷恢复；七天/48小时过期、错误回填与多 Session 并发仍需对应集成证据 |
| M4 | 一台全新的 DSH 从插件市场安装后不做任何配置，60 秒内在收件箱里看到一个真实的义务；卸载后 Session 和 preset 都没有任何变化。 | 007 声称当前 profile Plugin Manager applied 和 Slot 注册 | 全新 DSH/profile、市场安装路径、零配置、计时 ≤60 秒真实义务、卸载前后 Session/preset 对照；安装当前 profile 与 mock 不代替验收 |

M4 交付范围还包含：导出类型包；004 契约检查（拒绝无效提交、数量预算）；50 行以内的 [hello-producer 示例](../examples/hello-producer/index.js) 演示 raise/withdraw/一个动作；双语资源、图标、README；npm 发布与插件市场索引。示例只接入调用方真实 source，不默认启用、挂载时不造业务事项；不能把受控示例 record 当成 M4 真实义务。发布、安装与 clean profile 由 lead 负责，本子任务不执行。

[扩展契约测试](../tests/extension.test.mjs) 独立检查无效提交、并发每 producer 50 条、跨 ref/显式提交合并预算与超限警告、30 天 expired 账本、实际 Cordis caller 自动生命周期，以及通过包公开类型入口的 TypeScript 正反例编译。TypeScript 5.9.3 已由 lead 安装作为开发依赖，类型编译不是文本匹配，不作为跳过项。初跑发现 expiry 账本及 defaultAction/includeSnoozed/可省略 producer 声明缺口，交 API 负责人修复后，本轮独立扩展测试 **6 通过、0 失败、0 跳过**；与回放测试联合运行 **10 通过、0 失败、0 跳过**。示例实际 Cordis caller 卸载清理及业务失败保留已通过，不代替市集安装或真实 GUI 验收。

## 证据边界和执行记录

- lead 已确认只读结构日志、现有测试、读取提取 runtime 授权。执行 `DSH_TEST_RUNTIME=/tmp/dshx/app/dsh/node_modules/@deepseek-ai node --test tests/*.test.mjs`：46 通过、0 失败、0 跳过（本轮新增回放测试前基线）。
- Inspect 已核对 `sessionQuery` 与 `sessionPersistence` 只读契约；Inspect 不能调用业务方法。lead 通过现有官方 experimental-inspector 导出精确授权 Session 结构字段，不扫描其他 Session 根目录。
- 不读取 Cookie、密钥文件、用户正文、工具参数、工具输出或真实标题；不修改用户 Session。
- 真实 fixture 仅保留必要结构字段（type/seq/time/source.kind/reason.kind/goal.phase 等），记录来源、匿名化步骤与 SHA-256。手工构造或 runtime 内 append 的事件必须标记为 synthetic。
- 本子任务无直接浏览器工具；lead 发现官方已开启 experimental-inspector（9230），由 lead 负责验证现有 Host/Client CDP 的真实 GUI 可达性及全新 profile。尚无完成结果，仍列待补齐；不提取 Cookie 或凭据。

## 本轮源码结论（不能代替真实对象和 GUI 证据）

- S4：真实 runtime 的 goal-round-driver 在产生自主消息时写 `source.kind: goal`（附 round）；manifest 的 goal 自主消息计数仅按该来源。回放上界另统计明确自主来源的 completed 轮次（详见下文），普通用户输入不归自主。schedule 源码写 `source.kind: schedule`；实际录制出现 `agent-message`、`subagent-settled`，但未出现 schedule、tool-jobs，后两者仍缺真实样本。
- S4：agent-loop 在可识别取消原因时记录 `turn/end.reason.kind: aborted`；Session 的 `interruptedTurnClosers` 明确为崩溃恢复未结束轮次补 `interrupted`。这些源码含义不证明当前录制样本已出现这些分支。
- M3 初次复核发现风险：旧实现对人工 goal complete 也产生 review、冷回填却过滤 review；真实 s1 首次回放出现 1 review / 0 自主轮的失败。已报告 Host 负责人。负责人修复后，本轮同一文件 hash 重跑通过：人工完成不凭空生成 review，自主完成的 live/cold 义务一致。007 或 002 的历史过滤描述不能降低 006 标准。

## 真实录制与最小匿名化

| 录制 | 来源与性质 | 数量 | 文件字节 SHA-256 |
|---|---|---|---|
| [真实工作区结构录制](../tests/fixtures/real-session-structure.json) | lead 经现有官方 Inspector 的只读 `ctx.sessionQuery.readSession` 读取 3 个精确授权 Session；含 root 和 2 个 subagent。原始用户日志不落本仓库 | 3142 事件（s1=2004、s2=606、s3=532）；仅出现 completed 结束原因；无 goal 自主消息 | `5c827044e12958531d043e3130ea448377893aff3694b0063f77fa36cf8b1314` |
| [受控原生运行时录制](../tests/fixtures/controlled-native-structure.json) | [生成脚本](../scripts/acceptance-controlled.mjs) 在独立 Node Context 挂载原生 SessionStore、ProjectionRegistry、Agents、Goals、AgentLoop 和 goal-round-driver；只有 llm 流为固定替身，无网络、无 profile、无手工 Session.append | 13 事件；1 次模型替身调用；1 goal 自主完成轮、1 review | `8baaf8f116e473ad1f5e891bc2d7056eb335c064b54de18ab07f9ce54a29ab06` |

来源授权由 lead 确认，源 Session id 仅保存 SHA-256 对照与 s1/s2/s3 别名；不保存用户真实标题。导出在源端仅选择 type/seq/time 与必要结构；所有文本、工具参数、输出和其他 data 移除。goal id 按 Session 稳定映射 g1，保留 revision/phase；objective 的固定 `[redacted]` 只供 schema 适配，不是原文。后处理进一步移除 maxGoalRounds 等非推导必要字段。

[真实录制 manifest](../tests/fixtures/real-session-structure.manifest.json) 与 [受控录制 manifest](../tests/fixtures/controlled-native-structure.manifest.json) 记录来源、时间、匿名化和最终文件字节 hash；[最小化/manifest 脚本](../scripts/acceptance-fixture.mjs) 只处理已匿名 fixture，不读取原日志或运行时。测试不采集正文。非目标事件仍在 fixture 保留真实 envelope；为避开被删除 payload 的审批 schema，回放输入将非 goal/turn/user-message 类型映射为惰性 `acceptance/ignored`，seq/time 不变。这一步是明确的测试适配，不冒称完整原日志恢复。

[回放测试](../tests/replay-real.test.mjs) 独立按明确自主来源和 completed 轮次计算上界：goal、schedule、agent-message、subagent-settled、tool-jobs；同轮有真实 user 输入时不归自主，metadata 消息不单独增加轮次。unique review key 只计一次。真实录制的 3 Session 上界是 0/0，受控原生正例是 1/1；两者性质分别报告。

```sh
DSH_TEST_RUNTIME=/tmp/dshx/app/dsh/node_modules/@deepseek-ai node --test tests/replay-real.test.mjs
```

最新完整集成复核：`DSH_TEST_RUNTIME=/tmp/dshx/app/dsh/node_modules/@deepseek-ai node --test tests/*.test.mjs`，**89 通过、0 失败、0 跳过**。其中本子任务回放+扩展 10 项全部通过，TypeScript 正反例编译实际执行。M4 合并期间曾出现 Client harness 与旧内部 API 依赖失败，修复后已用完整测试套件重新验证；不再沿用先前阶段的 64 项结果。校验两个 hash 与白名单字段；4 Session 每个 prefix 的实际 runtime 冷恢复/增量投影一致；检查点与后续 tail 恢复一致；实际 Host 回填路径与实时推导的完整条目一致。模型替身不会证明真实模型质量，受控录制也不会替代 M4 的真实 GUI/安装标准。
