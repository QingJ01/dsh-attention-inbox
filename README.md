# Attention Inbox · 注意力收件箱

把 DeepSeek Harness 中跨 Session、跨 Workspace 的待处理事项集中到一个队列：审批、问题、计划审阅、受阻目标、自主运行待验收、最终轮次失败和账户登录失效。

**[dsh-attention-inbox@1.0.0 已在 npm 公开发布](https://www.npmjs.com/package/dsh-attention-inbox)，dist-tag 为 latest。核心功能已完成构建期验收，正式版的12个运行/资源文件与通过验收的 `1.0.0-rc.5` 字节一致。首次 registry 安装验证和市场分发仍待完成。** 源码位于 [QingJ01/dsh-attention-inbox](https://github.com/QingJ01/dsh-attention-inbox)，采用 MIT 许可证。完整原标准与证据见 [008 验收记录](docs/008-acceptance.md)。

## 安装

npm 正式包现已可用，安装路径如下；独立环境中的首次 registry 安装验收尚未完成，不将发布成功等同于安装已验证。

通过 DSH CLI 从 npm 安装并激活：

```sh
dsh plugin add dsh-attention-inbox@1.0.0
```

也可让 DSH Plugin Manager 安装 `dsh-attention-inbox@1.0.0`。安装不需要填写插件配置或账户凭据。市场收录尚在等待，不承诺现在可以在市场中搜索到此包。

若仅把包作为普通开发项目依赖下载：

```sh
npm install dsh-attention-inbox@1.0.0
```

`npm install` 本身不会激活 DSH bundle，日常使用应走 DSH CLI 或 Plugin Manager。候选归档的安装只用于独立验收环境，不能代替首次 registry 或市场安装。

## 使用

在 DSH 侧栏打开 **注意力收件箱**。

- **Agent 在等你**：审批、问题、计划审阅。允许一次、拒绝和回答复用 DSH 原生对象；计划批准使用原生指定选项。能力不可用时打开来源 Session。
- **待你决定下一步**：受阻目标、来源明确的自主完成轮、最终失败轮次。软事项可忽略当前 revision，或稍后提醒一小时。
- **系统**：账户登录失效。账户事实恢复后自动撤回。

徽标只统计 `hard` 和 `system`，这两类事项不能通过忽略或静音隐藏。原生作答返回后，只有原生决定或结算事实确认才记录为已处理；失败显示错误、保留条目并允许重试。

收件箱和原生设置页提供 review 开关、账本保留天数（1–3650 天）、Session/Workspace 软事项静音与移除。Workspace 使用实际 id。页脚展示可核实的过滤计数、响应时长、原地处理率和来源噪音率；没有样本时显示无数据。

## 每日笔记与时间线（开发中，未发布）

侧栏 **每日笔记**：先记下想法，再交给 Agent 去做，结论回到笔记里，未完成的事自动排进未来几天。设计见 [009](docs/009-daily-notes.md)。

- **记**：按日期分组的大纲。Enter 新建、Tab 缩进、⌘↵ 完成；也可以钉到右侧栏，和对话并排着记。
- **派**：任意一条都能「→ 对话」（原文发给新 Session），或「探索」（在提示里要求只读调研，结尾给出 `next-steps`；这只是提示，不是权限限制，Agent 的操作仍按你的 DSH 审批设置走）。全程不离开笔记页。
- **盯**：关联的 Session 状态直接显示在条目上：在等你、运行中、待验收、失败。顶部汇总条可以按状态筛选。
- **收**：Session 停下后，最后的结论写回条目下方；探索给出的下一步变成可以接受或忽略的建议。
- **排**：时间线分两条泳道。你自己做的事按估时占用你的时间；交给 Agent 的事只占验收时间（默认 15 分钟），每天最多派出 2 个。可以识别「明天」「周五前」「~2h」「!!」这类写法；逾期自动顺延，顺延 3 次以上会提醒你拆分、先探索或放弃。
- **回顾**：每天显示昨天完成、派出、顺延、放弃各多少，以及想法转化率、从记下到开始的中位时长。

收件箱和笔记共用一套页面骨架：吸顶工具栏、紧凑页头加属性标签、主栏加右侧栏。样式全部取自 DSH 的设计变量，深浅色和原生界面一致。详见 [005](docs/005-ux.md#视觉与排版2026-11-25)。

笔记存在独立的 `attention_notes` storage domain 里，不影响收件箱的数据。时间线和统计数字每次读取时现算，不落盘。

## 项目时间线（开发中，未发布）

侧栏 **项目时间线**：选一个项目，把它下面所有会话按时间排开。每一轮显示你问了什么、Agent 最后的结论、改了哪些文件、跑了几条命令、结果如何；「会话」视图可以展开看某个会话的逐轮记录。只读：只从会话日志里整理，不会唤醒、提示或改动任何会话，也不调用模型。设计见 [010](docs/010-project-timeline.md)。

## 数据与恢复

义务来自 Session 结构事件投影、DSH 自带问题投影和原生 Client 交互对象。设置、处置、外部提交与账本写入自有 `attention_inbox` storage domain，持久化成功才确认，不写用户 Session 或 preset。

启动时只读回填最近七天仍有效的事实，失败轮次保留最多 48 小时；冷回填和实时推导使用相同规则。Host 暂时不可达时，原生交互继续更新，最后一次 Host 结果会标记为可能过时。

扩展调用方卸载时自动清理其注册和义务；外部义务 30 天未更新以 `expired` 关闭。收件箱自己的 domain 数据保留以便重新安装。独立卸载验收已验证非空基线 Session 文件、preset/loop 配置和模型可见内容不变，证据及范围见 [008](docs/008-acceptance.md)。

## 扩展

Host `ctx.attention` 与 Client `ctx.attentionClient` 均为 `apiVersion: 1` 的 Cordis contextual Service，自动追踪真实调用方并绑定生命周期。

- `raise / withdraw`：显式提交；producer 可省略，由 caller 推导。更新按 key 幂等，保存返回的规范 key 用于撤回。
- `registerProducer / invalidate`：从真实业务事实推导。显式和推导提交共享默认 50 条预算，超限拒绝并警告。
- 主体、kind、Host action 和 Client action 扩展；`attention.subject` 按主体类型提供富渲染，未注册时使用通用说明。
- Channel 默认选择 hard/system，按 key/revision 去重，失败指数退避到 60 秒上限，关闭或卸载取消投递及重试。
- defaultAction 展示本地化动作标签，不显示 input，也不因到期自动执行。

[28 行 hello-producer](examples/hello-producer/index.js) 展示真实 source 触发 raise、Host action 和 withdraw，不在挂载时制造业务事项。精确接口见 [004](docs/004-extension-api.md)，类型从 `dsh-attention-inbox/api` 导入。

## 验证与开发

当前验证基于 DSH 0.2.1-rc.5、Node 24、TypeScript 5.9.3：

- **108 项 SDK 测试通过，0 失败、0 跳过**，包含公开类型实际编译、caller 生命周期、预算、过期、Channel 重试和匿名录制回放。
- 独立真实浏览器的五类 pointer 操作 **5/5 原地确认**，每项只有一张匹配卡片、mainView=0、coverage gap=0，账本原生确认并清除 pending。
- 真实 pointer 验证失败显示/保留/retry、设置持久化与恢复；浅深色均无横向溢出。
- 同一 Agent 装载/卸载前后 tools、prompt sections、contexts、variables 的 hash 相等；专门 CLI 卸载和重启前后，非空 Session 文件及 preset/loop 配置保持不变。

这些是核心构建期证据，不代替 [006](docs/006-roadmap.md) 的 npm/市场分发标准，也不等于 M0–M4 全部完成。

```sh
pnpm install --ignore-scripts
pnpm check
DSH_TEST_RUNTIME=/path/to/dsh/node_modules/@deepseek-ai node --test tests/*.test.mjs
```

Host 使用 ESM，Client 由 DSH ModuleLoader 加载。集成和 GUI 验收必须使用独立 DSH_HOME、profile、进程、显式 Web/Inspector 地址，以及专用临时浏览器目录；清除继承的 DSH 环境变量。禁止访问用户在用 DSH 或个人浏览器 profile。详细实现和证据索引见 [007](docs/007-implementation.md)、[008](docs/008-acceptance.md)。

## 边界

本插件面向个人，不提供团队共享或指派，不自动放权、不修改 preset，也不切换异步提问模式。没有内置飞书、邮件或桌面通知 Channel；重试状态在进程内，外部提供方负责自己的幂等投递。原生交互能力升级后不可用时回退打开来源 Session。市场收录还受仓库年龄及维护者合并流程约束。
