window.__ModuleLoader__.load({ id: '@local/attention-acceptance-bridge-v8', factory() {
  return { inject: ['connection', 'layout', 'uiSession', 'sessions'], async apply(ctx) {
    const abort = new AbortController(); ctx.effect(() => () => abort.abort())
    const call = async (payload) => { while (!abort.signal.aborted) { try { return await ctx.connection.rpc.call('/api', 'attentionAcceptance', payload, abort.signal) } catch (error) { if (abort.signal.aborted) throw error; await new Promise(resolve => setTimeout(resolve, 250)) } } abort.signal.throwIfAborted() }
    const frame = () => new Promise((resolve) => { const timer = setTimeout(resolve, 80); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve() })) })
    const execute = async (command) => {
      if (command.op === 'panel') { ctx.layout.selectPanel(command.panelId); await frame(); return { selected: true } }
      if (command.op === 'layout') return ctx.layout.getSnapshot?.() ?? null
      if (command.op === 'diagnostics') return { loaderKeys: Object.keys(window.__ModuleLoader__), plugins: [...(ctx.get('loader')?.entries?.() ?? [])].filter(e=>String(e.options?.name).includes('attention')).map(e=>({name:e.options.name,state:e.fiber?.state,error:String(e.fiber?.error?.message ?? '')})) }
      if (command.op === 'snapshot') {
        await frame()
        const page = document.querySelector('[data-attention-inbox="page"]')
        return { origin: location.origin, knownSessions: Object.keys(ctx.sessions.list.getSnapshot().byId ?? {}).filter(id=>command.sessionIds?.includes(id)), page: Boolean(page), settings: Boolean(page?.querySelector('[data-attention-inbox="settings"]')),
          coverageGap: page?.querySelector('[data-coverage-gap]')?.getAttribute('data-coverage-gap') ?? null,
          size: page ? { width: page.clientWidth, height: page.clientHeight, scrollWidth: page.scrollWidth } : null,
          colors: page ? { text: getComputedStyle(page).color, background: getComputedStyle(page).backgroundColor } : null,
          cards: [...(page?.querySelectorAll('[data-attention-key]') ?? [])].map((card) => ({ key: card.getAttribute('data-attention-key'), buttons: [...card.querySelectorAll('[data-action-id]')].map((b) => ({ id: b.getAttribute('data-action-id'), disabled: b.disabled })), alert: !!card.querySelector('[role="alert"]') })),
          native: [...ctx.uiSession.sessionStatus.getSnapshot()].filter(([id]) => command.sessionIds?.includes(id)).map(([sessionId,s]) => ({sessionId,kind:s.pendingInteraction?.kind,key:s.pendingInteraction?.key,callId:s.pendingInteraction?.callId,state:s.pendingInteraction?.getSnapshot?.().state,mainView:ctx.sessions.list.getSnapshot().byId?.[sessionId]?.retainedBy?.mainView??0})),
        }
      }
      if (command.op === 'click' || command.op === 'input') {
        const page = document.querySelector('[data-attention-inbox="page"]')
        const element = page?.querySelector(command.selector)
        if (!element) throw new Error('Acceptance target absent')
        if (command.op === 'click') { if (element.disabled) throw new Error('Acceptance target disabled'); element.click() }
        else { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,command.value); element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})) }
        await frame(); return { performed: true }
      }
      if (command.op === 'openUrl') { const url = new URL(command.url); if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Only the isolated loopback acceptance server is allowed'); window.open(url.href, 'attention-acceptance-clean'); return { attempted: true } }
      if (command.op === 'reload') { setTimeout(() => location.reload(), 100); return { scheduled: true } }
      throw new Error('Unsupported bounded acceptance command')
    }
    void (async () => {
      await call({ op: 'hello', origin: location.origin }); let result
      while (!abort.signal.aborted) {
        const reply = await call({ op: 'poll', result }); result = undefined
        if (!reply.ok) throw new Error('Acceptance carrier declined')
        if (!reply.value) continue
        try { result = { id: reply.value.id, value: await execute(reply.value) } }
        catch (error) { result = { id: reply.value.id, error: String(error.message).slice(0,200) } }
      }
    })().catch((error) => { if (!abort.signal.aborted) ctx.logger?.warn?.('Acceptance carrier stopped',error.message) })
  } }
} })
