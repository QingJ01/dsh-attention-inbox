// Isolated visual review only: real DSH page in a temporary browser profile, real native fixtures.
import {connectInspector} from './cdp.mjs'
import {dismissNativeStartup} from './browser-actions.mjs'
import {mkdtemp,realpath,rm,mkdir} from 'node:fs/promises'
import {resolve,basename,sep} from 'node:path'
const {chromium}=await import('../.acceptance/browser-tools/node_modules/playwright-core/index.mjs')
const out=resolve(process.env.DSH_SCREEN_DIR??'.acceptance/screens');await mkdir(out,{recursive:true})
const tag=process.env.DSH_SCREEN_TAG??'current'
const c=await connectInspector()
const profile=await mkdtemp(resolve('.acceptance/browser-run-'))
const bridge=v=>c.rootCall(`function(){return this.get('attentionAcceptanceBridge').command(${JSON.stringify(v)})}`)
const fx=(m,a)=>c.rootCall(`function(){return this.get('attentionAcceptanceFixtures').${m}(${a===undefined?'':JSON.stringify(a)})}`)
let browser;const ids=[]
try{
 const url=await c.rootCall(`function(){return this.get('connection').authenticatedUrl(this.get('webApp').getAdvertisedUrl())}`)
 browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.DSH_TEST_CHROME,headless:true,viewport:{width:1440,height:900},deviceScaleFactor:2})
 const page=browser.pages()[0]??await browser.newPage()
 const openedAt=Date.now();await page.goto(url,{waitUntil:'domcontentloaded'})
 for(let i=0;i<150;i++){const s=await c.rootCall(`function(){return this.get('attentionAcceptanceBridge').status()}`);if(s.lastSeen>=openedAt)break;await page.waitForTimeout(100)}
 await page.waitForTimeout(800);await dismissNativeStartup(page)
 await bridge({op:'panel',panelId:'attention-inbox'});await page.waitForTimeout(600)
 const shot=async name=>{for(const mode of ['light','dark']){await page.emulateMedia({colorScheme:mode});await page.waitForTimeout(250);await page.screenshot({path:resolve(out,`${tag}-${name}-${mode}.png`)})}await page.emulateMedia({colorScheme:null})}
 await shot('empty')
 if(process.env.DSH_SCREEN_ITEMS!=='0'){
  for(const kind of ['approval-allow','question-open','plan-review']){const r=await fx('start',{kind,cwd:process.env.DSH_TEST_WORKSPACE,deferLaunch:true});ids.push(r.id)}
  for(let i=0;i<100;i++){const v=await bridge({op:'snapshot',sessionIds:ids});if(v.knownSessions.length===ids.length)break;await page.waitForTimeout(100)}
  for(const id of ids)await fx('launch',id)
  for(let i=0;i<150;i++){const v=await bridge({op:'snapshot',sessionIds:ids});if(ids.every(id=>v.cards.some(card=>card.key.includes(id))))break;await page.waitForTimeout(100)}
  await page.waitForTimeout(500);await shot('items')
  if(process.env.DSH_SCREEN_FLOW==='1'){
   const pageRoot=page.locator('[data-attention-inbox="page"]')
   const cards=()=>pageRoot.locator('[data-attention-key]').count()
   // Keyboard: the first (selected) approval is allowed with Enter, like the native panel.
   await page.mouse.click(5,890);await page.keyboard.press('Enter')
   for(let i=0;i<60&&await cards()>2;i++)await page.waitForTimeout(100)
   await page.waitForTimeout(150);await page.screenshot({path:resolve(out,`${tag}-after-allow-light.png`)})
   await pageRoot.locator('label.ai-option').first().click();await page.waitForTimeout(200)
   await page.screenshot({path:resolve(out,`${tag}-option-selected-light.png`)})
   await pageRoot.locator('button[type="submit"][data-action-id="question.answer"]').click()
   for(let i=0;i<60&&await cards()>1;i++)await page.waitForTimeout(100)
   await pageRoot.locator('button.primary[data-action-id="question.answer"]').first().click()
   for(let i=0;i<80&&await cards()>0;i++)await page.waitForTimeout(100)
   await page.waitForTimeout(700);await page.screenshot({path:resolve(out,`${tag}-cleared-light.png`)})
   await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(250);await page.screenshot({path:resolve(out,`${tag}-cleared-dark.png`)});await page.emulateMedia({colorScheme:null})
  }
 }
 console.log(JSON.stringify({out,tag,fixtures:ids.length}))
}finally{
 for(const id of ids)await fx('finish',id).catch(()=>{})
 await browser?.close();c.close()
 const target=await realpath(profile),root=await realpath('.acceptance')
 if(!target.startsWith(root+sep)||!basename(target).startsWith('browser-run-'))throw Error('Unexpected browser cleanup path')
 await rm(target,{recursive:true})
}
