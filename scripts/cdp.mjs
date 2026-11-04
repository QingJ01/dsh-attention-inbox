import { once } from 'node:events'

/** Connect only to the documented, already-running local DSH Inspector. No browser launch or profile access. */
export async function connectInspector(base = 'http://127.0.0.1:9230') {
  const parsed = new URL(base)
  if (parsed.hostname !== '127.0.0.1') throw new Error('Inspector must be loopback')
  const targets = await (await fetch(new URL('/json/list', base))).json()
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl)
  await once(socket, 'open')
  let id = 0
  const pending = new Map(), contexts = new Map(), consoleErrors = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id); clearTimeout(item.timer)
      if (message.error) item.reject(new Error(JSON.stringify(message.error)))
      else item.resolve(message.result)
    } else if (message.method === 'Runtime.executionContextCreated') contexts.set(message.params.context.id, message.params.context)
    else if (message.method === 'Runtime.executionContextDestroyed') contexts.delete(message.params.executionContextId)
    else if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id
    const timer = setTimeout(() => { pending.delete(callId); reject(new Error(`Timed out: ${method}`)) }, 20000)
    pending.set(callId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: callId, method, params }))
  })
  await send('Runtime.enable')
  return {
    contexts, consoleErrors, send,
    async rootCall(functionDeclaration) {
      const tree = await send('DOM.getDocument', { depth: 2 })
      const host = tree.root.children.find((node) => node.localName === 'host')
      const node = host?.children?.find((node) => node.localName === 'context')
      if (!node) throw new Error('Live Host Context not found')
      const { object } = await send('DOM.resolveNode', { nodeId: node.nodeId })
      const result = await send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.result?.description ?? ''))
      return result.result?.value
    },
    async evaluate(expression, contextId) {
      const result = await send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.result?.description ?? ''))
      return result.result?.value
    },
    close() { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Inspector closed')) } pending.clear(); socket.close() },
  }
}
