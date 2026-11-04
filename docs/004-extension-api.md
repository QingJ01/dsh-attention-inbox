# 004 扩展 API

本篇面向 work-item、GitHub、飞书、通知通道及其他第三方插件，记录 **v1.0.0-rc.2 候选、apiVersion: 1** 的实际公开接口。原提交要求继续保留；实现、受控测试和真实 GUI 证据分别记录在 [007](007-implementation.md)、[008](008-acceptance.md)，不能用接口存在替代 [006](006-roadmap.md) 验收。

## 接入与调用方生命周期

Host 插件可以硬依赖 `attention`，推荐用 `ctx.inject(['attention'], callback)` 可选接入：未安装收件箱时业务插件仍正常工作。类型通过 `import type { AttentionService, AttentionClientService, RaiseInput } from 'dsh-attention-inbox/api'` 引入；该入口同时有领域纯函数运行时导出，`import type` 不产生运行时依赖。

`attention` 和 `attentionClient` 都是 Cordis contextual Service。服务的 `this.ctx` 跟随真实调用方，注册函数自动把 disposer 绑定到该 caller；仍返回 disposer，供调用方提前注销。调用方卸载会撤回其显式/推导义务并清理注册；挂起的 raise 会等待结算后清理，不能把晚返回结果遗留给其他 caller。业务 source 的订阅等自有资源仍由调用方用 `ctx.effect` 管理。

`raise` 的 producer 可省略，由实际调用方 fiber 推导；显式指定 producer 也不能逃逸 caller 数量预算或归属。引擎类单独构造用于测试不等于 Cordis caller 接入，不应绕过 contextual Service 当作生产扩展入口。

## Host 服务 `ctx.attention`

```ts
interface AttentionService {
  readonly apiVersion: 1
  raise(input: RaiseInput, producer?: string): Promise<Obligation>
  withdraw(key: string, resolution?: Resolution): Promise<void>
  registerProducer(def: DerivedProducer): () => void
  invalidate(producerId: string, subjectRef: string): void
  registerSubjectType(def: SubjectTypeDef): () => void
  registerKind(def: KindDef): () => void
  registerAction(def: ActionDef): () => void
  registerChannel(def: ChannelDef): () => void
  registerFilter(def: FilterDef): () => void
  list(query?: {
    kinds?: string[]; subjectType?: string; includeSnoozed?: boolean
  }): Obligation[]
  watch(signal?: AbortSignal): AsyncIterable<object>
  act(key: string, revision: number, actionId: string,
      input?: unknown, via?: string, signal?: AbortSignal): Promise<{ accepted: true }>
  dispose(key: string, revision: number,
      disposition: { kind: 'dismissed' } | { kind: 'snoozed'; until: string }): Promise<void>
  getSettings(): { reviewEnabled: boolean; ledgerRetentionDays: number }
  updateSettings(patch: Partial<{
    reviewEnabled: boolean; ledgerRetentionDays: number
  }>): Promise<{ reviewEnabled: boolean; ledgerRetentionDays: number }>
  mute(scope: 'session' | 'workspace', ref: string, remove?: boolean): Promise<void>
}
type Resolution = 'withdrawn' | 'expired' | 'superseded' | 'acted'
interface RaiseInput {
  key: string
  subject: { type: string; ref: string }
  kind: string
  title: string
  blocking?: 'hard' | 'soft' | 'system'
  detail?: string
  options?: { id: string; label: string; recommended?: boolean }[]
  actions?: string[]
  openedAt?: string
  deadline?: string
  defaultAction?: { actionId: string; input?: unknown }
  certainty?: 'exact' | 'inferred'
  audience?: string
  payload?: Json
}
```

完整类型包括原生动作归属等内置适配接口，见 [公开声明](../lib/api.d.ts)。`watch` 产出完整快照，包含 items、groups、badge、settings、muteRules、funnel、metrics 和 health；具体可选扩展字段可能增加，调用方不要把未声明字段当作固定必有事实。

### 提交、规范 key 与默认动作

`raise` 等待持久化成功才返回；同内容按 key 幂等，内容/选项/动作变化时 revision 增加。key 按 producer、subject.type、subject.ref、local key 分段编码，避免冒号或其他字符逃逸命名空间。保存返回的规范 key，并把它传给 `withdraw`；对不存在的 key 撤回不报错。

`title` 必须非空。`blocking` 省略时采用 kind 默认等级；这不免除调用方如实使用 hard/system 的责任。`actions` 是条目允许的动作 id，不填时不会自动赋予未声明动作；要显示“打开”，显式包含 `subject.open` 并提供可用的主体导航。

`defaultAction` 是默认动作和 input 的**展示元数据**。原要求“收件箱只负责显示”保留：通用 Client 行展示 Host 动作元数据中的本地化标签，无标签时显示 actionId；不显示 input。独立 Client 渲染测试确认有标签且不调度执行，该测试不冒充真实 GUI 录制。收件箱不因 deadline 到期自动执行；到期逻辑由提交方负责，不做自动批准。`input` 的公开类型为 unknown，执行器必须验证自己的输入；持久化义务仍须 JSON-safe，函数、accessor、循环引用等会被规范化拒绝。

`includeSnoozed: true` 包含当前 snoozed revision，但不恢复 dismissed 项。普通查询继续遵守 review 设置、静音、到期和软事项过滤规则。设置更新是部分合并，账本保留天数为 1–3650；新增静音只允许已知 Session 或实际 Workspace id，且只作用于 soft。

### 推导型来源

```ts
interface DerivedProducer {
  id: string
  subjectType: string
  derive(subjectRef: string): Omit<RaiseInput, 'subject'>[]
}
```

`derive` 是不做 I/O 的纯函数，返回该主体当前全部义务；Host 补主体与 producer 命名空间，比较差异后打开、更新或撤回。调用方事实变化时调用 `invalidate`，不能靠通知条目被点击来推断业务已经成功。数量预算同时计算显式和推导提交，跨 subjectRef 累计；超限拒绝且保留此前事实。

### 主体类型与导航（S5）

```ts
interface SubjectTypeDef {
  type: string
  describe?(ref: string): {
    title: string; subtitle?: string; icon?: string
  } | undefined
  open?(ref: string): { panelId: string } | { url: string }
}
```

DSH 内部导航使用 `{ panelId: 'work-items' }`；外部导航使用 `{ url: 'https://…' }`，Client 仅允许 HTTP(S)。旧 `{ route: string }` 仍有兼容分支，但其字符串被当作 panel id 交给 `layout.selectPanel`，不是 URL router；新代码不要构造 `/work-items/${id}` 风格 route。Session 类型由原生 `uiWorkspace.openSession(sessionId)` 打开。指定轮次/工具调用和 composer 预填仍缺独立真实 GUI 证据，不是本 API 已验证承诺。

### Client 富主体 Slot

收件箱在 `main` 下声明 root-scope keyed Slot `attention.subject`。贡献者的注册 `name` 固定为 `attention.subject`，`key` 必须等于 `subject.type`，不使用 id 代替 key。

组件收到直接展开的 props：

```ts
interface AttentionSubjectProps {
  subject: { type: string; ref: string }
  obligation: Obligation
  description?: {
    title?: string; subtitle?: string; icon?: string
    open?: { panelId: string } | { url: string } | { route: string }
    workspace?: { id: string; title: string }
  }
}
```

这些字段不是 `props.owner`。注册的 `inject` 可省略；若返回自定义 props，renderer 按 kit → entry inject → slot inject → owner props 合并，最后的 subject/obligation/description 保持页面事实。页面用 `entryKey: subject.type` 选择组件；没有匹配贡献者时使用通用标题、副标题 fallback。

以下是未默认启用的 Client 模块示例，调用形态已核对实际 renderer 源码和 Slot 集成测试，不冒称已在真实 GUI 加载了此示例：

```js
window.__ModuleLoader__.load({
  id: 'example-attention-subject',
  factory(require) {
    const h = require('react').createElement
    function WorkItemSubject({ subject, obligation, description, prefix }) {
      return h('span', { title: obligation.title },
        `${prefix}${description?.title ?? subject.ref}`)
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('attention.subject', () => ctx.slots.register({
          name: 'attention.subject', key: 'work-item',
          inject: () => ({ prefix: '▣ ' }),
        }, WorkItemSubject))
      },
    }
  },
})
```

`slots.inject/register` 自身绑定 caller 生命周期，不需要再套一个用于重复注册的 `ctx.effect`。Slot 只提供主体富渲染，不赋予批准权限或关闭事实。

### Host 与 Client 动作

```ts
type ActionDef = {
  id: string
  label?: string | { zh: string; en: string }
  confirm?: 'none' | 'destructive'
} & (
  { side: 'host'; run(item: Obligation, input: unknown, signal: AbortSignal): Promise<void> }
  | { side: 'client'; run?: never }
)
interface AttentionClientService {
  readonly apiVersion: 1
  registerAction(def: {
    id: string
    confirm?: 'none' | 'destructive'
    run(item: Obligation, input: unknown, signal: AbortSignal): Promise<void>
  }): () => void
}
```

Host 的 `registerAction` 对 `side: client` 只注册元数据，不接受 Host executor；`ctx.attention.act` 只执行 Host action，拒绝 Client action。Client 按同 id 查找 `attentionClient` executor，确认条目声明该动作且 revision 最新。`confirm: destructive` 来自 Host 元数据或 Client executor 任一侧时都会要求真实确认，确认后再次核对 executor/条目；卸载自动注销并 abort 该注册的信号。执行成功不自动关闭条目，仍由业务事实变化或提交方撤回确认。

Host 声明元数据并把 id 放进相应义务的 actions：

```js
ctx.attention.registerAction({
  id: 'work-item.copy-ref', side: 'client',
  label: { zh: '复制引用', en: 'Copy reference' },
})
```

Client 模块可选接入并注册实际执行器：

```js
window.__ModuleLoader__.load({
  id: 'example-attention-actions',
  factory() {
    return {
      inject: [],
      apply(ctx) {
        ctx.inject(['attentionClient'], (scope) => {
          if (scope.attentionClient.apiVersion !== 1) return
          scope.attentionClient.registerAction({
            id: 'work-item.copy-ref',
            async run(item, _input, signal) {
              signal.throwIfAborted()
              await navigator.clipboard.writeText(item.subject.ref)
            },
          })
        })
      },
    }
  },
})
```

Client action id 必须以字母/数字开头，总长最多 200，只含字母、数字、点、下划线、冒号或连字符；同 id 不能重复注册。`approval.allow-once`、`approval.reject`、`question.answer`、`question.open`、`subject.open` 是保留 id，第三方不能替换。未安装执行器的 Client action 不显示可执行按钮，不会退回 Host 误执行。

### Channel（投递通道）

```ts
interface ChannelDef {
  id: string
  select?(item: Obligation): boolean
  deliver(item: Obligation, signal: AbortSignal): Promise<void>
  retract?(item: Obligation, resolution: Resolution): Promise<void>
}
```

默认只选择 system/hard，防止外部通道成为噪音源。当前实现按 key/revision 去重成功投递；失败重试采用指数退避，上限 60 秒。新 revision、义务关闭或调用方注销会取消旧投递和重试；关闭等待进行中的调用结算后再 retract，不让失败的旧调用复活重试。注销会 abort 信号并等待异步 adapter 清理。

原设计原文要求“每个义务的每个 revision 最多调用一次；收件箱负责去重和失败重试（指数退避，上限 1 分钟）”。这里保留要求并明确其边界：失败重试会再次调用 deliver，当前通过的是成功状态去重和失败重试测试，不能宣称同一 revision 的函数调用总次数始终 ≤1。这一严格表述冲突不通过删掉要求解决，也不承诺跨进程 exactly-once。队列/重试在进程内；外部提供方需使用稳定 key/revision 做自己的幂等处理。

通道收到人的回复后，可调用对应已注册 **Host** action 的 `ctx.attention.act`，仍检查 revision 和动作声明；不在 Host 代执行 Client 原生审批对象。

### 漏斗规则

```ts
interface FilterDef {
  id: string
  layer?: 'classify' | 'merge' | 'present'
  apply(item: Obligation, context: { now: string }): 'keep' | 'drop'
}
```

原要求保持：规则只能减少义务，不能新增或升级紧急程度。当前服务只允许 soft 被 drop；传给 filter 的是副本，不能通过修改参数提升等级或改变权威事实。L1/L2 只计可核实的丢弃/合并，不用普通消息总数编造“节省注意力”。

## 事件

| 事件 | 载荷 | 用途 |
|---|---|---|
| attention/opened | Obligation | 义务打开 |
| attention/updated | Obligation | 内容或 revision 变化 |
| attention/closed | `{ obligation, resolution, via? }` | 事实关闭与审计；via 是可选字段，未提供时不能猜处理归属 |

账本的 via 与 nativeConfirmed 用于已确认的原地处置统计；仅收到 opened/closed 事件或 Client accepted 不足以推断原生审批已经成功。

## 契约：提交方必须遵守的规则

以下原要求保持，不因候选实现或示例降低。服务拒绝可机器校验的结构、JSON 安全与预算违规；真实业务语义和不放密钥仍是提交方责任，不能声称通过类型检查就已经验证语义。

1. **一个义务只问一件具体的事**：title 不能为空，不能只是一份进度汇报。
2. **必须能关闭**：提交方负责在事实不再成立时调用 withdraw。插件卸载时会自动撤回，超过 30 天没有更新的外部义务以 expired 关闭。
3. **阻塞等级要诚实**：hard 只能用于“有一个执行体停下来在等人”；system 只能用于影响全局的问题。
4. **不放密钥**：title、detail 和 options 会被显示，也可能被 Channel 发到外部。
5. **数量预算**：每个插件同时打开的义务默认最多 50 个，超过时拒绝并记警告，防止失控的插件刷屏。当前预算合并显式/推导、跨 ref 与显式 producer 别名，更新已有条目不额外消耗名额。
6. **不得自行升级**：漏斗规则只能减少义务。

## Host 示例与验证

[hello-producer](../examples/hello-producer/index.js) 是 28 行 opt-in 示例：caller 的 source 真实 ready 事实触发 raise；Host action 先完成业务 accept 再 withdraw；自有订阅由 ctx.effect 清理；未提交事实时挂载不会制造义务。

work-item 等推导型适配可以这样连接已有业务仓库：

```js
export function apply(ctx) {
  ctx.inject(['attention'], (scope) => {
    const inbox = scope.attention
    if (inbox.apiVersion !== 1) return
    inbox.registerSubjectType({
      type: 'work-item',
      describe: (id) => {
        const ticket = tickets.get(id)
        return ticket && { title: ticket.title, subtitle: ticket.stage }
      },
      open: () => ({ panelId: 'work-items' }),
    })
    inbox.registerProducer({
      id: 'work-item', subjectType: 'work-item',
      derive: (id) => {
        const ticket = tickets.get(id)
        return ticket?.report === 'ready'
          ? [{ key: 'review', kind: 'review', blocking: 'soft',
               title: `${ticket.title} 已就绪，待验收`, actions: ['subject.open'] }]
          : []
      },
    })
    scope.effect(() => tickets.onChange((id) => inbox.invalidate('work-item', id)))
  })
}
```

tickets 是调用方已经持有的真实业务仓库，不由收件箱创建；示例不是默认启用的假业务来源。

独立 [扩展测试](../tests/extension.test.mjs)、[caller/Channel 测试](../tests/contextual.test.mjs) 和 [Client 测试](../tests/client.test.mjs) 验证预算、拒绝无效输入、自动生命周期、过期、重试/取消、同 id 执行器与 Slot。公开 [TypeScript fixture](../tests/fixtures/extension-contract.ts) 使用 TypeScript 5.9.3 实际编译正反例，未把 unknown 动作输入错误收窄为 Json。完整测试结果与真实运行边界见 [008](008-acceptance.md)。

## 版本与兼容

apiVersion 只在不兼容时增加；新增可选字段或注册类型不算不兼容。配套插件检查主版本，不匹配时不接入并记警告，自身照常工作。内置 kind（approval、question、plan-review、goal-blocked、turn-failed、review、credential）及动作 id 是公开契约，改名视为不兼容。
