/** Adapter example, not enabled by this bundle. A ticket plugin supplies its own repository. */
export function integrateTickets(ctx, tickets) {
  return ctx.inject(['attention'], (scope) => {
    const inbox = scope.attention
    scope.effect(() => inbox.registerSubjectType({
      type: 'ticket',
      describe: (id) => ({ title: tickets.get(id)?.title ?? id }),
      open: () => ({ panelId: 'tickets' }),
    }))
    scope.effect(() => inbox.registerAction({
      id: 'ticket.accept', side: 'host', label: { zh: '验收', en: 'Accept' },
      async run(item) {
        await tickets.accept(item.subject.ref)
        // Success in the repository is the closing fact; clicking the button alone isn't.
        inbox.invalidate('tickets', item.subject.ref)
      },
    }))
    scope.effect(() => inbox.registerProducer({
      id: 'tickets', subjectType: 'ticket',
      derive: (id) => tickets.get(id)?.state === 'ready'
        ? [{ key: 'review', kind: 'review', title: tickets.get(id).title, actions: ['ticket.accept', 'subject.open'] }]
        : [],
    }))
    scope.effect(() => tickets.onChanged((id) => inbox.invalidate('tickets', id)))
    for (const id of tickets.ids()) inbox.invalidate('tickets', id)
  })
}
