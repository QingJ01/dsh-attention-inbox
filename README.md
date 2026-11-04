# Attention Inbox · 注意力收件箱

面向个人的 DeepSeek Harness 插件，把跨 Session、跨 Workspace 的待处理事项集中到一个队列：审批、问题、计划审阅、受阻 goal、自主运行待验收、最终轮次失败和账户登录失效。

**当前为 `v1.0.0-rc.2` 发布候选，npm 包尚未发布，市集分发与完整验收尚未完成。** 包名为 `dsh-attention-inbox`，拟公开源码仓库为 [QingJ01/dsh-attention-inbox](https://github.com/QingJ01/dsh-attention-inbox)，采用 MIT 许可证。当前独立测试使用 DSH Desktop **0.2.1-rc.5**；不能把候选版本号理解为全部验收已通过。原标准和逐项证据见 [008 验收表](docs/008-acceptance.md)。

## 安装

候选阶段可让 DSH 的 Plugin Manager 安装本仓库绝对目录，或由维护者提供的候选归档：

```json
{ "action": "install_bundle", "target": "/absolute/path/to/dsh-inbox" }
```

**以下 npm 安装方式仅在发行后可用，现在不要执行：**

```json
{ "action": "install_bundle", "target": "dsh-attention-inbox@1.0.0-rc.2" }
```

若只是把包下载到普通开发项目，发行后的 npm 命令为：

```sh
npm install dsh-attention-inbox@1.0.0-rc.2
```

npm 下载本身不会激活 DSH bundle；在 DSH 中使用上面的 Plugin Manager 安装入口，不手工改 profile 配置。安装后在当前 DSH 界面侧栏打开 **注意力收件箱**。如果页面仍使用旧模块，刷新现有页面；无需另外启动服务器。全新 DSH 从市集零配置安装、60 秒内出现真实义务与卸载对照仍由发布验收确认。

## 使用

- **Agent 在等你**：审批、问题、计划审阅。允许一次、拒绝和回答使用 DSH 原生交互对象，不绕过权限策略；能力不可用时打开来源 Session。计划批准使用原生 intent 中的指定选项。
- **待你决定下一步**：受阻 goal、来源明确的自主完成轮、最终失败或中断轮次。软事项可忽略当前 revision，或稍后提醒一小时；人工完成 goal 不额外制造自主验收事项。
- **系统**：DeepSeek 登录失效。完成登录后由账户事实撤回。

徽标只统计 `hard` 和 `system`；这两类事项不能通过忽略或静音隐藏。原生作答的调用返回不等于完成，只有原生决定或结算事实确认后才记为已处理。按钮失败会显示错误并保留条目。

收件箱与 DSH 原生设置中提供 **review 开关、账本保留天数（1–3650 天）和 Session/Workspace 静音规则管理**。静音只作用于软事项，Workspace 使用实际 Workspace id。关闭 review 不会改变原生审批或问题。

页脚展示可核实的 L1/L2 丢弃、显示计数、硬阻塞响应时长、原地处理率和按来源统计的噪音率。没有确认样本时显示无数据，不把点击成功、请求发送或测试样本当成真实处置。

## 数据与恢复

义务事实来自 Session 日志投影、DSH 自带 `userQuestions` 投影和原生 Client 交互对象。处置、设置、静音、外部插件提交和账本保存在自有 `attention_inbox` storage domain，提交等待持久化成功才返回；不写用户 Session 或 preset。

冷启动只读观察最近七天可读取的历史 Session，保留仍有效的受阻 goal、continued 问题、48 小时内失败和来源明确的自主 review。冷回填与实时推导使用相同事实和规则；部分读取失败会提示。Host 暂时不可达时，原生交互继续实时更新，最近一次 Host 结果会标记为可能过时。

扩展调用方卸载时，其注册和提交的义务由 Cordis caller 生命周期清理；外部义务超过 30 天未更新会以 `expired` 关闭。收件箱自己的 domain 数据在卸载后保留，供重新安装恢复。全新 profile 的真实卸载前后 Session/preset 无改动对照仍须单独验收。

## 扩展

Host 服务 `ctx.attention` 和 Client 服务 `ctx.attentionClient` 均使用 `apiVersion: 1`。推荐可选依赖接入；Cordis contextual 服务自动追踪实际调用方，注册返回 disposer，调用方卸载时清理注册及其义务。

- `raise / withdraw`：显式提交；`producer` 可省略，由实际调用方推导。保存返回的规范 key 用于撤回。
- `registerProducer / invalidate`：从真实业务事实推导；显式与推导义务共同受调用方数量预算约束，默认最多 50 个。
- `registerSubjectType / registerKind / registerAction`：主体说明、类型和 Host 动作，或供 Client 执行器使用的动作元数据。
- `attentionClient.registerAction`：注册同 id 的 Client 执行器；保留 revision、权限与破坏性确认边界。
- `attention.subject` keyed Slot：按主体类型提供富渲染，未提供时回退通用说明；内部导航使用 `panelId`，外部使用 `url`。
- `registerChannel`：默认只选 `hard/system`；按 key/revision 去重，失败指数退避到 60 秒上限，关闭或卸载取消重试并清理异步投递。
- `defaultAction`：通用行展示本地化动作标签，不暴露 input，也不会因到期自动执行；执行仍由提交方负责。

[hello-producer](examples/hello-producer/index.js) 是 28 行按需接入示例，展示 `raise`、`withdraw` 和 Host action，挂载时不会制造业务事项。[扩展 API](docs/004-extension-api.md) 给出实际接口与 Client/Slot 用法；[公开类型](lib/api.d.ts) 可通过 `import type { AttentionService } from 'dsh-attention-inbox/api'` 引入。

## 开发与验证

```sh
pnpm install --ignore-scripts
pnpm check
```

Host 使用 ESM，Client 使用 DSH ModuleLoader，当前不需要单独打包构建。测试使用 Node 内置 runner；TypeScript 5.9.3 实际编译公开 API 的正反例。

完整原生 runtime 测试需要指向已有 DSH 安装或提取产物：

```sh
DSH_TEST_RUNTIME=/path/to/dsh/node_modules/@deepseek-ai node --test tests/*.test.mjs
```

本轮独立完整复核为 **90 通过、0 失败、0 跳过**，包含真实 Cordis caller 生命周期、Channel 重试/取消、Client 执行器/Slot、公开类型编译和匿名结构录制回放。测试不是 GUI 或市集验收的替代品；最新真实界面、全新安装与卸载证据以 [008](docs/008-acceptance.md) 为准。[007](docs/007-implementation.md) 记录候选实现范围。

## 当前边界

只服务个人，不提供团队共享或指派。不自动放权、不改 preset、不切换异步提问模式，也不提供权限规则建议。没有内置飞书、邮件或桌面通知 Channel 提供方；Channel 重试状态当前在进程内，外部投递需要提供方自己的幂等设计，不承诺跨进程 exactly-once。原生审批/提问对象仍属于 DSH 实现接口，升级后能力检测失败时回退打开来源 Session。
