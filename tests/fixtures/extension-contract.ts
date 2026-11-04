import type { AttentionService, RaiseInput } from 'dsh-attention-inbox/api'

declare const inbox: AttentionService
const input: RaiseInput = {
  key: 'record-ready', subject: { type: 'record', ref: 'record-1' },
  kind: 'review', title: 'Review a completed record', blocking: 'soft',
  defaultAction: { actionId: 'record.accept', input: { approved: false } },
  options: [{ id: 'accept', label: 'Accept', recommended: true }],
}
inbox.raise(input)
inbox.raise(input, 'explicit-producer')
inbox.list({ kinds: ['review'], subjectType: 'record', includeSnoozed: true })
inbox.registerAction({ id: 'record.accept', side: 'host', async run(item, data, signal) {
  const payload: unknown = data
  void payload; void signal
  await inbox.withdraw(item.key, 'acted')
} })
inbox.registerProducer({ id: 'derived', subjectType: 'record', derive: (ref) => [{ key: ref, kind: 'review', title: 'Review result' }] })
// @ts-expect-error only concrete blocking tiers are accepted
const badTier: RaiseInput = { ...input, blocking: 'urgent' }
// @ts-expect-error title is required
const missingTitle: RaiseInput = { key: 'x', subject: { type: 'record', ref: 'x' }, kind: 'review' }
// @ts-expect-error actions registered through the Host API must be Host actions
inbox.registerAction({ id: 'invalid', side: 'client', async run() {} })
// 004 declares action input as unknown; its concrete validation belongs to the executor.
inbox.act('key', 1, 'record.accept', { callback() {} })
// @ts-expect-error resolution vocabulary is bounded
inbox.withdraw('key', 'silently-dropped')
void badTier; void missingTitle
