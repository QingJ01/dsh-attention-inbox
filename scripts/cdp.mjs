import { once } from 'node:events'
import { resolve, sep } from 'node:path'

/** Test-only: require an explicit project-local DSH home and verify it before exposing any commands. */
export async function connectInspector(base = process.env.DSH_TEST_INSPECTOR) {
  const home = process.env.DSH_TEST_HOME, webOrigin = process.env.DSH_TEST_WEB_ORIGIN
  if (!base || !home || !webOrigin) throw new Error('Explicit isolated DSH_TEST_INSPECTOR, DSH_TEST_HOME and DSH_TEST_WEB_ORIGIN are required')
  const expectedHome = resolve(home), allowedRoot = resolve('.acceptance') + sep
  if (!expectedHome.startsWith(allowedRoot)) throw new Error('Test DSH home must be inside this project .acceptance directory')
  const parsed = new URL(base), expectedWeb = new URL(webOrigin)
  if (parsed.hostname !== '127.0.0.1' || parsed.protocol !== 'http:' || parsed.port === '9230' || expectedWeb.hostname !== '127.0.0.1' || expectedWeb.protocol !== 'http:') throw new Error('Only explicit isolated loopback test ports are allowed')
  if (process.env.DSH_WEB_URL && new URL(process.env.DSH_WEB_URL).origin === expectedWeb.origin) throw new Error('Refusing to test the current Harness GUI')
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
  const hostContext = [...contexts.values()].find(context => context.name === 'Host')
  const identity = await send('Runtime.evaluate', { expression: 'process.env.DSH_HOME', contextId: hostContext?.id, returnByValue: true })
  if (typeof identity.result?.value !== 'string' || resolve(identity.result.value) !== expectedHome) {
    socket.close()
    throw new Error('Inspector does not belong to the isolated test DSH home; refusing access')
  }
  let callGroup = 0
  const callValue = async (objectId, functionDeclaration) => {
    const group = `attention-isolated-call-${++callGroup}`
    try {
      let result = await send('Runtime.callFunctionOn', { objectId, functionDeclaration, objectGroup: group, awaitPromise: false, returnByValue: false })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.result?.description ?? ''))
      if (result.result?.subtype === 'promise') result = await send('Runtime.awaitPromise', { promiseObjectId: result.result.objectId, returnByValue: true })
      else if (result.result?.objectId) result = await send('Runtime.callFunctionOn', { objectId: result.result.objectId, functionDeclaration: 'function(){return this}', awaitPromise: false, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.result?.description ?? ''))
      return result.result?.value
    } finally { await send('Runtime.releaseObjectGroup', { objectGroup: group }).catch(() => {}) }
  }
  const api = {
    contexts, consoleErrors, send,
    async rootCall(functionDeclaration) {
      const tree = await send('DOM.getDocument', { depth: 2 })
      const host = tree.root.children.find((node) => node.localName === 'host')
      const node = host?.children?.find((node) => node.localName === 'context')
      if (!node) throw new Error('Live Host Context not found')
      const { object } = await send('DOM.resolveNode', { nodeId: node.nodeId })
      return callValue(object.objectId, functionDeclaration)
    },
    async clientCall(functionDeclaration) {
      const tree = await send('DOM.getDocument', { depth: 3 })
      const clients = tree.root.children.find((node) => node.localName === 'clients')
      const node = clients?.children?.[0]?.children?.find((node) => node.localName === 'context')
      if (!node) throw new Error('Live Client Context not found')
      const { object } = await send('DOM.resolveNode', { nodeId: node.nodeId })
      return callValue(object.objectId, functionDeclaration)
    },
    async evaluate(expression, contextId, awaitPromise = false) {
      const result = await send('Runtime.evaluate', { expression, contextId, awaitPromise, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.result?.description ?? ''))
      return result.result?.value
    },
    close() { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Inspector closed')) } pending.clear(); socket.close() },
  }
  try {
    const actualWeb = await api.rootCall(`function(){return this.get('webApp').getAdvertisedUrl()}`)
    if (new URL(actualWeb).origin !== expectedWeb.origin) throw new Error('Inspector does not belong to the explicitly selected test GUI')
  } catch (error) { api.close(); throw error }
  return api
}
