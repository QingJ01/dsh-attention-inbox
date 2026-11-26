# dsh-attention：注意力收件箱 · 设计文档

> 当前为 v1.0.0-rc.2 发布候选，尚未 npm/市集发布。000–005 保留产品设计与本轮核实结论；[006 原验收标准](006-roadmap.md) 不因实现记录降低。当前实现见 [007](007-implementation.md)，逐项证据与缺口见 [008](008-acceptance.md)，公开类型见 [api.d.ts](../lib/api.d.ts)。

**一句话**：装上就能用的"漏斗末端"。DSH 里所有**此刻必须由你处理**的事项都汇到这里，在这里就能处理掉；其余的系统自己消化，只告诉你它替你挡掉了多少。

它源自 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 里的 Attention 设计和文章 [Super-agent 设计探索](https://superagent.ltd/#article) 中的"注意力义务"概念，但不依赖原型里的 Ticket 和 Source：在纯 DSH 里，义务的主体是 **Session**（以及挂在它上面的 goal、plan、提问和审批）。后续的 work item、Source、Channel 插件都通过本插件的扩展接口接入。

## 已定决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | v1 只服务个人：一个 DSH 实例对应一个人，不建模 owner 和共享 | 先在单人场景把"完整、可在原地处理"做扎实；共享留给后续插件，数据模型预留 `audience` 字段 |
| D2 | 上手成本趋近 0：装上即生效，无必填配置，不新增模型可见的工具和 prompt，不改变 agent 行为 | 让大量 DSH 用户能直接装、直接用、随时卸载，没有任何残留 |
| D3 | 扩展性优先于功能数量：内置的义务来源本身就通过公开扩展 API 实现 | 保证这套 API 真的能用，后续插件和第三方的接入方式跟内置来源完全一样 |
| D4 | `ask_user_question` 保持 DSH 默认的阻塞行为，异步提问作为一键开启的选项（v1.1） | DSH 已经提供 `mode: timed` 和后续作答（`userQuestions.answer`），不需要再造一个工具；默认不改变 agent 行为 |

## 阅读顺序

按编号阅读，每篇只用到前面已经介绍过的概念。

1. [000 定位与原则](000-principles.md)：为什么做、和原生侧栏有什么不同、怎样才不是玩具
2. [001 领域模型](001-domain.md)：义务（Obligation）、生命周期、漏斗、排序与计数
3. [002 内置义务来源](002-builtin-producers.md)：从现有 DSH 事实推导出哪些义务，以及依据
4. [003 架构](003-architecture.md)：Host/Client 两半、单一事实来源、存储、原地处理的实现路径
5. [004 扩展 API](004-extension-api.md)：给后续插件和第三方的契约
6. [005 交互设计](005-ux.md)：入口、页面、条目、快捷键、空状态
7. [006 路线图](006-roadmap.md)：里程碑、待验证技术点（spike）、度量指标、配套插件规划
8. [009 每日笔记与时间线](009-daily-notes.md)：想法 → Session → 结论 → 排程的闭环（未发布，开发中）
9. [010 项目时间线](010-project-timeline.md)：只读整理一个项目下所有会话的问、结论、改动，按时间排开（未发布，开发中）

## 术语

| 术语 | English | 含义 |
|---|---|---|
| 义务 | Obligation | 一件此刻必须由人处理、否则某项工作无法继续或无法交付的事项 |
| 主体 | Subject | 义务挂在谁身上：一个 Session、一个系统账户，以及后续插件引入的 work item、PR 等 |
| 来源 | Producer | 产生义务的模块。内置来源从 DSH 事件推导；外部来源调用 `raise` 提交 |
| 处置 | Disposition | 人对义务做的事：处理、忽略、稍后提醒 |
| 结局 | Resolution | 义务关闭的原因：已处理、已撤回、已过期、被替代 |
| 漏斗 | Funnel | 从原始事件到收件箱条目的逐层收敛规则 |
| 账本 | Ledger | 每个义务从出现到关闭的记录，用来衡量注意力的消耗和节省 |
