import { writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { connectInspector } from './cdp.mjs'
const ids = process.argv.slice(2)
if (!ids.length || ids.length > 10) throw new Error('Pass 1–10 explicitly authorized Session ids; no default or history scan is performed')
const c = await connectInspector()
try {
  // Filtering happens inside the already-running Host: no user messages/tool payloads cross CDP.
  const sessions = await c.rootCall(`async function(){
    const query = this.get('sessionQuery'), output = []
    const ids = ${JSON.stringify(ids)}
    for(let index=0;index<ids.length;index++) {
      const log = await query.readSession(ids[index]), goals = new Map()
      const alias=(id)=>{if(!goals.has(id))goals.set(id,'g'+(goals.size+1));return goals.get(id)}
      output.push({id:'s'+(index+1),origin:log.session.origin ?? 'user',events:log.events.map(event=>{
        const data={},raw=event.data??{}
        if(event.type==='user/message'&&typeof raw.source?.kind==='string') data.source={kind:raw.source.kind}
        if(['turn/start','turn/end'].includes(event.type)&&typeof raw.turn==='number')data.turn=raw.turn
        if(event.type==='turn/end'&&typeof raw.reason?.kind==='string')data.reason={kind:raw.reason.kind}
        if(event.type==='goal/change'){
          if(raw.goal){data.goal={id:alias(raw.goal.id),revision:raw.goal.revision,phase:raw.goal.phase,objective:'[redacted]',maxGoalRounds:raw.goal.maxGoalRounds};if(raw.goal.blockedReason)data.goal.blockedReason={code:'redacted',message:'[redacted]'}}
          else data.goal=null
        }
        return {type:event.type,seq:event.seq,time:event.time,data}
      })})
    }
    return output
  }`)
  const document = { provenance: { capturedAt: new Date().toISOString(), capture: 'Existing DSH Inspector -> live-preferred sessionQuery.readSession; source-filtered structural events only', aliases: ids.map((id,i)=>({alias:'s'+(i+1),sourceIdSha256:createHash('sha256').update(id).digest('hex')})), redactions: ['all text, tool arguments/results and non-whitelisted event data removed', 'goal ids mapped per session; objectives and blocker messages replaced with [redacted]'] }, sessions }
  await mkdir('tests/fixtures',{recursive:true})
  await writeFile('tests/fixtures/real-session-structure.json',JSON.stringify(document,null,2)+'\n')
  console.log(JSON.stringify({sessions:sessions.map(s=>({id:s.id,events:s.events.length,turnEnds:s.events.filter(e=>e.type==='turn/end').length})),sha256:createHash('sha256').update(JSON.stringify(document)).digest('hex')}))
} finally { c.close() }
