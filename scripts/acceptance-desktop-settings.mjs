import {connectInspector} from './cdp.mjs'
import {performIsolatedInput} from './browser-actions.mjs'
import {writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const c=await connectInspector()
const command=async(value)=>{
 const page=globalThis.__attentionAcceptancePage
 if(page&&['click','input'].includes(value.op)){
  return performIsolatedInput(page,value)
 }
 return c.rootCall(`function(){return this.get('attentionAcceptanceBridge').command(${JSON.stringify(value)})}`)
}
const settings=()=>c.rootCall(`function(){return this.get('attention').getSettings()}`)
const before=await settings(),report={target:'isolated DSH GUI through its native carrier',checks:[]}
const wait=async(key,value)=>{for(let i=0;i<100;i++){if((await settings())[key]===value)return;await new Promise(r=>setTimeout(r,100))}throw Error('Host setting not acknowledged: '+key)}
const click=(id)=>command({op:'click',selector:`[data-action-id="${id}"]`})
const input=(value)=>command({op:'input',selector:'[data-setting-key="ledgerRetentionDays"]',value})
try{
 await command({op:'panel',panelId:'attention-inbox'})
 const initial=await command({op:'snapshot',sessionIds:[]})
 if(initial.settings)await click('settings.back')
 await click('settings.open');assert.equal((await command({op:'snapshot',sessionIds:[]})).settings,true)
 await command({op:'click',selector:'[data-setting-key="reviewEnabled"]'});await wait('reviewEnabled',!before.reviewEnabled);report.checks.push('review toggle acknowledged')
 await command({op:'click',selector:'[data-setting-key="reviewEnabled"]'});await wait('reviewEnabled',before.reviewEnabled)
 await input('0');await assert.rejects(click('settings.save'),/disabled/);report.checks.push('invalid retention prevents submit')
 await input('121');await click('settings.save');await wait('ledgerRetentionDays',121);report.checks.push('valid retention persisted by real form')
 await input(String(before.ledgerRetentionDays));await click('settings.save');await wait('ledgerRetentionDays',before.ledgerRetentionDays)
 assert.deepEqual(await settings(),before);report.restored=true
 console.log(JSON.stringify(report))
}finally{
 await c.rootCall(`function(){return this.get('attention').updateSettings(${JSON.stringify(before)})}`).catch(()=>{})
 await click('settings.back').catch(()=>{})
 await writeFile('.acceptance/desktop-settings-report.json',JSON.stringify(report,null,2)+'\n');c.close()
}
