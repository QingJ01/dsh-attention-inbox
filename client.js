/**
 * Attention inbox — Browser half.
 *
 * The page, the sidebar entry and the in-place actions. Everything that blocks a
 * Session (an approval, a question, a plan review) is read from the live
 * `uiSession` status the Web sidebar already renders, so the inbox never
 * disagrees with it, and an approval is answered through the very same pending
 * object the native composer uses. The Host half adds what the sidebar cannot
 * see: a blocked goal, a failed turn, a broken credential and obligations other
 * plugins submit. When the Host half is unreachable the page keeps working from
 * the Client facts alone.
 *
 * Design: docs/003-architecture.md and docs/005-ux.md.
 */
window.__ModuleLoader__.load({
  id: 'dsh-attention-inbox',
  factory(require) {
    const React = require('react')
    const { Service } = require('@deepseek-ai/cordis')
    const h = React.createElement
    const { useSyncExternalStore, useState } = React

    const PANEL_ID = 'attention-inbox'
    const NS = 'attention-inbox'
    const ROUTE = 'api/attention-inbox'

    /* --------------------------------------------------------------- copy */

    const zh = {
      panel: '注意力收件箱',
      title: '注意力收件箱',
      groupSystem: '系统',
      groupWaiting: 'Agent 在等你',
      groupDecide: '待你决定下一步',
      empty: '没有需要你的事。',
      emptyHint: '它会自动收集所有会话里等你处理的事，不需要任何设置。',
      loading: '正在汇总…',
      historyPartial: '部分历史会话未能读取，当前显示实时事项和已读取的历史事项。',
      hostUnavailable: '后台汇总暂不可用；交互保持实时，其他条目为上次读取的状态。',
      kindApproval: '需要批准',
      kindQuestion: '需要回答',
      kindPlan: '计划待批准',
      kindGoal: '目标受阻',
      kindFailed: '运行出错',
      kindReview: '待验收',
      kindCredential: '系统',
      allowOnce: '允许一次',
      reject: '拒绝',
      answer: '回答',
      open: '打开',
      openPlan: '查看计划',
      dismiss: '忽略',
      snooze: '稍后',
      working: '处理中…',
      failedAction: '操作未完成，请重试或打开来源处理',
      waitedSecond: '刚刚',
      waitedMinute: '分钟',
      waitedHour: '小时',
      waitedDay: '天',
      ago: '前',
      blockedGoal: '目标受阻',
      deadline: '截止',
      defaultAction: '截止时默认动作',
      dropped: '今天替你挡掉',
      obligations: '待处理',
      customAnswer: '补充或自定义回答',
      settings: '设置', back: '返回收件箱', reviewEnabled: '显示待验收事项', ledgerRetentionDays: '账本保留天数',
      save: '保存', saved: '已保存', settingsFailed: '设置未保存，请重试', mute: '静音', muteSession: '这个会话',
      muteWorkspace: '这个工作区', muteRules: '静音规则（只对不阻塞 Agent 的事项生效）', noMuteRules: '没有静音规则', unmute: '解除静音',
      hardResponse: '中位响应', inPlace: '原地处理率', noSamples: '暂无样本', coverage: '覆盖缺口',
      sourceL1: '规则过滤', sourceL2: '合并去重', planApprove: '批准计划', awaitingFact: '已提交，等待原生状态确认…',
      nativeTrackingFailed: '原生操作统计同步失败；可重试同步', retryTracking: '重试统计同步',
      noisySource: '这个来源经常被忽略，建议调整来源规则',
      unitSecond: ' 秒', watching: '正在盯着', sessionsUnit: '个会话', coverageGapLabel: '个会话暂未覆盖',
      coverageTip: '所有会话的待处理请求都已汇总到这里',
      heroSystem: '件系统问题要你先处理', heroHard: '个 Agent 停下来等你处理', heroSoft: '件事等你决定下一步',
      heroSystemOne: '件系统问题要你先处理', heroHardOne: '个 Agent 停下来等你处理', heroSoftOne: '件事等你决定下一步',
      heroCalm: '一切都在跑，没有需要你的事', heroCleared: '清空了，干得漂亮',
      subOldest: '最久的已经等了', subInPlace: '在这里直接处理，不用切过去', subSoft: 'Agent 都没停下，这些等你有空再看就行',
      clearedPrefix: '这一轮你在这里处理了 ', clearedSuffix: ' 件事，一次都没切走。',
      radarRunningCount: '个 Agent 正在跑。', radarRunningHint: '谁卡住或需要你拍板，会第一时间出现在这里。',
      radarIdleHint: '现在没有在跑的 Agent。它卡住或需要你拍板的那一刻，会出现在这里。',
      radarTitle: '它在替你盯着', radarRunning: '正在跑', radarDone: '刚跑完', agentStateRunning: '运行中', agentStateDone: '刚完成', agentReading: '正在读它做了什么…', agentsMorePrefix: '另外还有 ', agentsMoreSuffix: ' 个', alsoRunningPrefix: '另外还有 ', alsoRunningSuffix: ' 个 Agent 在跑',
      statInPlaceToday: '今天在这里处理', statMedian: '中位响应', resolvedToast: '搞定，没离开这一页',
      subJustNow: '刚刚停下来', calmPrefix: '正在盯着你的 ', calmSuffix: ' 个会话，暂时没人需要你。',
      perkHere: '审批、提问、计划审批，全部在这里原地处理', perkOrder: '谁等得最久排最前，实时计时，系统问题永远置顶', perkKeys: 'J / K 切换 · ↵ 允许一次 · Esc 拒绝 · O 打开来源',
      howCounted: '这些数字怎么来的', fromNote: '来自笔记', planTitle: '今天的计划', planOpen: '打开每日笔记 →', planLeft: '件事待办', planWaiting: '个在等你',
      errNoKey: '没有配置模型的 API Key，Agent 调不了模型。到「设置 › 模型」填好后，打开会话重试。',
      errAuth: '模型服务不认这个 API Key（无效或已过期）。到「设置 › 模型」更新后，打开会话重试。',
      errQuota: '模型账户的余额或额度用完了。充值或换一个模型后，打开会话重试。',
      errRate: '模型服务限流了（请求太频繁）。等一会儿再打开会话重试。',
      errContext: '对话太长，超出了模型一次能处理的长度。新开一个会话接着做，或先让它压缩上下文。',
      errNetwork: '连不上模型服务（网络问题或超时）。检查网络后，打开会话重试。',
      errServer: '模型服务那边暂时出错了，不是你的问题。稍后打开会话重试。',
      errCut: '回复太长，被截断了。打开会话让它接着写。',
      errInterrupted: '这一轮被中途打断了（可能是重启或断线）。打开会话让它继续。',
      errBlocked: '这一轮被拦下，没有继续。打开会话看看原因。',
      errUnknown: '这一轮出错停下了。打开会话查看完整信息。',
      rawError: '原始信息', reviewFallback: '自主运行已经跑完，等你看一眼结果。', goalDone: '目标已完成，等你确认结果。',
      planFallback: '计划', planQuestion: '批准这份计划，让 Agent 开始动手？', keepPlanning: '继续完善计划',
      kbdNav: '切换', inferred: '推断', collapse: '收起', showMore: '展开详情', showFullPlan: '展开完整计划',
    }

    const en = {
      panel: 'Attention inbox',
      title: 'Attention inbox',
      groupSystem: 'System',
      groupWaiting: 'Agents waiting for you',
      groupDecide: 'Waiting for your decision',
      empty: 'Nothing needs you.',
      emptyHint: 'It collects what is waiting for you in every Session, with no setup.',
      loading: 'Collecting…',
      historyPartial: 'Some history could not be read; live items and successfully read history are shown.',
      hostUnavailable: 'Host summary unavailable; interactions are live, other items reflect the last successful read.',
      kindApproval: 'Needs approval',
      kindQuestion: 'Needs an answer',
      kindPlan: 'Plan to approve',
      kindGoal: 'Goal blocked',
      kindFailed: 'Run failed',
      kindReview: 'Ready to review',
      kindCredential: 'System',
      allowOnce: 'Allow once',
      reject: 'Reject',
      answer: 'Answer',
      open: 'Open',
      openPlan: 'Open plan',
      dismiss: 'Dismiss',
      snooze: 'Later',
      working: 'Working…',
      failedAction: 'The action did not complete; retry or open its source',
      waitedSecond: 'just now',
      waitedMinute: 'min',
      waitedHour: 'h',
      waitedDay: 'd',
      ago: '',
      blockedGoal: 'Goal blocked',
      deadline: 'due',
      defaultAction: 'Default action at deadline',
      dropped: 'Filtered today',
      obligations: 'Open items',
      customAnswer: 'Additional or custom answer',
      settings: 'Settings', back: 'Back to inbox', reviewEnabled: 'Show review items', ledgerRetentionDays: 'Ledger retention days',
      save: 'Save', saved: 'Saved', settingsFailed: 'Settings were not saved; retry', mute: 'Mute', muteSession: 'This Session',
      muteWorkspace: 'This Workspace', muteRules: 'Mute rules (soft items only)', noMuteRules: 'No mute rules', unmute: 'Unmute',
      hardResponse: 'Median hard response', inPlace: 'Hard items handled in inbox', noSamples: 'No samples', coverage: 'Coverage gap',
      sourceL1: 'rules', sourceL2: 'merged', planApprove: 'Approve plan', awaitingFact: 'Submitted; waiting for native confirmation…',
      nativeTrackingFailed: 'Native action metrics could not sync; retry sync', retryTracking: 'Retry metrics sync',
      noisySource: 'This source is often dismissed; consider changing its rules',
      unitSecond: 's', watching: 'Watching', sessionsUnit: 'Sessions', coverageGapLabel: 'Sessions not covered',
      coverageTip: 'Pending requests from every Session are collected here',
      heroSystem: ' system issues need you first', heroHard: ' agents paused, waiting on you', heroSoft: ' things wait for your call',
      heroSystemOne: ' system issue needs you first', heroHardOne: ' agent paused, waiting on you', heroSoftOne: ' thing waits for your call',
      heroCalm: 'Everything is running. Nothing needs you.', heroCleared: 'Inbox zero. Nicely done.',
      subOldest: 'Longest wait', subInPlace: 'handle them right here, no switching', subSoft: 'No agent is blocked — look when you have a moment',
      clearedPrefix: 'You handled ', clearedSuffix: ' here this round without switching once.',
      radarRunningCount: 'agents running. ', radarRunningHint: 'The moment one gets stuck or needs your call, it lands here.',
      radarIdleHint: 'No agents running right now. The moment one gets stuck or needs your call, it lands here.',
      radarTitle: 'Watching for you', radarRunning: 'Running', radarDone: 'Just finished', agentStateRunning: 'Running', agentStateDone: 'Finished', agentReading: 'Reading what it did…', agentsMorePrefix: '+', agentsMoreSuffix: ' more', alsoRunningPrefix: '', alsoRunningSuffix: ' more agents running',
      statInPlaceToday: 'Handled here today', statMedian: 'Median response', resolvedToast: 'Done, without leaving this page',
      subJustNow: 'Just paused', calmPrefix: 'Watching your ', calmSuffix: ' Sessions. Nobody needs you right now.',
      perkHere: 'Approvals, questions and plan reviews handled right here', perkOrder: 'Longest wait first, with live timers; system issues always on top', perkKeys: 'J / K to move · ↵ allow once · Esc reject · O open source',
      howCounted: 'How these numbers are counted', fromNote: 'From note', planTitle: 'Today\'s plan', planOpen: 'Open daily notes →', planLeft: ' open items', planWaiting: ' waiting for you',
      errNoKey: 'No API key is set for the model, so the agent cannot call it. Add one in Settings › Models, then open the session and retry.',
      errAuth: 'The model service rejected the API key (invalid or expired). Update it in Settings › Models, then open the session and retry.',
      errQuota: 'The model account is out of balance or quota. Top up or switch models, then open the session and retry.',
      errRate: 'The model service is rate limiting requests. Wait a moment, then open the session and retry.',
      errContext: 'The conversation is longer than the model can handle at once. Continue in a new session, or have it compact the context first.',
      errNetwork: 'Could not reach the model service (network or timeout). Check the connection, then open the session and retry.',
      errServer: 'The model service had a temporary error on its side. Open the session and retry in a bit.',
      errCut: 'The reply was too long and got cut off. Open the session and ask it to continue.',
      errInterrupted: 'This turn was interrupted (for example by a restart or a dropped connection). Open the session and ask it to continue.',
      errBlocked: 'This turn was stopped before it finished. Open the session to see why.',
      errUnknown: 'This turn stopped with an error. Open the session for the full details.',
      rawError: 'Original message', reviewFallback: 'An autonomous run finished; take a look at the result.', goalDone: 'Goal completed; confirm the result.',
      planFallback: 'Plan', planQuestion: 'Approve this plan so the agent can start?', keepPlanning: 'Keep planning',
      kbdNav: 'move', inferred: 'Inferred', collapse: 'Collapse', showMore: 'Show details', showFullPlan: 'Show full plan',
    }

    /* ---------------------------------------------------------- ordering */

    const KINDS = {
      credential: { blocking: 'system', rank: 0, group: 'system' },
      approval: { blocking: 'hard', rank: 0, group: 'waiting' },
      'plan-review': { blocking: 'hard', rank: 1, group: 'waiting' },
      question: { blocking: 'hard', rank: 2, group: 'waiting' },
      'goal-blocked': { blocking: 'soft', rank: 0, group: 'decide' },
      'turn-failed': { blocking: 'soft', rank: 1, group: 'decide' },
      review: { blocking: 'soft', rank: 2, group: 'decide' },
    }
    const GROUP_ORDER = ['system', 'waiting', 'decide']
    const BADGE = new Set(['system', 'hard'])

    function meta(item, registry = {}) {
      const kind = typeof item === 'string' ? item : item.kind
      const definition = registry[kind] ?? KINDS[kind] ?? {}
      const blocking = (typeof item === 'object' && item.blocking) || definition.blocking || 'soft'
      return { ...definition, blocking, rank: Number.isFinite(definition.rank) ? definition.rank : 9,
        group: blocking === 'system' ? 'system' : blocking === 'hard' ? 'waiting' : 'decide' }
    }

    function compare(a, b, registry) {
      const ma = meta(a, registry), mb = meta(b, registry)
      const tier = GROUP_ORDER.indexOf(ma.group) - GROUP_ORDER.indexOf(mb.group)
      if (tier) return tier
      if (ma.rank !== mb.rank) return ma.rank - mb.rank
      const date = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : Infinity
      const da = date(a.deadline), db = date(b.deadline)
      if (da !== db) return da < db ? -1 : 1
      return date(a.openedAt) - date(b.openedAt) || a.key.localeCompare(b.key)
    }

    function nativeCallId(value, kind = value?.kind) {
      const named = value?.native?.callId ?? value?.callId
      if (typeof named === 'string' && named.trim().length > 0) return named
      // A non-timed native plan card is unnamed. Its single validated plan
      // intent names the real execution; never infer an id from labels or keys.
      if (kind !== 'plan-review') return undefined
      const review = planReviewOf(value?.questions)
      const callId = review?.question.intent?.callId
      return typeof callId === 'string' && callId.trim().length > 0 ? callId : undefined
    }

    // The pending object is the authority. Cache only its first-observed time,
    // never a second copy of its answer channel or its lifecycle.
    function clientObligations(statuses, previous = new Map()) {
      const items = [], live = new Map()
      for (const [sessionId, status] of statuses) {
        const interaction = status?.pendingInteraction
        if (!interaction) continue
        const card = interaction.getSnapshot?.()
        // Match the sidebar's raw pendingInteraction presence, including a new
        // native kind or a channel transition. Unsupported cards remain openable.
        const supported = ['approval', 'question', 'plan-review'].includes(interaction.kind)
        const kind = supported ? interaction.kind : 'question'
        const key = `client:${kind}:${sessionId}:${interaction.key ?? nativeCallId(interaction, kind) ?? ''}`
        const old = previous.get(key)
        const openedAt = old?.openedAt ?? new Date().toISOString()
        const signature = JSON.stringify([titleOf(interaction, kind), interaction.questions, interaction.reason, interaction.displayReason])
        const revision = old?.signature === signature ? old.revision : (old?.revision ?? 0) + 1
        const canAnswer = supported && kind !== 'approval' && interaction.answerable !== false && typeof interaction.answer === 'function' &&
          card && !card.closed && card.state !== 'settled' && ['waterfall', 'rpc'].includes(card.channel)
        items.push({ key, revision, producer: 'client', subject: { type: 'session', ref: sessionId },
          kind, blocking: 'hard', title: titleOf(interaction, kind), openedAt, certainty: 'exact',
          questions: canAnswer ? interaction.questions : undefined,
          detail: kind === 'plan-review' ? interaction.questions?.map((q) => q.detail).filter(Boolean).join('\n\n') : undefined,
          actions: kind === 'approval' && interaction.answerable !== false && typeof interaction.answer === 'function'
            ? ['approval.allow-once', 'approval.reject', 'subject.open']
            : ['subject.open'] })
        live.set(key, { interaction, sessionId, openedAt, signature, revision })
      }
      return { items, live }
    }

    function titleOf(interaction, kind) {
      if (kind === 'approval') {
        return interaction.reason ? `${interaction.toolName}: ${interaction.reason}` : String(interaction.toolName ?? '')
      }
      const question = interaction.questions?.[0]?.question ?? interaction.question
      return typeof question === 'string' && question.length > 0 ? question : ''
    }

    /* -------------------------------------------------------------- apply */

    function apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'attention-inbox: dictionaries')
        const t = ctx.locale.bind(NS)

        // One observable view shared by the page and the sidebar badge.
        let snapshot = {
          phase: 'loading',
          items: [],
          groups: [],
          counts: {},
          total: 0,
          badge: 0,
          funnel: { droppedToday: 0, shownToday: 0 },
          hostAvailable: true,
          dispositions: {},
          pending: {},
          coverage: { gap: 0, missingSessionIds: [], nativeSessionCount: 0, checks: 0 },
          settings: { reviewEnabled: true, ledgerRetentionDays: 90 }, muteRules: [], metrics: {},
          settingsPending: false, settingsError: false, nativeTrackingFailed: false,
        }
        const listeners = new Set()
        const source = {
          getSnapshot: () => snapshot,
          subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        }
        const publish = (patch) => {
          snapshot = { ...snapshot, ...patch }
          for (const listener of listeners) listener()
        }
        let live = new Map()
        let host = { items: [], kinds: {}, actions: {}, subjects: {}, dispositions: {} }
        let active = true
        let controller
        let generation = 0
        const clientId = globalThis.crypto?.randomUUID?.() ?? `inbox:${Date.now()}:${Math.random().toString(36).slice(2)}`
        const cardSubscriptions = new Map()
        const busy = new Set()
        const clientActions = new Map()
        const awaitingNative = new Map()
        const trackingQueue = new Map()
        const finishedNative = new Set()
        const answeredNative = new Map()
        const nativeKey = (sessionId, kind, value) => `${sessionId}:${nativeCallId(value, kind) || `${kind}:${value.toolName ?? ''}`}`
        const localeText = (value) => {
          if (typeof value === 'string') return value
          if (value && typeof value === 'object') {
            const locale = ctx.locale.getSnapshot?.() ?? ctx.locale.getLocale?.()
            const id = typeof locale === 'string' ? locale : locale?.active ?? locale?.id ?? 'zh'
            return value[id] ?? value[id.startsWith('zh') ? 'zh' : 'en'] ?? value.en ?? value.zh ?? ''
          }
          return ''
        }

        const callHost = async (body, signal) => {
          const response = await fetch(new URL(ROUTE, document.baseURI).href, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            credentials: 'same-origin', body: JSON.stringify(body), signal,
          })
          const data = await response.json()
          if (!response.ok || data.ok === false) throw new Error(data.message ?? `HTTP ${response.status}`)
          return data
        }
        const lifetime = new AbortController()
        // Remote namespaces are independent traced Cordis services. The raw
        // root service stores a namespace registry, not userQuestions getters.
        const questionRemote = () => {
          try { return ctx.get?.('remote.userQuestions') ?? ctx.remote?.userQuestions }
          catch { return undefined } // An optional namespace may be absent or outside this caller's inject roster.
        }
        const canAnswerContinued = (item) => ['question', 'plan-review'].includes(item?.kind) &&
          item.subject?.type === 'session' && item.native?.state === 'continued' && nativeCallId(item) !== undefined &&
          Array.isArray(item.questions) && item.questions.length > 0 && typeof questionRemote()?.answer === 'function'
        const continuedOf = (current) => {
          const callId = nativeCallId(live.get(current.key)?.interaction ?? current, current.kind)
          if (!callId) return undefined
          return host.items.find((item) => item.subject?.type === 'session' && item.subject.ref === current.subject?.ref &&
            item.kind === current.kind && nativeCallId(item) === callId && canAnswerContinued(item))
        }
        const rebuild = () => {
          if (!active) return
          const statuses = ctx.uiSession.sessionStatus.getSnapshot()
          const local = clientObligations(statuses, live)
          const currentNative = new Set([...local.live.values()].map((entry) => nativeKey(entry.sessionId, entry.interaction.kind, entry.interaction)))
          for (const entry of live.values()) {
            const interaction = entry.interaction, card = interaction.getSnapshot?.()
            const identity = nativeKey(entry.sessionId, interaction.kind, interaction)
            // Losing a composer seat is not settlement: timed questions can
            // continue through RPC without a retained Session or pending card.
            if (interaction.kind === 'approval' && interaction.answerable === false) finishedNative.add(identity)
            else if (answeredNative.get(identity)?.interaction === interaction && (card?.closed || card?.state === 'settled'))
              finishedNative.add(identity)
          }
          if (finishedNative.size > 1000) finishedNative.delete(finishedNative.values().next().value)
          live = local.live
          for (const [key, record] of cardSubscriptions) {
            if (live.get(key)?.interaction !== record.interaction) {
              record.unsubscribe()
              cardSubscriptions.delete(key)
            }
          }
          for (const [key, entry] of live) {
            if (!cardSubscriptions.has(key) && typeof entry.interaction.subscribe === 'function') {
              const unsubscribe = entry.interaction.subscribe(rebuild)
              cardSubscriptions.set(key, { interaction: entry.interaction, unsubscribe })
            }
          }
          // Deduplicate live cards and suppress only confirmed closed requests.
          // A missing waterfall alone must not hide an active continued question.
          const hostItems = host.items.filter((item) => {
            if (item.producer === 'client') return false
            if (!item.native || item.subject?.type !== 'session') return true
            const identity = nativeKey(item.subject.ref, item.kind, item.native)
            return !currentNative.has(identity) && !finishedNative.has(identity)
          }).map((item) => item.native && ['question', 'plan-review'].includes(item.kind)
            ? { ...item, questions: canAnswerContinued(item) ? item.questions : undefined } : item)
          const localItems = local.items.map((item) => {
            const continued = !item.questions && continuedOf(item)
            return continued ? { ...item, questions: continued.questions, native: continued.native } : item
          })
          const items = [...localItems, ...hostItems].filter((item) => {
            if (meta(item, host.kinds).blocking !== 'soft') return true
            const d = host.dispositions[item.key]
            return !d || d.revision !== item.revision ||
              (d.kind !== 'dismissed' && !(d.kind === 'snoozed' && Date.parse(d.until) > Date.now()))
          }).sort((a, b) => compare(a, b, host.kinds))
          const keys = new Set(items.map((item) => item.key))
          for (const [key, timer] of awaitingNative) if (!keys.has(key)) {
            clearTimeout(timer)
            awaitingNative.delete(key)
          }
          const nativeSessionIds = [...statuses].filter(([, status]) => status?.pendingInteraction).map(([id]) => id)
          const listedSessions = new Set(items.filter((item) => item.subject?.type === 'session').map((item) => item.subject.ref))
          const missingSessionIds = nativeSessionIds.filter((id) => !listedSessions.has(id))
          const coverage = { gap: missingSessionIds.length, missingSessionIds, nativeSessionCount: nativeSessionIds.length,
            checks: snapshot.coverage.checks + 1 }
          const retain = (map) => Object.fromEntries(Object.entries(map ?? {}).filter(([key]) => keys.has(key)))
          const groups = GROUP_ORDER.map((id) => ({ id, items: items.filter((item) => meta(item, host.kinds).group === id) }))
            .filter((group) => group.items.length)
          publish({ phase: 'ready', items, groups, total: items.length,
            counts: Object.fromEntries(groups.map((group) => [group.id, group.items.length])),
            badge: items.filter((item) => BADGE.has(meta(item, host.kinds).blocking)).length,
            kinds: host.kinds, actions: host.actions, subjects: host.subjects, health: host.health, coverage,
            settings: host.settings ?? snapshot.settings, muteRules: host.muteRules ?? snapshot.muteRules,
            metrics: host.metrics ?? snapshot.metrics, clientActions: [...clientActions.keys()], activity: host.activity ?? snapshot.activity, activityReady: host.activityReady ?? snapshot.activityReady,
            dispositions: host.dispositions, pending: retain(snapshot.pending), failed: retain(snapshot.failed) })
        }
        const refresh = async () => {
          if (!active) return
          const ownGeneration = ++generation
          controller?.abort()
          controller = new AbortController()
          try {
            const statusesOf = () => { try { return ctx.uiSession?.sessionStatus?.getSnapshot?.() } catch { return undefined } }
            const visibleSessionIds = Object.entries(ctx.sessions.list.getSnapshot().byId ?? {})
              .filter(([, row]) => row.retainedBy?.mainView > 0).map(([id]) => id).sort()
            // Refresh the per-browser lease every poll, including empty lists.
            const snap = ctx.sessions.list.getSnapshot()
            const statusSnap = statusesOf()
            const busyIds = Object.entries(snap.byId ?? {})
              .filter(([id, row]) => row.running === true || statusSnap?.get?.(id)?.completionUnread)
              .map(([id]) => id).slice(0, 30)
            try {
              await callHost({ op: 'telemetry', clientId, visibleSessionIds, activitySessionIds: busyIds }, controller.signal)
            } catch (error) { if (error.name === 'AbortError') throw error }
            let state = await callHost({ op: 'state' }, controller.signal)
            if (!active || ownGeneration !== generation) return
            const rows = ctx.sessions.list.getSnapshot().byId ?? {}
            const viewed = [...new Set((state.items ?? []).filter((item) => item.kind === 'review' && item.subject.type === 'session' && rows[item.subject.ref]?.retainedBy?.mainView > 0).map((item) => item.subject.ref))]
            if (viewed.length) {
              await callHost({ op: 'viewed', sessionIds: viewed }, controller.signal)
              state = await callHost({ op: 'state' }, controller.signal)
              if (!active || ownGeneration !== generation) return
            }
            const nextItems = Array.isArray(state.items) ? state.items : []
            const nextNative = new Set(nextItems.filter((item) => item.native && item.subject?.type === 'session')
              .map((item) => nativeKey(item.subject.ref, item.kind, item.native)))
            for (const item of host.items) if (item.native && item.subject?.type === 'session') {
              const identity = nativeKey(item.subject.ref, item.kind, item.native)
              if (answeredNative.has(identity) && !nextNative.has(identity)) finishedNative.add(identity)
            }
            host = { ...state, items: nextItems, kinds: state.kinds ?? {},
              actions: state.actions ?? {}, subjects: state.subjects ?? {}, dispositions: state.dispositions ?? {}, health: state.health,
              metrics: state.metrics ?? {} }
            publish({ hostAvailable: true, funnel: state.funnel ?? {} })
          } catch (error) {
            if (!active || ownGeneration !== generation || error.name === 'AbortError') return
            // Keep last-known Host blockers visible rather than silently hiding
            // them on network failure; the degraded notice explains freshness.
            publish({ hostAvailable: false })
          }
          rebuild()
        }
        const currentItem = (obligation) => {
          rebuild()
          const current = snapshot.items.find((item) => item.key === obligation.key)
          if (!current || current.revision !== obligation.revision) throw new Error('stale obligation')
          return current
        }
        const openSubject = (obligation) => {
          if (obligation.subject?.type === 'session') {
            const workspace = ctx.uiWorkspace ?? ctx.get?.('uiWorkspace')
            if (typeof workspace?.openSession !== 'function') throw new Error('Session navigation unavailable')
            workspace.openSession(obligation.subject.ref)
            if (obligation.kind === 'review') void callHost({ op: 'viewed', sessionIds: [obligation.subject.ref] }, lifetime.signal).then(refresh).catch(() => {})
            return
          }
          const description = host.subjects[obligation.key] ?? obligation.subjectDescription
          const target = description?.open
          if (target?.panelId || target?.route) {
            const layout = ctx.layout ?? ctx.get?.('layout')
            if (typeof layout?.selectPanel !== 'function') throw new Error('Panel navigation unavailable')
            layout.selectPanel(target.panelId ?? target.route)
            return
          }
          if (target?.url) {
            const url = new URL(target.url, document.baseURI)
            if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported subject URL')
            window.open(url.href, '_blank', 'noopener,noreferrer')
            return
          }
          // Registered Host actions own custom subjects; never silently succeed.
          throw new Error('No subject navigation available')
        }
        const execute = async (obligation, operation) => {
          if (!active || busy.has(obligation.key) || awaitingNative.has(obligation.key)) return
          busy.add(obligation.key)
          const failed = { ...snapshot.failed }; delete failed[obligation.key]
          publish({ pending: { ...snapshot.pending, [obligation.key]: true }, failed })
          try {
            const current = currentItem(obligation)
            await operation(current)
            if (active) { rebuild(); await refresh() }
          } catch (error) {
            if (active && snapshot.items.some((item) => item.key === obligation.key))
              publish({ failed: { ...snapshot.failed, [obligation.key]: true } })
          } finally {
            busy.delete(obligation.key)
            if (active) {
              const pending = { ...snapshot.pending }
              if (!awaitingNative.has(obligation.key)) delete pending[obligation.key]
              publish({ pending })
            }
          }
        }
        // Acknowledgements only correlate a user action with Host-native facts.
        // Neither a resolved Promise nor disappearance of a card records acted.
        const trackNative = async (body) => {
          const id = JSON.stringify([body.key, body.revision, body.actionId, body.phase])
          try {
            await callHost({ op: 'native-action', ...body }, lifetime.signal)
            trackingQueue.delete(id)
          } catch {
            trackingQueue.set(id, body)
          }
          if (active) publish({ nativeTrackingFailed: trackingQueue.size > 0 })
        }
        const retryTracking = async () => {
          for (const body of [...trackingQueue.values()]) await trackNative(body)
          await refresh()
        }
        const waitForNativeFact = (current) => {
          rebuild()
          if (snapshot.items.some((item) => item.key === current.key)) {
            const timer = setTimeout(() => {
              awaitingNative.delete(current.key)
              if (!active) return
              rebuild()
              if (snapshot.items.some((item) => item.key === current.key)) {
                const pending = { ...snapshot.pending }; delete pending[current.key]
                publish({ pending, failed: { ...snapshot.failed, [current.key]: true } })
              }
            }, 5000)
            awaitingNative.set(current.key, timer)
          }
        }
        const answerNative = async (current, actionId, input) => {
          const entry = live.get(current.key), interaction = entry?.interaction
          if (!interaction || interaction.answerable === false || typeof interaction.answer !== 'function') throw new Error('native answer unavailable')
          const channel = interaction.getSnapshot?.()?.channel
          const callId = nativeCallId(interaction)
          const mirror = callId && host.items.find((item) => item.subject?.type === 'session' &&
            item.subject.ref === entry.sessionId && item.kind === interaction.kind && nativeCallId(item) === callId)
          // PendingApproval.key is a browser render counter, not the Host request
          // id. Prefer the exact mirror; otherwise correlate only by tool call.
          const body = { key: mirror?.key ?? current.key, revision: mirror?.revision ?? current.revision, actionId, sessionId: entry.sessionId,
            kind: interaction.kind, callId, requestId: mirror?.native?.requestId }
          await trackNative({ ...body, phase: 'attempt' })
          try {
            // The request may have changed while the acknowledgement was in flight.
            currentItem(current)
            const freshCard = interaction.getSnapshot?.()
            if (live.get(current.key)?.interaction !== interaction || interaction.answerable === false || nativeCallId(interaction) !== callId ||
                (interaction.kind !== 'approval' && (!freshCard || freshCard.closed || freshCard.state === 'settled' ||
                  !['waterfall', 'rpc'].includes(freshCard.channel)))) throw new Error('native request replaced or expired')
            const result = await interaction.answer(input)
            if (result === false) throw new Error('native answer refused')
          } catch (error) {
            await trackNative({ ...body, phase: 'failed' })
            throw error
          }
          const identity = nativeKey(entry.sessionId, interaction.kind, interaction)
          answeredNative.set(identity, { interaction: channel === 'waterfall' ? interaction : undefined })
          const card = interaction.getSnapshot?.()
          if ((interaction.kind === 'approval' && interaction.answerable === false) ||
              (channel === 'waterfall' && (card?.closed || card?.state === 'settled'))) finishedNative.add(identity)
          await trackNative({ ...body, phase: 'accepted' })
          waitForNativeFact(current)
        }
        const answerContinued = async (current, input) => {
          const continued = continuedOf(current)
          if (!continued) throw new Error('continued question unavailable')
          const body = { key: continued.key, revision: continued.revision, actionId: 'question.answer',
            sessionId: continued.subject.ref, kind: continued.kind, callId: nativeCallId(continued) }
          await trackNative({ ...body, phase: 'attempt' })
          try {
            currentItem(current)
            const fresh = continuedOf(current)
            if (!fresh || fresh.key !== continued.key || fresh.revision !== continued.revision) throw new Error('stale continued question')
            // This is the native card's exact Remote path. The gateway resolves
            // the live Agent; the owner validates continued state and the batch.
            const result = await questionRemote().answer(body.sessionId, body.callId, input)
            if (!result?.ok) throw new Error(result?.error?.message ?? 'native question RPC failed')
            if (result.value !== true) throw new Error('question is no longer continued')
          } catch (error) {
            await trackNative({ ...body, phase: 'failed' })
            throw error
          }
          // true means queued for admission, not settled. Keep the hard row
          // until the source projection actually removes the active question.
          answeredNative.set(nativeKey(body.sessionId, body.kind, continued.native), {})
          await trackNative({ ...body, phase: 'accepted' })
          waitForNativeFact(current)
        }
        const run = (obligation, actionId, input) => execute(obligation, async (current) => {
          if (actionId === 'approval.allow-once' || actionId === 'approval.reject') {
            const entry = live.get(current.key)
            if (!entry || entry.interaction.kind !== 'approval' || entry.interaction.answerable === false ||
                typeof entry.interaction.answer !== 'function') throw new Error('approval unavailable')
            // This path is reachable only from an explicit button click.
            await answerNative(current, actionId, actionId === 'approval.reject' ? 'rejected' : 'allowed-once')
          } else if (actionId === 'question.answer') {
            const pending = live.get(current.key)?.interaction
            const card = pending?.getSnapshot?.()
            if (pending && card && !card.closed && ['waterfall', 'rpc'].includes(card.channel))
              await answerNative(current, 'question.answer', input)
            else if (continuedOf(current)) await answerContinued(current, input)
            else openSubject(current)
          } else if (actionId === 'subject.open' || actionId === 'question.open') {
            openSubject(current)
          } else {
            const action = host.actions[actionId]
            const executor = clientActions.get(actionId)
            if (!current.actions?.includes(actionId) || !['host', 'client'].includes(action?.side) ||
                (action.side === 'client' && !executor)) throw new Error('unsupported action')
            if ((action.confirm === 'destructive' || executor?.confirm === 'destructive') &&
                !window.confirm(localeText(action.label) || actionId)) return
            const fresh = currentItem(current)
            if (action.side === 'client') {
              if (clientActions.get(actionId) !== executor || executor.controller.signal.aborted) throw new Error('client action unavailable')
              await executor.run(JSON.parse(JSON.stringify(fresh)), input, executor.controller.signal)
            } else {
              await callHost({ op: 'act', key: fresh.key, revision: fresh.revision, actionId, input }, lifetime.signal)
            }
          }
        })
        const dispose = (obligation, kind) => execute(obligation, async (current) => {
          if (meta(current, host.kinds).blocking !== 'soft') throw new Error('blockers cannot be hidden')
          if (!['dismissed', 'snoozed'].includes(kind)) throw new Error('invalid disposition')
          await callHost({ op: 'dispose', key: current.key, revision: current.revision, kind,
            until: kind === 'snoozed' ? new Date(Date.now() + 3600000).toISOString() : undefined }, lifetime.signal)
        })

        const updateSettings = async (patch) => {
          if (snapshot.settingsPending) return
          publish({ settingsPending: true, settingsError: false })
          try {
            await callHost({ op: 'settings', patch }, lifetime.signal)
            await refresh()
          } catch {
            if (active) publish({ settingsError: true })
          } finally {
            if (active) publish({ settingsPending: false })
          }
        }
        const mute = (obligation, scope) => execute(obligation, async (current) => {
          if (meta(current, host.kinds).blocking !== 'soft') throw new Error('blockers cannot be muted')
          const ref = scope === 'session' && current.subject?.type === 'session' ? current.subject.ref
            : scope === 'workspace' ? workspaceOf(current, ctx.sessions.list.getSnapshot(), host.subjects) : undefined
          if (!ref) throw new Error('mute scope unavailable')
          await callHost({ op: 'mute', scope, ref }, lifetime.signal)
        })
        const unmute = async (rule) => {
          publish({ settingsPending: true, settingsError: false })
          try {
            await callHost({ op: 'unmute', scope: rule.scope, ref: rule.ref }, lifetime.signal)
            await refresh()
          } catch {
            if (active) publish({ settingsError: true })
          } finally {
            if (active) publish({ settingsPending: false })
          }
        }

        class AttentionClient extends Service {
          constructor(owner) { super(owner, 'attentionClient'); this.apiVersion = 1 }
          registerAction(def) {
            if (!def || typeof def.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(def.id) ||
                typeof def.run !== 'function' || (def.confirm !== undefined && !['none', 'destructive'].includes(def.confirm))) throw new Error('INVALID_CLIENT_ACTION')
            if (['approval.allow-once', 'approval.reject', 'question.answer', 'question.open', 'subject.open'].includes(def.id)) throw new Error('RESERVED_CLIENT_ACTION')
            if (!active || clientActions.has(def.id)) throw new Error('CLIENT_ACTION_UNAVAILABLE')
            const id = def.id, record = { run: def.run, confirm: def.confirm, controller: new AbortController() }
            // Service.ctx follows Cordis' calling-context tracker, so this effect
            // belongs to the contributing plugin, not the inbox provider.
            return this.ctx.effect(() => {
              clientActions.set(id, record)
              rebuild()
              return () => {
                record.controller.abort()
                if (clientActions.get(id) === record) clientActions.delete(id)
                rebuild()
              }
            }, `attentionClient action: ${id}`)
          }
        }
        new AttentionClient(ctx)

        ctx.effect(() => {
          const unsubscribe = ctx.uiSession.sessionStatus.subscribe(rebuild)
          const unsubscribeSessions = ctx.sessions.list.subscribe(() => { rebuild(); void refresh() })
          rebuild()
          void refresh()
          const timer = setInterval(() => { rebuild(); void refresh() }, 8000)
          return () => {
            active = false
            generation++
            controller?.abort()
            lifetime.abort()
            clearInterval(timer)
            unsubscribe()
            unsubscribeSessions()
            for (const record of cardSubscriptions.values()) record.unsubscribe()
            cardSubscriptions.clear()
            live.clear()
            busy.clear()
            for (const record of clientActions.values()) record.controller.abort()
            clientActions.clear()
            for (const timer of awaitingNative.values()) clearTimeout(timer)
            awaitingNative.clear()
            trackingQueue.clear()
            finishedNative.clear()
            answeredNative.clear()
            listeners.clear()
          }
        }, 'attention-inbox: source feeds')

        const props = {
          view: source,
          useView: (selector) => selector(useSyncExternalStore(source.subscribe, source.getSnapshot)),
          run,
          dispose, mute, unmute, updateSettings, retryTracking,
          t,
          openSubject,
          sessions: ctx.sessions.list,
          statuses: ctx.uiSession.sessionStatus,
          localeText,
          engageQuestion: (key) => live.get(key)?.interaction.engage?.(),
        }

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          children: { 'attention.subject': { kind: 'keyed', scope: 'root' } },
          inject: () => props,
        }, InboxPage))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: PANEL_ID, order: 60, locale: NS,
          label: () => t('panel'), inject: () => props,
        }, InboxSettings))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 12,
          locale: NS,
          label: () => labelFor(snapshot, t),
          inject: () => ({ useView: props.useView }),
        }, InboxIcon))

        // Daily notes and timeline share the inbox's live facts (docs/009-daily-notes.md).
        const notesController = installNotes(ctx, { useView: props.useView, sessions: ctx.sessions.list, statuses: ctx.uiSession.sessionStatus })
        props.notes = notesController.source
        props.openNotes = () => { const layout = ctx.layout ?? ctx.get?.('layout'); if (typeof layout?.selectPanel === 'function') layout.selectPanel(NOTES_PANEL_ID) }
        // Project timelines read Session logs only while their page is open (docs/010-project-timeline.md).
        installProjects(ctx)
    }

    /* ------------------------------------------------- daily notes (docs/009) */

    const NOTES_PANEL_ID = 'attention-notes'
    const NOTES_NS = 'attention-notes'
    const NOTES_ROUTE = 'api/attention-notes'
    const NOTES_TAB_ID = 'dsh-attention-inbox/notes'
    const NOTES_TAB_KIND = 'attention-notes'
    const FENCE = '```'

    const notesZh = {
      panel: '每日笔记', title: '每日笔记', tabNotes: '笔记', tabTimeline: '时间线', tabSettings: '设置',
      today: '今天', tomorrow: '明天', yesterday: '昨天', later: '稍后', auto: '自动排',
      placeholder: '记下一个想法…', placeholderChild: '记到这条下面…', loading: '正在读取笔记…',
      loadFailed: '笔记暂时读不到', retry: '重试', saveFailed: '有改动没保存上：',
      toTask: '交给 Agent', toExplore: '先探索', open: '打开', creating: '正在派给 Agent…', convertFailed: '没派出去：', noWorkspace: '还没有可用的工作区，先在 DSH 里打开一个项目，或在设置里选默认工作区。', alreadyLinked: '这条笔记已经连着一个对话了。',
      accept: '接受', dismiss: '忽略', suggestion: '建议', markDone: '标记完成', looksDone: '看起来完成了？',
      stWaiting: '在等你', stRunning: '运行中', stReview: '待验收', stFailed: '失败或受阻', stIdle: '已停下', stMissing: '会话不在了',
      barWaiting: '个在等你', barRunning: '个在跑', barReview: '个待验收', clearFilter: '全部',
      rolled: '已拖', rolledUnit: '次', split: '拆分', drop: '放弃', dropped: '已放弃', unlink: '解除关联',
      laneMe: '我', laneAgent: 'Agent', review: '验收', reviewCost: '验收',
      groupWaiting: '等你', groupRunning: '在跑', groupDispatch: '待派', groupMine: '我做',
      you: '你', agentSlots: 'Agent 派发', overbooked: '超载', deadline: '截止', rolledFrom: '顺延自',
      scheduled: '已排', laterCount: '稍后', timelineEmpty: '没有要排的事。笔记里没完成的条目会自动排进来；子条目算作说明，不单独占时间。',
      reviewTitle: '昨天', rvDone: '完成', rvDispatched: '派出', rvReviewed: '已验收', rvRolled: '顺延', rvDropped: '放弃', rvInbox: '收件箱原地处理',
      mConversion: '想法转化率', mStart: '记下到开始', mFinish: '开始到完成', mRollovers: '平均顺延', noData: '暂无数据',
      sCapacity: '每天给自己留的时间（小时）', sReviewCost: '每个 Agent 结果的验收时间（分钟）', sAgentSlots: '每天最多派出的 Agent 任务', sHorizon: '时间线天数',
      sWeekends: '周末不排', sWorkspace: '默认工作区', sWorkspaceAuto: '自动（最近活跃的）', save: '保存', saved: '已保存',
      pin: '钉到对话旁', pinTip: '在对话旁边打开笔记，边做边记', pinFailed: '先打开一个对话，再钉到右侧',
      anchoredTo: '记到', anchoredNone: '记到今天', keysHint: '↵ 新建 · Tab 缩进 · ⌘↵ 完成 · ⌘⇧↵ 对话 · ⌘⌥↵ 探索',
      viewNotes: '笔记', viewTimeline: '时间线', propDate: '日期', propYou: '你的时间', propAgent: 'Agent',
      agentDispatched: '今日派发', inFlight: '在跑', calloutWaiting: '个 Agent 停下来在等你。', goInbox: '去处理 →',
      tipsLead: '想到什么就记下来。一条想法可以直接交给 Agent，也可以先让它只读探索。',
      tipsExamples1: '明天 写周报 ~1h', tipsExamples2: '周五前 迁移 CI 环境变量 !!',
      tipsAfter: '日期、截止、估时和优先级会被自动识别并排进时间线；Agent 的结论会回到这一条下面。',
      addBelow: '在下方添加', reopen: '重新打开', nudgeAsk: '，要换个做法吗？',
      kNew: '新建', kIndent: '缩进', kDone: '完成', kStart: '交给 Agent', kExplore: '先探索',
      secYou: '你的时间', secAgent: 'Agent', secTimeline: '时间线',
      sCapacityHint: '每天留给自己亲手做事的时间，时间线按它排。', sReviewCostHint: '交给 Agent 的事只占这么多你的时间。',
      sAgentSlotsHint: '每天最多派出多少个 Agent 任务，避免同时验收太多。', sWorkspaceHint: '新对话建在哪个工作区；默认用你最近活跃的那个。',
      sWeekendsHint: '周六、周日不自动安排事情（今天除外）。',
      ledeWaiting: ' 个 Agent 停下来在等你', ledeToday: ' 件事排在今天', ledeLeft: '你的时间还剩 ', ledeEmpty: '今天还是空白的', ledeEmptySub: '想到什么就记下来',
      railToday: '今天', railTodayEmpty: '今天没有排事情', railTrend: '近 30 天', colDate: '日期', colLane: '谁做', colCost: '占用', back: '返回',
      unitMin: '分钟', unitH: '小时', unitD: '天', weekdays: '日一二三四五六',
      promptDetails: '补充：', exploreIntro: '先做一次只读探索：不要修改任何文件，也不要执行有副作用的命令。',
      exploreIdea: '想法：', exploreAsk: '请：\n1. 阅读相关代码和资料，说清楚现状；\n2. 列出可行方案和各自的取舍；\n3. 给出你推荐的做法。',
      exploreSteps: '最后用下面的格式列出建议的下一步（每行一条，可以带估时）：', exampleStep1: '第一步 ~1h', exampleStep2: '第二步 ~30m',
    }
    const notesEn = {
      panel: 'Daily notes', title: 'Daily notes', tabNotes: 'Notes', tabTimeline: 'Timeline', tabSettings: 'Settings',
      today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday', later: 'Later', auto: 'Auto',
      placeholder: 'Write down an idea…', placeholderChild: 'Add under this…', loading: 'Loading notes…',
      loadFailed: 'Notes are unavailable right now', retry: 'Retry', saveFailed: 'A change was not saved: ',
      toTask: 'Start', toExplore: 'Explore', open: 'Open', creating: 'Handing to an agent…', convertFailed: 'Not started: ', noWorkspace: 'No workspace yet. Open a project in DSH, or pick a default workspace in settings.', alreadyLinked: 'This note is already linked to a conversation.',
      accept: 'Accept', dismiss: 'Dismiss', suggestion: 'Suggested', markDone: 'Mark done', looksDone: 'Looks done?',
      stWaiting: 'Waiting for you', stRunning: 'Running', stReview: 'Ready for review', stFailed: 'Failed or blocked', stIdle: 'Stopped', stMissing: 'Session is gone',
      barWaiting: ' waiting for you', barRunning: ' running', barReview: ' to review', clearFilter: 'All',
      rolled: 'Slipped', rolledUnit: '×', split: 'Split', drop: 'Drop', dropped: 'Dropped', unlink: 'Unlink',
      laneMe: 'Me', laneAgent: 'Agent', review: 'Review', reviewCost: 'review',
      groupWaiting: 'Waiting', groupRunning: 'Running', groupDispatch: 'To dispatch', groupMine: 'Mine',
      you: 'You', agentSlots: 'Agent dispatch', overbooked: 'Overbooked', deadline: 'due', rolledFrom: 'from',
      scheduled: 'Scheduled', laterCount: 'later', timelineEmpty: 'Nothing to schedule. Unfinished notes are placed here automatically; child lines are details and take no time of their own.',
      reviewTitle: 'Yesterday', rvDone: 'done', rvDispatched: 'dispatched', rvReviewed: 'reviewed', rvRolled: 'slipped', rvDropped: 'dropped', rvInbox: 'handled in inbox',
      mConversion: 'Ideas started', mStart: 'Idea → start', mFinish: 'Start → done', mRollovers: 'Avg. slips', noData: 'No data yet',
      sCapacity: 'Your own time per day (hours)', sReviewCost: 'Review time per agent result (minutes)', sAgentSlots: 'Agent tasks dispatched per day', sHorizon: 'Timeline days',
      sWeekends: 'Skip weekends', sWorkspace: 'Default Workspace', sWorkspaceAuto: 'Automatic (most recent)', save: 'Save', saved: 'Saved',
      pin: 'Pin to side', pinTip: 'Open notes beside a conversation', pinFailed: 'Open a conversation first, then pin',
      anchoredTo: 'Adding to', anchoredNone: 'Adding to today', keysHint: '↵ new · Tab indent · ⌘↵ done · ⌘⇧↵ start · ⌘⌥↵ explore',
      viewNotes: 'Notes', viewTimeline: 'Timeline', propDate: 'Date', propYou: 'Your time', propAgent: 'Agent',
      agentDispatched: 'dispatched today', inFlight: 'running', calloutWaiting: ' agents stopped and are waiting for you.', goInbox: 'Handle →',
      tipsLead: 'Write down whatever comes to mind. Hand an idea straight to an agent, or let it explore read-only first.',
      tipsExamples1: 'tomorrow write the weekly report ~1h', tipsExamples2: 'migrate CI secrets by fri !!',
      tipsAfter: 'Dates, deadlines, estimates and priority are picked up and scheduled; the agent\'s conclusion comes back under the line.',
      addBelow: 'Add below', reopen: 'Reopen', nudgeAsk: ' — try another way?',
      kNew: 'new', kIndent: 'indent', kDone: 'done', kStart: 'hand to agent', kExplore: 'explore first',
      secYou: 'Your time', secAgent: 'Agent', secTimeline: 'Timeline',
      sCapacityHint: 'Time you keep for hands-on work each day; the timeline plans around it.', sReviewCostHint: 'What an agent task costs you: just the review.',
      sAgentSlotsHint: 'At most this many agent tasks are dispatched per day, so reviews do not pile up.', sWorkspaceHint: 'Where new conversations are created; defaults to your most recent one.',
      sWeekendsHint: 'Nothing is scheduled on Saturday or Sunday, except today.',
      ledeWaiting: ' agents stopped and are waiting for you', ledeToday: ' things planned for today', ledeLeft: 'your time left ', ledeEmpty: 'Today is still blank', ledeEmptySub: 'write down whatever comes to mind',
      railToday: 'Today', railTodayEmpty: 'Nothing planned today', railTrend: 'Last 30 days', colDate: 'Date', colLane: 'Who', colCost: 'Cost', back: 'Back',
      unitMin: 'm', unitH: 'h', unitD: 'd', weekdays: 'SMTWTFS',
      promptDetails: 'Details:', exploreIntro: 'Do a read-only exploration first: do not modify any file or run commands with side effects.',
      exploreIdea: 'Idea: ', exploreAsk: 'Please:\n1. Read the relevant code and material and describe the current state;\n2. List viable approaches and their trade-offs;\n3. Recommend one.',
      exploreSteps: 'End with the suggested next steps in exactly this format (one per line, estimates optional):', exampleStep1: 'first step ~1h', exampleStep2: 'second step ~30m',
    }

    function localToday(now = new Date()) {
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    }
    function shiftDay(day, count) {
      const [y, m, d] = day.split('-').map(Number)
      return localToday(new Date(y, m - 1, d + count, 12))
    }
    function newNoteId() {
      const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)
      return `n-${Date.now().toString(36)}-${random}`
    }
    function dayLabel(day, today, t) {
      if (day === today) return t('today')
      if (day === shiftDay(today, 1)) return t('tomorrow')
      if (day === shiftDay(today, -1)) return t('yesterday')
      const [y, m, d] = day.split('-').map(Number)
      const w = new Date(y, m - 1, d, 12).getDay()
      const names = t('weekdays')
      return names.length === 7 && /[一二]/.test(names) ? `${m}月${d}日 周${names[w]}` : `${m}/${d} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][w]}`
    }
    function minutes(value, t) {
      if (!Number.isFinite(value)) return '—'
      if (value < 60) return `${value}${t('unitMin')}`
      const hours = Math.floor(value / 60), rest = Math.round(value % 60)
      return rest ? `${hours}${t('unitH')}${rest}${t('unitMin')}` : `${hours}${t('unitH')}`
    }
    function duration(ms, t) {
      if (!Number.isFinite(ms)) return t('noData')
      const m = Math.round(ms / 60000)
      if (m < 60) return `${m}${t('unitMin')}`
      if (m < 2880) return `${(m / 60).toFixed(m < 600 ? 1 : 0)}${t('unitH')}`
      return `${Math.round(m / 1440)}${t('unitD')}`
    }
    const omit = (map, key) => { const next = { ...map }; delete next[key]; return next }

    function noteChildren(notes) {
      const map = new Map()
      for (const note of notes) {
        const key = note.parentId ?? ''
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(note)
      }
      for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      return map
    }
    function subtreeIds(notes, id) {
      const kids = noteChildren(notes), out = new Set([id]), queue = [id]
      while (queue.length) for (const child of kids.get(queue.shift()) ?? []) { out.add(child.id); queue.push(child.id) }
      return out
    }

    /** Mirror of the Host's mutations, so the outline reacts before the round trip settles. */
    function applyNoteOp(notes, op, today) {
      const stamp = new Date().toISOString()
      switch (op.op) {
        case 'upsert': {
          const patch = op.note, existing = notes.find((note) => note.id === patch.id)
          const parent = patch.parentId !== undefined ? patch.parentId : existing?.parentId ?? null
          const parentNote = parent ? notes.find((note) => note.id === parent) : undefined
          const base = existing ?? { id: patch.id, day: patch.day ?? today, parentId: null, order: 1, text: '', kind: 'note', state: 'open', createdAt: stamp }
          const next = { ...base, ...patch, parentId: parent, updatedAt: stamp, day: parentNote?.day ?? patch.day ?? base.day }
          if (patch.plan === null) delete next.plan
          if (patch.state && patch.state !== 'open' && patch.state !== base.state) next.closedAt = stamp
          if (patch.state === 'open') delete next.closedAt
          return existing ? notes.map((note) => note.id === patch.id ? next : note) : [...notes, next]
        }
        case 'delete': case 'dismiss': {
          const gone = subtreeIds(notes, op.id)
          return notes.filter((note) => !gone.has(note.id))
        }
        case 'link': return notes.map((note) => note.id === op.id ? { ...note, sessionId: op.sessionId, mode: op.mode, linkedAt: stamp } : note)
        case 'unlink': return notes.map((note) => {
          if (note.id !== op.id || (op.sessionId && note.sessionId !== op.sessionId)) return note
          const next = { ...note }
          for (const key of ['sessionId', 'mode', 'linkedAt', 'result', 'harvestedAt']) delete next[key]
          return next
        })
        case 'accept': return notes.map((note) => note.id === op.id ? { ...note, kind: 'note' } : note)
        default: return notes
      }
    }

    /** What a linked Session is doing, read from the same facts the sidebar and the inbox use. */
    function noteSessionStatus(sessionId, inbox, list, statuses) {
      if (!sessionId) return undefined
      const row = list?.byId?.[sessionId]
      const items = (inbox?.items ?? []).filter((item) => item.subject?.type === 'session' && item.subject.ref === sessionId)
      const status = statuses?.get?.(sessionId)
      if (status?.pendingInteraction || items.some((item) => meta(item, inbox?.kinds).blocking !== 'soft')) return 'waiting'
      if (items.some((item) => item.kind === 'turn-failed' || item.kind === 'goal-blocked')) return 'failed'
      if (row?.running) return 'running'
      if (status?.completionUnread || items.some((item) => item.kind === 'review')) return 'review'
      if (!row) return Object.keys(list?.byId ?? {}).length ? 'missing' : 'idle'
      return 'idle'
    }
    const FAILURE_TEXT = { NO_WORKSPACE: 'noWorkspace', ALREADY_LINKED: 'alreadyLinked' }
    const failureText = (code, t) => FAILURE_TEXT[code] ? t(FAILURE_TEXT[code]) : code
    const STATUS_LABEL = { waiting: 'stWaiting', running: 'stRunning', review: 'stReview', failed: 'stFailed', idle: 'stIdle', missing: 'stMissing' }

    function notePrompt(note, notes, mode, t) {
      const details = (noteChildren(notes).get(note.id) ?? []).filter((child) => child.kind !== 'suggestion' && child.text.trim())
        .map((child) => `- ${child.text.trim()}`)
      if (mode !== 'explore') return [note.text.trim(), details.length ? `\n\n${t('promptDetails')}\n${details.join('\n')}` : ''].join('')
      return [
        t('exploreIntro'), '',
        `${t('exploreIdea')}${note.text.trim()}`, ...(details.length ? [details.join('\n')] : []), '',
        t('exploreAsk'), '',
        t('exploreSteps'),
        `${FENCE}next-steps`, `- ${t('exampleStep1')}`, `- ${t('exampleStep2')}`, FENCE,
      ].join('\n')
    }

    function createNotesController(ctx, t) {
      let state = { phase: 'idle', notes: [], timeline: undefined, review: undefined, settings: {}, workspaces: [],
        today: localToday(), error: undefined, converting: {}, failed: {}, focusId: undefined }
      const listeners = new Set()
      const source = { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } }
      const publish = (patch) => { state = { ...state, ...patch }; for (const listener of [...listeners]) listener() }
      let server = { notes: [] }, active = true, started = false, interval, unsubscribeSessions, wakeTimer
      const pending = [], drafts = new Map(), draftTimers = new Map()
      let chain = Promise.resolve(), convertChain = Promise.resolve()
      const lifetime = new AbortController()
      const running = new Map()

      const call = async (body) => {
        const response = await fetch(new URL(NOTES_ROUTE, document.baseURI).href, {
          method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ today: localToday(), ...body }), signal: lifetime.signal,
        })
        const data = await response.json()
        if (!response.ok || data.ok === false) throw new Error(data.code ?? data.message ?? `HTTP ${response.status}`)
        return data
      }
      const view = () => {
        const today = server.today ?? localToday()
        let notes = Array.isArray(server.notes) ? server.notes : []
        for (const op of pending) notes = applyNoteOp(notes, op, today)
        if (drafts.size) notes = notes.map((note) => drafts.has(note.id) ? { ...note, text: drafts.get(note.id) } : note)
        return notes
      }
      const recompute = (patch = {}) => publish({ notes: view(), timeline: server.timeline, review: server.review,
        settings: server.settings ?? state.settings, workspaces: server.workspaces ?? state.workspaces, today: server.today ?? state.today, ...patch })
      const settle = (op) => { const index = pending.indexOf(op); if (index >= 0) pending.splice(index, 1) }
      const enqueue = (op) => {
        if (op.op !== 'state') { pending.push(op); recompute() }
        const task = chain.then(() => call(op)).then((data) => {
          settle(op)
          if (active) { server = data; recompute({ phase: 'ready', error: undefined }) }
          return data
        }, (error) => {
          settle(op)
          if (active && error?.name !== 'AbortError') recompute({ error: String(error?.message ?? error), phase: state.phase === 'ready' ? 'ready' : 'error' })
          throw error
        })
        chain = task.catch(() => {})
        return task
      }
      const sessionFacts = () => {
        const rows = ctx.sessions?.list?.getSnapshot?.()?.byId ?? {}
        const linked = new Set(state.notes.filter((note) => note.sessionId && note.state === 'open').map((note) => note.sessionId))
        return [...linked].filter((id) => rows[id]).slice(0, 200).map((id) => ({ id, updatedAt: Number(rows[id].updatedAt) || 0, running: rows[id].running === true }))
      }
      const refresh = () => active ? enqueue({ op: 'state', sessions: sessionFacts() }).catch(() => {}) : chain
      // A linked Session that just stopped is the moment its result is worth reading.
      const onSessions = () => {
        const rows = ctx.sessions?.list?.getSnapshot?.()?.byId ?? {}
        let settled = false
        for (const note of state.notes) if (note.sessionId) {
          const now = rows[note.sessionId]?.running === true
          if (running.get(note.sessionId) === true && !now) settled = true
          running.set(note.sessionId, now)
        }
        if (settled) { clearTimeout(wakeTimer); wakeTimer = setTimeout(() => void refresh(), 1200) }
      }
      const start = () => {
        if (started || !active) return
        started = true
        publish({ phase: 'loading' })
        void refresh()
        interval = setInterval(() => { if (!pending.length && !drafts.size) void refresh() }, 15000)
        unsubscribeSessions = ctx.sessions?.list?.subscribe?.(onSessions)
      }

      const flush = (id) => {
        if (!drafts.has(id)) return chain
        clearTimeout(draftTimers.get(id)); draftTimers.delete(id)
        const text = drafts.get(id); drafts.delete(id)
        return enqueue({ op: 'upsert', note: { id, text } }).catch(() => {})
      }
      const setText = (id, text) => {
        drafts.set(id, text)
        clearTimeout(draftTimers.get(id))
        draftTimers.set(id, setTimeout(() => void flush(id), 400))
        recompute()
      }
      const siblingsOf = (note, parentId = note?.parentId ?? null, day = note?.day) =>
        (noteChildren(state.notes).get(parentId ?? '') ?? []).filter((item) => parentId || item.day === day)
      const create = ({ after, parentId = null, day, text = '' } = {}) => {
        const parent = after ? after.parentId ?? null : parentId
        const targetDay = after?.day ?? day ?? state.today
        const siblings = siblingsOf(after, parent, targetDay)
        let order
        if (after) {
          const next = siblings[siblings.findIndex((item) => item.id === after.id) + 1]
          order = next ? (after.order + next.order) / 2 : after.order + 1
        } else order = siblings.length ? siblings[siblings.length - 1].order + 1 : 1
        const id = newNoteId()
        void enqueue({ op: 'upsert', note: { id, text, parentId: parent, order, ...(parent ? {} : { day: targetDay }) } }).catch(() => {})
        publish({ focusId: id })
        return id
      }
      const indent = (note) => {
        const siblings = siblingsOf(note)
        const previous = siblings[siblings.findIndex((item) => item.id === note.id) - 1]
        if (!previous || previous.kind === 'suggestion') return
        void flush(note.id)
        const kids = noteChildren(state.notes).get(previous.id) ?? []
        void enqueue({ op: 'upsert', note: { id: note.id, parentId: previous.id, order: (kids.at(-1)?.order ?? 0) + 1 } }).catch(() => {})
        publish({ focusId: note.id })
      }
      const outdent = (note) => {
        const parent = state.notes.find((item) => item.id === note.parentId)
        if (!parent) return
        void flush(note.id)
        const siblings = siblingsOf(parent)
        const next = siblings[siblings.findIndex((item) => item.id === parent.id) + 1]
        void enqueue({ op: 'upsert', note: { id: note.id, parentId: parent.parentId ?? null, order: next ? (parent.order + next.order) / 2 : parent.order + 1 } }).catch(() => {})
        publish({ focusId: note.id })
      }
      const plain = (op) => enqueue(op).catch(() => {})
      const workspaceFor = (note) => {
        const listed = new Set(state.workspaces.map((w) => w.id))
        if (note?.workspaceId && listed.has(note.workspaceId)) return note.workspaceId
        if (state.settings.workspaceId && listed.has(state.settings.workspaceId)) return state.settings.workspaceId
        const rows = Object.values(ctx.sessions?.list?.getSnapshot?.()?.byId ?? {})
          .filter((row) => row && row.origin !== 'subagent' && row.cwd).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        for (const row of rows) { const match = state.workspaces.find((w) => w.path === row.cwd); if (match) return match.id }
        return state.workspaces[0]?.id
      }
      // Always a fresh Session in a named Workspace. Never `connectWorkspace`: it hands back the
      // Workspace's reusable blank, which may be the person's own New Session with an unsent draft.
      // Never a Workspace-less create either: that runs the Agent in the Host's default directory.
      const createSession = async (workspaceId) => {
        if (!workspaceId) throw new Error('NO_WORKSPACE')
        if (typeof ctx.sessions?.create !== 'function') throw new Error('SESSION_CREATE_UNAVAILABLE')
        return ctx.sessions.create({ workspaceId })
      }
      const promptSession = (sessionId, text) => {
        if (typeof ctx.sessions?.using !== 'function') throw new Error('SESSION_PROMPT_UNAVAILABLE')
        return ctx.sessions.using(sessionId, { source: 'controllerOperation' }, async (reference) => {
          const binding = await reference.ready
          const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
          if (result && result.ok === false) throw new Error(result.error?.message ?? result.error?.code ?? 'PROMPT_REJECTED')
        })
      }
      // Conversions run one at a time: a Workspace hands concurrent callers the same blank Session.
      // One note, one Session: a linked, closed or suggested note is never converted again.
      const convertible = (note) => note && note.kind === 'note' && note.state === 'open' && !note.sessionId && note.text.trim()
      const convert = (note, mode) => {
        if (!convertible(note) || state.converting[note.id]) return Promise.resolve()
        void flush(note.id)
        publish({ converting: { ...state.converting, [note.id]: mode }, failed: omit(state.failed, note.id) })
        const task = convertChain.then(async () => {
          await chain
          // Re-read the Host first: another tab may have linked, closed or deleted the note.
          await enqueue({ op: 'state' })
          const current = state.notes.find((item) => item.id === note.id)
          // Deleted, closed or linked while waiting in line: nothing to start.
          if (!convertible(current)) return
          const workspaceId = workspaceFor(current)
          const sessionId = await createSession(workspaceId)
          if (typeof sessionId !== 'string' || !sessionId) throw new Error('SESSION_CREATE_FAILED')
          // Link before prompting: if the Host refuses the link, no Agent starts work nobody tracks.
          // An unprompted Session stays a hidden blank that New Session reuses.
          await enqueue({ op: 'link', id: note.id, sessionId, mode, workspaceId })
          try { await promptSession(sessionId, notePrompt(current, state.notes, mode, t)) }
          catch (error) { await enqueue({ op: 'unlink', id: note.id, sessionId }).catch(() => {}); throw error }
          running.set(sessionId, true)
        })
        convertChain = task.catch(() => {})
        return task.then(() => { if (active) publish({ converting: omit(state.converting, note.id) }) },
          (error) => { if (active) publish({ converting: omit(state.converting, note.id), failed: { ...state.failed, [note.id]: String(error?.message ?? error) } }) })
      }
      const open = (note) => {
        const workspace = ctx.uiWorkspace ?? ctx.get?.('uiWorkspace')
        if (note?.sessionId && typeof workspace?.openSession === 'function') workspace.openSession(note.sessionId)
      }
      const actions = {
        start, refresh, flush, setText, create, indent, outdent, convert, open,
        remove: (note) => plain({ op: 'delete', id: note.id }),
        setState: (note, value) => { void flush(note.id); return plain({ op: 'upsert', note: { id: note.id, state: value } }) },
        setPlan: (note, patch) => {
          const next = { ...note.plan, ...patch }
          for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === '') delete next[key]
          return plain({ op: 'upsert', note: { id: note.id, plan: Object.keys(next).length ? next : null } })
        },
        unlink: (note) => plain({ op: 'unlink', id: note.id }),
        accept: (note) => plain({ op: 'accept', id: note.id }),
        dismiss: (note) => plain({ op: 'dismiss', id: note.id }),
        updateSettings: (patch) => enqueue({ op: 'settings', patch }),
        clearFocus: () => { if (state.focusId !== undefined) state = { ...state, focusId: undefined } },
      }
      const dispose = () => {
        active = false
        lifetime.abort()
        clearInterval(interval); clearTimeout(wakeTimer)
        for (const timer of draftTimers.values()) clearTimeout(timer)
        draftTimers.clear(); drafts.clear(); pending.length = 0
        unsubscribeSessions?.()
        listeners.clear()
      }
      return { source, actions, dispose, state: () => state }
    }

    /** Wire the notes panel, its sidebar entry and the optional right-sidebar tab. */
    function installNotes(ctx, inbox) {
      ctx.effect(() => ctx.locale.register(NOTES_NS, { zh: notesZh, en: notesEn }), 'attention-notes: dictionaries')
      const t = ctx.locale.bind(NOTES_NS)
      const controller = createNotesController(ctx, t)
      ctx.effect(() => () => controller.dispose(), 'attention-notes: controller')
      let right
      const pin = () => {
        if (typeof right?.openTab !== 'function') return false
        try { right.openTab(NOTES_TAB_KIND); return true } catch {}
        // The right sidebar belongs to a Session on screen; bring the most recent one first.
        const rows = Object.values(ctx.sessions?.list?.getSnapshot?.()?.byId ?? {}).filter((row) => row && row.origin !== 'subagent')
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        const workspace = ctx.uiWorkspace ?? ctx.get?.('uiWorkspace')
        if (!rows[0] || typeof workspace?.openSession !== 'function') return false
        workspace.openSession(rows[0].id)
        setTimeout(() => { try { right.openTab(NOTES_TAB_KIND) } catch {} }, 200)
        return true
      }
      const props = {
        notes: controller.source, actions: controller.actions, t, useInbox: inbox.useView,
        sessions: inbox.sessions, statuses: inbox.statuses, canPin: () => typeof right?.openTab === 'function', pin,
        openPanel: (id) => { const layout = ctx.layout ?? ctx.get?.('layout'); if (typeof layout?.selectPanel === 'function') layout.selectPanel(id) },
        currentSession: () => {
          const mounted = right?.mounted
          try { return typeof mounted?.getSnapshot === 'function' ? mounted.getSnapshot() : undefined } catch { return undefined }
        },
      }
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NOTES_PANEL_ID, locale: NOTES_NS, inject: () => props }, NotesPage))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: NOTES_PANEL_ID, order: 13, locale: NOTES_NS,
        label: () => t('panel'), inject: () => ({ start: controller.actions.start }),
      }, NotesIcon))
      // Right sidebar is optional: without it the panel works and the pin button hides.
      if (typeof ctx.inject === 'function') ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
        right = scope.sidebarRight
        scope.effect(() => () => { right = undefined }, 'attention-notes: right sidebar')
        scope.effect(() => scope.sidebarRightTabs.register({
          id: NOTES_TAB_ID, kind: NOTES_TAB_KIND, title: () => t('panel'),
          guide: [{ id: 'notes', order: 60, title: () => t('panel'), description: () => t('pinTip') }],
        }), 'attention-notes: right sidebar tab')
        scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
          name: 'sidebar.right.pane.tab', key: NOTES_TAB_ID, inject: () => ({ ...props, compact: true }),
        }, NotesPage)), 'attention-notes: right sidebar body')
      })
      return controller
    }

    /* ------------------------------------------------- shared page skeleton */
    // One layout for the inbox and the notes: a sticky top bar, a compact head
    // (icon, title, one status line, property chips), then a main column with a
    // right rail when the panel is wide enough. Everything uses DSH tokens.

    function Icon({ name, size = 14 }) {
      const paths = {
        calendar: 'M3 5.5h10M5 2.5v2M11 2.5v2M3.5 4h9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
        clock: 'M8 4.5V8l2.2 1.4M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z',
        agent: 'M8 2v2.2M8 11.8V14M2 8h2.2M11.8 8H14M3.8 3.8l1.5 1.5M10.7 10.7l1.5 1.5M12.2 3.8l-1.5 1.5M5.3 10.7l-1.5 1.5',
        eye: 'M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8ZM8 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z',
        shield: 'M8 2 3 4v3.6c0 3 2.1 5.4 5 6.4 2.9-1 5-3.4 5-6.4V4L8 2Z',
        bolt: 'M8.8 1.8 3.8 9h4l-.6 5.2L12.2 7h-4l.6-5.2Z',
        check: 'M3.5 8.2 6.6 11l5.9-6.2',
        gear: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6',
        pin: 'M9.6 2.4 13.6 6.4 11.3 7.3 8.7 9.9 8.9 12.6 3.4 7.1 6.1 7.3 8.7 4.7 9.6 2.4ZM5.8 10.2 2.4 13.6',
        back: 'M9.8 3.5 5.3 8l4.5 4.5',
        list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
        timeline: 'M2.5 4h6M5 8h8.5M3.5 12h5',
        refresh: 'M13 8a5 5 0 1 1-1.6-3.7M13.2 2.6v2.9h-2.9',
      }
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, className: 'cn-icon' },
        h('path', { d: paths[name] ?? paths.check, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function PageTopbar({ icon, crumb, children }) {
      return h('div', { className: 'cn-topbar' }, [
        h('span', { key: 'crumb', className: 'cn-crumb' }, [icon, h('span', { key: 't' }, crumb)]),
        h('span', { key: 'spacer', className: 'cn-spacer' }),
        h('span', { key: 'actions', className: 'cn-topbar-actions' }, children),
      ])
    }

    /** Mark a page as scrolled straight on the element: no React state, no re-render per scroll event. */
    const markScrolled = (event) => {
      const page = event.currentTarget
      if (page && typeof page.toggleAttribute === 'function') page.toggleAttribute('data-scrolled', page.scrollTop > 4)
    }

    function PageHead({ icon, title, lede, props }) {
      return h('header', { className: 'cn-head' }, [
        h('div', { key: 'row', className: 'cn-title-row' }, [
          h('div', { key: 'icon', className: 'cn-page-icon', 'aria-hidden': true }, icon),
          h('div', { key: 'text', className: 'cn-title-text' }, [
            h('h1', { key: 'title', className: 'cn-title' }, title),
            lede ? h('p', { key: 'lede', className: 'cn-lede' }, lede) : null,
          ]),
        ]),
        props?.some(Boolean) ? h('div', { key: 'props', className: 'cn-props' }, props) : null,
      ])
    }

    /** An inline page property: icon, quiet label, value. */
    function Prop({ icon, label, children, title, ...rest }) {
      return h('span', { className: 'cn-prop', title, ...rest }, [
        icon ? h(Icon, { key: 'i', name: icon }) : null,
        label ? h('span', { key: 'l', className: 'cn-prop-label' }, label) : null,
        h('span', { key: 'v', className: 'cn-prop-value' }, children),
      ])
    }

    function Panel({ title, aside, children, ...rest }) {
      return h('section', { className: 'cn-panel', ...rest }, [
        h('header', { key: 'h', className: 'cn-panel-head' }, [h('h3', { key: 't' }, title), h('span', { key: 's', className: 'cn-spacer' }), aside]),
        h('div', { key: 'b', className: 'cn-panel-body' }, children),
      ])
    }

    /** The inbox's view of today's notes: what is planned, and a way in. */
    function TodayPlan({ source, t, open }) {
      const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
      const day = state.timeline?.days?.[0]
      if (state.phase !== 'ready' || !day || !day.items.length) return null
      const byId = new Map(state.notes.map((note) => [note.id, note]))
      return h(Panel, { title: `${t('planTitle')} · ${day.items.length}`, 'data-attention-plan': '',
        aside: open ? h('button', { type: 'button', className: 'cn-link', 'data-action-id': 'plan.open-notes', onClick: open }, t('planOpen')) : null }, [
        h('ul', { key: 'list', className: 'cn-mini' }, day.items.slice(0, 6).map((entry) => {
          const note = byId.get(entry.id)
          return note ? h('li', { key: entry.id }, [h(StatusGlyph, { key: 'g', status: note.sessionId ? 'idle' : 'todo' }),
            h('span', { key: 't', className: 'cn-mini-text' }, note.text),
            entry.lane === 'agent' ? h(Tag, { key: 'lane', tone: 'purple' }, 'Agent') : null]) : null
        })),
        day.items.length > 6 ? h('p', { key: 'more', className: 'cn-faint cn-mini-more' }, `+${day.items.length - 6}`) : null,
      ])
    }

    /* The inbox's cards and controls, tuned to the shared skeleton and DSH metrics. */
    const INBOX_CN_STYLE = `
.dsh-cn .ai-group{margin:0 0 24px}
.dsh-cn .ai-group h2{margin:0 0 2px;font-size:var(--cn-fs-2);font-weight:600;letter-spacing:0;text-transform:none;color:var(--cn-ink)}
.dsh-cn .ai-count{min-width:18px;height:18px;background:var(--cn-gray-bg);color:var(--cn-muted)}
/* Notion-like list: blocks bleed 10px past the text edge on hover, hairlines between them. */
.dsh-cn .ai-list{gap:0;grid-template-columns:minmax(0,1fr);margin:0 -10px}
.dsh-cn .ai-card{min-width:0}
.dsh-cn .ai-title,.dsh-cn .ai-plan{overflow-wrap:anywhere}
.dsh-cn .ai-card{padding:12px 10px;border-radius:var(--cn-r-sm);background:transparent;border:0;box-shadow:none;transition:background var(--cn-fast) var(--cn-ease),opacity var(--cn-mid) var(--cn-ease);animation:cn-in var(--cn-slow) var(--cn-ease) both}
.dsh-cn .ai-card::before{content:'';display:block;left:10px;right:10px;top:0;bottom:auto;width:auto;height:1px;border-radius:0;background:var(--cn-line-soft);transition:opacity var(--cn-fast) var(--cn-ease)}
.dsh-cn .ai-card:first-child::before,.dsh-cn .ai-card:hover::before,.dsh-cn .ai-card:hover+.ai-card::before,
.dsh-cn .ai-card[data-selected=true]::before,.dsh-cn .ai-card[data-selected=true]+.ai-card::before{opacity:0}
.dsh-cn .ai-card:hover{background:var(--cn-hover)}
.dsh-cn .ai-card[data-selected=true]{background:color-mix(in srgb,var(--cn-accent) 7%,transparent);box-shadow:none}
.dsh-cn .ai-chip{height:20px;display:inline-flex;align-items:center;padding:0 6px;border-radius:var(--cn-r-xs);border:0;font-size:var(--cn-fs-3);font-weight:500}
.dsh-cn .ai-card[data-tone=hard] .ai-chip{background:var(--cn-orange-bg);color:var(--cn-orange)}
.dsh-cn .ai-card[data-tone=system] .ai-chip{background:var(--cn-red-bg);color:var(--cn-red)}
.dsh-cn .ai-where{font-size:var(--cn-fs-3);color:var(--cn-faint);max-width:none}
.dsh-cn .ai-timer{padding:0;background:none;border:0;font-size:var(--cn-fs-3);color:var(--cn-faint)}
.dsh-cn .ai-title{margin-top:8px;font-size:var(--cn-fs);font-weight:500;line-height:1.55}
.dsh-cn .ai-sub{margin-top:4px;font-size:var(--cn-fs-2);color:var(--cn-muted);line-height:1.55}
.dsh-cn .ai-raw{margin-top:6px;font-size:var(--cn-fs-3);color:var(--cn-faint)}
.dsh-cn .ai-raw summary{width:max-content;cursor:pointer;list-style:none;padding:1px 4px;margin-left:-4px;border-radius:var(--cn-r-xs);transition:background var(--cn-fast) var(--cn-ease),color var(--cn-fast) var(--cn-ease)}
.dsh-cn .ai-raw summary::-webkit-details-marker{display:none}
.dsh-cn .ai-raw summary::before{content:'▸ ';display:inline-block;transition:transform var(--cn-fast) var(--cn-ease)}
.dsh-cn .ai-raw[open] summary::before{transform:rotate(90deg)}
.dsh-cn .ai-raw summary:hover{background:var(--cn-hover);color:var(--cn-muted)}
.dsh-cn .ai-raw code{display:block;margin-top:4px;padding:8px 10px;border-radius:var(--cn-r-sm);background:var(--cn-sunken);font:12px/1.6 var(--cn-code);color:var(--cn-muted);white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-cn .ai-from-note{display:flex;gap:8px;align-items:baseline;margin:6px 0 0;font-size:var(--cn-fs-3);color:var(--cn-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-cn .ai-from-note span{flex:none;color:var(--cn-accent)}
.dsh-cn .ai-actions{margin-top:10px;gap:6px}
.dsh-cn .ai-btn{height:28px;padding:0 12px;border-radius:var(--cn-r-sm);font-size:var(--cn-fs-2);transition:background var(--cn-fast) var(--cn-ease),border-color var(--cn-fast) var(--cn-ease),transform var(--cn-fast) var(--cn-ease)}
.dsh-cn .ai-btn.small{height:24px;padding:0 8px;font-size:var(--cn-fs-3)}
.dsh-cn .ai-plan{margin-top:10px;padding:10px 12px;border:0;border-radius:var(--cn-r-sm);background:var(--cn-sunken);font-size:var(--cn-fs-2)}
.dsh-cn .ai-q{margin-top:10px}
.dsh-cn .ai-option{min-height:30px;padding:0 12px;border-radius:var(--cn-r-sm);font-size:var(--cn-fs-2)}
.dsh-cn .ai-input{height:30px;border-radius:var(--cn-r-sm);margin-top:8px}
.dsh-cn .ai-toast{margin:0 0 12px;border-radius:var(--cn-r-sm);font-size:var(--cn-fs-2)}
.dsh-cn .ai-notice{margin:0 0 12px;border-radius:var(--cn-r-sm);font-size:var(--cn-fs-2)}
.dsh-cn .ai-calm{display:flex;align-items:center;gap:18px;padding:12px 0 8px;animation:cn-fade var(--cn-slow) var(--cn-ease) both}
.dsh-cn .ai-calm .ai-orb{width:64px;height:64px;flex:none}
.dsh-cn .ai-calm .ai-check{width:64px;height:64px}
.dsh-cn .ai-calm-text{display:grid;gap:4px;min-width:0}
.dsh-cn .ai-calm-text b{font-size:var(--cn-fs);font-weight:600;color:var(--cn-ink)}
.dsh-cn .ai-calm-text span{font-size:var(--cn-fs-2);color:var(--cn-muted)}
.dsh-cn .ai-perks{margin:16px 0 0;padding:0;border-top:0;font-size:var(--cn-fs-2)}
.dsh-cn .ai-perks b{color:var(--cn-accent)}
.dsh-cn .ai-agents{gap:2px}
.dsh-cn .ai-agent{padding:6px 6px;border:0;border-radius:var(--cn-r-sm);background:transparent;transition:background var(--cn-fast) var(--cn-ease)}
.dsh-cn .ai-agent:hover{background:var(--cn-hover)}
.dsh-cn .ai-agent-title{font-size:var(--cn-fs-2)}
.dsh-cn .ai-how summary{cursor:pointer;list-style:none;color:var(--cn-faint)}
.dsh-cn .ai-how summary::before{content:'▸';display:inline-block;width:12px;transition:transform var(--cn-mid) var(--cn-ease)}
.dsh-cn .ai-how[open] summary::before{transform:rotate(90deg)}
.dsh-cn .ai-how[open]{display:grid;gap:4px}
.dsh-cn .ai-how span{padding-left:12px}
.dsh-cn .ai-keys{gap:12px}
.dsh-cn .ai-settings{max-width:720px}
.dsh-cn .ai-settings-title{display:none}
.dsh-cn .ai-setting{justify-content:space-between;margin:0;padding:12px 0;border-bottom:1px solid var(--cn-line-soft)}
.dsh-cn .ai-settings-sub{margin:20px 0 8px;font-size:var(--cn-fs-2);font-weight:600;color:var(--cn-muted)}
`

    /* ------------------------------------------------- daily notes: views */

    function NotesIcon({ size = 18, start }) {
      useEffectSafe(() => { start?.() }, [])
      return h('svg', { viewBox: '0 0 20 20', width: size, height: size, role: 'img', 'aria-hidden': true, style: { display: 'block' } }, [
        h('rect', { key: 'page', x: 3.5, y: 4, width: 13, height: 12.5, rx: 2.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { key: 'rings', d: 'M7 2.6v3M13 2.6v3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('path', { key: 'lines', d: 'M7 9.4h6M7 12.6h3.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    /** Marks words that came back from an Agent. */
    function Spark({ size = 12 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, className: 'cn-spark' },
        h('path', { d: 'M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    const noSubscribe = () => () => {}
    const noSnapshot = () => undefined

    function NotesPage(props) {
      const { notes, actions, t, compact } = props
      const state = useSyncExternalStore(notes.subscribe, notes.getSnapshot)
      const inbox = props.useInbox((current) => current)
      const list = useSyncExternalStore(props.sessions?.subscribe ?? noSubscribe, props.sessions?.getSnapshot ?? noSnapshot)
      const statuses = useSyncExternalStore(props.statuses?.subscribe ?? noSubscribe, props.statuses?.getSnapshot ?? noSnapshot)
      const [tab, setTab] = useState('notes')
      const [collapsed, setCollapsed] = useState({})
      const [filter, setFilter] = useState(null)
      const [pinError, setPinError] = useState(false)
      useEffectSafe(() => { actions.start() }, [])
      const env = { state, inbox, list, statuses, actions, t, collapsed,
        toggle: (id) => setCollapsed((current) => ({ ...current, [id]: !current[id] })),
        statusOf: (note) => note.sessionId ? noteSessionStatus(note.sessionId, inbox, list, statuses) : undefined }
      const shell = (children, topbar) => h('div', { 'data-attention-notes': compact ? 'pane' : 'page', className: `dsh-cn cn-page${compact ? ' compact' : ''}`, onScroll: markScrolled }, [
        h('style', { key: 'css' }, CN_THEME + LAYOUT_STYLE + NOTES_STYLE),
        topbar ?? null,
        h('div', { key: 'col', className: 'cn-col' }, children),
      ])
      if (state.phase === 'idle' || state.phase === 'loading') return shell([h('p', { key: 'loading', className: 'cn-faint cn-loading' }, t('loading'))])
      if (state.phase === 'error') return shell([h(Callout, { key: 'error', tone: 'red', icon: '!' }, [t('loadFailed'), ' ',
        h('button', { key: 'retry', type: 'button', className: 'cn-link', onClick: () => void actions.refresh() }, t('retry'))])])
      if (compact) {
        const current = props.currentSession?.()
        const anchor = current ? state.notes.find((note) => note.sessionId === current && note.state === 'open') : undefined
        return shell([h(NotesOutline, { key: 'outline', env, compact: true, anchor, filter: null, setFilter })])
      }

      const today = state.timeline?.days?.[0]
      const counts = { waiting: 0, running: 0, review: 0 }
      for (const note of state.notes) if (note.sessionId && note.state === 'open') { const s = env.statusOf(note); if (s in counts) counts[s]++ }
      const left = today ? Math.max(0, today.capacityMin - today.usedMin) : 0
      const lede = counts.waiting
        ? [h('b', { key: 'n', className: 'cn-num warn' }, String(counts.waiting)), t('ledeWaiting'),
          props.openPanel ? h('button', { key: 'go', type: 'button', className: 'cn-link', 'data-action-id': 'notes.go-inbox', onClick: () => props.openPanel('attention-inbox') }, t('goInbox')) : null]
        : today?.items.length
          ? [h('b', { key: 'n', className: 'cn-num' }, String(today.items.length)), t('ledeToday'), h('span', { key: 'm', className: 'cn-faint' }, ` · ${t('ledeLeft')}${minutes(left, t)}`)]
          : [t('ledeEmpty'), h('span', { key: 'm', className: 'cn-faint' }, ` · ${t('ledeEmptySub')}`)]
      const topbar = h(PageTopbar, { key: 'top', icon: h(NotesIcon, { key: 'i', size: 14 }), crumb: tab === 'settings' ? `${t('title')} / ${t('tabSettings')}` : t('title') }, [
        props.canPin?.() ? h('button', { key: 'pin', type: 'button', className: 'cn-ghost', title: t('pinTip'), 'data-action-id': 'notes.pin',
          onClick: () => setPinError(!props.pin()) }, [h(Icon, { key: 'i', name: 'pin' }), t('pin')]) : null,
        h('button', { key: 'settings', type: 'button', className: `cn-ghost${tab === 'settings' ? ' on' : ''}`, 'data-action-id': 'notes.tab.settings',
          onClick: () => setTab(tab === 'settings' ? 'notes' : 'settings') }, [h(Icon, { key: 'i', name: tab === 'settings' ? 'back' : 'gear' }), tab === 'settings' ? t('back') : t('tabSettings')]),
      ])
      const head = h(PageHead, { key: 'head', icon: h(NotesIcon, { size: 18 }), title: t('title'), lede,
        props: today ? [
          h(Prop, { key: 'date', icon: 'calendar' }, dayLabel(state.today, '', t)),
          h(Prop, { key: 'you', icon: 'clock', label: t('propYou') }, h(Meter, { used: today.usedMin, total: today.capacityMin, t })),
          h(Prop, { key: 'agent', icon: 'agent', label: t('propAgent') }, [h(Slots, { key: 's', used: today.agentUsed, total: today.agentSlots }), ` ${today.agentUsed}/${today.agentSlots}`]),
        ] : [] })
      const views = [['notes', 'viewNotes', 'list'], ['timeline', 'viewTimeline', 'timeline']]
      const viewBar = tab === 'settings' ? null : h('nav', { key: 'views', className: 'cn-views', role: 'tablist' }, [
        ...views.map(([id, label, icon]) => h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': tab === id,
          className: `cn-view${tab === id ? ' on' : ''}`, 'data-action-id': `notes.tab.${id}`, onClick: () => setTab(id) }, [h(Icon, { key: 'i', name: icon }), t(label)])),
        h('span', { key: 'spacer', className: 'cn-spacer' }),
        tab === 'notes' ? h(StatusFilters, { key: 'filters', counts, filter, setFilter, t }) : null,
      ])
      const main = tab === 'notes' ? h(NotesOutline, { key: 'outline', env, filter, setFilter })
        : tab === 'timeline' ? h(NotesTimeline, { key: 'timeline', env })
          : h(NotesSettings, { key: 'settings', env })
      const rail = tab === 'notes' ? h(NotesRail, { key: 'rail', env }) : null
      return shell([
        head, viewBar,
        pinError ? h(Callout, { key: 'pin-error', tone: 'gray', icon: 'i' }, t('pinFailed')) : null,
        state.error ? h(Callout, { key: 'error', tone: 'red', icon: '!' }, `${t('saveFailed')}${state.error}`) : null,
        h('div', { key: `body:${tab}`, className: `cn-body${rail ? ' has-rail' : ''}` }, [h('div', { key: 'main', className: 'cn-main' }, main), rail]),
      ], topbar)
    }

    function StatusFilters({ counts, filter, setFilter, t }) {
      const chips = [['waiting', 'barWaiting', 'orange'], ['running', 'barRunning', 'blue'], ['review', 'barReview', 'green']].filter(([key]) => counts[key])
      if (!chips.length) return null
      return h('span', { className: 'cn-filters', role: 'toolbar' }, [
        ...chips.map(([key, label, tone]) => h('button', { key, type: 'button', className: `cn-filter ${tone}${filter === key ? ' on' : ''}`, 'aria-pressed': filter === key,
          'data-action-id': `notes.filter.${key}`, onClick: () => setFilter(filter === key ? null : key) }, [h(StatusGlyph, { key: 'g', status: key }), `${counts[key]}${t(label)}`])),
        filter ? h('button', { key: 'all', type: 'button', className: 'cn-ghost', onClick: () => setFilter(null) }, t('clearFilter')) : null,
      ])
    }

    /** Today at a glance beside the outline: the plan in order, yesterday, and the trend. */
    function NotesRail({ env }) {
      const { state, t, actions } = env
      const day = state.timeline?.days?.[0]
      const byId = new Map(state.notes.map((note) => [note.id, note]))
      const yesterday = state.review?.yesterday && !state.review.yesterday.empty ? state.review.yesterday : undefined
      const metrics = state.review?.metrics
      const facts = yesterday ? [[yesterday.done, 'rvDone'], [yesterday.dispatched, 'rvDispatched'], [yesterday.reviewed, 'rvReviewed'], [yesterday.rolled, 'rvRolled'], [yesterday.dropped, 'rvDropped'], [yesterday.inboxActed, 'rvInbox']].filter(([value]) => value > 0) : []
      return h('aside', { className: 'cn-rail' }, [
        day ? h(Panel, { key: 'today', title: `${t('railToday')} · ${day.items.length}` }, day.items.length
          ? h('ul', { className: 'cn-mini' }, day.items.map((entry) => {
            const note = byId.get(entry.id)
            if (!note) return null
            const status = env.statusOf(note)
            return h('li', { key: entry.id }, [
              h('button', { key: 'g', type: 'button', className: 'cn-mark small', onClick: () => note.sessionId ? actions.open(note) : void actions.setState(note, 'done') }, h(StatusGlyph, { status: status ?? 'todo' })),
              h('span', { key: 't', className: 'cn-mini-text', title: note.text }, note.text),
              h('span', { key: 'c', className: 'cn-mini-meta' }, entry.lane === 'agent' ? h(Tag, { tone: 'purple' }, 'Agent') : minutes(entry.estimateMin, t)),
            ])
          }))
          : h('p', { className: 'cn-faint cn-mini-more' }, t('railTodayEmpty'))) : null,
        facts.length ? h(Panel, { key: 'yesterday', title: t('reviewTitle') }, h('ul', { className: 'cn-facts' },
          facts.map(([value, key]) => h('li', { key }, [h('b', { key: 'v' }, String(value)), h('span', { key: 'l' }, t(key))])))) : null,
        metrics?.captured >= 5 ? h(Panel, { key: 'metrics', title: t('railTrend') }, h('ul', { className: 'cn-facts' }, [
          h('li', { key: 'c' }, [h('b', { key: 'v' }, metrics.conversionRate === null ? '—' : `${Math.round(metrics.conversionRate * 100)}%`), h('span', { key: 'l' }, t('mConversion'))]),
          h('li', { key: 's' }, [h('b', { key: 'v' }, duration(metrics.startMedianMs ?? NaN, t)), h('span', { key: 'l' }, t('mStart'))]),
          h('li', { key: 'f' }, [h('b', { key: 'v' }, duration(metrics.finishMedianMs ?? NaN, t)), h('span', { key: 'l' }, t('mFinish'))]),
        ])) : null,
      ])
    }

    function Meter({ used, total, t }) {
      const ratio = total ? used / total : used ? 2 : 0
      return h('span', { className: `cn-meter${ratio > 1 ? ' over' : ''}` }, [
        h('i', { key: 'bar', className: 'cn-meter-bar' }, h('b', { style: { width: `${Math.min(100, ratio * 100)}%` } })),
        h('span', { key: 'text' }, `${minutes(used, t)} / ${minutes(total, t)}`),
      ])
    }

    function Slots({ used, total }) {
      const dots = []
      for (let i = 0; i < Math.max(total, used); i++) dots.push(h('i', { key: i, className: `cn-slot${i < used ? ' on' : ''}${i >= total ? ' over' : ''}` }))
      return h('span', { className: 'cn-slots', 'aria-hidden': true }, dots)
    }

    function Callout({ tone = 'gray', icon, children }) {
      return h('div', { className: `cn-callout ${tone}`, role: tone === 'red' ? 'alert' : undefined }, [
        h('span', { key: 'icon', className: 'cn-callout-icon', 'aria-hidden': true }, icon),
        h('div', { key: 'body', className: 'cn-callout-body' }, children),
      ])
    }

    function Tag({ tone = 'gray', children, title }) {
      return h('span', { className: `cn-tag ${tone}`, title }, children)
    }

    /** A property that reads as text and opens the native picker on click. */
    function PropChip({ value, options, onChange, label, tone, action }) {
      const current = options.find(([option]) => option === value)?.[1] ?? options[0]?.[1]
      return h('label', { className: `cn-chip${tone ? ` ${tone}` : ''}${value === '' ? ' auto' : ''}`, 'data-action-id': action }, [
        h('span', { key: 'text' }, current),
        h('select', { key: 'select', value, 'aria-label': label, onChange: (event) => onChange(event.target.value) },
          options.map(([option, text]) => h('option', { key: option || 'auto', value: option }, text))),
      ])
    }

    function StatusGlyph({ status }) {
      const s = { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, className: `cn-glyph ${status}` }
      const ring = (key, extra = {}) => h('circle', { key, cx: 8, cy: 8, r: 5.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, ...extra })
      switch (status) {
        case 'waiting': return h('svg', s, [ring('r'), h('path', { key: 'f', d: 'M8 2.4a5.6 5.6 0 0 1 0 11.2Z', fill: 'currentColor' })])
        case 'running': return h('svg', s, [ring('r', { opacity: 0.25 }), h('path', { key: 'a', d: 'M8 2.4a5.6 5.6 0 0 1 5.6 5.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' })])
        case 'review': return h('svg', s, [ring('r'), h('circle', { key: 'd', cx: 8, cy: 8, r: 2.8, fill: 'currentColor' })])
        case 'failed': return h('svg', s, [ring('r'), h('path', { key: 'x', d: 'M6 6l4 4M10 6l-4 4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })])
        case 'missing': return h('svg', s, [ring('r', { strokeDasharray: '2 2' })])
        case 'idle': return h('svg', s, [ring('r')])
        case 'done': return h('svg', s, [h('rect', { key: 'b', x: 2.5, y: 2.5, width: 11, height: 11, rx: 3, fill: 'currentColor' }), h('path', { key: 'c', d: 'M5.4 8.2l1.8 1.8 3.6-3.8', fill: 'none', stroke: 'var(--cn-bg)', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' })])
        case 'dropped': return h('svg', s, [h('rect', { key: 'b', x: 2.5, y: 2.5, width: 11, height: 11, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }), h('path', { key: 'd', d: 'M5.5 8h5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })])
        case 'suggestion': return h('svg', s, [h('rect', { key: 'b', x: 2.5, y: 2.5, width: 11, height: 11, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeDasharray: '2 1.6' })])
        case 'todo': return h('svg', s, [h('rect', { key: 'b', x: 2.5, y: 2.5, width: 11, height: 11, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 })])
        default: return h('svg', s, [h('circle', { key: 'd', cx: 8, cy: 8, r: 2.4, fill: 'currentColor' })])
      }
    }

    function scheduleLabel(item, today, t) {
      if (!item) return undefined
      return item.date === 'later' ? t('later') : dayLabel(item.date, today, t)
    }

    function Caret({ open, onClick, action }) {
      return h('button', { type: 'button', className: `cn-caret${open ? '' : ' shut'}`, 'aria-label': 'toggle', 'aria-expanded': open, 'data-action-id': action, onClick },
        h('svg', { viewBox: '0 0 10 10', width: 10, height: 10, 'aria-hidden': true }, h('path', { d: 'M2 3.2h6L5 7.4Z', fill: 'currentColor' })))
    }

    function NotesOutline({ env, compact, anchor, filter }) {
      const { state, t, collapsed } = env
      const kids = noteChildren(state.notes)
      const placed = new Map()
      for (const day of state.timeline?.days ?? []) for (const item of day.items) placed.set(item.id, item)
      for (const item of state.timeline?.later ?? []) placed.set(item.id, { ...item, date: 'later' })
      const rows = []
      const walk = (parentId, depth, day) => {
        for (const note of kids.get(parentId ?? '') ?? []) {
          if (!parentId && note.day !== day) continue
          rows.push({ note, depth, hasKids: (kids.get(note.id) ?? []).length > 0 })
          if (!collapsed[note.id]) walk(note.id, depth + 1, day)
        }
      }
      const today = state.today
      const sections = []
      if (anchor) {
        rows.push({ note: anchor, depth: 0, hasKids: (kids.get(anchor.id) ?? []).length > 0 })
        walk(anchor.id, 1, anchor.day)
        sections.push({ day: anchor.day, rows: rows.splice(0), quickParent: anchor.id })
      } else {
        const days = [...new Set([today, ...state.notes.filter((note) => !note.parentId).map((note) => note.day)])]
          .sort((a, b) => b.localeCompare(a)).filter((day) => !compact || day === today)
        for (const day of days) { walk(null, 0, day); sections.push({ day, rows: rows.splice(0) }) }
      }
      const visible = sections.flatMap((section) => section.rows.map((row) => row.note.id))
      const focus = (id) => setTimeout(() => {
        const target = typeof document.querySelector === 'function' ? document.querySelector(`[data-note-input="${id}"]`) : undefined
        target?.focus?.()
      }, 0)
      const move = (id, delta) => { const next = visible[visible.indexOf(id) + delta]; if (next) focus(next) }
      const linkedOpen = state.notes.filter((note) => note.sessionId && note.state === 'open')
      const filtered = filter ? linkedOpen.filter((note) => env.statusOf(note) === filter) : null
      const blank = !state.notes.some((note) => note.kind === 'note')
      return h('div', { className: 'cn-outline' }, [
        compact ? h('p', { key: 'anchor', className: 'cn-faint cn-anchor' }, anchor ? [h(Spark, { key: 's' }), ` ${t('anchoredTo')} · ${anchor.text}`] : t('anchoredNone')) : null,
        filtered ? h('ul', { key: 'filtered', className: 'cn-blocks' }, filtered.map((note) => h(NoteRow, { key: note.id, env, note, depth: 0, hasKids: false, placed: placed.get(note.id), move, focus, flat: true })))
          : sections.map((section) => h('section', { key: section.day, className: 'cn-day', 'data-notes-day': section.day }, [
            anchor ? null : h('h2', { key: 'label', className: 'cn-h2' }, [dayLabel(section.day, today, t),
              section.day === today ? null : h('span', { key: 'date', className: 'cn-faint' }, section.day.slice(5)),
              h('span', { key: 'n', className: 'cn-count' }, String(section.rows.filter((row) => row.depth === 0).length))]),
            h('ul', { key: 'list', className: 'cn-blocks' }, [
              ...section.rows.map((row) => h(NoteRow, { key: row.note.id, env, ...row, placed: placed.get(row.note.id), move, focus })),
              section.day === today || anchor ? h(QuickAdd, { key: 'quick', env, parentId: section.quickParent ?? null, day: section.day, depth: anchor ? 1 : 0 }) : null,
            ]),
            !compact && blank && section.day === today ? h(Callout, { key: 'tips', tone: 'accent', icon: h(Spark, { size: 14 }) }, [
              h('p', { key: 'a' }, t('tipsLead')),
              h('p', { key: 'b', className: 'cn-tip-examples' }, [h('code', { key: '1' }, t('tipsExamples1')), h('code', { key: '2' }, t('tipsExamples2'))]),
              h('p', { key: 'c', className: 'cn-faint' }, t('tipsAfter')),
            ]) : null,
          ])),
        compact ? null : h('footer', { key: 'foot', className: 'cn-foot' }, h('p', { className: 'cn-keys' }, [['↵', 'kNew'], ['Tab', 'kIndent'], ['⌘↵', 'kDone'], ['⌘⇧↵', 'kStart'], ['⌘⌥↵', 'kExplore']]
          .map(([key, label]) => h('span', { key: label }, [h('kbd', { key: 'k' }, key), t(label)])))),
      ])
    }

    function QuickAdd({ env, parentId, day, depth }) {
      const { t, actions } = env
      const [text, setText] = useState('')
      return h('li', { className: 'cn-block cn-quick', style: { '--depth': depth } }, h('div', { className: 'cn-line' }, [
        h('span', { key: 'gutter', className: 'cn-gutter' }),
        h('span', { key: 'caret', className: 'cn-caret blank' }),
        h('span', { key: 'glyph', className: 'cn-mark', 'aria-hidden': true }, '+'),
        h('input', { key: 'input', className: 'cn-input', value: text, placeholder: parentId ? t('placeholderChild') : t('placeholder'), 'data-note-quick': day,
          onChange: (event) => setText(event.target.value),
          onKeyDown: (event) => {
            if (event.nativeEvent?.isComposing || event.keyCode === 229 || event.key !== 'Enter' || !text.trim()) return
            event.preventDefault()
            actions.create({ parentId, day, text: text.trim() })
            actions.clearFocus()
            setText('')
          } }),
      ]))
    }

    const STATUS_TONE = { waiting: 'orange', running: 'blue', review: 'green', failed: 'red', idle: 'gray', missing: 'gray' }

    function NoteRow({ env, note, depth, hasKids, placed, move, flat }) {
      const { state, t, actions } = env
      const ref = useRefSafe(null)
      const status = env.statusOf(note)
      const suggestion = note.kind === 'suggestion'
      const closed = note.state !== 'open'
      useEffectSafe(() => {
        if (state.focusId === note.id && ref.current) { ref.current.focus(); actions.clearFocus() }
      }, [state.focusId])
      const converting = state.converting[note.id]
      const failed = state.failed[note.id]
      const glyph = suggestion ? 'suggestion' : closed ? note.state : status ?? (hasKids ? 'open' : 'todo')
      const onKeyDown = (event) => {
        if (event.nativeEvent?.isComposing || event.keyCode === 229) return
        const mod = event.metaKey || event.ctrlKey
        if (event.key === 'Enter' && mod && event.shiftKey) { event.preventDefault(); void actions.convert(note, 'task') }
        else if (event.key === 'Enter' && mod && event.altKey) { event.preventDefault(); void actions.convert(note, 'explore') }
        else if (event.key === 'Enter' && mod) { event.preventDefault(); void actions.setState(note, closed ? 'open' : 'done') }
        else if (event.key === 'Enter') { event.preventDefault(); void actions.flush(note.id); actions.create({ after: note }) }
        else if (event.key === 'Tab') { event.preventDefault(); event.shiftKey ? actions.outdent(note) : actions.indent(note) }
        // Clearing a linked note's text must not silently drop the note its Session reports to.
        else if (event.key === 'Backspace' && event.target.value === '' && !hasKids && !note.sessionId) { event.preventDefault(); move(note.id, -1); void actions.remove(note) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); move(note.id, -1) }
        else if (event.key === 'ArrowDown') { event.preventDefault(); move(note.id, 1) }
      }
      // Trail: facts that stay visible and line up in one column. Tools: hover actions floating over the trail.
      const trail = []
      const tools = []
      const when = !closed && !suggestion ? scheduleLabel(placed, state.today, t) : undefined
      if (suggestion) {
        trail.push(h(Tag, { key: 't', tone: 'accent' }, t('suggestion')))
        tools.push(h('button', { key: 'accept', type: 'button', className: 'cn-ghost strong', 'data-action-id': 'notes.accept', onClick: () => void actions.accept(note) }, t('accept')),
          h('button', { key: 'dismiss', type: 'button', className: 'cn-ghost', 'data-action-id': 'notes.dismiss', onClick: () => void actions.dismiss(note) }, t('dismiss')))
      } else {
        if (note.rollovers >= 3 && !closed) trail.push(h(Tag, { key: 'rolled', tone: 'orange' }, `${t('rolled')} ${note.rollovers}${t('rolledUnit')}`))
        if (!closed && !note.sessionId && placed?.lane === 'agent') trail.push(h(Tag, { key: 'lane', tone: 'purple' }, t('laneAgent')))
        if (converting) trail.push(h('span', { key: 'converting', className: 'cn-working' }, [h(StatusGlyph, { key: 'g', status: 'running' }), t('creating')]))
        else if (note.sessionId) trail.push(h(Tag, { key: 'status', tone: STATUS_TONE[status] ?? 'gray' }, t(STATUS_LABEL[status] ?? 'stIdle')))
        if (when) trail.push(h('span', { key: 'when', className: 'cn-when' }, when))
        if (note.sessionId) tools.push(h('button', { key: 'open', type: 'button', className: 'cn-ghost strong', 'data-action-id': 'notes.open', onClick: () => actions.open(note) }, `${t('open')} ↗`))
        else if (!closed && !converting && note.text.trim()) tools.push(
          h('button', { key: 'task', type: 'button', className: 'cn-ghost strong', 'data-action-id': 'notes.convert.task', onClick: () => void actions.convert(note, 'task') }, `${t('toTask')} →`),
          h('button', { key: 'explore', type: 'button', className: 'cn-ghost', 'data-action-id': 'notes.convert.explore', onClick: () => void actions.convert(note, 'explore') }, [h(Spark, { key: 's' }), t('toExplore')]))
      }
      return h('li', { className: `cn-block${closed ? ' closed' : ''}${suggestion ? ' suggestion' : ''}`, 'data-note-id': note.id, style: { '--depth': flat ? 0 : depth } }, [
        h('div', { key: 'line', className: 'cn-line' }, [
          h('span', { key: 'gutter', className: 'cn-gutter' }, suggestion || flat ? null : h('button', { type: 'button', className: 'cn-add', 'aria-label': t('addBelow'), title: t('addBelow'),
            onClick: () => { void actions.flush(note.id); actions.create({ after: note }) } }, '+')),
          hasKids && !flat ? h(Caret, { key: 'caret', open: !env.collapsed[note.id], onClick: () => env.toggle(note.id) }) : h('span', { key: 'caret', className: 'cn-caret blank' }),
          h('button', { key: 'glyph', type: 'button', className: 'cn-mark', 'data-action-id': note.sessionId ? 'notes.glyph.open' : 'notes.glyph.toggle',
            title: note.sessionId ? t(STATUS_LABEL[status] ?? 'stIdle') : closed ? t('reopen') : t('markDone'),
            onClick: () => { if (suggestion) return; if (note.sessionId && !closed) actions.open(note); else void actions.setState(note, closed ? 'open' : 'done') } }, h(StatusGlyph, { status: glyph })),
          suggestion ? h('span', { key: 'text', className: 'cn-text' }, note.text)
            : h('input', { key: 'text', ref, className: 'cn-input', value: note.text, 'data-note-input': note.id, 'aria-label': note.text || t('placeholder'),
              onChange: (event) => actions.setText(note.id, event.target.value), onBlur: () => void actions.flush(note.id), onKeyDown }),
          h('span', { key: 'trail', className: 'cn-trail' }, trail),
          tools.length ? h('span', { key: 'tools', className: 'cn-tools' }, tools) : null,
        ]),
        note.result ? h('div', { key: 'result', className: 'cn-reply' }, [h(Spark, { key: 's' }), h('span', { key: 't' }, note.result.text)]) : null,
        note.result && !closed && status === 'idle' ? h('div', { key: 'done', className: 'cn-reply quiet' }, [`${t('looksDone')} `,
          h('button', { key: 'mark', type: 'button', className: 'cn-link', 'data-action-id': 'notes.mark-done', onClick: () => void actions.setState(note, 'done') }, t('markDone'))]) : null,
        failed ? h('div', { key: 'failed', className: 'cn-reply error' }, [`${t('convertFailed')}${failureText(failed, t)} `,
          h('button', { key: 'retry', type: 'button', className: 'cn-link', onClick: () => void actions.convert(note, note.mode ?? 'task') }, t('retry'))]) : null,
      ])
    }

    function NotesTimeline({ env }) {
      const { state, t, actions } = env
      const timeline = state.timeline
      const [open, setOpen] = useState({ later: false })
      const byId = new Map(state.notes.map((note) => [note.id, note]))
      if (!timeline) return null
      const total = timeline.days.reduce((sum, day) => sum + day.items.length, 0)
      const dateOptions = [['', t('auto')], ...timeline.days.map((day) => [day.date, dayLabel(day.date, state.today, t)]), ['later', t('later')]]
      const estimateOptions = (entry) => [['', `${minutes(entry.estimateMin, t)}`], ...[15, 30, 60, 120, 240, 480].map((value) => [String(value), minutes(value, t)])]
      const row = (entry) => {
        const note = byId.get(entry.id)
        if (!note) return null
        const status = env.statusOf(note)
        const rolled = (note.rollovers ?? 0) >= 3
        return h('li', { key: entry.id, className: 'cn-trow', 'data-timeline-item': entry.id }, [
          h('div', { key: 'main', className: 'cn-line cn-tgrid' }, [
            h('button', { key: 'glyph', type: 'button', className: 'cn-mark', title: note.sessionId ? t('open') : t('markDone'),
              onClick: () => note.sessionId ? actions.open(note) : void actions.setState(note, 'done') }, h(StatusGlyph, { status: status ?? 'todo' })),
            h('span', { key: 'text', className: 'cn-text', title: note.text }, note.text),
            h('span', { key: 'tags', className: 'cn-trail' }, [
              entry.priority ? h(Tag, { key: 'p', tone: 'orange' }, '!'.repeat(entry.priority)) : null,
              entry.deadline ? h(Tag, { key: 'd', tone: 'red' }, `${t('deadline')} ${entry.deadline.slice(5)}`) : null,
              entry.rolledFrom ? h(Tag, { key: 'r', tone: 'gray' }, `${t('rolledFrom')} ${entry.rolledFrom.slice(5)}`) : null,
              entry.overbooked ? h(Tag, { key: 'o', tone: 'red' }, t('overbooked')) : null,
            ]),
            h(PropChip, { key: 'date', label: 'date', action: 'timeline.date', value: note.plan?.date ?? '', options: dateOptions, onChange: (value) => void actions.setPlan(note, { date: value }) }),
            h(PropChip, { key: 'lane', label: 'lane', action: 'timeline.lane', tone: entry.lane === 'agent' ? 'purple' : undefined, value: note.plan?.lane ?? '',
              options: [['', entry.lane === 'agent' ? t('laneAgent') : t('laneMe')], ['me', t('laneMe')], ['agent', t('laneAgent')]], onChange: (value) => void actions.setPlan(note, { lane: value }) }),
            entry.lane === 'agent' ? h('span', { key: 'cost', className: 'cn-chip static' }, `${t('reviewCost')} ${minutes(entry.costMin, t)}`)
              : h(PropChip, { key: 'estimate', label: 'estimate', action: 'timeline.estimate', value: String(note.plan?.estimateMin ?? ''), options: estimateOptions(entry),
                onChange: (value) => void actions.setPlan(note, { estimateMin: value ? Number(value) : undefined }) }),
            h('span', { key: 'tools', className: 'cn-tools' }, [
              note.sessionId ? h('button', { key: 'open', type: 'button', className: 'cn-ghost strong', onClick: () => actions.open(note) }, `${t('open')} ↗`)
                : h('button', { key: 'task', type: 'button', className: 'cn-ghost strong', 'data-action-id': 'timeline.convert', onClick: () => void actions.convert(note, 'task') }, `${t('toTask')} →`),
              h('button', { key: 'done', type: 'button', className: 'cn-ghost', 'data-action-id': 'timeline.done', onClick: () => void actions.setState(note, 'done') }, t('markDone')),
            ]),
          ]),
          rolled ? h('div', { key: 'nudge', className: 'cn-reply warn' }, [`${t('rolled')} ${note.rollovers}${t('rolledUnit')}${t('nudgeAsk')} `,
            h('button', { key: 'split', type: 'button', className: 'cn-link', 'data-action-id': 'timeline.split', onClick: () => actions.create({ parentId: note.id }) }, t('split')),
            h('button', { key: 'explore', type: 'button', className: 'cn-link', 'data-action-id': 'timeline.explore', onClick: () => void actions.convert(note, 'explore') }, t('toExplore')),
            h('button', { key: 'drop', type: 'button', className: 'cn-link', 'data-action-id': 'timeline.drop', onClick: () => void actions.setState(note, 'dropped') }, t('drop'))]) : null,
          state.failed[note.id] ? h('div', { key: 'failed', className: 'cn-reply error' }, `${t('convertFailed')}${failureText(state.failed[note.id], t)}`) : null,
        ])
      }
      const groupOf = (entry) => {
        const note = byId.get(entry.id)
        const status = env.statusOf(note ?? {})
        if (status === 'waiting') return 'groupWaiting'
        if (status === 'running' || note?.sessionId) return 'groupRunning'
        if (entry.lane === 'agent') return 'groupDispatch'
        return 'groupMine'
      }
      const toggle = (key) => setOpen((current) => ({ ...current, [key]: !(current[key] ?? true) }))
      const isOpen = (key) => open[key] ?? true
      return h('div', { className: 'cn-timeline' }, [
        h('div', { key: 'cols', className: 'cn-tgrid cn-tcols', 'aria-hidden': true }, [
          h('span', { key: 'a' }), h('span', { key: 'b' }, `${t('scheduled')} ${total} · ${t('laterCount')} ${timeline.later.length}`), h('span', { key: 'c' }),
          h('span', { key: 'd' }, t('colDate')), h('span', { key: 'e' }, t('colLane')), h('span', { key: 'f' }, t('colCost')),
        ]),
        total + timeline.later.length === 0 ? h(Callout, { key: 'empty', tone: 'gray', icon: h(Icon, { name: 'calendar' }) }, t('timelineEmpty')) : null,
        ...timeline.days.filter((day) => day.items.length || day.date === state.today).map((day) => h('section', { key: day.date, className: 'cn-tday', 'data-timeline-day': day.date }, [
          h('header', { key: 'head', className: 'cn-thead' }, [
            h(Caret, { key: 'toggle', open: isOpen(day.date), onClick: () => toggle(day.date) }),
            h('h2', { key: 'label', className: 'cn-h2' }, [dayLabel(day.date, state.today, t), h('span', { key: 'date', className: 'cn-faint' }, day.date.slice(5)), h('span', { key: 'n', className: 'cn-count' }, String(day.items.length))]),
            h('span', { key: 'spacer', className: 'cn-spacer' }),
            h('span', { key: 'you', className: 'cn-tmeter', title: t('you') }, [h('span', { key: 'l', className: 'cn-faint' }, t('you')), h(Meter, { key: 'm', used: day.usedMin, total: day.capacityMin, t })]),
            h('span', { key: 'agent', className: 'cn-tmeter', title: t('agentSlots') }, [h('span', { key: 'l', className: 'cn-faint' }, t('laneAgent')), h(Slots, { key: 's', used: day.agentUsed, total: day.agentSlots })]),
          ]),
          isOpen(day.date) ? h('div', { key: 'groups', className: 'cn-tbody' }, ['groupWaiting', 'groupRunning', 'groupDispatch', 'groupMine'].map((group) => {
            const entries = day.items.filter((entry) => groupOf(entry) === group)
            return entries.length ? h('div', { key: group, className: 'cn-tgroup' }, [h('h3', { key: 'h' }, `${t(group)} · ${entries.length}`), h('ul', { key: 'l', className: 'cn-blocks' }, entries.map(row))]) : null
          })) : null,
        ])),
        timeline.later.length ? h('section', { key: 'later', className: 'cn-tday' }, [
          h('header', { key: 'head', className: 'cn-thead' }, [
            h(Caret, { key: 'toggle', open: isOpen('later'), action: 'timeline.later', onClick: () => toggle('later') }),
            h('h2', { key: 'label', className: 'cn-h2' }, [t('later'), h('span', { key: 'n', className: 'cn-count' }, String(timeline.later.length))]),
          ]),
          isOpen('later') ? h('ul', { key: 'l', className: 'cn-blocks cn-tbody' }, timeline.later.map(row)) : null,
        ]) : null,
      ])
    }

    function NotesSettings({ env }) {
      const { state, t, actions } = env
      const s = state.settings ?? {}
      const [draft, setDraft] = useState(null)
      const [saved, setSaved] = useState(false)
      const value = draft ?? { capacityH: (s.capacityMin ?? 240) / 60, reviewCostMin: s.reviewCostMin ?? 15, agentSlots: s.agentSlots ?? 2, horizonDays: s.horizonDays ?? 7, skipWeekends: s.skipWeekends === true, workspaceId: s.workspaceId ?? '' }
      const set = (patch) => { setSaved(false); setDraft({ ...value, ...patch }) }
      const field = (key, label, hint, control) => h('div', { key, className: 'cn-setting' }, [
        h('div', { key: 'text', className: 'cn-setting-text' }, [h('b', { key: 'l' }, label), hint ? h('span', { key: 'h', className: 'cn-faint' }, hint) : null]),
        h('div', { key: 'control', className: 'cn-setting-control' }, control),
      ])
      const number = (key, min, max, step = 1) => h('input', { type: 'number', min, max, step, value: value[key], className: 'cn-field', onChange: (event) => set({ [key]: Number(event.target.value) }) })
      return h('form', { className: 'cn-settings', onSubmit: (event) => {
        event.preventDefault()
        void actions.updateSettings({ capacityMin: Math.round(value.capacityH * 60), reviewCostMin: value.reviewCostMin, agentSlots: value.agentSlots,
          horizonDays: value.horizonDays, skipWeekends: value.skipWeekends, workspaceId: value.workspaceId || null })
          .then(() => { setDraft(null); setSaved(true) }, () => {})
      } }, [
        h('h2', { key: 'you', className: 'cn-h2' }, t('secYou')),
        field('capacityH', t('sCapacity'), t('sCapacityHint'), number('capacityH', 0.5, 16, 0.5)),
        field('reviewCostMin', t('sReviewCost'), t('sReviewCostHint'), number('reviewCostMin', 0, 120, 5)),
        h('h2', { key: 'agent', className: 'cn-h2' }, t('secAgent')),
        field('agentSlots', t('sAgentSlots'), t('sAgentSlotsHint'), number('agentSlots', 0, 10)),
        field('workspace', t('sWorkspace'), t('sWorkspaceHint'), h('select', { value: value.workspaceId, className: 'cn-field', onChange: (event) => set({ workspaceId: event.target.value }) }, [
          h('option', { key: 'auto', value: '' }, t('sWorkspaceAuto')),
          ...state.workspaces.map((w) => h('option', { key: w.id, value: w.id }, w.title ?? w.path ?? w.id))])),
        h('h2', { key: 'timeline', className: 'cn-h2' }, t('secTimeline')),
        field('horizonDays', t('sHorizon'), undefined, number('horizonDays', 3, 14)),
        field('weekends', t('sWeekends'), t('sWeekendsHint'), h('input', { type: 'checkbox', className: 'cn-switch', checked: value.skipWeekends, onChange: (event) => set({ skipWeekends: event.target.checked }) })),
        h('div', { key: 'actions', className: 'cn-setting-actions' }, [h('button', { key: 'save', type: 'submit', className: 'cn-primary', 'data-action-id': 'notes.settings.save', disabled: !draft }, t('save')),
          saved ? h('span', { key: 'saved', className: 'cn-faint' }, t('saved')) : null]),
      ])
    }

    /* Shared theme on DSH tokens. Scoped to .dsh-cn so it never leaks into the host UI. */
    const CN_THEME = `
.dsh-cn{
  --cn-bg:var(--dsw-alias-bg-base);--cn-surface:var(--dsw-alias-bg-layer-1);--cn-sunken:var(--dsw-alias-bg-module-platform,var(--dsw-alias-fill-l1));
  --cn-hover:var(--dsw-alias-interactive-bg-hover);--cn-active:var(--dsw-alias-interactive-bg-active);--cn-hover-solid:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-bg-layer-2));
  --cn-ink:var(--dsw-alias-label-primary);--cn-text:var(--dsw-alias-label-primary);--cn-muted:var(--dsw-alias-label-secondary);--cn-faint:var(--dsw-alias-label-tertiary);--cn-caption:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));
  --cn-line:var(--dsw-alias-border-l2);--cn-line-soft:var(--dsw-alias-border-l1);
  --cn-accent:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-link));
  --cn-accent-soft:color-mix(in srgb,var(--cn-accent) 12%,transparent);--cn-focus:color-mix(in srgb,var(--cn-accent) 45%,transparent);
  --cn-gray-bg:var(--dsw-alias-fill-l1);--cn-gray:var(--dsw-alias-label-secondary);
  --cn-orange:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary));--cn-orange-bg:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);
  --cn-blue:var(--dsw-alias-state-business-primary,var(--cn-accent));--cn-blue-bg:color-mix(in srgb,var(--cn-blue) 12%,transparent);
  --cn-green:color-mix(in srgb,var(--dsw-alias-state-success-primary) 78%,var(--dsw-alias-label-primary));--cn-green-bg:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent);
  --cn-red:var(--dsw-alias-state-error-primary);--cn-red-bg:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);
  --cn-purple:var(--dsw-alias-state-done-primary,#7c3aed);--cn-purple-bg:color-mix(in srgb,var(--cn-purple) 12%,transparent);
  --cn-shadow:var(--dsw-elevation-soft,0 0 0 .5px var(--dsw-alias-border-l3));--cn-shadow-panel:var(--dsw-elevation-panel,var(--cn-shadow));
  --cn-r-xs:var(--dsw-radius-xs,4px);--cn-r-sm:var(--dsw-radius-sm,8px);--cn-r-md:var(--dsw-radius-md,12px);
  --cn-fast:var(--ds-transition-duration-fast,.1s);--cn-mid:var(--ds-transition-duration,.2s);--cn-slow:var(--ds-transition-duration-slow,.3s);--cn-ease:var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1));
  --cn-fs:var(--dsw-font-s-14-font-size,14px);--cn-fs-2:var(--dsh-content-font-size-secondary,13px);--cn-fs-3:var(--dsw-font-xxs-12-font-size,12px);
  --cn-code:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);
  background:var(--cn-bg);color:var(--cn-text);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif);
  font-size:var(--cn-fs);line-height:1.55;-webkit-font-smoothing:antialiased;
}
.dsh-cn *{box-sizing:border-box}
.dsh-cn button{font:inherit;color:inherit}
.dsh-cn :focus-visible{outline:2px solid var(--cn-focus);outline-offset:1px;border-radius:var(--cn-r-xs)}
.cn-faint{color:var(--cn-faint)}
.cn-spacer{flex:1}
.cn-link{border:0;background:none;padding:0 2px;cursor:pointer;color:var(--cn-accent);font-size:inherit;transition:opacity var(--cn-fast) var(--cn-ease)}
.cn-link:hover{opacity:.75}
.cn-ghost{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border:0;border-radius:var(--cn-r-sm);background:transparent;color:var(--cn-muted);font-size:var(--cn-fs-2);cursor:pointer;white-space:nowrap;transition:background var(--cn-fast) var(--cn-ease),color var(--cn-fast) var(--cn-ease),opacity var(--cn-mid) var(--cn-ease)}
.cn-ghost:hover,.cn-ghost.on{background:var(--cn-hover);color:var(--cn-ink)}
.cn-ghost:active{background:var(--cn-active)}
.cn-ghost.strong{color:var(--cn-ink);font-weight:500}
.cn-primary{display:inline-flex;align-items:center;height:30px;padding:0 14px;border:0;border-radius:var(--cn-r-sm);background:var(--dsw-alias-button-primary-fill,var(--cn-ink));color:var(--dsw-alias-label-primary-inverted,#fff) !important;font-size:var(--cn-fs-2);font-weight:500;cursor:pointer;transition:background var(--cn-fast) var(--cn-ease),transform var(--cn-fast) var(--cn-ease)}
.cn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--cn-ink))}
.cn-primary:active:not(:disabled){transform:scale(.98)}
.cn-primary:disabled{opacity:.4;cursor:default}
.cn-tag{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:var(--cn-r-xs);font-size:var(--cn-fs-3);font-weight:500;line-height:1;white-space:nowrap;background:var(--cn-gray-bg);color:var(--cn-gray)}
.cn-tag.orange{background:var(--cn-orange-bg);color:var(--cn-orange)}.cn-tag.blue{background:var(--cn-blue-bg);color:var(--cn-blue)}
.cn-tag.green{background:var(--cn-green-bg);color:var(--cn-green)}.cn-tag.red{background:var(--cn-red-bg);color:var(--cn-red)}
.cn-tag.purple{background:var(--cn-purple-bg);color:var(--cn-purple)}.cn-tag.accent{background:var(--cn-accent-soft);color:var(--cn-accent)}
.cn-callout{display:flex;gap:10px;padding:10px 12px;margin:0 0 12px;border-radius:var(--cn-r-sm);background:var(--cn-gray-bg);font-size:var(--cn-fs-2);line-height:1.6;color:var(--cn-text);animation:cn-in var(--cn-mid) var(--cn-ease) both}
.cn-callout.orange{background:var(--cn-orange-bg)}.cn-callout.red{background:var(--cn-red-bg)}.cn-callout.accent{background:var(--cn-accent-soft)}
.cn-callout-icon{flex:none;width:18px;display:grid;place-items:start center;padding-top:2px;color:var(--cn-muted)}
.cn-callout.orange .cn-callout-icon{color:var(--cn-orange)}.cn-callout.red .cn-callout-icon{color:var(--cn-red)}.cn-callout.accent .cn-callout-icon{color:var(--cn-accent)}
.cn-callout-body{min-width:0;flex:1}.cn-callout-body p{margin:0 0 4px}.cn-callout-body p:last-child{margin:0}
.cn-spark{flex:none;color:var(--cn-accent)}
.cn-glyph{display:block;flex:none;color:var(--cn-faint);transition:color var(--cn-mid) var(--cn-ease)}
.cn-glyph.waiting{color:var(--dsw-alias-state-warn-primary)}.cn-glyph.running{color:var(--cn-blue);animation:cn-spin 1s linear infinite}
.cn-glyph.review{color:var(--dsw-alias-state-success-primary)}.cn-glyph.failed{color:var(--cn-red)}.cn-glyph.done{color:var(--cn-accent)}
.cn-glyph.todo,.cn-glyph.idle{color:var(--cn-faint)}
@keyframes cn-spin{to{transform:rotate(360deg)}}
@keyframes cn-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@keyframes cn-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.dsh-cn *,.dsh-cn *::before,.dsh-cn *::after{animation:none!important;transition:none!important}}
`

    /* Page skeleton shared by the inbox and the notes. Spacing follows a 4px grid. */
    const LAYOUT_STYLE = `
.cn-page{height:100%;overflow-y:auto;overflow-x:hidden;scroll-behavior:smooth}
.cn-topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;height:44px;padding:0 16px 0 20px;background:color-mix(in srgb,var(--cn-bg) 86%,transparent);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid transparent}
/* Notion-like: the bar has no edge at rest; a hairline fades in once content scrolls under it. */
.cn-topbar{transition:border-color var(--cn-mid) var(--cn-ease)}
.cn-page[data-scrolled]>.cn-topbar{border-bottom-color:var(--cn-line-soft)}
.cn-crumb{display:inline-flex;align-items:center;gap:8px;min-width:0;font-size:var(--cn-fs-2);color:var(--cn-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cn-crumb svg{flex:none;color:var(--cn-faint)}
.cn-topbar-actions{display:inline-flex;align-items:center;gap:4px}
.cn-col{max-width:1040px;margin:0 auto;padding:24px 40px 64px;container-type:inline-size;animation:cn-fade var(--cn-mid) var(--cn-ease) both}
.cn-head{margin:0 0 8px}
/* Without view tabs, a hairline closes the page head the way Notion closes its properties. */
.cn-head+.cn-body{margin-top:12px;padding-top:16px;border-top:1px solid var(--cn-line-soft)}
.cn-title-row{display:flex;align-items:center;gap:12px;min-width:0}
.cn-page-icon{flex:none;width:32px;height:32px;display:grid;place-items:center;color:var(--cn-accent)}
.cn-page-icon svg{width:24px;height:24px}
.cn-title-text{min-width:0;display:grid;gap:2px}
.cn-title{margin:0;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-.01em;color:var(--cn-ink)}
.cn-lede{margin:0;font-size:var(--cn-fs-2);line-height:1.5;color:var(--cn-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cn-num{font-weight:600;color:var(--cn-ink);font-variant-numeric:tabular-nums;margin-right:2px}
.cn-num.warn{color:var(--dsw-alias-state-warn-label,var(--cn-orange))}.cn-num.error{color:var(--cn-red)}
.cn-lede .cn-link{margin-left:6px}
.cn-props{display:flex;flex-wrap:wrap;gap:2px 4px;margin:10px -6px 0}
.cn-prop{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 6px;border-radius:var(--cn-r-xs);background:transparent;font-size:var(--cn-fs-2);color:var(--cn-text);white-space:nowrap;font-variant-numeric:tabular-nums;transition:background var(--cn-fast) var(--cn-ease)}
.cn-prop:hover{background:var(--cn-hover)}
.cn-prop .cn-icon{color:var(--cn-faint)}
.cn-prop-label{color:var(--cn-faint)}
.cn-prop-value{display:inline-flex;align-items:center;gap:6px}
.cn-prop.warn .cn-icon,.cn-prop.warn .cn-prop-value{color:var(--dsw-alias-state-warn-label,var(--cn-orange))}
.cn-meter{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums;color:inherit}
.cn-meter-bar{display:inline-block;width:64px;height:4px;border-radius:2px;background:var(--cn-line);overflow:hidden}
.cn-meter-bar b{display:block;height:100%;border-radius:2px;background:var(--cn-accent);transition:width var(--cn-slow) var(--cn-ease)}
.cn-meter.over .cn-meter-bar b{background:var(--cn-red)}.cn-meter.over{color:var(--cn-red)}
.cn-slots{display:inline-flex;gap:3px}
.cn-slot{width:7px;height:7px;border-radius:50%;border:1.3px solid var(--cn-faint);transition:background var(--cn-mid) var(--cn-ease),border-color var(--cn-mid) var(--cn-ease)}
.cn-slot.on{background:var(--cn-purple);border-color:var(--cn-purple)}.cn-slot.over{border-color:var(--cn-red);background:var(--cn-red)}
.cn-views{display:flex;align-items:center;gap:2px;min-height:36px;margin:12px 0 16px;border-bottom:1px solid var(--cn-line-soft)}
.cn-view{position:relative;display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 8px;border:0;background:transparent;color:var(--cn-faint);font-size:var(--cn-fs-2);cursor:pointer;transition:color var(--cn-fast) var(--cn-ease)}
.cn-view:hover{color:var(--cn-ink)}
.cn-view.on{color:var(--cn-ink);font-weight:500}
.cn-view::after{content:'';position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:1px;background:var(--cn-ink);transform:scaleX(0);transition:transform var(--cn-mid) var(--cn-ease)}
.cn-view.on::after{transform:scaleX(1)}
.cn-body{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;align-items:start;animation:cn-in var(--cn-mid) var(--cn-ease) both}
@container (min-width:880px){.cn-body.has-rail{grid-template-columns:minmax(0,1fr) 248px;column-gap:48px}.cn-rail{position:sticky;top:60px}}
.cn-main{min-width:0}
.cn-rail{display:grid;gap:24px;min-width:0}
/* Rail sections are headed lists, not cards: whitespace divides them. */
.cn-panel{min-width:0;animation:cn-in var(--cn-slow) var(--cn-ease) both}
.cn-panel-head{display:flex;align-items:center;gap:6px;min-height:24px;margin:0 0 2px;padding:0 4px}
.cn-panel-head h3{margin:0;font-size:var(--cn-fs-3);font-weight:500;color:var(--cn-faint)}
.cn-panel-head .cn-link{font-size:var(--cn-fs-3)}
.cn-mini{list-style:none;margin:0;padding:0;display:grid;gap:1px}
.cn-mini li{display:flex;align-items:center;gap:6px;min-height:28px;padding:0 4px;border-radius:var(--cn-r-sm);font-size:var(--cn-fs-2);transition:background var(--cn-fast) var(--cn-ease)}
.cn-mini li:hover{background:var(--cn-hover)}
.cn-mini-text{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--cn-text)}
.cn-mini-meta{flex:none;font-size:var(--cn-fs-3);color:var(--cn-faint)}
.cn-mini-more{margin:4px 4px 0;font-size:var(--cn-fs-3)}
.cn-facts{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 6px}
.cn-facts li{display:grid;gap:0;padding:2px 4px}
.cn-facts b{font-size:16px;font-weight:600;color:var(--cn-ink);font-variant-numeric:tabular-nums}
.cn-facts span{font-size:var(--cn-fs-3);color:var(--cn-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cn-foot{margin-top:40px;padding-top:0;border-top:0;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;font-size:var(--cn-fs-3);color:var(--cn-faint)}
.cn-foot p{margin:0}
.cn-keys{display:flex;flex-wrap:wrap;gap:6px 14px}
.cn-keys span{display:inline-flex;align-items:center;gap:5px}
.dsh-cn kbd,.cn-keys kbd{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 4px;border-radius:var(--cn-r-xs);font:500 11px/1 var(--cn-code);color:var(--cn-muted);background:var(--cn-surface);box-shadow:inset 0 0 0 1px var(--cn-line),0 1px 0 var(--cn-line)}
.cn-loading{padding:40px 0}
@container (max-width:560px){.cn-lede{white-space:normal}.cn-props{gap:4px}}
@media (max-width:720px){.cn-col{padding:12px 16px 40px}.cn-topbar{padding:0 12px}.cn-page-icon{width:26px;height:26px}.cn-page-icon svg{width:20px;height:20px}.cn-title{font-size:19px}.cn-keys{display:none}}
`

    const NOTES_STYLE = `
.cn-page.compact .cn-col{padding:8px 8px 24px;max-width:none}
.cn-page.compact .cn-gutter{display:none}
.cn-filters{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center}
.cn-filter{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:12px;border:0;background:transparent;font-size:var(--cn-fs-3);color:var(--cn-muted);cursor:pointer;transition:background var(--cn-fast) var(--cn-ease),color var(--cn-fast) var(--cn-ease)}
.cn-filter .cn-glyph{width:13px;height:13px}
.cn-filter:hover{background:var(--cn-hover)}
.cn-filter.on.orange{background:var(--cn-orange-bg);color:var(--cn-orange)}
.cn-filter.on.blue{background:var(--cn-blue-bg);color:var(--cn-blue)}
.cn-filter.on.green{background:var(--cn-green-bg);color:var(--cn-green)}
.cn-day{margin:0 0 24px;animation:cn-in var(--cn-mid) var(--cn-ease) both}
.cn-h2{display:flex;align-items:center;gap:6px;margin:0 0 4px;padding:0 2px;font-size:var(--cn-fs-2);font-weight:600;line-height:24px;color:var(--cn-ink)}
.cn-h2 .cn-faint{font-weight:400;font-size:var(--cn-fs-3)}
.cn-count{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;font-size:11px;font-weight:500;background:var(--cn-gray-bg);color:var(--cn-muted)}
.cn-blocks{list-style:none;margin:0;padding:0}
.cn-block{position:relative;padding-left:calc(var(--depth,0) * 24px);animation:cn-in var(--cn-mid) var(--cn-ease) both}
.cn-line{position:relative;display:flex;align-items:center;gap:2px;min-height:30px;padding:0 6px 0 0;border-radius:var(--cn-r-sm);transition:background var(--cn-fast) var(--cn-ease)}
.cn-block:hover>.cn-line,.cn-block:focus-within>.cn-line,.cn-trow:hover>.cn-line,.cn-trow:focus-within>.cn-line{background:var(--cn-hover-solid)}
.cn-gutter{width:22px;flex:none;display:grid;place-items:center;margin-left:-24px}
.cn-add{width:20px;height:22px;border:0;border-radius:var(--cn-r-xs);background:transparent;color:var(--cn-faint);font-size:16px;line-height:1;cursor:pointer;opacity:0;transition:opacity var(--cn-mid) var(--cn-ease),background var(--cn-fast) var(--cn-ease)}
.cn-block:hover .cn-add{opacity:1}.cn-add:hover{background:var(--cn-active);color:var(--cn-ink)}
.cn-caret{width:18px;height:22px;flex:none;display:grid;place-items:center;border:0;border-radius:var(--cn-r-xs);background:transparent;color:var(--cn-faint);cursor:pointer;transition:transform var(--cn-mid) var(--cn-ease),background var(--cn-fast) var(--cn-ease)}
.cn-caret:hover{background:var(--cn-active)}.cn-caret.shut{transform:rotate(-90deg)}
.cn-caret.blank{pointer-events:none}
.cn-mark{width:24px;height:24px;flex:none;display:grid;place-items:center;border:0;border-radius:var(--cn-r-xs);background:transparent;cursor:pointer;padding:0;color:var(--cn-faint);font-size:15px;transition:background var(--cn-fast) var(--cn-ease),transform var(--cn-fast) var(--cn-ease)}
.cn-mark:hover{background:var(--cn-active)}.cn-mark:active{transform:scale(.9)}
.cn-mark.small{width:20px;height:20px}
.cn-quick .cn-mark{cursor:default;background:none}
.cn-input{flex:1;min-width:60px;height:28px;border:0;outline:0;background:transparent;font:inherit;font-size:var(--cn-fs);color:var(--cn-ink);padding:0 4px}
.cn-input::placeholder{color:var(--cn-faint)}
.cn-text{flex:1;min-width:0;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cn-ink)}
.cn-block.closed .cn-input{color:var(--cn-faint);text-decoration:line-through;text-decoration-color:var(--cn-line)}
.cn-block.suggestion .cn-text{color:var(--cn-muted)}
.cn-trail{display:inline-flex;align-items:center;justify-content:flex-end;gap:6px;flex:none;min-width:56px;transition:opacity var(--cn-fast) var(--cn-ease)}
.cn-when{min-width:44px;text-align:right;font-size:var(--cn-fs-3);color:var(--cn-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
.cn-tools{position:absolute;right:4px;top:50%;display:inline-flex;align-items:center;gap:2px;padding-left:28px;background:linear-gradient(to right,transparent,var(--cn-hover-solid) 24px);opacity:0;pointer-events:none;transform:translate(4px,-50%);transition:opacity var(--cn-mid) var(--cn-ease),transform var(--cn-mid) var(--cn-ease)}
.cn-block:hover>.cn-line>.cn-tools,.cn-block:focus-within>.cn-line>.cn-tools,.cn-trow:hover>.cn-line>.cn-tools,.cn-trow:focus-within>.cn-line>.cn-tools{opacity:1;pointer-events:auto;transform:translate(0,-50%)}
.cn-working{display:inline-flex;align-items:center;gap:6px;font-size:var(--cn-fs-3);color:var(--cn-muted)}
.cn-reply{display:flex;align-items:flex-start;gap:8px;margin:2px 0 8px 52px;padding:1px 0 1px 12px;border-left:2px solid var(--cn-line);border-radius:0;background:transparent;font-size:var(--cn-fs-2);line-height:1.6;color:var(--cn-muted);animation:cn-in var(--cn-slow) var(--cn-ease) both}
.cn-reply .cn-spark{margin-top:4px}
.cn-reply.quiet{background:transparent;border-left:0;padding:0 0 0 14px;font-size:var(--cn-fs-3);color:var(--cn-faint)}
.cn-reply.error{border-left:0;padding:8px 10px;border-radius:var(--cn-r-sm);background:var(--cn-red-bg);color:var(--cn-red)}
.cn-reply.warn{border-left:0;padding:8px 10px;border-radius:var(--cn-r-sm);background:var(--cn-orange-bg);color:var(--cn-orange);margin-left:24px}
.cn-tip-examples{display:flex;flex-wrap:wrap;gap:6px}
.cn-tip-examples code{padding:2px 8px;border-radius:var(--cn-r-xs);background:var(--cn-surface);box-shadow:inset 0 0 0 1px var(--cn-line-soft);font:inherit;color:var(--cn-ink)}
.cn-anchor{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-size:var(--cn-fs-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cn-tgrid{display:grid;grid-template-columns:24px minmax(0,1fr) auto 76px 64px 92px;align-items:center;column-gap:6px}
.cn-tcols{min-height:24px;padding:0 6px 0 0;font-size:var(--cn-fs-3);color:var(--cn-faint)}
.cn-tcols span:nth-child(n+4){padding-left:7px}
.cn-tday{margin:0 0 12px;animation:cn-in var(--cn-mid) var(--cn-ease) both}
.cn-thead{display:flex;align-items:center;gap:4px;min-height:32px;border-bottom:1px solid var(--cn-line-soft)}
.cn-thead .cn-h2{margin:0}
.cn-tmeter{display:inline-flex;align-items:center;gap:6px;margin-left:12px;font-size:var(--cn-fs-3);color:var(--cn-muted)}
.cn-tbody{padding:2px 0 0}
.cn-tgroup h3{margin:8px 0 0 30px;font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--cn-faint)}
.cn-trow{animation:cn-in var(--cn-mid) var(--cn-ease) both}
.cn-trow .cn-trail{min-width:0}
.cn-chip{position:relative;display:inline-flex;align-items:center;height:24px;padding:0 7px;border-radius:var(--cn-r-xs);font-size:var(--cn-fs-3);color:var(--cn-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:background var(--cn-fast) var(--cn-ease)}
.cn-chip:hover{background:var(--cn-active)}
.cn-chip.purple{color:var(--cn-purple)}
.cn-chip.auto{color:var(--cn-faint)}
.cn-chip.static{cursor:default;color:var(--cn-muted)}.cn-chip.static:hover{background:none}
.cn-chip select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:14px}
.cn-settings{display:grid;max-width:720px}
.cn-settings .cn-h2{margin:20px 0 0;padding-bottom:6px;border-bottom:1px solid var(--cn-line-soft);color:var(--cn-muted)}
.cn-settings .cn-h2:first-child{margin-top:0}
.cn-setting{display:grid;grid-template-columns:minmax(0,1fr) 220px;align-items:center;gap:24px;padding:10px 0;border-bottom:1px solid var(--cn-line-soft)}
.cn-setting-text{display:grid;gap:2px;min-width:0}
.cn-setting-text b{font-weight:500;font-size:var(--cn-fs);color:var(--cn-ink)}
.cn-setting-text .cn-faint{font-size:var(--cn-fs-3);line-height:1.5}
.cn-setting-control{display:flex;justify-content:flex-end}
.cn-field{width:100%;height:30px;padding:0 10px;border:0;border-radius:var(--cn-r-sm);background:var(--cn-sunken);box-shadow:inset 0 0 0 1px var(--cn-line-soft);font:inherit;font-size:var(--cn-fs-2);color:var(--cn-ink);transition:box-shadow var(--cn-fast) var(--cn-ease)}
.cn-field:focus{outline:0;box-shadow:inset 0 0 0 1.5px var(--cn-accent)}
.cn-switch{appearance:none;width:32px;height:18px;border-radius:9px;background:var(--cn-line);position:relative;cursor:pointer;transition:background var(--cn-mid) var(--cn-ease)}
.cn-switch::after{content:'';position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform var(--cn-mid) var(--cn-ease)}
.cn-switch:checked{background:var(--cn-accent)}.cn-switch:checked::after{transform:translateX(14px)}
.cn-setting-actions{display:flex;align-items:center;gap:12px;padding:16px 0 0}
@container (max-width:640px){
  .cn-tgrid{grid-template-columns:24px minmax(0,1fr) auto}
  .cn-tgrid>.cn-chip,.cn-tcols span:nth-child(n+4){display:none}
  .cn-thead{flex-wrap:wrap;row-gap:2px;padding-bottom:4px}.cn-thead .cn-spacer{flex-basis:100%}.cn-tmeter{margin-left:24px}.cn-tmeter+.cn-tmeter{margin-left:12px}
  .cn-setting{grid-template-columns:minmax(0,1fr);gap:8px}.cn-setting-control{justify-content:flex-start}
  .cn-reply{margin-left:24px}
}
@media (hover:none){
  .cn-tools{position:static;transform:none;opacity:1;pointer-events:auto;background:none;padding-left:0;display:none}
  .cn-block:focus-within>.cn-line>.cn-tools,.cn-trow:focus-within>.cn-line>.cn-tools{display:inline-flex}
  .cn-line{flex-wrap:wrap}.cn-gutter{display:none}
}
`

    /* ------------------------------------------- project timeline (docs/010) */
    // Read-only: the Host condenses each Session log of a Workspace; nothing here
    // prompts, creates or changes a Session. Work happens only while the page is open.

    const PROJECTS_PANEL_ID = 'attention-projects'
    const PROJECTS_NS = 'attention-projects'
    const PROJECTS_ROUTE = 'api/attention-projects'
    const PROJECTS_PICK_KEY = 'dsh-attention-projects:selected'

    const projectsZh = {
      title: '项目时间线', loading: '正在读取项目…', loadFailed: '没读到：', retry: '重试', refresh: '刷新',
      noWorkspace: '还没有项目。在 DSH 里打开一个文件夹后，这里会按时间列出它下面每个对话做过的事。',
      empty: '这个项目还没有对话过。', propProject: '项目',
      unitSessions: ' 个会话', unitTurns: ' 轮', unitFiles: ' 个文件', unitDays: ' 天有活动', lastActive: '最近活动 ',
      reading: '正在读取会话，还剩 ', readingTail: ' 个',
      viewTimeline: '时间线', viewSessions: '会话',
      railFiles: '改动最多的文件', railRunning: '正在进行', skipped: '个会话是旧格式或读不出来，没有列入',
      open: '打开', ran: '运行了 ', commands: ' 条命令', moreFiles: '另 ', moreFilesTail: ' 个',
      olderTurns: '更早的 ', olderTail: ' 轮没有列出', turn: '第 ', turnTail: ' 轮', firstAsk: '起因：', lastAnswer: '最近结论：',
      todos: '待办 ', noAnswer: '这一轮没有文字结论', subagents: ' 个子代理', archived: '已归档', detailLoading: '正在读取这段对话…',
      filesTitle: '改过的文件', commandsTitle: '运行过的命令', todosTitle: '最后的待办',
      outdone: '完成', outerror: '出错', outrunning: '进行中', outaborted: '已中止', outinterrupted: '被打断', 'outmax-tokens': '输出被截断',
      readOnly: '只从会话记录里整理，不会唤醒、提示或改动任何会话。',
      today: '今天', tomorrow: '明天', yesterday: '昨天', weekdays: '日一二三四五六',
      agoNow: '刚刚', agoMin: ' 分钟前', agoH: ' 小时前', agoD: ' 天前',
    }
    const projectsEn = {
      title: 'Project timeline', loading: 'Reading project…', loadFailed: 'Could not read: ', retry: 'Retry', refresh: 'Refresh',
      noWorkspace: 'No projects yet. Open a folder in DSH and this page lists, in order, what every conversation in it did.',
      empty: 'No conversations in this project yet.', propProject: 'Project',
      unitSessions: ' sessions', unitTurns: ' turns', unitFiles: ' files', unitDays: ' active days', lastActive: 'last active ',
      reading: 'Reading sessions, ', readingTail: ' left',
      viewTimeline: 'Timeline', viewSessions: 'Sessions',
      railFiles: 'Most changed files', railRunning: 'In progress', skipped: 'sessions use an old format or could not be read',
      open: 'Open', ran: 'Ran ', commands: ' commands', moreFiles: '+', moreFilesTail: '',
      olderTurns: '', olderTail: ' older turns not listed', turn: 'Turn ', turnTail: '', firstAsk: 'Started with: ', lastAnswer: 'Latest: ',
      todos: 'Todos ', noAnswer: 'No written conclusion in this turn', subagents: ' subagents', archived: 'Archived', detailLoading: 'Reading this conversation…',
      filesTitle: 'Files changed', commandsTitle: 'Commands run', todosTitle: 'Last todo list',
      outdone: 'Done', outerror: 'Error', outrunning: 'Running', outaborted: 'Aborted', outinterrupted: 'Interrupted', 'outmax-tokens': 'Cut off',
      readOnly: 'Built only from session logs; nothing is woken, prompted or changed.',
      today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday', weekdays: 'SMTWTFS',
      agoNow: 'just now', agoMin: 'm ago', agoH: 'h ago', agoD: 'd ago',
    }
    const OUTCOME_GLYPH = { done: 'done', error: 'failed', running: 'running', aborted: 'dropped', interrupted: 'dropped', 'max-tokens': 'missing', empty: 'idle' }
    const clockOf = (at) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
    function ago(at, t, now = Date.now()) {
      const m = Math.max(0, Math.round((now - at) / 60000))
      if (m < 1) return t('agoNow')
      if (m < 60) return `${m}${t('agoMin')}`
      if (m < 48 * 60) return `${Math.round(m / 60)}${t('agoH')}`
      return `${Math.round(m / 1440)}${t('agoD')}`
    }

    function createProjectsController(ctx) {
      let state = { phase: 'idle', workspaces: [], selected: undefined, project: undefined, details: {}, error: undefined, loading: false }
      const listeners = new Set()
      const source = { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } }
      const publish = (patch) => { state = { ...state, ...patch }; for (const listener of [...listeners]) listener() }
      const lifetime = new AbortController()
      let active = true, started = false, mounted = 0, generation = 0, unsubscribe, signature = '', timer
      const call = async (body) => {
        const response = await fetch(new URL(PROJECTS_ROUTE, document.baseURI).href, {
          method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body), signal: lifetime.signal,
        })
        const data = await response.json()
        if (!response.ok || data.ok === false) throw new Error(data.code ?? `HTTP ${response.status}`)
        return data
      }
      const rows = () => Object.values(ctx.sessions?.list?.getSnapshot?.()?.byId ?? {}).filter((row) => row && row.origin !== 'subagent')
      const facts = () => Object.entries(ctx.sessions?.list?.getSnapshot?.()?.byId ?? {}).filter(([, row]) => row && row.origin !== 'subagent')
        .slice(0, 2000).map(([id, row]) => ({ id, ...(Number.isFinite(Number(row.updatedAt)) ? { updatedAt: Number(row.updatedAt) } : {}), running: row.running === true }))
      const pathOf = (id) => state.workspaces.find((w) => w.id === id)?.path
      const signatureOf = () => {
        const path = pathOf(state.selected)
        return rows().filter((row) => row.cwd === path).map((row) => `${row.id}:${row.updatedAt ?? ''}:${row.running ? 1 : 0}`).sort().join('|')
      }
      const load = async () => {
        if (!active || !state.selected) return
        const gen = ++generation
        signature = signatureOf()
        publish({ loading: true })
        try {
          let data
          // The Host digests a few Sessions per request; keep asking until the project is complete.
          for (let round = 0; round < 200; round++) {
            data = await call({ op: 'project', workspaceId: state.selected, sessions: facts() })
            if (!active || gen !== generation) return
            publish({ phase: 'ready', project: data, error: undefined })
            if (!(data.pending > 0) || !mounted) break
          }
        } catch (error) {
          if (!active || gen !== generation || error?.name === 'AbortError') return
          publish({ error: String(error?.message ?? error), phase: state.project ? 'ready' : 'error' })
        } finally { if (active && gen === generation) publish({ loading: false }) }
      }
      const onSessions = () => {
        if (!mounted || !state.selected) return
        if (signatureOf() === signature) return
        clearTimeout(timer)
        timer = setTimeout(() => void load(), 2500)
      }
      const remembered = () => { try { return globalThis.localStorage?.getItem(PROJECTS_PICK_KEY) ?? undefined } catch { return undefined } }
      const start = async () => {
        if (started || !active) return
        started = true
        publish({ phase: 'loading' })
        unsubscribe = ctx.sessions?.list?.subscribe?.(onSessions)
        try {
          const { workspaces = [] } = await call({ op: 'list' })
          if (!active) return
          const listed = new Set(workspaces.map((w) => w.id))
          let selected = remembered()
          if (!listed.has(selected)) {
            const recent = rows().filter((row) => row.cwd).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
            selected = recent.map((row) => workspaces.find((w) => w.path === row.cwd)?.id).find(Boolean) ?? workspaces[0]?.id
          }
          publish({ workspaces, selected, phase: selected ? 'loading' : 'ready' })
          await load()
        } catch (error) {
          if (active && error?.name !== 'AbortError') { started = false; publish({ phase: 'error', error: String(error?.message ?? error) }) }
        }
      }
      const actions = {
        mount() {
          mounted++
          if (!started) void start()
          else if (state.selected && signatureOf() !== signature) void load()
          return () => { mounted = Math.max(0, mounted - 1) }
        },
        refresh: () => started ? load() : start(),
        select(id) {
          if (!id || id === state.selected) return
          try { globalThis.localStorage?.setItem(PROJECTS_PICK_KEY, id) } catch {}
          publish({ selected: id, project: undefined, details: {}, phase: 'loading' })
          void load()
        },
        async detail(sessionId) {
          if (state.details[sessionId]?.loading) return
          const workspaceId = state.selected
          const updatedAt = Number(ctx.sessions?.list?.getSnapshot?.()?.byId?.[sessionId]?.updatedAt)
          publish({ details: { ...state.details, [sessionId]: { loading: true } } })
          try {
            const data = await call({ op: 'session', workspaceId, sessionId, ...(Number.isFinite(updatedAt) ? { updatedAt } : {}) })
            if (active && state.selected === workspaceId) publish({ details: { ...state.details, [sessionId]: { session: data.session } } })
          } catch (error) {
            if (active && error?.name !== 'AbortError') publish({ details: { ...state.details, [sessionId]: { error: String(error?.message ?? error) } } })
          }
        },
        open(sessionId) {
          const workspace = ctx.uiWorkspace ?? ctx.get?.('uiWorkspace')
          if (typeof workspace?.openSession === 'function') workspace.openSession(sessionId)
        },
      }
      const dispose = () => { active = false; lifetime.abort(); clearTimeout(timer); unsubscribe?.(); listeners.clear() }
      return { source, actions, dispose }
    }

    function installProjects(ctx) {
      ctx.effect(() => ctx.locale.register(PROJECTS_NS, { zh: projectsZh, en: projectsEn }), 'attention-projects: dictionaries')
      const t = ctx.locale.bind(PROJECTS_NS)
      const controller = createProjectsController(ctx)
      ctx.effect(() => () => controller.dispose(), 'attention-projects: controller')
      const props = { source: controller.source, actions: controller.actions, t }
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PROJECTS_PANEL_ID, locale: PROJECTS_NS, inject: () => props }, ProjectsPage))
      // The sidebar entry does not start anything: logs are read only once the page is open.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: PROJECTS_PANEL_ID, order: 14, locale: PROJECTS_NS, label: () => t('title'), inject: () => ({}),
      }, ProjectsIcon))
      return controller
    }

    function ProjectsIcon({ size = 18 }) {
      return h('svg', { viewBox: '0 0 20 20', width: size, height: size, role: 'img', 'aria-hidden': true, style: { display: 'block' } }, [
        h('path', { key: 'axis', d: 'M5.5 3v14', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('circle', { key: 'a', cx: 5.5, cy: 5.5, r: 1.7, fill: 'var(--dsw-alias-bg-base, #fff)', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('circle', { key: 'b', cx: 5.5, cy: 10.5, r: 1.7, fill: 'var(--dsw-alias-bg-base, #fff)', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { key: 'lines', d: 'M9.5 5.5h6M9.5 10.5h4.5M9.5 15h5.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    function ProjectsPage({ source, actions, t }) {
      const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
      const [tab, setTab] = useState('timeline')
      const [expanded, setExpanded] = useState({})
      useEffectSafe(() => actions.mount(), [])
      const project = state.project
      const workspace = project?.workspace ?? state.workspaces.find((w) => w.id === state.selected)
      const titles = new Map((project?.sessions ?? []).map((s) => [s.id, s.title]))
      const shell = (children) => h('div', { 'data-attention-projects': 'page', className: 'dsh-cn cn-page pj-page', onScroll: markScrolled }, [
        h('style', { key: 'css' }, CN_THEME + LAYOUT_STYLE + NOTES_STYLE + PROJECTS_STYLE),
        h(PageTopbar, { key: 'top', icon: h(ProjectsIcon, { key: 'i', size: 14 }), crumb: workspace ? `${t('title')} / ${workspace.title}` : t('title') }, [
          state.loading ? h('span', { key: 'busy', className: 'cn-working' }, h(StatusGlyph, { status: 'running' })) : null,
          h('button', { key: 'refresh', type: 'button', className: 'cn-ghost', 'data-action-id': 'projects.refresh', onClick: () => void actions.refresh() },
            [h(Icon, { key: 'i', name: 'refresh' }), t('refresh')]),
        ]),
        h('div', { key: 'col', className: 'cn-col' }, children),
      ])
      if (state.phase === 'idle' || (state.phase === 'loading' && !project)) return shell([h('p', { key: 'l', className: 'cn-faint cn-loading' }, t('loading'))])
      if (state.phase === 'error') return shell([h(Callout, { key: 'e', tone: 'red', icon: '!' }, [`${t('loadFailed')}${state.error ?? ''} `,
        h('button', { key: 'r', type: 'button', className: 'cn-link', onClick: () => void actions.refresh() }, t('retry'))])])
      if (!state.workspaces.length) return shell([h(Callout, { key: 'n', tone: 'gray', icon: 'i' }, t('noWorkspace'))])

      const stats = project?.stats ?? {}
      const picker = h(PropChip, { key: 'pick', value: state.selected ?? '', label: t('propProject'), action: 'projects.pick',
        options: state.workspaces.map((w) => [w.id, w.title]), onChange: (id) => actions.select(id) })
      const lede = [
        project?.pending ? h('span', { key: 'p', className: 'cn-num warn' }, `${t('reading')}${project.pending}${t('readingTail')}`) : null,
        h('span', { key: 'path', className: 'cn-faint', title: workspace?.path }, `${project?.pending ? ' · ' : ''}${workspace?.path ?? ''}`),
        stats.lastAt ? h('span', { key: 'last', className: 'cn-faint' }, ` · ${t('lastActive')}${ago(stats.lastAt, t)}`) : null,
      ]
      const head = h(PageHead, { key: 'head', icon: h(ProjectsIcon, { size: 18 }), title: workspace?.title ?? t('title'), lede,
        props: [
          h(Prop, { key: 'project', icon: 'list', label: t('propProject') }, picker),
          h(Prop, { key: 'sessions', icon: 'agent' }, [h('b', { key: 'n', className: 'cn-num' }, String(stats.sessions ?? 0)), t('unitSessions')]),
          h(Prop, { key: 'turns', icon: 'timeline' }, [h('b', { key: 'n', className: 'cn-num' }, String(stats.turns ?? 0)), t('unitTurns')]),
          h(Prop, { key: 'files', icon: 'check' }, [h('b', { key: 'n', className: 'cn-num' }, String(stats.files ?? 0)), t('unitFiles')]),
          h(Prop, { key: 'days', icon: 'calendar' }, [h('b', { key: 'n', className: 'cn-num' }, String(stats.activeDays ?? 0)), t('unitDays')]),
        ] })
      const views = [['timeline', 'viewTimeline', 'timeline'], ['sessions', 'viewSessions', 'list']]
      const viewBar = h('nav', { key: 'views', className: 'cn-views', role: 'tablist' }, views.map(([id, label, icon]) =>
        h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, className: `cn-view${tab === id ? ' on' : ''}`,
          'data-action-id': `projects.tab.${id}`, onClick: () => setTab(id) }, [h(Icon, { key: 'i', name: icon }), t(label)])))
      const env = { project, titles, t, actions, details: state.details, expanded,
        toggle: (id) => { const open = !expanded[id]; setExpanded({ ...expanded, [id]: open }); if (open && !state.details[id]?.session) void actions.detail(id) } }
      const empty = project && !project.sessions.length && !project.pending
      const hasRail = !!(project?.hotFiles?.length || project?.skipped?.length || project?.sessions?.some((s) => s.running))
      const main = empty ? h('p', { key: 'empty', className: 'cn-faint' }, t('empty'))
        : tab === 'timeline' ? h(ProjectTimeline, { key: 'timeline', env }) : h(ProjectSessions, { key: 'sessions', env })
      return shell([
        head, viewBar,
        state.error ? h(Callout, { key: 'err', tone: 'red', icon: '!' }, `${t('loadFailed')}${state.error}`) : null,
        h('div', { key: `body:${tab}`, className: `cn-body${hasRail ? ' has-rail' : ''}` }, [h('div', { key: 'main', className: 'cn-main' }, main), hasRail ? h(ProjectRail, { key: 'rail', env }) : null]),
        h('footer', { key: 'foot', className: 'cn-foot' }, h('p', null, t('readOnly'))),
      ])
    }

    function FileList({ files, total, t, limit = 3 }) {
      if (!files?.length) return null
      const shown = files.slice(0, limit)
      const rest = Math.max(0, (total ?? files.length) - shown.length)
      return h('span', { className: 'pj-files' }, [
        ...shown.map((file) => { const path = typeof file === 'string' ? file : file.path
          return h('code', { key: path, className: 'pj-file', title: path }, path.split('/').pop()) }),
        rest ? h('span', { key: 'more', className: 'cn-faint' }, `${t('moreFiles')}${rest}${t('moreFilesTail')}`) : null,
      ])
    }

    function TurnMeta({ entry, t }) {
      const outcome = entry.outcome ?? 'done'
      return h('div', { className: 'pj-meta' }, [
        h('span', { key: 'o', className: `pj-outcome ${outcome}` }, [h(StatusGlyph, { key: 'g', status: OUTCOME_GLYPH[outcome] ?? 'idle' }), t(`out${outcome}`)]),
        h(FileList, { key: 'f', files: entry.files, total: entry.fileCount ?? entry.files?.length, t }),
        entry.commandCount ? h('span', { key: 'c' }, `${t('ran')}${entry.commandCount}${t('commands')}`) : null,
      ])
    }

    function ProjectTimeline({ env }) {
      const { project, titles, t, actions } = env
      const today = localToday()
      const days = []
      for (const entry of project?.timeline ?? []) {
        const day = localToday(new Date(entry.at))
        if (days.at(-1)?.day !== day) days.push({ day, entries: [] })
        days.at(-1).entries.push(entry)
      }
      const hidden = (project?.timelineTotal ?? 0) - (project?.timeline?.length ?? 0)
      return h('div', { className: 'pj-timeline' }, [
        ...days.map(({ day, entries }) => h('section', { key: day, className: 'cn-day pj-day' }, [
          h('h2', { key: 'h', className: 'cn-h2' }, [dayLabel(day, today, t), h('span', { key: 'c', className: 'cn-count' }, String(entries.length))]),
          h('ol', { key: 'l', className: 'pj-entries' }, entries.map((entry, index) => {
            const same = index > 0 && entries[index - 1].sessionId === entry.sessionId
            return h('li', { key: `${entry.sessionId}:${entry.n}`, className: `pj-entry${same ? ' same' : ''}`, 'data-session-id': entry.sessionId }, [
              h('span', { key: 'time', className: 'pj-time' }, clockOf(entry.at)),
              h('div', { key: 'body', className: 'pj-body' }, [
                same ? null : h('button', { key: 's', type: 'button', className: 'pj-session', 'data-action-id': 'projects.open', title: t('open'),
                  onClick: () => actions.open(entry.sessionId) }, [titles.get(entry.sessionId) ?? entry.sessionId, h('span', { key: 'a', className: 'pj-arrow' }, '↗')]),
                entry.ask ? h('p', { key: 'ask', className: 'pj-ask' }, entry.ask) : null,
                h('div', { key: 'ans', className: `cn-reply${entry.answer ? '' : ' quiet'}` }, entry.answer
                  ? [h(Spark, { key: 's' }), h('span', { key: 't' }, entry.answer)] : t('noAnswer')),
                h(TurnMeta, { key: 'meta', entry, t }),
              ]),
            ])
          })),
        ])),
        hidden > 0 ? h('p', { key: 'older', className: 'cn-faint pj-older' }, `${t('olderTurns')}${hidden}${t('olderTail')}`) : null,
      ])
    }

    function ProjectSessions({ env }) {
      const { project, t, actions, details, expanded, toggle } = env
      return h('ol', { className: 'pj-srows' }, (project?.sessions ?? []).map((s) => {
        const open = !!expanded[s.id]
        const detail = details[s.id]
        return h('li', { key: s.id, className: `pj-srow${open ? ' open' : ''}`, 'data-session-id': s.id }, [
          h('div', { key: 'head', className: 'pj-shead' }, [
            h(Caret, { key: 'c', open, action: 'projects.expand', onClick: () => toggle(s.id) }),
            h(StatusGlyph, { key: 'g', status: s.running ? 'running' : OUTCOME_GLYPH[s.outcome] ?? 'idle' }),
            h('button', { key: 't', type: 'button', className: 'pj-stitle', onClick: () => toggle(s.id), title: s.title }, s.title ?? s.id),
            s.archived ? h(Tag, { key: 'arch' }, t('archived')) : null,
            h('span', { key: 'm', className: 'pj-smeta' }, `${s.turnCount}${t('unitTurns')} · ${s.fileCount}${t('unitFiles')} · ${ago(s.lastAt, t)}`),
            h('button', { key: 'o', type: 'button', className: 'cn-ghost pj-open', 'data-action-id': 'projects.open', onClick: () => actions.open(s.id) }, `${t('open')} ↗`),
          ]),
          !open ? h('div', { key: 'sum', className: 'pj-ssum' }, [
            s.firstAsk ? h('p', { key: 'a', className: 'pj-line' }, [h('span', { key: 'l', className: 'cn-faint' }, t('firstAsk')), s.firstAsk]) : null,
            s.lastAnswer && s.turnCount > 1 ? h('p', { key: 'b', className: 'pj-line' }, [h('span', { key: 'l', className: 'cn-faint' }, t('lastAnswer')), s.lastAnswer]) : null,
            h('div', { key: 'meta', className: 'pj-meta' }, [
              h(FileList, { key: 'f', files: s.files, total: s.fileCount, t }),
              s.commandCount ? h('span', { key: 'c' }, `${t('ran')}${s.commandCount}${t('commands')}`) : null,
              s.todos ? h('span', { key: 'td' }, `${t('todos')}${s.todos.done}/${s.todos.total}`) : null,
              s.subagents ? h('span', { key: 'sa' }, `${s.subagents}${t('subagents')}`) : null,
            ]),
          ]) : h(SessionDetail, { key: 'detail', detail, t }),
        ])
      }))
    }

    function SessionDetail({ detail, t }) {
      if (!detail || detail.loading) return h('p', { className: 'cn-faint pj-detail-note' }, t('detailLoading'))
      if (detail.error) return h('p', { className: 'cn-reply error' }, `${t('loadFailed')}${detail.error}`)
      const s = detail.session
      const commands = s.turns.flatMap((turn) => turn.commands ?? []).slice(-12)
      return h('div', { className: 'pj-detail' }, [
        h('ol', { key: 'turns', className: 'pj-turns' }, s.turns.map((turn) => h('li', { key: turn.n, className: 'pj-turn' }, [
          h('div', { key: 'h', className: 'pj-turn-head' }, `${t('turn')}${turn.n}${t('turnTail')} · ${dayLabel(localToday(new Date(turn.at)), localToday(), t)} ${clockOf(turn.at)}`),
          turn.ask ? h('p', { key: 'a', className: 'pj-ask full' }, turn.ask) : null,
          h('div', { key: 'r', className: `cn-reply${turn.answer ? '' : ' quiet'}` }, turn.answer ? [h(Spark, { key: 's' }), h('span', { key: 't' }, turn.answer)] : t('noAnswer')),
          h(TurnMeta, { key: 'm', entry: { ...turn, fileCount: turn.files.length }, t }),
        ]))),
        s.files.length ? h('section', { key: 'files', className: 'pj-block' }, [h('h3', { key: 'h' }, t('filesTitle')),
          h('ul', { key: 'l', className: 'pj-paths' }, s.files.slice(0, 30).map((file) => h('li', { key: file.path }, [
            h('code', { key: 'p', title: file.path }, file.path), h('span', { key: 'n', className: 'cn-faint' }, `×${file.count}`)])))]) : null,
        commands.length ? h('section', { key: 'cmds', className: 'pj-block' }, [h('h3', { key: 'h' }, t('commandsTitle')),
          h('ul', { key: 'l', className: 'pj-cmds' }, commands.map((command, i) => h('li', { key: i }, h('code', { title: command }, command))))]) : null,
        s.todos?.length ? h('section', { key: 'todos', className: 'pj-block' }, [h('h3', { key: 'h' }, t('todosTitle')),
          h('ul', { key: 'l', className: 'pj-todos' }, s.todos.map((todo, i) => h('li', { key: i, className: todo.status }, [
            h(StatusGlyph, { key: 'g', status: todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'running' : 'todo' }), todo.content])))]) : null,
      ])
    }

    function ProjectRail({ env }) {
      const { project, t, actions } = env
      const running = (project?.sessions ?? []).filter((s) => s.running)
      const skipped = project?.skipped?.length ?? 0
      return h('aside', { className: 'cn-rail' }, [
        running.length ? h(Panel, { key: 'running', title: `${t('railRunning')} · ${running.length}` }, h('ul', { className: 'cn-mini' }, running.map((s) =>
          h('li', { key: s.id, className: 'pj-click', onClick: () => actions.open(s.id) }, [h(StatusGlyph, { key: 'g', status: 'running' }),
            h('span', { key: 't', className: 'cn-mini-text', title: s.title }, s.title)])))) : null,
        project?.hotFiles?.length ? h(Panel, { key: 'files', title: t('railFiles') }, h('ul', { className: 'cn-mini' }, project.hotFiles.map((file) => {
          const parts = file.path.split('/'), name = parts.pop()
          return h('li', { key: file.path, title: file.path }, [
            h('span', { key: 't', className: 'cn-mini-text pj-hot' }, [h('b', { key: 'n' }, name), parts.length ? h('span', { key: 'd', className: 'cn-faint' }, ` ${parts.join('/')}`) : null]),
            h('span', { key: 'c', className: 'cn-mini-meta' }, `×${file.count}`)])
        }))) : null,
        skipped ? h('p', { key: 'skipped', className: 'cn-faint pj-skipped' }, `${skipped} ${t('skipped')}`) : null,
      ])
    }

    const PROJECTS_STYLE = `
.pj-entries,.pj-srows{list-style:none;margin:0 -10px;padding:0}
.pj-entry{position:relative;display:grid;grid-template-columns:40px minmax(0,1fr);gap:8px;padding:8px 10px;border-radius:var(--cn-r-sm);transition:background var(--cn-fast) var(--cn-ease);animation:cn-in var(--cn-mid) var(--cn-ease) both}
.pj-entry:hover{background:var(--cn-hover)}
.pj-entry.same{padding-top:2px}
.pj-time{padding-top:2px;font-size:var(--cn-fs-3);color:var(--cn-faint);font-variant-numeric:tabular-nums}
.pj-entry.same .pj-time{padding-top:0}
.pj-body{min-width:0}
.pj-session{display:inline-flex;align-items:center;gap:4px;max-width:100%;margin:0 0 2px;padding:0;border:0;background:none;font-size:var(--cn-fs-3);font-weight:500;color:var(--cn-muted);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color var(--cn-fast) var(--cn-ease)}
.pj-session:hover{color:var(--cn-ink)}
.pj-arrow{opacity:0;transition:opacity var(--cn-fast) var(--cn-ease)}.pj-session:hover .pj-arrow{opacity:1}
.pj-ask{margin:0;color:var(--cn-ink);line-height:1.55;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pj-ask.full{display:block;-webkit-line-clamp:none}
.pj-body .cn-reply,.pj-turn .cn-reply,.pj-detail-note{margin:4px 0 0}
.pj-body .cn-reply span,.pj-turn .cn-reply span{overflow-wrap:anywhere}
.pj-body .cn-reply.quiet,.pj-turn .cn-reply.quiet{padding-left:0}
.pj-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:6px;font-size:var(--cn-fs-3);color:var(--cn-faint)}
.pj-outcome{display:inline-flex;align-items:center;gap:4px}
.pj-outcome .cn-glyph{width:13px;height:13px}
.pj-files{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0}
.pj-file{max-width:200px;padding:1px 6px;border-radius:var(--cn-r-xs);background:var(--cn-gray-bg);font:500 11.5px/1.6 var(--cn-code);color:var(--cn-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pj-older{margin:0 0 8px;font-size:var(--cn-fs-3)}
.pj-srow{position:relative;padding:10px;border-radius:var(--cn-r-sm);transition:background var(--cn-fast) var(--cn-ease);animation:cn-in var(--cn-mid) var(--cn-ease) both}
.pj-srow+.pj-srow::before{content:'';position:absolute;left:10px;right:10px;top:0;height:1px;background:var(--cn-line-soft);transition:opacity var(--cn-fast) var(--cn-ease)}
.pj-srow:hover,.pj-srow.open{background:var(--cn-hover)}
.pj-srow:hover::before,.pj-srow:hover+.pj-srow::before,.pj-srow.open::before,.pj-srow.open+.pj-srow::before{opacity:0}
.pj-shead{display:flex;align-items:center;gap:6px;min-width:0}
.pj-stitle{flex:1;min-width:0;padding:0;border:0;background:none;text-align:left;font-weight:500;color:var(--cn-ink);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pj-smeta{flex:none;font-size:var(--cn-fs-3);color:var(--cn-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
.pj-open{opacity:0;transition:opacity var(--cn-mid) var(--cn-ease),background var(--cn-fast) var(--cn-ease)}
.pj-srow:hover .pj-open,.pj-srow:focus-within .pj-open{opacity:1}
.pj-ssum,.pj-detail{margin:4px 0 0 46px;min-width:0}
.pj-line{margin:2px 0 0;font-size:var(--cn-fs-2);color:var(--cn-text);line-height:1.55;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pj-turns{list-style:none;margin:6px 0 0;padding:0 0 0 12px;border-left:1px solid var(--cn-line)}
.pj-turn{padding:6px 0 8px}
.pj-turn-head{font-size:var(--cn-fs-3);color:var(--cn-faint);font-variant-numeric:tabular-nums}
.pj-block{margin:12px 0 0}
.pj-block h3{margin:0 0 4px;font-size:var(--cn-fs-3);font-weight:500;color:var(--cn-faint)}
.pj-paths,.pj-cmds,.pj-todos{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.pj-paths li{display:flex;gap:8px;align-items:baseline;min-width:0}
.pj-paths code,.pj-cmds code{min-width:0;font:12px/1.6 var(--cn-code);color:var(--cn-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pj-cmds code{display:block}
.pj-todos li{display:flex;align-items:flex-start;gap:6px;font-size:var(--cn-fs-2);color:var(--cn-text)}
.pj-todos li.completed{color:var(--cn-faint);text-decoration:line-through;text-decoration-color:var(--cn-line)}
.pj-todos .cn-glyph{width:13px;height:13px;margin-top:3px}
.pj-click{cursor:pointer}
.pj-hot b{font-weight:500;color:var(--cn-text)}
.pj-skipped{margin:0;padding:0 4px;font-size:var(--cn-fs-3)}
@container (max-width:560px){
  .pj-entry{grid-template-columns:minmax(0,1fr);gap:0}
  .pj-time{padding:0}
  .pj-ssum,.pj-detail{margin-left:24px}
  .pj-smeta{display:none}
}
@media (hover:none){.pj-open{opacity:1}}
`

    /* ---------------------------------------------------------- components */

    /** Sidebar glyph with a quiet dot while hard blockers wait. */
    function InboxIcon({ size = 18, useView }) {
      const badge = useView((view) => view.badge)
      return h('svg', {
        viewBox: '0 0 20 20',
        width: size,
        height: size,
        role: 'img',
        'aria-hidden': true,
        style: { display: 'block', overflow: 'visible' },
      }, [
        h('path', {
          key: 'bell',
          d: 'M10 2.6a4.6 4.6 0 0 0-4.6 4.6v2.2L4.2 12h11.6l-1.2-2.6V7.2A4.6 4.6 0 0 0 10 2.6Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'clapper',
          d: 'M8.2 14.2a1.9 1.9 0 0 0 3.6 0',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
        badge > 0
          ? h('circle', { key: 'dot', cx: 16.4, cy: 3.6, r: 3.2, fill: 'var(--dsw-alias-state-error-primary)' })
          : null,
      ])
    }

    function labelFor(snapshot, t) {
      return snapshot.badge > 0 ? `${t('panel')} · ${snapshot.badge}` : t('panel')
    }

    /* ---------------------------------------------------------- page */

    const useEffectSafe = React.useEffect ?? (() => {})
    const useRefSafe = React.useRef ?? ((value) => useState({ current: value })[0])

    function span(ms, t) {
      const s = Math.max(0, Math.floor(ms / 1000))
      if (s < 60) return `${s}${t('unitSecond')}`
      const m = Math.floor(s / 60)
      if (m < 60) return `${m}${t('waitedMinute')}`
      const hrs = Math.floor(m / 60)
      if (hrs < 24) return `${hrs}${t('waitedHour')}`
      return `${Math.floor(hrs / 24)}${t('waitedDay')}`
    }

    function clock(ms) {
      const s = Math.max(0, Math.floor(ms / 1000))
      if (s < 3600) return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
      const hrs = Math.floor(s / 3600)
      if (hrs < 48) return `${hrs}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
      return `${Math.floor(hrs / 24)}d`
    }

    function baseName(path) {
      if (typeof path !== 'string') return ''
      const parts = path.split(/[\\/]/).filter(Boolean)
      return parts[parts.length - 1] ?? ''
    }

    function isTyping(target) {
      const tag = target?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true
    }

    /** The page: who is waiting on you, what is still moving, and how much this saved you. */
    function InboxPage(props) {
      const { useView, run, dispose, mute, t, sessions, statuses, localeText, engageQuestion, retryTracking, renderSlot, openSubject } = props
      const view = useView((current) => current)
      const list = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot)
      const status = useSyncExternalStore(statuses?.subscribe ?? (() => () => {}), statuses?.getSnapshot ?? (() => undefined))
      const notesState = useSyncExternalStore(props.notes?.subscribe ?? noSubscribe, props.notes?.getSnapshot ?? noSnapshot)
      const [expanded, setExpanded] = useState({})
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [selected, setSelected] = useState(null)
      const [visit, setVisit] = useState({ handled: 0, last: '', at: 0 })
      const [, setTick] = useState(0)
      const memory = useRefSafe({ acted: new Set(), titles: new Map() })
      const keys = useRefSafe(null)
      const now = Date.now()

      useEffectSafe(() => {
        const id = setInterval(() => setTick((value) => value + 1), 1000)
        return () => clearInterval(id)
      }, [])

      // A row the person acted on that then leaves the projection is a thing handled in place.
      const present = new Set(view.items.map((item) => item.key))
      useEffectSafe(() => {
        const m = memory.current
        for (const item of view.items) if (view.pending?.[item.key]) { m.acted.add(item.key); m.titles.set(item.key, (item.kind === 'approval' ? /^[A-Za-z0-9_.:-]{1,64}: ([\s\S]+)$/.exec(item.title ?? '')?.[1] : undefined) ?? presentItem(item, t).title) }
        const gone = [...m.acted].filter((key) => !present.has(key))
        if (gone.length === 0) return
        for (const key of gone) m.acted.delete(key)
        setVisit((current) => ({ handled: current.handled + gone.length, last: m.titles.get(gone[gone.length - 1]) ?? '', at: Date.now() }))
      })

      const ordered = view.groups.flatMap((group) => group.items)
      const focus = ordered.find((item) => item.key === selected) ?? ordered[0]
      const rows = new Map(view.items.map((item) => [item.key, {
        item,
        where: whereOf(item, list, view.subjects),
        hasOpen: Boolean(view.subjects?.[item.key]?.open ?? item.subjectDescription?.open),
      }]))

      keys.current = (event) => {
        if (settingsOpen || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
        if (!document.querySelector?.('[data-attention-inbox="page"]') || document.querySelector?.('[role="dialog"]')) return
        const index = focus ? ordered.indexOf(focus) : -1
        const move = (delta) => {
          const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))]
          if (!next) return
          event.preventDefault(); setSelected(next.key)
          document.querySelector(`[data-attention-key="${(globalThis.CSS?.escape?.(next.key) ?? next.key)}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
        }
        if (event.key === 'j' || event.key === 'ArrowDown') return move(1)
        if (event.key === 'k' || event.key === 'ArrowUp') return move(-1)
        if (!focus || view.pending?.[focus.key]) return
        const has = (id) => (focus.actions ?? []).includes(id)
        const tone = meta(focus, view.kinds).blocking
        // Same semantics as the native approval panel; plans and questions always need an explicit click.
        if (event.key === 'Enter' && event.target?.tagName !== 'BUTTON' && focus.kind === 'approval' && has('approval.allow-once')) { event.preventDefault(); void run(focus, 'approval.allow-once') }
        else if (event.key === 'Escape' && focus.kind === 'approval' && has('approval.reject')) { event.preventDefault(); void run(focus, 'approval.reject') }
        else if (event.key === 'o' && (focus.subject?.type === 'session' || rows.get(focus.key)?.hasOpen)) { event.preventDefault(); void run(focus, 'subject.open') }
        else if (event.key === 's' && tone === 'soft') { event.preventDefault(); void dispose(focus, 'snoozed') }
        else if (event.key === 'x' && tone === 'soft') { event.preventDefault(); void dispose(focus, 'dismissed') }
      }
      useEffectSafe(() => {
        const listener = (event) => keys.current?.(event)
        document.addEventListener?.('keydown', listener)
        return () => document.removeEventListener?.('keydown', listener)
      }, [])

      const shell = (children, topbar) => h('div', { 'data-attention-inbox': 'page', className: 'dsh-cn cn-page ai-page', onScroll: markScrolled }, [
        h('style', { key: 'css' }, STYLE + CN_THEME + LAYOUT_STYLE + INBOX_CN_STYLE),
        topbar ?? null,
        h('div', { key: 'col', className: 'cn-col' }, children),
      ])
      const crumbIcon = h(InboxIcon, { key: 'i', size: 14, useView })

      if (view.phase === 'loading') return shell([
        h('section', { key: 'calm', className: 'ai-calm' }, [h(Orb, { key: 'orb' }), h('div', { key: 't', className: 'ai-calm-text' }, h('span', null, t('loading')))]),
      ])

      if (settingsOpen) return shell([
        h(PageHead, { key: 'head', icon: h(InboxIcon, { size: 18, useView }), title: t('settings') }),
        h(InboxSettings, { ...props, key: 'settings' }),
      ], h(PageTopbar, { key: 'top', icon: crumbIcon, crumb: `${t('title')} / ${t('settings')}` },
        h('button', { key: 'back', 'data-action-id': 'settings.back', type: 'button', className: 'cn-ghost', onClick: () => setSettingsOpen(false) }, [h(Icon, { key: 'i', name: 'back' }), t('back')])))

      const tones = { system: 0, hard: 0, soft: 0 }
      let oldest = Infinity
      for (const item of view.items) {
        const tone = meta(item, view.kinds).blocking
        tones[tone] = (tones[tone] ?? 0) + 1
        const opened = Date.parse(item.openedAt)
        if (tone !== 'soft' && Number.isFinite(opened)) oldest = Math.min(oldest, opened)
      }
      const people = Object.entries(list?.byId ?? {}).map(([id, row]) => ({ id, title: row?.title ?? id.slice(0, 8), place: baseName(row?.cwd), running: row?.running === true, activity: view.activity?.[id], activityResolved: (view.activityReady ?? []).includes(id) }))
      const waitingOn = new Set(view.items.filter((item) => item.subject?.type === 'session').map((item) => item.subject.ref))
      const running = people.filter((row) => row.running && !waitingOn.has(row.id))
      const finished = people.filter((row) => status?.get?.(row.id)?.completionUnread && !waitingOn.has(row.id))
      const gap = view.coverage?.gap ?? 0
      const linkedNotes = new Map((notesState?.notes ?? []).filter((note) => note.sessionId && note.state === 'open').map((note) => [note.sessionId, note]))

      const topbar = h(PageTopbar, { key: 'top', icon: crumbIcon, crumb: t('title') },
        h('button', { key: 'settings', 'data-action-id': 'settings.open', type: 'button', className: 'cn-ghost', onClick: () => setSettingsOpen(true) }, [h(Icon, { key: 'i', name: 'gear' }), t('settings')]))

      const notices = [
        view.nativeTrackingFailed ? h('p', { key: 'tracking', className: 'ai-notice' }, [t('nativeTrackingFailed'), ' ',
          h('button', { key: 'retry', 'data-action-id': 'metrics.retry', type: 'button', className: 'ai-link', onClick: () => void retryTracking() }, t('retryTracking'))]) : null,
        view.hostAvailable === false ? h('p', { key: 'degraded', className: 'ai-notice' }, t('hostUnavailable'))
          : view.health?.backfill === 'partial' ? h('p', { key: 'history-partial', className: 'ai-notice' }, t('historyPartial')) : null,
      ]

      const plural = (n, key) => t(n === 1 ? `${key}One` : key)
      const headline = tones.system ? [tones.system, 'system', plural(tones.system, 'heroSystem')]
        : tones.hard ? [tones.hard, 'hard', plural(tones.hard, 'heroHard')]
          : tones.soft ? [tones.soft, 'soft', plural(tones.soft, 'heroSoft')] : null
      const subline = headline
        ? headline[1] === 'soft' ? t('subSoft') : `${now - oldest < 60000 ? t('subJustNow') : `${t('subOldest')} ${span(now - oldest, t)}`} · ${t('subInPlace')}`
        : visit.handled ? `${t('clearedPrefix')}${visit.handled}${t('clearedSuffix')}`
          : `${t('calmPrefix')}${people.length}${t('calmSuffix')}`
      const median = view.metrics?.hardResponseMedianMs
      const head = h(PageHead, { key: 'head', icon: h(InboxIcon, { size: 18, useView }), title: t('title'),
        lede: [headline
          ? [h('b', { key: 'n', className: `cn-num${headline[1] === 'system' ? ' error' : headline[1] === 'hard' ? ' warn' : ''}` }, String(headline[0])), headline[2]]
          : h('b', { key: 'calm', className: 'cn-num' }, t(visit.handled ? 'heroCleared' : 'heroCalm')),
          h('span', { key: 'sub', className: 'cn-faint' }, ` · ${subline}`)],
        props: [
          h(Prop, { key: 'coverage', icon: gap ? 'shield' : 'eye', className: `cn-prop${gap ? ' warn' : ''}`, 'data-coverage-gap': gap, title: t('coverageTip') },
            gap ? `${gap} ${t('coverageGapLabel')}` : `${t('watching')}${people.length ? ` ${people.length} ${t('sessionsUnit')}` : ''}`),
          h(Prop, { key: 'here', icon: 'check', label: t('statInPlaceToday') }, String(view.metrics?.inboxActedToday ?? 0)),
          h(Prop, { key: 'filtered', icon: 'shield', label: t('dropped') }, String(view.funnel?.droppedToday ?? 0)),
          h(Prop, { key: 'median', icon: 'bolt', label: t('statMedian') }, Number.isFinite(median) && median >= 0 ? span(median, t) : '—'),
        ] })

      const toast = visit.handled && now - visit.at < 3200
        ? h('div', { key: 'toast', className: 'ai-toast', role: 'status' }, [h(Check, { key: 'c', small: true }), `${t('resolvedToast')}${visit.last ? ` · ${visit.last}` : ''}`])
        : null

      const agents = (rowsOf, tone) => h('ul', { key: `agents:${tone}`, className: 'ai-agents' }, [
        ...rowsOf.slice(0, 5).map((row) => h('li', { key: row.id }, h('button', { type: 'button', className: 'ai-agent', 'data-action-id': 'radar.open',
          onClick: () => { try { openSubject?.({ key: `radar:${row.id}`, kind: 'radar', subject: { type: 'session', ref: row.id } }) } catch {} } }, [
          h('i', { key: 'dot', className: `ai-dot${tone === 'running' ? ' live' : ''}` }),
          h('span', { key: 'body', className: 'ai-agent-body' }, [
            h('span', { key: 'title', className: 'ai-agent-title' }, row.activity ? row.activity : row.activityResolved ? row.title : t('agentReading')),
            h('em', { key: 'state', className: 'ai-agent-state' }, [tone === 'running' ? t('agentStateRunning') : t('agentStateDone'), row.place ? ` · ${row.place}` : '', row.activity && row.activity !== row.title ? ` · ${row.title}` : '']),
          ]),
        ]))),
        rowsOf.length > 5 ? h('li', { key: 'more', className: 'ai-agent-more' }, t('agentsMorePrefix') + (rowsOf.length - 5) + t('agentsMoreSuffix')) : null,
      ])

      const perks = (view.metrics?.hardActed ?? 0) >= 3 ? null : h('ul', { key: 'perks', className: 'ai-perks' }, [
        h('li', { key: 'here' }, [h('b', { key: 'i' }, '01'), t('perkHere')]),
        h('li', { key: 'order' }, [h('b', { key: 'i' }, '02'), t('perkOrder')]),
        h('li', { key: 'keys' }, [h('b', { key: 'i' }, '03'), t('perkKeys')]),
      ])
      const main = view.total === 0
        ? h('section', { key: 'calm', className: 'ai-calm-wrap' }, [
          h('div', { key: 'calm', className: 'ai-calm' }, [visit.handled ? h(Check, { key: 'check' }) : h(Orb, { key: 'orb' }),
            h('div', { key: 't', className: 'ai-calm-text' }, [h('b', { key: 'b' }, t('radarTitle')),
              h('span', { key: 's' }, running.length || finished.length ? t('radarRunningHint') : t('radarIdleHint'))])]),
          perks,
        ])
        : h('div', { key: 'groups' }, view.groups.map((group) => h('section', { key: group.id, className: 'ai-group' }, [
            h('h2', { key: 'label' }, [groupLabel(group.id, t), h('span', { key: 'count', className: 'ai-count' }, String(group.items.length))]),
            h('ul', { key: 'list', className: 'ai-list' }, group.items.map((item) => renderRow(rows.get(item.key), {
              t, now,
              kinds: view.kinds, actions: view.actions, clientActions: view.clientActions, localeText, engageQuestion,
              renderSubject: (item, fallback) => typeof renderSlot === 'function'
                ? renderSlot('attention.subject', { subject: item.subject, obligation: item,
                  description: view.subjects?.[item.key] ?? item.subjectDescription }, { entryKey: item.subject?.type, fallback })
                : fallback,
              expanded: expanded[item.key] === true,
              toggle: () => setExpanded((current) => ({ ...current, [item.key]: current[item.key] !== true })),
              select: () => setSelected(item.key),
              selected: focus?.key === item.key,
              run, dispose, mute, workspace: workspaceOf(item, list, view.subjects),
              pending: view.pending[item.key] === true,
              note: item.subject?.type === 'session' ? linkedNotes.get(item.subject.ref) : undefined,
              failed: view.failed?.[item.key] === true,
            }))),
          ])))
      const rail = h('aside', { key: 'rail', className: 'cn-rail' }, [
        props.notes ? h(TodayPlan, { key: 'plan', source: props.notes, t, open: props.openNotes }) : null,
        running.length ? h(Panel, { key: 'running', title: `${t('radarRunning')} · ${running.length}` }, agents(running, 'running')) : null,
        finished.length ? h(Panel, { key: 'done', title: `${t('radarDone')} · ${finished.length}` }, agents(finished, 'done')) : null,
      ])
      const body = h('div', { key: 'body', className: 'cn-body has-rail' }, [h('div', { key: 'main', className: 'cn-main' }, [toast, main]), rail])

      return shell([
        head, ...notices, body,
        h('footer', { key: 'foot', className: 'cn-foot ai-foot' }, [
          h('details', { key: 'how', className: 'ai-how' }, [
            h('summary', { key: 'summary' }, t('howCounted')),
            h('span', { key: 'funnel' }, funnelLine(view.funnel, view.total, t)),
            h('span', { key: 'metrics' }, metricsLine(view.metrics, t)),
          ]),
          view.total ? h('span', { key: 'keys', className: 'ai-keys' }, [
            h('span', { key: 'nav' }, [h('kbd', { key: 'j', className: 'ai-kbd' }, 'J'), h('kbd', { key: 'k', className: 'ai-kbd' }, 'K'), t('kbdNav')]),
            h('span', { key: 'allow' }, [h('kbd', { key: 'e', className: 'ai-kbd' }, '↵'), t('allowOnce')]),
            h('span', { key: 'reject' }, [h('kbd', { key: 'x', className: 'ai-kbd' }, 'Esc'), t('reject')]),
            h('span', { key: 'open' }, [h('kbd', { key: 'o', className: 'ai-kbd' }, 'O'), t('open')]),
          ]) : null,
        ]),
      ], topbar)
    }

    function Orb() {
      return h('div', { className: 'ai-orb', 'aria-hidden': true }, [
        h('span', { key: 'sweep', className: 'ai-sweep' }), h('i', { key: 'a' }), h('i', { key: 'b' }), h('i', { key: 'c' }), h('b', { key: 'core' }),
      ])
    }

    function Check({ small = false }) {
      return h('svg', { className: small ? 'ai-check small' : 'ai-check', viewBox: '0 0 56 56', 'aria-hidden': true }, [
        h('circle', { key: 'c', cx: 28, cy: 28, r: 26 }),
        h('path', { key: 'p', d: 'M17 29.5l7.5 7.5L39.5 21' }),
      ])
    }

    function InboxSettings({ useView, updateSettings, unmute, t }) {
      const view = useView((current) => current)
      const [draftDays, setDraftDays] = useState(null)
      const days = draftDays ?? String(view.settings.ledgerRetentionDays)
      const valid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 3650
      const disabled = view.settingsPending || view.hostAvailable === false
      return h('section', { 'data-attention-inbox': 'settings', className: 'ai-settings', style: { padding: '8px 0 20px', color: 'var(--dsw-alias-label-primary)' } }, [
        h('style', { key: 'css' }, STYLE),
        h('h2', { key: 'title', className: 'ai-settings-title' }, t('settings')),
        h('label', { key: 'review', className: 'ai-setting' }, [
          h('input', { key: 'input', 'data-setting-key': 'reviewEnabled', type: 'checkbox', checked: view.settings.reviewEnabled === true, disabled,
            onChange: (event) => void updateSettings({ reviewEnabled: event.target.checked }) }), h('span', { key: 'label' }, t('reviewEnabled')),
        ]),
        h('form', { key: 'retention', className: 'ai-setting', onSubmit: (event) => { event.preventDefault()
          if (valid && !disabled) void updateSettings({ ledgerRetentionDays: Number(days) }) } }, [
          h('label', { key: 'label' }, [t('ledgerRetentionDays'), h('input', { key: 'input', 'data-setting-key': 'ledgerRetentionDays', type: 'number', min: 1, max: 3650,
            value: days, disabled, className: 'ai-input', onChange: (event) => setDraftDays(event.target.value), style: { margin: '0 12px', width: 90 } })]),
          h('button', { key: 'save', 'data-action-id': 'settings.save', type: 'submit', disabled: disabled || !valid, className: 'ai-btn' }, t('save')),
        ]),
        view.settingsError ? h('p', { key: 'error', role: 'alert', className: 'ai-alert' }, t('settingsFailed')) : null,
        ...(view.metrics.noiseBySource ?? []).filter((source) => source.suggestRuleChange).map((source) =>
          h('p', { key: `noise:${source.source}:${source.kind}`, className: 'ai-notice' },
            `${t('noisySource')}: ${source.source} / ${source.kind} (${source.dismissed}/${source.closed})`)),
        h('h3', { key: 'mute-title', className: 'ai-settings-sub' }, t('muteRules')),
        view.muteRules.length ? h('ul', { key: 'rules', className: 'ai-rules' }, view.muteRules.map((rule) => h('li', { key: `${rule.scope}:${rule.ref}` }, [
          `${t(rule.scope === 'workspace' ? 'muteWorkspace' : 'muteSession')}: ${rule.ref} `,
          h('button', { key: 'remove', 'data-action-id': 'mute.unmute', 'data-mute-scope': rule.scope, 'data-mute-ref': rule.ref, type: 'button', disabled, className: 'ai-btn ghost', onClick: () => void unmute(rule) }, t('unmute')),
        ]))) : h('p', { key: 'none', className: 'ai-sub' }, t('noMuteRules')),
        h('details', { key: 'diagnostics', className: 'ai-settings-sub' }, [
          h('summary', { key: 'summary' }, `${t('coverage')}: ${view.coverage.gap}`),
          h('pre', { key: 'value', className: 'ai-plan' }, JSON.stringify(view.coverage, null, 2)),
        ]),
      ])
    }

    function renderRow(row, state) {
      if (row === undefined) return null
      const { item } = row
      const { t, pending, failed } = state
      const all = actionsFor(item, t, state.actions, state.localeText, row.hasOpen, state.clientActions)
      const openAction = all.find((action) => action.id === 'subject.open')
      const actions = all.filter((action) => action !== openAction)
      const tone = meta(item, state.kinds).blocking
      const waited = Math.max(0, state.now - Date.parse(item.openedAt))
      const urgency = !Number.isFinite(waited) || tone === 'soft' ? '' : waited > 1800000 ? ' error' : waited > 300000 ? ' warn' : ''
      const tool = item.kind === 'approval' ? /^([A-Za-z0-9_.:-]{1,64}): ([\s\S]+)$/.exec(item.title ?? '') : null
      const hasForm = Boolean(item.questions?.length)
      const label = state.localeText(state.kinds?.[item.kind]?.label) || (KINDS[item.kind] ? t(kindLabel(item.kind)) : item.kind)
      const shown = presentItem(item, t)
      return h('li', {
        key: item.key,
        'data-attention-key': item.key,
        'data-tone': tone,
        'data-selected': state.selected ? 'true' : 'false',
        'data-pending': pending ? 'true' : 'false',
        className: 'ai-card',
        onMouseDown: state.select,
      }, [
        h('div', { key: 'top', className: 'ai-row' }, [
          h('span', { key: 'kind', className: 'ai-chip' }, label),
          h('div', { key: 'where', className: 'ai-where' }, state.renderSubject(item, h('span', null, row.where))),
          item.certainty === 'inferred' ? h('span', { key: 'inferred', className: 'ai-where', style: { flex: 'none' }, title: t('inferred') }, '~') : null,
          Number.isFinite(waited) ? h('span', { key: 'waited', className: `ai-timer${urgency}`, title: waitedLine(item.openedAt, t) }, [
            tone === 'soft' ? null : h('i', { key: 'dot', className: 'ai-ring' }), clock(waited)]) : null,
          openAction ? h('button', { key: 'open', 'data-action-id': 'subject.open', type: 'button', disabled: pending, className: 'ai-btn ghost small ai-open', onClick: () => void state.run(item, 'subject.open') }, openAction.label) : null,
        ]),
        state.note ? h('div', { key: 'note', className: 'ai-from-note', title: state.note.text }, [h('span', { key: 'l' }, state.t('fromNote')), state.note.text]) : null,
        h('div', { key: 'title', className: 'ai-title' }, tool
          ? [h('code', { key: 'tool', className: 'ai-tool' }, tool[1]), tool[2]]
          : shown.title),
        shown.note ? h('div', { key: 'note-line', className: 'ai-sub' }, shown.note) : null,
        shown.raw ? h('details', { key: 'raw', className: 'ai-raw' }, [h('summary', { key: 's' }, t('rawError')), h('code', { key: 'c' }, shown.raw)]) : null,
        item.deadline || item.defaultAction?.actionId ? h('div', { key: 'meta', className: 'ai-meta' }, [
          item.deadline ? h('span', { key: 'deadline' }, `${t('deadline')} ${new Date(item.deadline).toLocaleTimeString()}`) : null,
          item.defaultAction?.actionId ? h('span', { key: 'default-action', 'data-default-action-id': item.defaultAction.actionId },
            `${t('defaultAction')}: ${state.localeText(state.actions?.[item.defaultAction.actionId]?.label) || item.defaultAction.actionId}`) : null,
        ]) : null,
        shown.detail && !hasForm ? h('pre', { key: 'detail', className: `ai-plan${state.expanded ? '' : ' collapsed'}` }, shown.detail) : null,
        shown.detail && !hasForm ? h('button', { key: 'detail-toggle', 'data-action-id': 'detail.toggle', type: 'button', className: 'ai-link', onClick: state.toggle },
          state.expanded ? t('collapse') : t('showMore')) : null,
        hasForm ? h(QuestionForm, { key: `question:${item.key}:${item.revision}`, item, run: state.run, pending, t, engage: state.engageQuestion,
          expanded: state.expanded, toggle: state.toggle }) : null,
        failed ? h('div', { key: 'failed', className: 'ai-alert', role: 'alert' }, t('failedAction')) : null,
        actions.length || tone === 'soft' ? h('div', { key: 'actions', className: 'ai-actions' }, [
          ...actions.map((action) => h('button', {
            key: action.id,
            'data-action-id': action.id,
            type: 'button',
            disabled: pending,
            onClick: () => void state.run(item, action.id),
            className: `ai-btn${action.primary ? ' primary' : ''}`,
          }, pending ? t('working') : action.label)),
          tone === 'soft' ? h('button', {
            key: 'snooze', 'data-action-id': 'dispose.snoozed', type: 'button', disabled: pending,
            onClick: () => void state.dispose(item, 'snoozed'), className: 'ai-btn ghost',
          }, t('snooze')) : null,
          tone === 'soft' ? h('button', {
            key: 'dismiss', 'data-action-id': 'dispose.dismissed', type: 'button', disabled: pending,
            onClick: () => void state.dispose(item, 'dismissed'), className: 'ai-btn ghost',
          }, t('dismiss')) : null,
          tone === 'soft' && (item.subject?.type === 'session' || state.workspace) ? h('details', { key: 'mute', className: 'ai-mute' }, [
            h('summary', { key: 'summary', className: 'ai-btn ghost' }, t('mute')),
            item.subject?.type === 'session' ? h('button', { key: 'session', 'data-action-id': 'mute.session', type: 'button', disabled: pending, className: 'ai-btn ghost',
              onClick: () => void state.mute(item, 'session') }, t('muteSession')) : null,
            state.workspace ? h('button', { key: 'workspace', 'data-action-id': 'mute.workspace', type: 'button', disabled: pending, className: 'ai-btn ghost',
              onClick: () => void state.mute(item, 'workspace') }, t('muteWorkspace')) : null,
          ]) : null,
          state.selected && item.kind === 'approval' && !pending ? h('span', { key: 'hint', className: 'ai-hint' }, [
            h('span', { key: 'a' }, [h('kbd', { key: 'k', className: 'ai-kbd' }, '↵'), t('allowOnce')]),
            h('span', { key: 'r' }, [h('kbd', { key: 'k', className: 'ai-kbd' }, 'Esc'), t('reject')]),
          ]) : null,
        ]) : null,
      ])
    }

    /**
     * Raw failure text from a model provider, explained in the person's language with what to do next.
     * The original stays available under "Original message".
     */
    const FAILURE_RULES = [
      [/^max-tokens$/i, 'errCut'], [/^interrupted$/i, 'errInterrupted'], [/^blocked$/i, 'errBlocked'],
      [/no api key|api[_ ]?key\b.*\b(missing|not (set|configured|found))|missing (api key|credential)/i, 'errNoKey'],
      [/\b401\b|unauthori[sz]ed|invalid[^.]{0,20}(api key|token)|authentication (failed|error)/i, 'errAuth'],
      [/\b402\b|insufficient[_ ](balance|quota|funds)|quota exceeded|billing|余额/i, 'errQuota'],
      [/\b429\b|rate[_ -]?limit|too many requests/i, 'errRate'],
      [/context[_ ](length|window)|maximum context|too many tokens|prompt is too long|context_length_exceeded/i, 'errContext'],
      [/timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed|socket hang up/i, 'errNetwork'],
      [/\b50[0-4]\b|overloaded|internal server error|service unavailable|bad gateway/i, 'errServer'],
    ]
    function explainFailure(message, t) {
      const raw = String(message ?? '').trim()
      const hit = FAILURE_RULES.find(([pattern]) => pattern.test(raw))
      return { text: t(hit ? hit[1] : 'errUnknown'), known: Boolean(hit), raw: raw && !/^(max-tokens|interrupted|blocked)$/i.test(raw) ? raw : undefined }
    }
    /** What a card says: Host titles are facts in whatever language produced them; placeholders become the person's language. */
    function presentItem(item, t) {
      if (item.kind === 'turn-failed') { const e = explainFailure(item.title, t); return { title: e.text, raw: e.raw, detail: item.detail } }
      if (item.kind === 'review' && item.reviewOrigin === 'goal-complete') return { title: item.title || t('goalDone'), note: t('goalDone') }
      if (item.kind === 'review' && (!item.title || /Autonomous turn ready for review/.test(item.title))) return { title: t('reviewFallback'), detail: item.detail }
      if (item.kind === 'plan-review' && (!item.title || item.title === 'Plan review')) return { title: t('planFallback'), detail: item.detail }
      if (item.kind === 'goal-blocked' && item.detail) {
        const e = explainFailure(item.detail, t)
        return e.known ? { title: item.title, note: e.text, raw: e.raw } : { title: item.title, detail: item.detail }
      }
      return { title: item.title || t('kindQuestion'), detail: item.detail }
    }
    // Labels the Host writes for its own plan-review question; answers still send the original label.
    const planLabel = (label, t) => label === 'Approve' ? t('planApprove') : label === 'Keep planning' ? t('keepPlanning') : label

    function actionsFor(item, t, registry = {}, localize = String, hasOpen = false, clientActions = []) {
      const actions = []
      for (const id of item.actions ?? []) {
        if (id === 'approval.allow-once') actions.push({ id, label: t('allowOnce'), primary: true })
        else if (id === 'approval.reject') actions.push({ id, label: t('reject') })
        else if (id === 'question.open') actions.push({ id, label: t('answer'), primary: true })
        else if (id === 'subject.open' && (item.subject?.type === 'session' || hasOpen)) actions.push({ id, label: t('open') })
        else if (registry[id]?.side === 'host' || (registry[id]?.side === 'client' && clientActions.includes(id)))
          actions.push({ id, label: localize(registry[id].label) || id })
      }
      if (actions.length === 0 && (item.subject?.type === 'session' || hasOpen)) actions.push({ id: 'subject.open', label: t('open') })
      return actions
    }

    function groupLabel(id, t) {
      if (id === 'system') return t('groupSystem')
      if (id === 'waiting') return t('groupWaiting')
      return t('groupDecide')
    }

    function kindLabel(kind) {
      if (kind === 'approval') return 'kindApproval'
      if (kind === 'question') return 'kindQuestion'
      if (kind === 'plan-review') return 'kindPlan'
      if (kind === 'goal-blocked') return 'kindGoal'
      if (kind === 'turn-failed') return 'kindFailed'
      if (kind === 'review') return 'kindReview'
      if (kind === 'credential') return 'kindCredential'
      return 'kindQuestion'
    }

    function waitedLine(openedAt, t) {
      const ms = Math.max(0, Date.now() - Date.parse(openedAt))
      const minutes = Math.floor(ms / 60000)
      if (minutes < 1) return t('waitedSecond')
      if (minutes < 60) return `${minutes}${t('waitedMinute')}${t('ago')}`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}${t('waitedHour')}${t('ago')}`
      return `${Math.floor(hours / 24)}${t('waitedDay')}${t('ago')}`
    }

    function funnelLine(funnel, total, t) {
      const l1 = funnel?.l1DroppedToday, l2 = funnel?.l2DroppedToday
      const known = Number.isFinite(l1) && Number.isFinite(l2)
      return `${t('dropped')} ${known ? l1 + l2 : '—'} · ${t('sourceL1')} ${Number.isFinite(l1) ? l1 : '—'} / ${t('sourceL2')} ${Number.isFinite(l2) ? l2 : '—'}`
    }

    function metricsLine(metrics, t) {
      const ms = metrics?.hardResponseMedianMs
      const duration = Number.isFinite(ms) && ms >= 0 ? ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}min` : t('noSamples')
      const rate = metrics?.hardInPlaceRate
      const ratio = Number.isFinite(rate) && metrics?.hardActed > 0
        ? `${Math.round(rate * 100)}% (${metrics.inboxHardActed}/${metrics.hardActed})` : t('noSamples')
      return `${t('hardResponse')} ${duration} · ${t('inPlace')} ${ratio}`
    }

    function workspaceOf(item, list, subjects = {}) {
      const workspace = (subjects[item.key] ?? item.subjectDescription)?.workspace
      if (workspace?.id) return workspace.id
      const row = item.subject?.type === 'session' ? list?.byId?.[item.subject.ref] : undefined
      return row?.workspaceId ?? row?.workspace?.id
    }

    /** Workspace › Session for a Session subject, so a row says where it comes from. */
    function whereOf(item, list, subjects = {}) {
      const description = subjects?.[item.key] ?? item.subjectDescription
      const ref = item.subject?.type === 'session' ? item.subject.ref : undefined
      const row = ref === undefined ? undefined : list?.byId?.[ref]
      const workspace = description?.workspace?.title ?? row?.workspaceTitle ?? row?.workspace?.title ?? (row?.cwd ? baseName(row.cwd) : undefined)
      const session = description?.session?.title ?? row?.title
      if (description?.title) return [workspace, session ?? description.title, description.subtitle].filter(Boolean).join(' › ')
      if (ref === undefined) return item.subject?.ref ?? ''
      const title = session ?? row?.title ?? ref.slice(0, 8)
      return workspace === undefined ? title : `${workspace} › ${title}`
    }

    function planReviewOf(questions) {
      if (questions?.length !== 1) return undefined
      const q = questions[0], options = q.options ?? []
      if (q.intent?.kind !== 'plan-review' || typeof q.detail !== 'string' || q.multiSelect || q.multi_select || options.length > 2) return undefined
      const approve = options.find((option) => option.label === q.intent.approve)
      return approve ? { question: q, approve, decline: options.find((option) => option !== approve) } : undefined
    }

    function QuestionForm(props) {
      const review = planReviewOf(props.item.questions)
      return review ? h(PlanReviewForm, { ...props, review }) : h(GenericQuestionForm, props)
    }

    function PlanReviewForm({ item, run, pending, engage, review, t, expanded, toggle }) {
      const q = review.question
      const long = q.detail.length > 420 || q.detail.split('\n').length > 8
      const answer = (label) => {
        engage?.(item.key)
        void run(item, 'question.answer', { answers: [{ id: q.id, selected: [label] }] })
      }
      const ask = q.question === 'Approve this plan and leave plan mode?' ? t?.('planQuestion') ?? q.question : q.question
      return h('section', { 'aria-label': ask, className: 'ai-review' }, [
        h('pre', { key: 'plan', className: `ai-plan${long && !expanded ? ' collapsed' : ''}` }, q.detail),
        long ? h('button', { key: 'more', 'data-action-id': 'detail.toggle', type: 'button', className: 'ai-link', onClick: toggle }, expanded ? t?.('collapse') : t?.('showFullPlan')) : null,
        h('div', { key: 'buttons', className: 'ai-actions' }, [
          h('button', { key: 'approve', 'data-action-id': 'question.answer', 'data-question-id': q.id, 'data-option-label': review.approve.label, type: 'button', disabled: pending, className: 'ai-btn primary',
            onClick: () => answer(review.approve.label) }, t ? planLabel(review.approve.label, t) : review.approve.label),
          review.decline ? h('button', { key: 'decline', 'data-action-id': 'question.answer', 'data-question-id': q.id, 'data-option-label': review.decline?.label, type: 'button', disabled: pending, className: 'ai-btn',
            onClick: () => answer(review.decline.label) }, t ? planLabel(review.decline.label, t) : review.decline.label) : null,
        ]),
      ])
    }

    function GenericQuestionForm({ item, run, pending, t, engage }) {
      const [answers, setAnswers] = useState({})
      const update = (id, patch) => {
        engage?.(item.key)
        setAnswers((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
      }
      const complete = item.questions.every((q) => answers[q.id]?.selected?.length || answers[q.id]?.custom?.trim())
      return h('form', { className: 'ai-form', onKeyDown: (event) => {
        // Editing, IME confirmation and key repeat never submit a decision.
        // Submission requires activating the explicit Answer button.
        if (event.key === 'Enter' && event.target?.tagName !== 'BUTTON') event.preventDefault()
      }, onSubmit: (event) => {
        event.preventDefault()
        if (!complete || pending) return
        void run(item, 'question.answer', { answers: item.questions.map((q) => {
          const a = answers[q.id] ?? {}, custom = a.custom?.trim()
          return { id: q.id, selected: custom && !(q.multiSelect ?? q.multi_select) ? [] : a.selected ?? [], ...(custom ? { custom } : {}) }
        }) })
      } }, [
        ...item.questions.map((q) => {
          const multi = Boolean(q.multiSelect ?? q.multi_select)
          return h('fieldset', { key: q.id, disabled: pending, className: 'ai-q' }, [
            item.questions.length > 1 || q.question !== item.title ? h('legend', { key: 'title' }, q.question) : null,
            q.detail ? h('pre', { key: 'detail', className: 'ai-plan' }, q.detail) : null,
            h('div', { key: 'options', className: 'ai-options' }, (q.options ?? []).map((o) => {
              const checked = answers[q.id]?.selected?.includes(o.label) ?? false
              return h('label', { key: o.label, className: 'ai-option', 'data-checked': checked ? 'true' : 'false', 'data-option-label': o.label, title: o.description }, [
                h('input', { key: 'input', type: multi ? 'checkbox' : 'radio', name: `${item.key}:${q.id}`, checked,
                  onChange: () => { const selected = answers[q.id]?.selected ?? []
                    update(q.id, { selected: multi ? selected.includes(o.label) ? selected.filter((v) => v !== o.label) : [...selected, o.label] : [o.label] }) } }),
                multi ? h('span', { key: 'mark', className: 'ai-box' }) : null,
                o.label,
              ])
            })),
            h('input', { key: 'custom', type: 'text', className: 'ai-input', placeholder: t('customAnswer'), 'aria-label': `${q.question}: ${t('customAnswer')}`,
              value: answers[q.id]?.custom ?? '', onChange: (event) => update(q.id, { custom: event.target.value }) }),
          ])
        }),
        h('div', { key: 'submit', className: 'ai-actions' }, h('button', { 'data-action-id': 'question.answer', type: 'submit', disabled: pending || !complete, className: 'ai-btn primary' }, t('answer'))),
      ])
    }

    /* -------------------------------------------------------------- styles */

    const shellStyle = {
      height: '100%',
      overflowY: 'auto',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      boxSizing: 'border-box',
    }

    const BRAND = 'var(--dsw-font-family-brand, var(--dsw-font-family, system-ui, sans-serif))'
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
    const TINT = (token, percent) => `color-mix(in srgb, var(${token}) ${percent}%, transparent)`
    const STYLE = `
.ai-page{-webkit-font-smoothing:antialiased}
.ai-dot,.ai-dot::after,.ai-orb i,.ai-orb b,.ai-sweep,.ai-radio,.ai-agent,.ai-pill,.ai-count{corner-shape:round}
.ai-col{max-width:880px;margin:0 auto;padding:28px 40px 56px}
.ai-top{display:flex;align-items:center;gap:10px;margin-bottom:30px}
.ai-brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ai-spacer{flex:1}
.ai-pill{display:inline-flex;align-items:center;gap:8px;height:28px;padding:0 12px;border-radius:999px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.ai-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);position:relative;flex:none;--ai-dot:var(--dsw-alias-state-success-primary)}
.ai-dot.warn{background:var(--dsw-alias-state-warn-primary);--ai-dot:var(--dsw-alias-state-warn-primary)}
.ai-dot.error{background:var(--dsw-alias-state-error-primary);--ai-dot:var(--dsw-alias-state-error-primary)}
.ai-dot.live::after{content:'';position:absolute;left:-4px;top:-4px;width:15px;height:15px;box-sizing:border-box;border-radius:50%;border:1.5px solid var(--ai-dot);opacity:0;animation:ai-ping 2.2s ease-out infinite}
@keyframes ai-ping{0%{transform:scale(.5);opacity:.9}100%{transform:scale(2.1);opacity:0}}
.ai-hero{margin:0 0 30px}
.ai-hero h1{margin:0;font-family:${BRAND};font-size:36px;line-height:1.2;font-weight:300;letter-spacing:-.015em;color:var(--dsw-alias-label-primary)}
.ai-num{font-weight:600;display:inline-block;vertical-align:-.04em;font-variant-numeric:tabular-nums;margin-right:.22em}
.ai-num.hard{color:var(--dsw-alias-state-warn-primary)}
.ai-num.system{color:var(--dsw-alias-state-error-primary)}
.ai-sub{margin:10px 0 0;font-size:14px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.ai-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:8px 0 0}
.ai-stat{padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.ai-stat b{display:block;font-family:${BRAND};font-size:24px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.2;color:var(--dsw-alias-label-primary)}
.ai-stat span{display:block;margin-top:4px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.ai-group{margin:0 0 26px}
.ai-group h2{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.ai-count{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 6px;box-sizing:border-box;border-radius:9px;font-size:11px;letter-spacing:0;background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary)}
.ai-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.ai-card{position:relative;padding:16px 18px 14px 22px;border-radius:14px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);transition:border-color .15s,box-shadow .2s,opacity .2s;animation:ai-in .34s cubic-bezier(.2,.7,.2,1) both;--ai-tone:var(--dsw-alias-border-l3)}
.ai-card::before{content:'';position:absolute;left:0;top:16px;bottom:16px;width:3px;border-radius:0 3px 3px 0;background:var(--ai-tone)}
.ai-card[data-tone=hard]{--ai-tone:var(--dsw-alias-state-warn-primary)}
.ai-card[data-tone=system]{--ai-tone:var(--dsw-alias-state-error-primary)}
.ai-card:hover{border-color:var(--dsw-alias-border-l2)}
.ai-card[data-selected=true]{border-color:var(--dsw-alias-border-l3);box-shadow:0 0 0 3px color-mix(in srgb,var(--ai-tone) 14%,transparent),0 10px 28px -18px rgba(0,0,0,.45)}
.ai-card[data-pending=true]{opacity:.6}
@keyframes ai-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.ai-row{display:flex;align-items:center;gap:10px;min-width:0}
.ai-chip{flex:none;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-l1);border:1px solid var(--dsw-alias-border-l1)}
.ai-card[data-tone=hard] .ai-chip{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border-color:transparent}
.ai-card[data-tone=system] .ai-chip{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-color:transparent}
.ai-where{min-width:0;flex:1;max-width:52ch;font-size:12.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ai-timer{flex:none;display:inline-flex;align-items:center;gap:7px;padding:3px 9px;border-radius:8px;background:var(--dsw-alias-fill-l1);border:1px solid var(--dsw-alias-border-l1);font:500 12px/1 ${MONO};font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}
.ai-ring{display:inline-block;width:7px;height:7px;border-radius:50%;border:1.5px solid var(--dsw-alias-state-warn-primary);flex:none}
.ai-timer.warn .ai-ring{border-color:var(--dsw-alias-state-warn-primary)}
.ai-timer.error .ai-ring{border-color:var(--dsw-alias-state-error-primary)}
.ai-timer.warn{color:var(--dsw-alias-state-warn-primary)}
.ai-timer.error{color:var(--dsw-alias-state-error-primary)}
.ai-title{margin:11px 0 0;font-size:15.5px;line-height:1.55;font-weight:500;color:var(--dsw-alias-label-primary);word-break:break-word}
.ai-tool{display:inline-block;margin-right:8px;padding:0 7px;border-radius:6px;font:500 12.5px/1.7 ${MONO};background:var(--dsw-alias-fill-l1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);vertical-align:1px}
.ai-meta{margin-top:6px;display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.ai-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:15px}
.ai-btn{font:inherit;font-size:13px;font-weight:500;height:32px;padding:0 14px;border-radius:9px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:transform .08s,background .15s,border-color .15s;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.ai-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l4)}
.ai-btn:active:not(:disabled){transform:scale(.97)}
.ai-btn:disabled{cursor:default;opacity:.5}
.ai-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}
.ai-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:transparent}
.ai-open::after{content:"↗";margin-left:2px;opacity:.7}
.ai-btn.small{height:26px;padding:0 9px;font-size:12px;flex:none}
.ai-btn.ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.ai-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:transparent}
.ai-hint{margin-left:auto;display:flex;gap:12px;align-items:center;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.ai-kbd{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 4px;margin-right:5px;box-sizing:border-box;border-radius:5px;font:500 10.5px/1 ${MONO};color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-bottom-width:2px}
.ai-plan{margin:12px 0 0;padding:14px 16px;border-radius:10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.ai-plan.collapsed{max-height:176px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 55%,transparent);mask-image:linear-gradient(#000 55%,transparent)}
.ai-link{font:inherit;font-size:12.5px;background:none;border:0;padding:0;margin-top:8px;cursor:pointer;color:var(--dsw-alias-link)}
.ai-q{border:0;padding:0;margin:14px 0 0;min-width:0}
.ai-q legend{padding:0;margin-bottom:10px;font-size:14px;color:var(--dsw-alias-label-primary)}
.ai-options{display:flex;flex-wrap:wrap;gap:8px}
.ai-option{position:relative;display:inline-flex;align-items:center;gap:9px;min-height:34px;padding:0 14px;border-radius:10px;cursor:pointer;font-size:13.5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:border-color .15s,background .15s,transform .08s}
.ai-option:hover{border-color:var(--dsw-alias-border-l4)}
.ai-option:active{transform:scale(.98)}
.ai-option[data-checked=true]{border-color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}
.ai-option input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.ai-radio,.ai-box{width:14px;height:14px;box-sizing:border-box;border:1.5px solid var(--dsw-alias-border-l4);display:inline-grid;place-items:center;flex:none}
.ai-radio{border-radius:50%}.ai-box{border-radius:4px}
.ai-option[data-checked=true] .ai-radio,.ai-option[data-checked=true] .ai-box{border-color:var(--dsw-alias-label-primary)}
.ai-option[data-checked=true] .ai-radio::after{content:'';width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-primary)}
.ai-option[data-checked=true] .ai-box{background:var(--dsw-alias-label-primary)}
.ai-input{display:block;font:inherit;font-size:13px;height:34px;margin-top:10px;padding:0 12px;width:min(100%,380px);box-sizing:border-box;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:none;transition:border-color .15s}
.ai-input:focus{border-color:var(--dsw-alias-border-l4)}
.ai-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.ai-alert{margin-top:10px;font-size:12.5px;color:var(--dsw-alias-state-error-primary)}
.ai-toast{display:flex;align-items:center;gap:10px;margin:-14px 0 22px;padding:10px 14px;border-radius:12px;font-size:13px;color:var(--dsw-alias-label-primary);background:${TINT('--dsw-alias-state-success-primary', 12)};border:1px solid ${TINT('--dsw-alias-state-success-primary', 32)};animation:ai-in .25s ease both}
.ai-empty{display:grid;grid-template-columns:auto minmax(0,1fr);gap:32px;align-items:center;padding:28px 30px;border-radius:18px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);margin:0 0 14px}
.ai-orb{position:relative;width:116px;height:116px;display:grid;place-items:center}
.ai-orb i{position:absolute;inset:0;border-radius:50%;border:1px solid ${TINT('--dsw-alias-state-success-primary', 55)};opacity:0;animation:ai-ring 3.6s ease-out infinite}
.ai-orb i:nth-of-type(2){animation-delay:1.2s}
.ai-orb i:nth-of-type(3){animation-delay:2.4s}
.ai-orb::before{content:"";position:absolute;inset:6px;border-radius:50%;corner-shape:round;border:1px solid ${TINT("--dsw-alias-state-success-primary", 28)}}
.ai-sweep{overflow:hidden}
.ai-orb b{position:relative;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 7px ${TINT('--dsw-alias-state-success-primary', 16)}}
.ai-sweep{position:absolute;inset:6px;border-radius:50%;background:conic-gradient(from 0deg,${TINT('--dsw-alias-state-success-primary', 26)},transparent 26%);animation:ai-spin 4.2s linear infinite}
@keyframes ai-ring{0%{transform:scale(.3);opacity:0}15%{opacity:1}100%{transform:scale(1);opacity:0}}
@keyframes ai-spin{to{transform:rotate(360deg)}}
.ai-check{width:116px;height:116px;flex:none}
.ai-check.small{width:18px;height:18px}
.ai-check circle{fill:${TINT('--dsw-alias-state-success-primary', 12)};stroke:var(--dsw-alias-state-success-primary);stroke-width:2}
.ai-check path{fill:none;stroke:var(--dsw-alias-state-success-primary);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40;animation:ai-draw .55s .1s cubic-bezier(.6,0,.2,1) forwards}
@keyframes ai-draw{to{stroke-dashoffset:0}}
.ai-radar h3.ai-radar-title{margin:0 0 14px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.ai-radar h3{margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.ai-radar p{margin:12px 0 0;font-size:13.5px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.ai-radar p:first-child{margin-top:0}
.ai-agents{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.ai-agent{display:flex;align-items:flex-start;gap:10px;width:100%;padding:9px 12px;border-radius:10px;font:inherit;text-align:left;cursor:pointer;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.ai-agent:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.ai-agent .ai-dot{margin-top:5px}
.ai-agent-body{min-width:0;flex:1;display:grid;gap:2px}
.ai-agent-title{font-size:13px;line-height:1.45;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ai-agent-state{font-style:normal;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.ai-agent-more{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:2px 4px}
.ai-perks{list-style:none;margin:18px 0 0;padding:16px 0 0;border-top:1px dashed var(--dsw-alias-border-l2);display:grid;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.ai-perks li{display:flex;gap:10px;align-items:baseline}
.ai-perks b{font:600 11px/1 ${MONO};color:var(--dsw-alias-state-success-primary);letter-spacing:.04em}
.ai-strip{display:grid;gap:8px;margin:-6px 0 22px;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px dashed var(--dsw-alias-border-l2);font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.ai-strip .ai-strip-line{display:flex;align-items:center;gap:8px}
.ai-foot{margin-top:28px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.ai-keys{display:flex;flex-wrap:wrap;gap:14px;margin-left:auto}
.ai-notice{margin:0 0 16px;padding:10px 14px;border-radius:10px;font-size:12.5px;background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-secondary)}
.ai-mute{display:inline-flex;align-items:center;gap:4px}
.ai-mute summary{list-style:none}
.ai-settings-title{font-family:${BRAND};font-weight:400;font-size:24px;margin:12px 0 18px}
.ai-settings-sub{margin:22px 0 10px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.ai-setting{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:13.5px}
.ai-rules{list-style:none;padding:0;margin:0;display:grid;gap:6px;font-size:13px}
@media (max-width:720px){.ai-col{padding:20px 18px 40px}.ai-stats{grid-template-columns:1fr}.ai-empty{grid-template-columns:1fr}.ai-hero h1{font-size:28px}.ai-keys{display:none}}
@media (prefers-reduced-motion:reduce){.ai-page *,.ai-page *::before,.ai-page *::after{animation:none!important;transition:none!important}}
`

    return {
      inject: ['slots', 'uiSession', 'sessions', 'locale', 'uiWorkspace'],
      apply,
    }
  },
})
