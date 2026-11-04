import { Service } from '@deepseek-ai/cordis'

/** Cordis traces Service.ctx to the consumer; the engine remains usable without Cordis. */
export class ContextualAttentionService extends Service {
  constructor(ctx, engine) {
    super(ctx, 'attention')
    this.engine = engine
    this.owners = new WeakMap()
    this.apiVersion = 1
  }
  owner() {
    const ctx = this.ctx, fiber = ctx.fiber
    let owner = this.owners.get(fiber)
    if (owner) {
      if (!owner.active) throw new Error('CALLER_UNLOADED')
      fiber.assertActive()
      return owner
    }
    owner = { id: fiber, producer: fiber.name, active: true, pending: new Set(), keys: new Set() }
    ctx.effect(() => async () => {
      owner.active = false
      await Promise.allSettled([...owner.pending])
      for (const key of owner.keys) if (this.engine.externalOwners.get(key) === owner.id) await this.engine.withdraw(key)
      await this.engine.queue
    }, 'attention: caller obligations')
    this.owners.set(fiber, owner)
    return owner
  }
  raise(input, producer) {
    const owner = this.owner()
    const task = this.engine.raise(input, producer ?? owner.producer, owner.id).then(async (item) => {
      owner.keys.add(item.key)
      if (!owner.active) await this.engine.withdraw(item.key)
      return item
    })
    owner.pending.add(task)
    void task.finally(() => owner.pending.delete(task)).catch(() => {})
    return task
  }
  registerProducer(def) {
    const owner = this.owner()
    return this.ctx.effect(() => this.engine.registerProducer(def, owner.id), 'attention: producer')
  }
}

for (const method of ['registerSubjectType', 'registerKind', 'registerAction', 'registerChannel', 'registerFilter']) {
  Object.defineProperty(ContextualAttentionService.prototype, method, { value: function (definition) {
    return this.ctx.effect(() => this.engine[method](definition), `attention: ${method}`)
  } })
}
for (const method of ['withdraw', 'invalidate', 'list', 'watch', 'act', 'dispose', 'getSettings', 'updateSettings', 'mute', 'nativeAction', 'snapshot', 'raw', 'find']) {
  Object.defineProperty(ContextualAttentionService.prototype, method, { value: function (...args) {
    return this.engine[method](...args)
  } })
}
