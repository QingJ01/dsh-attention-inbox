import { connectInspector } from './cdp.mjs'
import { writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const c = await connectInspector(process.env.DSH_TEST_INSPECTOR ?? 'http://127.0.0.1:9230')
const invoke = (service, method, arg) => c.rootCall(`function(){return this.get(${JSON.stringify(service)})[${JSON.stringify(method)}](${JSON.stringify(arg)})}`)
const browser = (command) => invoke('attentionAcceptanceBridge', 'command', command)
const waitFor = async (read, predicate, label) => {
  for(let attempt=0;attempt<100;attempt++) { const value=await read();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,100)) }
  throw new Error('Timed out: '+label)
}
const report={capturedAt:new Date().toISOString(),target:'existing Desktop GUI',model:'fixed fixture stream; native Host and Client objects',cases:[],cleanup:null}
let fatal
try {
  await browser({op:'panel',panelId:'attention-inbox'})
  for(const kind of ['approval-allow','approval-reject','question-open','question-continued','plan-review']) {
    const started=await invoke('attentionAcceptanceFixtures','start',{kind,cwd:process.cwd(),deferLaunch:true})
    const {id}=started
    await waitFor(()=>browser({op:'snapshot',sessionIds:[id]}),view=>view.knownSessions?.includes(id),'native sidebar Session retention')
    await invoke('attentionAcceptanceFixtures','launch',id)
    const snapshot=await waitFor(()=>browser({op:'snapshot',sessionIds:[id]}),view=>view.cards.some(card=>card.key.includes(id))&&view.native.some(row=>row.sessionId===id&&row.kind),kind+' native card')
    const native=snapshot.native.find(row=>row.sessionId===id)
    assert.equal(native.mainView,0,'Native interaction must be answerable outside the main Session view')
    assert.equal(snapshot.coverageGap,'0')
    if(kind==='question-continued') await waitFor(()=>invoke('attentionAcceptanceFixtures','status',id),s=>s.questions?.active.some(q=>q.state==='continued'),'native continued state')
    const ready=await waitFor(()=>browser({op:'snapshot',sessionIds:[id]}),view=>view.cards.some(card=>card.key.includes(id)),'current native card after channel transition')
    const card=ready.cards.find(row=>row.key.includes(id))
    const selector=`[data-attention-key=${JSON.stringify(card.key)}]`
    if(kind.startsWith('approval-')) await browser({op:'click',selector:selector+` [data-action-id="approval.${kind==='approval-reject'?'reject':'allow-once'}"]`})
    else if(kind==='plan-review') await browser({op:'click',selector:selector+' [data-action-id="question.answer"][data-option-label]'})
    else {
      await browser({op:'click',selector:selector+' input[type="radio"]'})
      await browser({op:'click',selector:selector+' button[data-action-id="question.answer"]'})
    }
    const final=await waitFor(()=>invoke('attentionAcceptanceFixtures','status',id),s=>s.toolResults.length>0&&!s.running,kind+' native resolution')
    assert.ok(final.toolResults.every(result=>!result.isError),JSON.stringify(final.toolResults))
    if(kind.startsWith('approval-')) assert.equal(final.nativeOutcome,kind==='approval-reject'?'rejected':'allowed-once')
    const settled=await waitFor(()=>browser({op:'snapshot',sessionIds:[id]}),view=>!view.cards.some(row=>row.key.includes(id))&&!view.native.some(row=>row.kind),kind+' shared composer state')
    assert.equal(settled.coverageGap,'0')
    await c.rootCall(`async function(){await this.get('attention').engine.queue}`)
    const confirmed=await invoke('attentionAcceptanceFixtures','status',id)
    const result={kind,mainViewBefore:native.mainView,coverageGap:Number(snapshot.coverageGap),nativeToolSucceeded:true,modelStubCalls:final.modelStubCalls,closedInInbox:true,composerCleared:true,ledger:confirmed.attention?.ledger.map(row=>({kind:row.kind,resolution:row.resolution,via:row.via,nativeConfirmed:row.nativeConfirmed}))??[]}
    report.cases.push(result);console.log(JSON.stringify(result))
    await invoke('attentionAcceptanceFixtures','finish',id)
  }
} catch(error) {fatal=error;report.error=String(error.stack);console.error(error.message)}
finally {
  try { report.cleanup=await c.rootCall(`async function(){const f=this.get('attentionAcceptanceFixtures'),p=this.get('sessionPersistence');const headers=[];for(const id of f.ids()){const s=this.get('sessions').get(id);if(s)headers.push(s.header)}const result=await f.cleanup();return {...result,artifactLocations:headers.map(header=>({id:header.id,...p.locate(header)}))}}`) }
  catch(error){report.cleanupError=String(error.message)}
  await mkdir('.acceptance',{recursive:true});await writeFile('.acceptance/browser-report.json',JSON.stringify(report,null,2)+'\n');c.close()
}
if(fatal)process.exitCode=1
else console.log(JSON.stringify({cases:report.cases.length,successful:report.cases.filter(c=>c.closedInInbox).length,originalsUnchanged:report.cleanup?.originalsUnchanged,workspaceOrderUnchanged:report.cleanup?.workspaceOrderUnchanged,cleanupErrors:report.cleanup?.errors}))
