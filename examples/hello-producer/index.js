/** Opt-in adapter: the caller supplies real records and an awaited subscription. */
export function integrateHello(ctx, source) {
  return ctx.inject(['attention'], (scope) => {
    const inbox = scope.attention, keys = new Map()
    if (inbox.apiVersion !== 1) throw new Error('Unsupported attention API')
    inbox.registerAction({
      id: 'hello.accept', side: 'host', label: { zh: '验收', en: 'Accept' },
      async run(item) {
        await source.accept(item.subject.ref)
        await inbox.withdraw(item.key, 'acted')
        keys.delete(item.subject.ref)
      },
    })
    scope.effect(() => source.subscribe(async (record) => {
      if (record.state === 'ready') {
        const item = await inbox.raise({
          key: 'ready', subject: { type: 'hello-record', ref: record.id },
          kind: 'review', blocking: 'soft', title: record.title,
          actions: ['hello.accept'],
        })
        keys.set(record.id, item.key)
      } else if (keys.has(record.id)) {
        await inbox.withdraw(keys.get(record.id))
        keys.delete(record.id)
      }
    }))
  })
}
