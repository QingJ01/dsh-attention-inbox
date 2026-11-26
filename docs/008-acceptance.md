# 008 验收证据与分发状态

**[dsh-attention-inbox@1.0.0 已在 npm 公开发布](https://www.npmjs.com/package/dsh-attention-inbox)，latest/public；核心构建期验收通过。正式版12个运行/资源文件与验收构建1.0.0-rc.5字节一致。首次registry安装与市场分发仍pending。** 本表保留 [006](006-roadmap.md) 原标准，不把npm发布或Core通过等同于M0–M4全部完成。

最终GUI与集成证据仅来自独立home/profile/进程、显式Web/Inspector地址和专用临时浏览器。用户在用DSH不用于验收，不访问其Session、配置、页面或个人浏览器profile。已有匿名fixture仅作离线回放。原始本地证明位于忽略目录，不随发行包发布；本篇保存结果、来源、范围与关键hash。

## 验证环境

| 项 | 环境与方法 |
|---|---|
| DSH/SDK | DSH 0.2.1-rc.5、Node24、TypeScript5.9.3；独立内存SDK Context及真实独立DSH进程 |
| home与工作区 | 项目内 `.acceptance/isolated-home` 和 `.acceptance/fixture-workspace`，独立测试profile |
| Web/Inspector | `http://127.0.0.1:54081` / `http://127.0.0.1:19231`；启动wrapper清除所有继承DSH_*变量，guard限定测试home/origin |
| 浏览器 | 真实Chrome/Playwright pointer；`.acceptance/browser-run-*`专用临时userDataDir，finally关闭删除，不读取个人profile |
| 原生交互 | 实际AgentLoop、审批、提问、计划对象；固定本地模型流，不手工构造pending、不手工append Session、不发真实provider请求 |
| 原生入门提示 | 正常Continue/Close关闭预览说明与signed-out Get started；不登录、不配置插件、不force-click穿越遮罩、不伪造DOM |
| SDK结果 | [tests-rc5.log](../.acceptance/tests-rc5.log)：108测试、108通过、0失败、0跳过 |

## M0：原标准、结论与证据

原文总验收：**“每个 spike 有结论和证据，并且据此更新了 002、003 两篇。”** 每个spike须有明确结论及最小可运行证据。

| 项 | 原文要验证什么 | 当前结论与已有证据 | 范围/待完成 |
|---|---|---|---|
| S0 | 第三方 bundle 如何声明 Host 的 Remote 方法，以及 Client 怎样调用（参考 `cordis-plugin-development` 中的 `user-actions.md`） | 独立Remote namespace承担Host/Client通道；SDK集成与隔离真实pointer操作闭环验证调用，模型可见面保持不变 | Core通道结论；正式npm安装后复核同一发行产物，不把旧HTTP路径当唯一协议承诺 |
| S1 | 对**没有在主视图打开**的 Session，Client 的 `uiSession.sessionStatus` 里是否也有 `PendingApproval` 对象；在收件箱里调用 `answer()` 后，原生 composer 状态是否一致 | 隔离allow/reject均mainView=0、gap=0、唯一匹配卡片；真实pointer作答后原生pending与收件箱均清除，账本原生确认 | 已通过本构建原生双分支；兼容能力不可用时仅打开来源 |
| S2 | 能否安全地直接回答阻塞中的问题（不经过原生卡片），以及批准计划的正确调用方式 | open/continued问题与plan-review真实pointer通过；复用原生通道/计划指定批准选项，nativeConfirmed=true；失败保留及重试另有真实pointer证明 | 已通过五类核心场景；多选/计时等补充边界由SDK测试覆盖，不能称全部浏览器/所有组合穷举 |
| S3 | Host 侧能否用 `sessionProjections.stateOf(session, 'userQuestions')` 读取 DSH 自带的问题投影；冷 Session 能否通过 `session-projection-cache` 读到本插件投影的 wire 值 | 复用原生userQuestions，独立SDK/ProjectionRegistry验证wire、逐prefix与checkpoint恢复；真实open/continued展示结算来自原生事实 | 已有Core实现与SDK恢复证据；录制payload删除范围及冷问题cache的独立运行覆盖不得由匿名软义务回放代替 |
| S4 | `user/message` 上 goal、schedule、队友消息、后台任务唤醒的 source 形态；`turn/end` 中 `aborted` 和 `interrupted` 的确切含义 | SDK源码/契约确定来源及取消/恢复语义；真实匿名录制覆盖user/agent-message/subagent-settled，受控原生driver覆盖goal。只有已证来源生成自主review，未知不推断 | 源码语义与已录样本分别计证；schedule/tool-jobs、aborted/interrupted未冒称已出现在真实历史样本中 |
| S5 | Client 如何跳转到指定 Session（以及某一轮、某个工具调用），以及能否往 composer 里预填文字 | 原生Session打开与主体panelId/HTTP(S) URL导航；采用原文“只跳到Session”兼容退路 | 不提供指定轮次/调用精确定位或composer预填承诺；不能把未实现能力标通过 |
| S6 | 第三方 bundle 能否以自己的名字打开 `storageDomain`、数据存在哪里、卸载时怎么清理 | attention_inbox自有domain、caller清理/持久化SDK测试；独立CLI卸载与重启窗口验证非空Session及preset/loop不变 | 卸载不变性已通过；自有domain保留用于恢复，不把保留数据称为全部删除 |
| S7 | 从 npm 或插件市场安装后，不做任何配置是否就能生效（Host 行插入、Client 模块加载、双语资源、图标） | 正式1.0.0已在npm public/latest发布；12个运行/资源文件与通过真实GUI的RC5一致，正常DSH入门提示不属于插件配置 | **pending：首次registry安装，市场可达/安装**。npm发布、本地归档或源码安装不替代安装后零配置标准 |
| M0总项 | 每个 spike 有结论和证据，并且据此更新了 002、003 两篇。 | [002](002-builtin-producers.md)、[003](003-architecture.md)已有S0–S7结论索引；本表更新最终证据边界 | 分发S7未完成，不能将整个M0标为全部完成 |

## M1–M4：原标准与当前状态

| 项 | 原文验收标准 | 证据与结果 | 状态/范围 |
|---|---|---|---|
| M1.1 | 任何时刻，原生侧栏上显示 pendingInteraction 的每一个 Session 都出现在收件箱里（开发模式下有一个自检计数器，必须一直是 0）； | SDK覆盖缺口/并发/迟到响应测试；五类真实pointer每项matchingCards.length===1、mainView=0、gap=0，pending一致清除 | Core通过所测场景；保留原持续为0标准，不推断未来所有状态已穷举 |
| M1.2 | 徽标数等于列表中 `system` + `hard` 的条目数； | 领域与Client聚合测试比较实际列表/分组/徽标；真实GUI交互保留覆盖核对 | Core计数测试通过 |
| M1.3 | 不新增任何模型可见的工具或 prompt（用 `Tool.listTools` 和 system prompt 对比装插件前后的差异来验证）。 | 同一原生Agent/scope装配、卸载产品Host fiber、重新装配；tools/sections/contexts/variables四组hash相等，changedContexts=[] | **通过**，同Agent实际装配，不以源码无工具代替比较 |
| M2 | 硬阻塞类型的原地处理率 ≥ 80%（在 S1、S2 结论允许的范围内）；动作失败时条目显示错误，不会被误判为已处理。 | 五类原生pointer确认5/5=100%；每项acted/via=inbox/nativeConfirmed；真实pointer失败显示错误、hard保留，重试第二次成功 | **Core通过**；固定模型真实原生交互样本，不声称长期生产指标或全部失败组合 |
| M3.1 | 用一份录制下来的真实 Session 日志集合回放，`review` 条目数不超过"自主运行轮次数"； | 3个授权真实Session共3142匿名事件：review0/自主完成轮0；独立原生goal正例13事件：review1/自主完成轮1 | **所录集合通过**；历史与受控来源分列，真实历史0/0不冒充非空自主正例 |
| M3.2 | 冷启动后，回填的条目和实时推导的结果一致。 | 4份录制每prefix独立SDK冷恢复/增量一致，checkpoint/tail一致，实际Host冷回填条目与实时推导一致 | **所录集合通过**；问题/审批payload不在该最小录制中，边界见下文 |
| M4 | 一台全新的 DSH 从插件市场安装后不做任何配置，60 秒内在收件箱里看到一个真实的义务；卸载后 Session 和 preset 都没有任何变化。 | 独立CLI卸载→停/启测试进程→after快照：非空Session、preset/loop及模型可见内容不变；npm正式1.0.0已公开发布 | **卸载子项通过，distribution pending**：首次registry安装、市场年龄/索引/合并与从市场≤60秒真实义务待补 |

M4交付中的公开类型、拒绝无效输入、默认50条数量预算、caller自动生命周期、Channel取消/重试、Client动作、主体Slot和28行 [hello-producer](../examples/hello-producer/index.js) 已有SDK/类型测试；双语界面、图标和README已随候选提供。示例只响应真实caller source，不在挂载时制造义务。

## 真实pointer、失败、设置与主题

[isolated-browser-proof.json](../.acceptance/isolated-browser-proof.json) 记录realDshPage=true、caseCount=5、inPlaceConfirmed=5、existingBrowserProfileUsed=false、pageErrors=[]。五类分别为allow、reject、question-open、question-continued、plan-review，逐项断言唯一匹配卡片、未在主视图打开、覆盖缺口0，并以原生结算确认账本与composer。非空基线文件hash在UI前后相等。

原生交互细节与结算在 [browser-report.json](../.acceptance/browser-report.json) 保存：每项acted、via=inbox、nativeConfirmed=true、closedInInbox/composerCleared=true。continued固定模型流3次调用，其余各2次；manualPendingObjects=0、manualSessionAppends=0、realProviderCalls=0。拒绝为明确原生决定，属于acted，不是取消。原地处理率的分子/分母均为这5项。

| 证据 | 结果 |
|---|---|
| [failed-action-proof.json](../.acceptance/failed-action-proof.json) | 真实Playwright pointer：首次Host action失败显示红色错误，hard项仍在；第二次retry成功 |
| [desktop-settings-report.json](../.acceptance/desktop-settings-report.json) | 真实pointer：review切换确认、非法retention禁止提交、合法值持久化、restored=true |
| [isolated-themes-proof.json](../.acceptance/isolated-themes-proof.json) | 原生media感知；light/dark两模式width=scrollWidth=1000；文本/背景颜色分别为(15,17,21)/(255,255,255)和(249,250,251)/(21,21,23) |

这些证明属于真实隔离页面和固定模型原生运行，不是伪造DOM、手工pending或截图拼接；未用个人账户登录或生产浏览器profile。

## 同Agent模型可见内容不变

[runtime-m1.json](../.acceptance/runtime-m1.json) 在同一个临时原生Agent/scope中比较产品Host fiber存在与卸载后的装配结果。工具31、sections22、contexts7；toolsUnchanged、sectionsUnchanged、contextsUnchanged、variablesUnchanged均true，changedContexts=[]。精确动态上下文值只hash，不正规化成相等；followupInvocations=0、blockedModelAttempts=0，未发模型请求。

| 内容 | 前后相等的SHA-256 |
|---|---|
| tools | `af0f0b40e4967efeee79a39534bfdc80a92f98b0d60666cd9074aa4adf885bd9` |
| sections | `bd206818638ad66e7aa6da0b8d5af95f806628a01adf1d998417c7d563601c04` |
| contexts | `0fe61cccc1d96db5771eb5044a46b1e34582f19e9a8ac2d756e0dc7f06ce962c` |
| variables | `1c7ad7dd89cbbeaef956b7d8dba2e23cfba46ee7eda7efa27952af6ee7e0a277` |

M1窗口内非空基线Session序号6→6、文件hash不变；快照自身没有改写基线。

## 专门卸载验收

方法为 [runtime-before.json](../.acceptance/runtime-before.json) → 关闭测试浏览器、独立CLI remove产品 → 停/启自己的DSH测试进程 → [runtime-after.json](../.acceptance/runtime-after.json)。这是独立卸载窗口，不使用跨整个UI周期的比较，也不拿fixture清理代替卸载。

| 比较项 | before/after结果 |
|---|---|
| 非空Session文件 | SHA-256均为 `54bc3fbd0806e12596f143f7326d8172e641f44405a2ae63cedb74f09bcd8ebb`；每次快照后仍相等 |
| preset/registry/loop相关行 | 6→6；preset4、registry1、loop1，各行与各组options hash相等 |
| 配置摘要hash | `4af8a53d8640fc05198136abd0c7459a151492d55b979a0a5d116f13048846ed`，前后相等 |
| 全Loader行数 | 198→197，产品行被移除；不要求整个Loader树数量不变 |
| 模型可见内容 | tools/sections/精确contexts/variables hash均相等，changedContexts=[] |

runtime-after.comparison中的baselineSessionFileUnchangedAcrossUninstall、presetAndLoopOptionsUnchangedAcrossUninstall、modelVisibleComparable、tools/sections/exactContexts/exactVariablesUnchanged均true。非空基线hash链贯穿pointer UI、M1和独立卸载前后；因此M1卸载fiber的窗口与CLI卸载窗口都没有遗漏Session变化。该结论针对确定的隔离配置和窗口，不泛化为未测profile的全部行为。

## M3来源、匿名化与回放

| 集合 | 来源与性质 | 数量 | 文件字节SHA-256 |
|---|---|---|---|
| [真实结构录制](../tests/fixtures/real-session-structure.json) | 3个精确授权历史Session的只读query导出；root和2个subagent，原始正文不落库 | 3142事件，s1=2004、s2=606、s3=532；仅completed；无goal自主消息 | `5c827044e12958531d043e3130ea448377893aff3694b0063f77fa36cf8b1314` |
| [受控原生录制](../tests/fixtures/controlled-native-structure.json) | 独立Node Context的原生AgentLoop/goal driver，只有模型流固定；无网络、profile或手工Session.append | 13事件，1次模型调用，1自主完成轮，1review | `8baaf8f116e473ad1f5e891bc2d7056eb335c064b54de18ab07f9ce54a29ab06` |

[真实manifest](../tests/fixtures/real-session-structure.manifest.json) 与 [受控manifest](../tests/fixtures/controlled-native-structure.manifest.json) 保存来源、时间、匿名化和文件hash。仅保留type/seq/time、source.kind、reason.kind、匿名goal id/revision/phase等必要字段。Session id仅存别名及hash，goal id稳定映射，objective固定[redacted]用于schema适配；正文、工具args/输出、密钥、真实标题不收集。此历史集合不再从用户在用DSH补采。

[回放测试](../tests/replay-real.test.mjs) 为保持连续seq，把非goal/turn/user-message的payload已删除事件在回放输入中映射为惰性acceptance/ignored；原fixture envelope不变。这是明确适配，不冒充完整原日志恢复。按明确自主来源和completed轮次独立计数，含人工输入的轮不归自主，metadata不增加轮次，unique review key只计一次。

已有真实source覆盖user、agent-message、subagent-settled，受控driver覆盖goal；schedule/tool-jobs及aborted/interrupted的真实历史分支未冒称覆盖，其语义另由源码/SDK契约确认。ProjectionRegistry每prefix、checkpoint/tail、实际Host冷热条目一致；审批/问题payload被移除，不能用这组软义务录制替代所有硬交互冷缓存测试。多版本、长期生产噪音与一周响应时长为后续持续观察，不篡改006目标。

## 正式npm发行与代码一致性

[dsh-attention-inbox@1.0.0](https://www.npmjs.com/package/dsh-attention-inbox) 已在npm以public访问级别发布，dist-tag为latest。发行包SHA-1为 `88739b650cddf134039c560a23f7b8039c645b85`。

[release-code-proof.json](../.acceptance/release-code-proof.json) 记录version=1.0.0、validatedBuild=1.0.0-rc.5、identicalRuntimeAndResources=true。核验范围覆盖Host/Client入口、公开声明、contextual服务、领域规则/投影/服务、bundle patch、双语资源和图标，共12个文件，逐项名单见证明；与已通过验收的RC5字节一致，codeSha256为 `4063f6e0ceaa2a686e20ba759aa5f5934f78a9d42e695281c5aff6483a1cbbfd`，正式包共28个文件。

该证明把正式包的运行/资源代码关联到108项SDK、pointer5/5和卸载通过的Core构建；不把npm发布成功当成首次安装或市场验收。最终测试Session文件、NativeFixture与临时产物清理记录仍待完成，产品卸载结论与该清理状态分别保存。

## 剩余分发gate

1. **首次registry安装：pending。** npm正式包已经发布；仍须独立全新环境从registry零配置安装，核对最终包与已验收源码及资源，不能以本地归档安装代替。
2. **市场年龄：未达到。** 仓库created_at为2026-11-04T13:57:21Z；最早2026-11-05T13:57:21Z满足一天门槛。不使用无关旧仓库或伪造时间绕过。
3. **catalog提交/合并与市场安装：pending。** ui分类双语单YAML候选已准备；实际PR/索引合并和从市场≤60秒真实义务须补独立证据，不声称已可搜索。

核心构建期验收已通过；M0 S7与M4分发标准未完成，所以不宣称M0–M4全部完成。安装与产品边界见 [README](../README.md)，实现见 [007](007-implementation.md)，精确API见 [004](004-extension-api.md)。
