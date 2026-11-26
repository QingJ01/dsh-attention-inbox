import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {connectInspector} from '../scripts/cdp.mjs'
const keys=['DSH_TEST_INSPECTOR','DSH_TEST_HOME','DSH_TEST_WEB_ORIGIN']
async function environment(values,run){const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys){if(values[key]===undefined)delete process.env[key];else process.env[key]=values[key]}try{return await run()}finally{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key]}}}
function forbidNetwork(t){let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw Error('Must not connect')});return()=>assert.equal(calls,0)}
test('acceptance never defaults to the active Harness Inspector',async t=>{const verify=forbidNetwork(t);await environment({},()=>assert.rejects(connectInspector(),/Explicit isolated/));verify()})
test('acceptance rejects a home outside the project before connecting',async t=>{const verify=forbidNetwork(t);await environment({DSH_TEST_INSPECTOR:'http://127.0.0.1:19231',DSH_TEST_HOME:resolve('..'),DSH_TEST_WEB_ORIGIN:'http://127.0.0.1:54081'},()=>assert.rejects(connectInspector(),/inside this project/));verify()})
test('acceptance refuses the production Inspector port even with a test home',async t=>{const verify=forbidNetwork(t);await environment({DSH_TEST_INSPECTOR:'http://127.0.0.1:9230',DSH_TEST_HOME:resolve('.acceptance/isolated-home'),DSH_TEST_WEB_ORIGIN:'http://127.0.0.1:54081'},()=>assert.rejects(connectInspector(),/isolated loopback test ports/));verify()})
