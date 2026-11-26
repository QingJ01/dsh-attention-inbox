import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { connectInspector } from './cdp.mjs'
const report=JSON.parse(await fs.readFile('.acceptance/browser-report.json','utf8'))
if(!report.cleanup||report.cleanup.liveFixtureIds.length||report.cleanup.errors.length)throw Error('Fixture ownership has not been released')
const allowedRoots=[await fs.realpath('.acceptance')]
const ids=report.cleanup.persistedFixtureIdsToRemove ?? []
if(!ids.every(id=>/^attention-acceptance-[a-f0-9-]{36}$/.test(id)))throw Error('Unexpected fixture id in cleanup receipt')
const c=await connectInspector(process.env.DSH_TEST_INSPECTOR ?? 'http://127.0.0.1:9230')
let locations
try { locations=await c.rootCall(`async function(){const p=this.get('sessionPersistence'),out=[];for(const id of ${JSON.stringify(ids)}){const stat=await p.stat(id);if(stat?.header?.id===id)out.push({id,...p.locate(stat.header)});if(this.get('agents').get(id))throw Error('Fixture agent still live')}const a=this.get('attention'),engine=a?.engine??a;if(engine){for(const id of ${JSON.stringify(ids)})for(const producer of ['builtin-session','builtin-approval','builtin-question','builtin-plan'])engine.invalidateDerived(producer,id,[]);await engine.queue;await engine.transact(state=>{state.ledger=state.ledger.filter(row=>!${JSON.stringify(ids)}.includes(row.subject?.ref));for(const key of Object.keys(state.observations??{}))if(${JSON.stringify(ids)}.some(id=>key.startsWith(id+':')))delete state.observations[key];for(const key of Object.keys(state.dispositions))if(${JSON.stringify(ids)}.some(id=>key.includes(':session:'+encodeURIComponent(id)+':')))delete state.dispositions[key]});for(const id of ${JSON.stringify(ids)})engine.sessionFacts.delete(id)}return out}`) }
finally { c.close() }
for(const item of [...(report.cleanup.artifactLocations??[]),...locations]) {
  if(!/^attention-acceptance-[a-f0-9-]{36}$/.test(item.id))throw Error('Not a uniquely owned fixture id')
  const candidate=path.dirname(item.path)
  let target
  try{target=await fs.realpath(candidate)}catch(error){if(error.code==='ENOENT')continue;throw error}
  if(target!==path.resolve(candidate)||!allowedRoots.some(root=>target.startsWith(root+path.sep))||path.basename(target)!==item.id)throw Error('Unexpected cleanup target')
  console.log('Verified closed, owned fixture artifact:',item.id)
  await fs.rm(target,{recursive:true})
}
