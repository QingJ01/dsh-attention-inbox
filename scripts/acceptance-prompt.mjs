import {connectInspector} from './cdp.mjs'
import {writeFile} from 'node:fs/promises'
const id=process.env.DSH_TEST_SESSION
const phase=process.argv[2]
if(!id||!['before','after'].includes(phase))throw Error('Pass before|after and the explicitly authorized live DSH_TEST_SESSION')
const c=await connectInspector()
try {
 const result=await c.rootCall(`async function(){
  const agent=this.get('agents').get(${JSON.stringify(id)})
  if(!agent)throw Error('Authorized live agent not found')
  const assembly=await agent.loopCtx.systemPrompt.assemble({agent,scope:agent})
  const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)
  const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))).toString('hex')
  return {sectionCount:assembly.sections.length,toolCount:assembly.tools.length,sectionsHash:await hash(assembly.sections),toolsHash:await hash(assembly.tools),contexts:await Promise.all(assembly.contexts.map(async c=>({name:c.name,hash:await hash(c)})))}
 }`)
 await writeFile(`.acceptance/prompt-${phase}.json`,JSON.stringify(result,null,2)+'\n')
 console.log({phase,sectionCount:result.sectionCount,toolCount:result.toolCount,sectionsHash:result.sectionsHash,toolsHash:result.toolsHash})
} finally {c.close()}
