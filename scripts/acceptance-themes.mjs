import {connectInspector} from './cdp.mjs'
import {writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const c=await connectInspector(process.env.DSH_TEST_INSPECTOR??'http://127.0.0.1:9231')
const clientId=[...c.contexts.values()].find(x=>x.name.startsWith('Client'))?.id
if(clientId===undefined)throw Error('An actual attached browser is required')
const preference=await c.clientCall(`function(){return this.get('theme').getTheme().preference}`)
const report={target:'isolated fresh DSH; actual attached HTTP browser',themes:[]}
try{
 await c.clientCall(`function(){this.get('layout').selectPanel('conversation');return true}`)
 await c.clientCall(`function(){this.get('layout').selectPanel('attention-inbox');return true}`)
 for(const mode of ['light','dark']){
  await c.clientCall(`function(){this.get('theme').setTheme(${JSON.stringify(mode)});return true}`)
  const view=await c.evaluate(`(()=>{const p=document.querySelector('[data-attention-inbox="page"]');return {page:!!p,text:getComputedStyle(p).color,background:getComputedStyle(p).backgroundColor,width:p.clientWidth,scrollWidth:p.scrollWidth}})()`,clientId)
  assert.ok(view.page);assert.equal(view.width,view.scrollWidth);report.themes.push({mode,...view})
 }
 assert.notEqual(report.themes[0].background,report.themes[1].background)
 console.log(JSON.stringify(report))
}finally{await c.clientCall(`function(){this.get('theme').setTheme(${JSON.stringify(preference)});return true}`).catch(()=>{});await writeFile('.acceptance/themes-report.json',JSON.stringify(report,null,2)+'\n');c.close()}
