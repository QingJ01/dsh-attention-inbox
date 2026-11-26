# 007 当前实现与验证

**[1.0.0 已在 npm 公开发布](https://www.npmjs.com/package/dsh-attention-inbox)，dist-tag 为 latest。** 核心构建期验证基于 `1.0.0-rc.5`，正式版12个运行/资源文件与该验收构建字节一致。已通过独立真实浏览器、原生交互、同Agent模型可见内容和专门卸载窗口验证；首次registry安装、市场收录与完整分发验收仍待完成。本篇不覆盖 [006](006-roadmap.md) 原标准，逐项证据见 [008](008-acceptance.md)。

## 产品行为

| 能力 | 当前实现 |
|---|---|
| 收件箱与徽标 | 汇总跨 Session/Workspace 义务；徽标只计 hard/system；核对原生 pendingInteraction 覆盖缺口 |
| 原生处理 | 审批允许一次/拒绝、open/continued 问题、计划批准复用原生对象；能力不可用时打开来源 |
| 事实确认 | 原生决定或结果确认才记 acted；accepted/点击/HTTP 成功不单独构成处理事实；失败保留并可重试 |
| 软义务 | 受阻目标、来源明确的自主完成轮、最终失败；当前 revision 的忽略和一小时稍后提醒 |
| 设置与静音 | reviewEnabled、1–3650 天账本保留、实际 Session/Workspace id 的 soft 静音；hard/system 不受隐藏 |
| 统计 | 可核实 L1/L2/显示计数、硬阻塞响应中位数、原地处理率和来源噪音率；无样本明确显示 |
| 冷启动 | 最近七天只读回填，失败最多48小时；本插件投影和原生 userQuestions 维持单一事实来源 |
| 持久化 | 自有 attention_inbox domain；串行事务成功才确认，失败不更新权威内存事实 |
| caller 与预算 | Cordis contextual Service 自动归属；卸载清理 caller 注册与义务；显式/推导跨主体共享默认50条预算；支持重启后的预算边界 |
| 外部义务过期 | 30天未更新以 expired 关闭并记账；无读者时也执行过期清理 |
| Host/Client 动作 | Host 只执行 Host executor；Client 同 id 执行器检查 revision、破坏性确认及卸载信号 |
| 主体富渲染 | attention.subject keyed Slot，按 subject.type 选择；直接传 subject/obligation/description，无组件时通用 fallback |
| Channel | hard/system 默认选择、revision 去重、失败指数退避至60秒上限、取消/撤回/异步清理 |
| 默认动作 | 展示本地化标签，不显示 input，不自动调度执行；业务执行仍归提交方 |
| 降级 | Host 不可达保留最近事实并提示过时，原生交互继续更新；部分回填失败提示 |
| 资源/API | 中英文界面、原创 SVG、theme token；独立 Remote namespace、公开类型与28行 hello-producer 示例 |

review 只依据明确自主来源与完成事实，未知来源不推断自主。主视图可见事实用于减少额外提醒。状态、问题和作答通道不在收件箱另造一份权威副本。

## 数据边界

用户 Session 和 preset 不是插件写入目标。设置、账本、处置和外部提交归自有 domain；domain 在卸载后保留供恢复。扩展调用方的生命周期清理与收件箱自身卸载分别验证。

没有新增模型可见工具或 prompt，不自动批准、不添加总是允许、不改变提问默认模式或权限规则。act/defaultAction 的 input 类型为 unknown，由具体 executor 验证；持久化义务仍要求 JSON-safe。

Channel 重试在进程内，没有跨重启 durable outbox 或外部 exactly-once 承诺；外部提供方必须处理自己的幂等。没有内置生产 IM/通知提供方。

## 验证环境与方法

所有最终集成证据来自项目内独立 DSH_HOME、独立 profile/进程，Web `http://127.0.0.1:54081`、Inspector `http://127.0.0.1:19231`；wrapper 清除继承的 DSH_* 环境变量。真实 Chrome 使用 `.acceptance/browser-run-*` 专用临时 userDataDir，finally 关闭并移除，不读取个人 profile。不得访问用户在用 DSH。常规 SDK 测试在独立内存 Context 中运行，既有匿名 fixture 仅离线回放。

DSH 的预览说明和 signed-out Get started 提示通过正常 Continue/Close 处理，不登录账户、不填写插件配置、不 force-click 穿过遮罩、不伪造 DOM。

| 验证 | 结果与证据 |
|---|---|
| SDK/类型/回放 | [tests-rc5.log](../.acceptance/tests-rc5.log)：108/108通过，0失败、0跳过；包括 TypeScript 5.9.3 正反例、真实 SDK、caller、预算、Channel、原生计划结果和匿名回放 |
| 五类原生 pointer | [isolated-browser-proof.json](../.acceptance/isolated-browser-proof.json)：5项、5项原地确认、pageErrors=[]；allow/reject/question-open/continued/plan-review，每例唯一匹配卡片、mainView=0、gap=0，acted/via=inbox/nativeConfirmed，原生 pending/卡片清除 |
| 动作失败与重试 | [failed-action-proof.json](../.acceptance/failed-action-proof.json)：真实 pointer 首次失败显示错误、hard保留，第二次重试成功 |
| 设置 | [desktop-settings-report.json](../.acceptance/desktop-settings-report.json)：review切换确认、非法retention禁止提交、合法值持久化、恢复成功 |
| 浅深主题 | [isolated-themes-proof.json](../.acceptance/isolated-themes-proof.json)：原生media主题感知，两种模式width=scrollWidth=1000，无横向溢出 |
| M1模型可见内容 | [runtime-m1.json](../.acceptance/runtime-m1.json)：同一原生Agent/scope装配→仅卸载产品Host fiber→重新装配；31工具、22 sections、7 contexts，四组hash一致，changedContexts=[] |
| 专门卸载窗口 | [runtime-before.json](../.acceptance/runtime-before.json) → 独立CLI remove产品 → 停/启测试进程 → [runtime-after.json](../.acceptance/runtime-after.json)：非空Session文件、preset/loop配置和四组模型可见hash一致 |

五类原地样本率为5/5=100%，超过M2的≥80%标准；其中拒绝是明确原生决定，不是取消。模型采用固定本地流，原生 AgentLoop/审批/问题/计划对象真实运行，没有手工 pending 或 Session.append，不宣称真实 provider 或长期生产指标。

## 模型与卸载不变性

M1 在同一 Agent 上比较，工具31、sections22、contexts7，tools/sections/contexts/variables均相等，blockedModelAttempts=0；没有将时钟、Session或provider动态上下文正规化成相等。M1窗口内基线Session序号保持6，文件hash保持不变。

专门卸载窗口使用同一个非空基线文件，SHA-256 为 `54bc3fbd0806e12596f143f7326d8172e641f44405a2ae63cedb74f09bcd8ebb`，before/after及各快照后均一致。相关配置行数量为6→6，canonicalOptionsHash为 `4af8a53d8640fc05198136abd0c7459a151492d55b979a0a5d116f13048846ed`；其中preset4行、preset registry1行、agent loop1行均不变。全Loader行数198→197是卸载产品行的预期变化，不声称全树行数相等。

非空基线hash链覆盖pointer UI、M1和独立卸载窗口。卸载后工具、sections、精确contexts/variables hash均相等，changedContexts=[]。此专门窗口是卸载验收依据，fixture清理不作为替代证据。

## 发布状态与复现

核心构建期验收通过，**npm包1.0.0已公开发布且latest；首次registry安装验证仍pending。市场仓库年龄、提交/合并及从市场零配置安装到真实义务的≤60秒分发标准仍待完成。** 不将这些状态合并为“M0–M4全部完成”。

发行包SHA-1为 `88739b650cddf134039c560a23f7b8039c645b85`。[release-code-proof.json](../.acceptance/release-code-proof.json) 核对12个运行/资源文件与RC5完全一致，codeSha256为 `4063f6e0ceaa2a686e20ba759aa5f5934f78a9d42e695281c5aff6483a1cbbfd`；正式包共28个文件。该证明建立代码/资源与已通过Core构建的关系，不代替首次registry安装或市场测试。最终测试Session文件与临时产物清理尚待记录，不将产品卸载通过写成所有测试数据已清理。

```sh
DSH_TEST_RUNTIME=/path/to/dsh/node_modules/@deepseek-ai node --test tests/*.test.mjs
```

本地证明文件位于忽略目录，摘要与hash收录于 [008](008-acceptance.md)，不将其中临时路径或fixture数据打入发行包。公开API及Slot用法见 [004](004-extension-api.md)，安装见 [README](../README.md)。[hello-producer](../examples/hello-producer/index.js) 只响应真实caller source，不在挂载时制造义务。
