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
      emptyHint: '它会自动收集所有 Session 里等你处理的事，不需要任何设置。',
      loading: '正在汇总…',
      historyPartial: '部分历史会话未能读取，当前显示实时事项和已读取的历史事项。',
      hostUnavailable: 'Host 汇总暂不可用；交互保持实时，其他条目为上次读取的状态。',
      kindApproval: '审批',
      kindQuestion: '提问',
      kindPlan: '计划',
      kindGoal: 'goal 受阻',
      kindFailed: '失败',
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
      blockedGoal: 'goal 受阻',
      deadline: '截止',
      defaultAction: '截止时默认动作',
      dropped: '今天替你挡掉',
      obligations: '待处理',
      customAnswer: '补充或自定义回答',
      settings: '设置', back: '返回收件箱', reviewEnabled: '显示待验收事项', ledgerRetentionDays: '账本保留天数',
      save: '保存', saved: '已保存', settingsFailed: '设置未保存，请重试', mute: '静音', muteSession: '这个 Session',
      muteWorkspace: '这个 Workspace', muteRules: '静音规则（仅软义务）', noMuteRules: '没有静音规则', unmute: '解除静音',
      hardResponse: '硬阻塞中位响应', inPlace: '硬阻塞原地处理率', noSamples: '暂无样本', coverage: '覆盖缺口',
      sourceL1: 'L1', sourceL2: 'L2', planApprove: '批准计划', awaitingFact: '已提交，等待原生状态确认…',
      nativeTrackingFailed: '原生操作统计同步失败；可重试同步', retryTracking: '重试统计同步',
      noisySource: '这个来源经常被忽略，建议调整来源规则',
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
      kindApproval: 'Approval',
      kindQuestion: 'Question',
      kindPlan: 'Plan',
      kindGoal: 'Goal blocked',
      kindFailed: 'Failed',
      kindReview: 'Review',
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
      sourceL1: 'L1', sourceL2: 'L2', planApprove: 'Approve plan', awaitingFact: 'Submitted; waiting for native confirmation…',
      nativeTrackingFailed: 'Native action metrics could not sync; retry sync', retryTracking: 'Retry metrics sync',
      noisySource: 'This source is often dismissed; consider changing its rules',
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
        const key = `client:${kind}:${sessionId}:${interaction.key ?? interaction.callId ?? ''}`
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
        const nativeKey = (sessionId, kind, value) => `${sessionId}:${value.callId || `${kind}:${value.toolName ?? ''}`}`
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
        const rebuild = () => {
          if (!active) return
          const statuses = ctx.uiSession.sessionStatus.getSnapshot()
          const local = clientObligations(statuses, live)
          const currentNative = new Set([...local.live.values()].map((entry) => nativeKey(entry.sessionId, entry.interaction.kind, entry.interaction)))
          for (const entry of live.values()) {
            const identity = nativeKey(entry.sessionId, entry.interaction.kind, entry.interaction)
            if (!currentNative.has(identity)) finishedNative.add(identity)
          }
          for (const identity of currentNative) finishedNative.delete(identity)
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
          // Live interactions are authoritative; never let a cached Host copy
          // resurrect an approval/question after its actual request was removed.
          const hostItems = host.items.filter((item) => {
            if (item.producer === 'client') return false
            if (!item.native || item.subject?.type !== 'session') return true
            const identity = nativeKey(item.subject.ref, item.kind, item.native)
            return !currentNative.has(identity) && !finishedNative.has(identity)
          })
          const items = [...local.items, ...hostItems].filter((item) => {
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
            metrics: host.metrics ?? snapshot.metrics, clientActions: [...clientActions.keys()],
            dispositions: host.dispositions, pending: retain(snapshot.pending), failed: retain(snapshot.failed) })
        }
        const refresh = async () => {
          if (!active) return
          const ownGeneration = ++generation
          controller?.abort()
          controller = new AbortController()
          try {
            const visibleSessionIds = Object.entries(ctx.sessions.list.getSnapshot().byId ?? {})
              .filter(([, row]) => row.retainedBy?.mainView > 0).map(([id]) => id).sort()
            // Refresh the per-browser lease every poll, including empty lists.
            try {
              await callHost({ op: 'telemetry', clientId, visibleSessionIds }, controller.signal)
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
            host = { ...state, items: Array.isArray(state.items) ? state.items : [], kinds: state.kinds ?? {},
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
        const answerNative = async (current, actionId, input) => {
          const entry = live.get(current.key), interaction = entry?.interaction
          if (!interaction || interaction.answerable === false || typeof interaction.answer !== 'function') throw new Error('native answer unavailable')
          const mirror = interaction.callId && host.items.find((item) => item.subject?.type === 'session' &&
            item.subject.ref === entry.sessionId && item.kind === interaction.kind && item.native?.callId === interaction.callId)
          // PendingApproval.key is a browser render counter, not the Host request
          // id. Prefer the exact mirror; otherwise correlate only by tool call.
          const body = { key: mirror?.key ?? current.key, revision: mirror?.revision ?? current.revision, actionId, sessionId: entry.sessionId,
            kind: interaction.kind, callId: interaction.callId, requestId: mirror?.native?.requestId }
          await trackNative({ ...body, phase: 'attempt' })
          try {
            // The request may have changed while the acknowledgement was in flight.
            currentItem(current)
            if (live.get(current.key)?.interaction !== interaction || interaction.answerable === false) throw new Error('native request replaced')
            const result = await interaction.answer(input)
            if (result === false) throw new Error('native answer refused')
          } catch (error) {
            await trackNative({ ...body, phase: 'failed' })
            throw error
          }
          await trackNative({ ...body, phase: 'accepted' })
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
            if (!pending || !card || card.closed || !['waterfall', 'rpc'].includes(card.channel)) {
              openSubject(current)
              return
            }
            await answerNative(current, 'question.answer', input)
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
    }

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

    /** The page: what needs a person now, in three groups, with counts that match the lists. */
    function InboxPage(props) {
      const { useView, run, dispose, mute, t, sessions, localeText, engageQuestion, retryTracking, renderSlot } = props
      const view = useView((current) => current)
      const list = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot)
      const [expanded, setExpanded] = useState({})
      const [settingsOpen, setSettingsOpen] = useState(false)
      const rows = view.items.map((item) => ({
        item,
        where: whereOf(item, list, view.subjects),
        hasOpen: Boolean(view.subjects?.[item.key]?.open ?? item.subjectDescription?.open),
      }))
      const byKey = new Map(rows.map((row) => [row.item.key, row]))

      if (view.phase === 'loading') {
        return h('div', { 'data-attention-inbox': 'page', style: shellStyle }, h('p', { style: mutedStyle }, t('loading')))
      }

      if (settingsOpen) return h('div', { 'data-attention-inbox': 'page', style: shellStyle }, [
        h('button', { key: 'back', 'data-action-id': 'settings.back', type: 'button', style: buttonQuietStyle, onClick: () => setSettingsOpen(false) }, t('back')),
        h(InboxSettings, { ...props, key: 'settings' }),
      ])
      return h('div', { 'data-attention-inbox': 'page', style: shellStyle }, [
        h('header', { key: 'head', style: { marginBottom: 20 } }, [
          h('h1', { key: 'title', style: { fontSize: 20, fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary)' } }, t('title')),
          h('button', { key: 'settings', 'data-action-id': 'settings.open', type: 'button', style: buttonQuietStyle, onClick: () => setSettingsOpen(true) }, t('settings')),
          view.nativeTrackingFailed ? h('p', { key: 'tracking', style: mutedStyle }, [t('nativeTrackingFailed'),
            h('button', { key: 'retry', 'data-action-id': 'metrics.retry', type: 'button', style: buttonQuietStyle, onClick: () => void retryTracking() }, t('retryTracking'))]) : null,
          view.hostAvailable === false
            ? h('p', { key: 'degraded', style: { ...mutedStyle, marginTop: 8 } }, t('hostUnavailable'))
            : view.health?.backfill === 'partial'
              ? h('p', { key: 'history-partial', style: { ...mutedStyle, marginTop: 8 } }, t('historyPartial'))
              : null,
        ]),
        view.total === 0
          ? h('section', { key: 'empty' }, [
            h('p', { key: 'line', style: { margin: 0, color: 'var(--dsw-alias-label-primary)' } }, t(view.hostAvailable === false ? 'hostUnavailable' : 'empty')),
            h('p', { key: 'hint', style: { ...mutedStyle, marginTop: 8 } }, t('emptyHint')),
          ])
          : h('div', { key: 'groups' }, view.groups.map((group) => h('section', { key: group.id, style: { marginBottom: 24 } }, [
            h('h2', {
              key: 'label',
              style: {
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--dsw-alias-label-secondary)',
                margin: '0 0 8px',
              },
            }, `${groupLabel(group.id, t)} · ${group.items.length}`),
            h('ul', { key: 'list', style: { listStyle: 'none', margin: 0, padding: 0 } },
              group.items.map((item) => renderRow(byKey.get(item.key), {
                t,
                kinds: view.kinds, actions: view.actions, clientActions: view.clientActions, localeText, engageQuestion,
                renderSubject: (item, fallback) => typeof renderSlot === 'function'
                  ? renderSlot('attention.subject', { subject: item.subject, obligation: item,
                    description: view.subjects?.[item.key] ?? item.subjectDescription }, { entryKey: item.subject?.type, fallback })
                  : fallback,
                expanded: expanded[item.key] === true,
                toggle: () => setExpanded((current) => ({ ...current, [item.key]: current[item.key] !== true })),
                run,
                dispose, mute, workspace: workspaceOf(item, list, view.subjects),
                pending: view.pending[item.key] === true,
                failed: view.failed?.[item.key] === true,
              }))),
          ]))),
        h('footer', {
          key: 'foot',
          style: {
            marginTop: 8,
            paddingTop: 12,
            borderTop: '1px solid var(--dsw-alias-border-l1)',
            ...mutedStyle,
          },
        }, [funnelLine(view.funnel, view.total, t), h('div', { key: 'metrics', style: { marginTop: 4 } }, metricsLine(view.metrics, t)),
          h('details', { key: 'debug', 'data-coverage-gap': view.coverage.gap }, [
            h('summary', { key: 'summary' }, `${t('coverage')}: ${view.coverage.gap}`),
            h('pre', { key: 'value' }, JSON.stringify(view.coverage, null, 2)),
          ])]),
      ])
    }

    function InboxSettings({ useView, updateSettings, unmute, t }) {
      const view = useView((current) => current)
      const [draftDays, setDraftDays] = useState(null)
      const days = draftDays ?? String(view.settings.ledgerRetentionDays)
      const valid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 3650
      const disabled = view.settingsPending || view.hostAvailable === false
      return h('section', { 'data-attention-inbox': 'settings', style: { padding: 20, color: 'var(--dsw-alias-label-primary)' } }, [
        h('h2', { key: 'title' }, t('settings')),
        h('label', { key: 'review', style: { display: 'block', marginBottom: 16 } }, [
          h('input', { key: 'input', 'data-setting-key': 'reviewEnabled', type: 'checkbox', checked: view.settings.reviewEnabled === true, disabled,
            onChange: (event) => void updateSettings({ reviewEnabled: event.target.checked }) }), t('reviewEnabled'),
        ]),
        h('form', { key: 'retention', onSubmit: (event) => { event.preventDefault()
          if (valid && !disabled) void updateSettings({ ledgerRetentionDays: Number(days) }) } }, [
          h('label', { key: 'label' }, [t('ledgerRetentionDays'), h('input', { key: 'input', 'data-setting-key': 'ledgerRetentionDays', type: 'number', min: 1, max: 3650,
            value: days, disabled, onChange: (event) => setDraftDays(event.target.value), style: { margin: '0 12px', width: 80 } })]),
          h('button', { key: 'save', 'data-action-id': 'settings.save', type: 'submit', disabled: disabled || !valid, style: buttonStyle }, t('save')),
        ]),
        view.settingsError ? h('p', { key: 'error', role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, t('settingsFailed')) : null,
        ...(view.metrics.noiseBySource ?? []).filter((source) => source.suggestRuleChange).map((source) =>
          h('p', { key: `noise:${source.source}:${source.kind}`, style: { ...mutedStyle, marginTop: 12 } },
            `${t('noisySource')}: ${source.source} / ${source.kind} (${source.dismissed}/${source.closed})`)),
        h('h3', { key: 'mute-title' }, t('muteRules')),
        view.muteRules.length ? h('ul', { key: 'rules' }, view.muteRules.map((rule) => h('li', { key: `${rule.scope}:${rule.ref}` }, [
          `${t(rule.scope === 'workspace' ? 'muteWorkspace' : 'muteSession')}: ${rule.ref} `,
          h('button', { key: 'remove', 'data-action-id': 'mute.unmute', 'data-mute-scope': rule.scope, 'data-mute-ref': rule.ref, type: 'button', disabled, style: buttonQuietStyle, onClick: () => void unmute(rule) }, t('unmute')),
        ]))) : h('p', { key: 'none', style: mutedStyle }, t('noMuteRules')),
      ])
    }

    function renderRow(row, state) {
      if (row === undefined) return null
      const { item } = row
      const { t, pending, failed } = state
      const actions = actionsFor(item, t, state.actions, state.localeText, row.hasOpen, state.clientActions)
      return h('li', {
        key: item.key,
        'data-attention-key': item.key,
        style: {
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)',
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 8,
          opacity: pending ? 0.7 : 1,
        },
      }, [
        h('div', { key: 'top', style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, [
          h('span', { key: 'kind', style: kindStyle(item, state.kinds) }, state.localeText(state.kinds?.[item.kind]?.label) || (KINDS[item.kind] ? t(kindLabel(item.kind)) : item.kind)),
          h('span', {
            key: 'title',
            style: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, lineHeight: 1.5, flex: 1, wordBreak: 'break-word' },
          }, item.title || t('kindQuestion')),
        ]),
        h('div', { key: 'meta', style: { ...mutedStyle, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' } }, [
          h('div', { key: 'where' }, state.renderSubject(item, h('span', null, row.where))),
          h('span', { key: 'waited' }, waitedLine(item.openedAt, t)),
          item.deadline ? h('span', { key: 'deadline' }, `${t('deadline')} ${new Date(item.deadline).toLocaleTimeString()}`) : null,
          item.defaultAction?.actionId ? h('span', { key: 'default-action', 'data-default-action-id': item.defaultAction.actionId },
            `${t('defaultAction')}: ${state.localeText(state.actions?.[item.defaultAction.actionId]?.label) || item.defaultAction.actionId}`) : null,
          item.certainty === 'inferred' ? h('span', { key: 'inferred' }, '~') : null,
        ]),
        item.detail
          ? h('button', {
            key: 'detail-toggle',
            'data-action-id': 'detail.toggle',
            type: 'button',
            onClick: state.toggle,
            style: linkStyle,
          }, state.expanded ? '−' : '+')
          : null,
        item.detail && state.expanded
          ? h('pre', {
            key: 'detail',
            style: {
              margin: '8px 0 0',
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 13,
              color: 'var(--dsw-alias-label-secondary)',
            },
          }, item.detail)
          : null,
        h('div', { key: 'actions', style: { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' } }, [
          ...actions.map((action) => h('button', {
            key: action.id,
            'data-action-id': action.id,
            type: 'button',
            disabled: pending,
            onClick: () => void state.run(item, action.id),
            style: action.primary ? buttonPrimaryStyle : buttonStyle,
          }, pending ? t('working') : action.label)),
          meta(item, state.kinds).blocking === 'soft' ? h('button', {
            key: 'dismiss', 'data-action-id': 'dispose.dismissed', type: 'button', disabled: pending,
            onClick: () => void state.dispose(item, 'dismissed'), style: buttonQuietStyle,
          }, t('dismiss')) : null,
          meta(item, state.kinds).blocking === 'soft' ? h('button', {
            key: 'snooze', 'data-action-id': 'dispose.snoozed', type: 'button', disabled: pending,
            onClick: () => void state.dispose(item, 'snoozed'), style: buttonQuietStyle,
          }, t('snooze')) : null,
          meta(item, state.kinds).blocking === 'soft' && (item.subject?.type === 'session' || state.workspace) ? h('details', { key: 'mute' }, [
            h('summary', { key: 'summary', style: buttonQuietStyle }, t('mute')),
            item.subject?.type === 'session' ? h('button', { key: 'session', 'data-action-id': 'mute.session', type: 'button', disabled: pending, style: buttonQuietStyle,
              onClick: () => void state.mute(item, 'session') }, t('muteSession')) : null,
            state.workspace ? h('button', { key: 'workspace', 'data-action-id': 'mute.workspace', type: 'button', disabled: pending, style: buttonQuietStyle,
              onClick: () => void state.mute(item, 'workspace') }, t('muteWorkspace')) : null,
          ]) : null,
        ]),
        item.questions?.length ? h(QuestionForm, { key: `question:${item.key}:${item.revision}`, item, run: state.run, pending, t, engage: state.engageQuestion }) : null,
        failed ? h('div', { key: 'failed', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, marginTop: 8 } }, t('failedAction')) : null,
      ])
    }

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

    function kindStyle(item, registry) {
      const blocking = meta(item, registry).blocking
      const color = blocking === 'system'
        ? 'var(--dsw-alias-state-error-primary)'
        : blocking === 'hard' ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)'
      return {
        fontSize: 11,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: '1px 6px',
        whiteSpace: 'nowrap',
      }
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
      return `${t('obligations')} ${total} · ${t('dropped')} ${known ? l1 + l2 : '—'} · L1 ${Number.isFinite(l1) ? l1 : '—'} / L2 ${Number.isFinite(l2) ? l2 : '—'}`
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
      if (description?.title) return [description.title, description.subtitle].filter(Boolean).join(' › ')
      const ref = item.subject?.type === 'session' ? item.subject.ref : undefined
      if (ref === undefined) return item.subject?.ref ?? ''
      const row = list?.byId?.[ref]
      const title = row?.title ?? ref.slice(0, 8)
      const workspace = row?.workspaceTitle ?? row?.workspace?.title
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

    function PlanReviewForm({ item, run, pending, engage, review }) {
      const q = review.question
      const answer = (label) => {
        engage?.(item.key)
        void run(item, 'question.answer', { answers: [{ id: q.id, selected: [label] }] })
      }
      return h('section', { 'aria-label': q.question }, [
        h('pre', { key: 'plan', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: 13 } }, q.detail),
        h('div', { key: 'buttons', style: { display: 'flex', gap: 8 } }, [
          h('button', { key: 'approve', 'data-action-id': 'question.answer', 'data-question-id': q.id, 'data-option-label': review.approve.label, type: 'button', disabled: pending, style: buttonPrimaryStyle,
            onClick: () => answer(review.approve.label) }, review.approve.label),
          review.decline ? h('button', { key: 'decline', 'data-action-id': 'question.answer', 'data-question-id': q.id, 'data-option-label': review.decline?.label, type: 'button', disabled: pending, style: buttonStyle,
            onClick: () => answer(review.decline.label) }, review.decline.label) : null,
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
      return h('form', { onKeyDown: (event) => {
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
        ...item.questions.map((q) => h('fieldset', { key: q.id, disabled: pending, style: { border: 0, padding: 0, marginTop: 12 } }, [
          h('legend', { key: 'title' }, q.question),
          q.detail ? h('pre', { key: 'detail', style: { whiteSpace: 'pre-wrap', fontFamily: 'inherit' } }, q.detail) : null,
          ...(q.options ?? []).map((o) => h('label', { key: o.label, style: { display: 'block' } }, [
            h('input', { key: 'input', type: (q.multiSelect ?? q.multi_select) ? 'checkbox' : 'radio', name: `${item.key}:${q.id}`,
              checked: answers[q.id]?.selected?.includes(o.label) ?? false,
              onChange: () => { const selected = answers[q.id]?.selected ?? []
                update(q.id, { selected: (q.multiSelect ?? q.multi_select) ? selected.includes(o.label) ? selected.filter((v) => v !== o.label) : [...selected, o.label] : [o.label] }) } }), o.label,
          ])),
          h('input', { key: 'custom', type: 'text', placeholder: t('customAnswer'), 'aria-label': `${q.question}: ${t('customAnswer')}`,
            value: answers[q.id]?.custom ?? '', onChange: (event) => update(q.id, { custom: event.target.value }) }),
        ])),
        h('button', { key: 'submit', 'data-action-id': 'question.answer', type: 'submit', disabled: pending || !complete, style: buttonPrimaryStyle }, t('answer')),
      ])
    }

    /* -------------------------------------------------------------- styles */

    const shellStyle = {
      height: '100%',
      overflowY: 'auto',
      padding: '28px 32px 40px',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      boxSizing: 'border-box',
    }
    const mutedStyle = {
      fontSize: 12,
      color: 'var(--dsw-alias-label-secondary)',
      margin: 0,
    }
    const buttonStyle = {
      font: 'inherit',
      fontSize: 13,
      padding: '4px 12px',
      borderRadius: 6,
      cursor: 'pointer',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
    }
    const buttonPrimaryStyle = { ...buttonStyle, borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' }
    const buttonQuietStyle = {
      ...buttonStyle,
      border: '1px solid transparent',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
    }
    const linkStyle = {
      font: 'inherit',
      fontSize: 12,
      background: 'transparent',
      border: 'none',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
      padding: 0,
      marginTop: 6,
    }

    return {
      inject: ['slots', 'uiSession', 'sessions', 'locale', 'uiWorkspace'],
      apply,
    }
  },
})
