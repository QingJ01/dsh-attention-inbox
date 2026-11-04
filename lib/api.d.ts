export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Copy = string | { zh: string; en: string }
export interface Subject { type: string; ref: string }
export interface InboxSettings { reviewEnabled: boolean; ledgerRetentionDays: number }
export interface MuteRule { scope: 'session' | 'workspace'; ref: string }
/** Accepted actions only attribute a later native decision/settlement; they never resolve facts. */
export interface NativeActionAck {
  key: string; revision: number; actionId: string; phase: 'attempt' | 'accepted' | 'failed'
  sessionId?: string; kind?: string; callId?: string; requestId?: string; nativeKey?: string
}
export interface SourceNoiseMetric { source: string; kind: string; closed: number; dismissed: number; noiseRate: number; suggestRuleChange: boolean }
export interface RaiseInput {
  key: string; subject: Subject; kind: string; title: string
  blocking?: 'hard' | 'soft' | 'system'; detail?: string; actions?: string[]
  openedAt?: string; deadline?: string; certainty?: 'exact' | 'inferred'
  defaultAction?: { actionId: string; input?: unknown }
  options?: { id: string; label: string; recommended?: boolean }[]
  payload?: Json; audience?: string
}
export interface Obligation extends RaiseInput {
  producer: string; revision: number; blocking: 'hard' | 'soft' | 'system'
  openedAt: string; actions: string[]; certainty: 'exact' | 'inferred'
}
export type Resolution = 'withdrawn' | 'expired' | 'superseded' | 'acted'
export interface AttentionService {
  readonly apiVersion: 1
  getSettings(): InboxSettings
  updateSettings(patch: Partial<InboxSettings>): Promise<InboxSettings>
  mute(scope: MuteRule['scope'], ref: string, remove?: boolean): Promise<void>
  nativeAction(ack: NativeActionAck): Promise<void>
  /** The Cordis service infers an omitted producer from the calling plugin and cleans up on unload. */
  raise(input: RaiseInput, producer?: string): Promise<Obligation>
  withdraw(key: string, resolution?: Resolution): Promise<void>
  list(query?: { kinds?: string[]; subjectType?: string; includeSnoozed?: boolean }): Obligation[]
  watch(signal?: AbortSignal): AsyncIterable<object>
  registerProducer(def: { id: string; subjectType: string; derive(ref: string): Omit<RaiseInput, 'subject'>[] }): () => void
  invalidate(producerId: string, ref: string): void
  registerSubjectType(def: { type: string; describe?(ref: string): { title: string; subtitle?: string; icon?: string } | undefined; open?(ref: string): { route: string } | { panelId: string } | { url: string } }): () => void
  registerKind(def: { id: string; blocking: Obligation['blocking']; rank?: number; label?: Copy }): () => void
  registerAction(def: { id: string; label?: Copy; confirm?: 'none' | 'destructive' } & ({ side: 'host'; run(item: Obligation, input: unknown, signal: AbortSignal): Promise<void> } | { side: 'client'; run?: never })): () => void
  registerChannel(def: { id: string; select?(item: Obligation): boolean; deliver(item: Obligation, signal: AbortSignal): Promise<void>; retract?(item: Obligation, resolution: Resolution): Promise<void> }): () => void
  registerFilter(def: { id: string; layer?: 'classify' | 'merge' | 'present'; apply(item: Obligation, context: { now: string }): 'keep' | 'drop' }): () => void
  act(key: string, revision: number, actionId: string, input?: unknown, via?: string, signal?: AbortSignal): Promise<{ accepted: true }>
  dispose(key: string, revision: number, disposition: { kind: 'dismissed' } | { kind: 'snoozed'; until: string }): Promise<void>
}
export interface AttentionClientService {
  readonly apiVersion: 1
  registerAction(def: { id: string; confirm?: 'none' | 'destructive'; run(item: Obligation, input: unknown, signal: AbortSignal): Promise<void> }): () => void
}
export function normalizeObligation(input: RaiseInput, producer: string, registry?: object): { ok: true; obligation: Obligation } | { ok: false; code: string; message: string }
export function compareObligations(a: Obligation, b: Obligation, registry?: object): number
export function buildView(items: Obligation[], options?: object): { items: Obligation[]; badge: number; total: number; groups: { id: string; items: Obligation[] }[] }
export function reconcile(previous: Obligation[], drafts: Obligation[], at: string): { open: Obligation[]; changed: Obligation[]; withdrawn: Obligation[] }
export function obligationsEqual(a: Obligation, b: Obligation): boolean
