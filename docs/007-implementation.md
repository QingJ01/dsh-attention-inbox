# 007 当前实现与验收记录

2026-11-04 · **v1.0.0-rc.2 发布候选** · 本篇描述当前代码，不覆盖 [006](006-roadmap.md) 的原验收标准。候选版本尚未 npm 发布；真实 GUI、市集、新 profile 与卸载证据由 lead 最终归档到 [008](008-acceptance.md)。

## 当前实现

| 能力 | 实现与事实边界 |
|---|---|
| 全局入口 | `sidebar.panellist` 图标和硬阻塞/系统徽标；`main` 收件箱页面；设置页同时挂载原生 `settings.section` |
| 覆盖自检 | 每次原生状态更新核对所有 pendingInteraction Session；缺口计数可见，未知或不可作答对象也保留“打开”入口；真实 GUI 已报告 coverage=0，持续为 0 仍按 006 验收 |
| 义务来源 | 审批、问题、计划审阅、受阻 goal、明确自主完成轮的 review、最终失败轮次、DeepSeek 登录失效 |
| 原地动作 | 原生 PendingApproval.answer、PendingQuestion.answer/engage；支持多问题、多选、自定义回答和原生计划 intent.approve；能力不可用时打开来源 |
| 作答结算 | 原生 attempt/accepted 仅用于归属跟踪，原生决定或结算事实才记 acted；取消不计成功，迟到响应不复活旧请求，失败保留且可重试 |
| 单一事实来源 | Host 从现有 approval/goal/turn/user-message 等结构事件投影；问题复用 DSH userQuestions；Client 使用原生交互对象 |
| review 降噪 | 仅已证自主来源的 completed 轮次可生成 review；人工输入、未知来源不凭空推断；完成 goal 与对应自主轮共用 review key；主视图可见事实用于抑制额外提醒 |
| 冷启动 | 最近七天只读观察；失败最多 48 小时；continued 问题依赖原生投影；真实结构录制与受控原生 goal 正例已验证冷热一致，历史 review 不再一概过滤 |
| 设置与静音 | reviewEnabled、ledgerRetentionDays（1–3650 天）、Session/Workspace 软事项静音和移除；使用真实 Workspace id，不用 cwd 冒充；hard/system 不受静音隐藏 |
| 账本与指标 | 串行持久化；处置按 revision；原生事实确认的硬阻塞响应中位数和原地处理率；来源噪音率与建议；可核实的 L1/L2/显示计数，无样本显示无数据 |
| caller 生命周期 | Host `attention` 与 Client `attentionClient` 均为 Cordis contextual Service；自动追踪真实调用方，卸载清理注册及其提交义务；公开函数仍返回 disposer |
| 数量预算与过期 | 显式和推导提交跨主体合并预算，默认每调用方/producer 最多 50；拒绝超限并警告且不破坏已有事实；外部义务 30 天未更新以 expired 关闭并写账本，无读者时也有过期定时器 |
| 动作扩展 | Host action 与 Client action 元数据分开；Host 拒绝执行 Client executor；Client 用同 id 执行器、最新 revision、卸载 AbortSignal 和破坏性确认 |
| 主体扩展 | `attention.subject` 是按 subject.type 选择的 keyed Slot；props 为 subject/obligation/description；无组件回退通用主体标题、副标题 |
| Channel | 默认 hard/system；按 key/revision 去重；失败指数退避（上限 60 秒）；AbortSignal；关闭/卸载取消重试并等待异步清理，支持 retract |
| defaultAction | API/持久化保留默认动作元数据，通用行展示本地化动作标签；不展示 input、不自动执行，到期执行由提交方负责；独立 Client 测试已覆盖 |
| 故障降级 | Host 不可达仍更新原生交互，保留最近 Host 事实并标记可能过时；部分回填失败提示；动作失败显示错误不误判处理 |
| 资源与分发 | 中英文 meta/界面、原创 SVG、theme token；候选包包含公开类型、简短扩展示例；npm 与市集发布尚未完成 |

## 数据与安全边界

`attention_inbox` 是自有 storage domain。提交、设置、处置等事务等待持久化成功才确认，失败不更新内存事实。用户 Session 和 preset 不是本插件的写入目标。调用方卸载时，其义务以 withdrawn 关闭；收件箱 domain 保留以便重新安装。实际卸载前后用户数据对照必须另有证据，不能仅凭源码断言通过。

不创建新的模型可见工具或 prompt，不自动批准、不添加“总是允许”，不修改权限或提问默认模式。审批返回值与原生 composer/卡片的最终状态必须由事实确认；“HTTP 成功”“accepted”或按钮被点击都不计作原生处理成功。

defaultAction 的 input 与 act.input 的公开类型为 unknown，具体动作输入由执行器验证；显式义务持久化仍须通过 JSON-safe 规范化。类型可接受某个输入不表示持久化接受函数、accessor、循环引用或密钥。

Channel 的重试、去重和取消目前在当前进程内管理，没有宣称跨重启的 durable outbox 或外部 exactly-once。外部提供方负责自己的幂等键及投递语义；本候选没有内置生产 IM/通知提供方。

## 验证

环境：Node 24、DSH Desktop 0.2.1-rc.5；公开类型由 TypeScript 5.9.3 实际编译。

```sh
DSH_TEST_RUNTIME=/tmp/dshx/app/dsh/node_modules/@deepseek-ai node --test tests/*.test.mjs
```

本轮独立完整复核：**90 通过、0 失败、0 跳过**。覆盖领域规范化/排序/计数、Host 持久化和处置、原生结算归属、Client 交互适配、真实 Cordis caller 卸载、Channel 重试/取消/无读者过期、Client actions/keyed Slot、API 正反例编译、实际 SessionStore/ProjectionRegistry 集成。

[真实工作区结构录制](../tests/fixtures/real-session-structure.json) 包含 3 个精确授权 Session 的 3142 个匿名事件；另有 [受控原生录制](../tests/fixtures/controlled-native-structure.json)，由实际 AgentLoop 与 goal-round-driver 配合固定模型流生成，13 个事件、1 自主轮、1 review，未手工追加 Session 事件。它们的来源、匿名化、SHA-256、覆盖边界和冷热回放记录见 [008](008-acceptance.md)。受控记录不冒充生产模型日志。

Client VM 测试用于调用与状态验证，真实 Cordis 测试用于生命周期验证。lead 已报告现有 Desktop 的真实 DOM 页面被激活，页面约 1137×798、无横向 overflow、coverage=0；这证明该场景可渲染，不代表审批/问题/计划全部已验收。真实审批 fixture 曾被全局 preset 后覆写的 never policy 自动拒绝，正在修正隔离 fixture policy；该现象不能冒称产品批准成功，也不等同于产品绕过权限策略。

lead 已在全新 profile 从 rc.2 归档安装，零配置 frontend graph 含插件；真实浏览器操作、市集路径、60 秒真实义务、卸载对照仍在验收中。**当前没有宣称全部 M0–M4 通过，也没有宣称 npm 或市集已经发布。** 最新最终证据以 [008](008-acceptance.md) 为准。

## 使用与扩展

安装与候选状态见 [README](../README.md)，精确 Host/Client/Slot API 及不可降低的提交契约见 [004](004-extension-api.md)。[hello-producer](../examples/hello-producer/index.js) 为 28 行 opt-in adapter：真实 caller source 提供 ready 事实才 raise，Host action 先执行真实业务验收再 withdraw，不在挂载时制造示例义务。

后续配套插件仍优先独立接入：work-item → Channel 提供方 → Executor/Source → 人工确认的 Policy 变更。收件箱不依赖这些配套插件。团队共享、权限规则建议、异步提问开关和外部 Source 不在本候选范围。
