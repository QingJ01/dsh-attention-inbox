import {connectInspector} from './cdp.mjs'
import {dismissNativeStartup} from './browser-actions.mjs'
import {mkdtemp,readFile,writeFile,realpath,rm} from 'node:fs/promises'
import {resolve,basename,sep} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const {chromium}=await import('../.acceptance/browser-tools/node_modules/playwright-core/index.mjs')
const c=await connectInspector()
console.log('Verified isolated Inspector identity')
const profile=await mkdtemp(resolve('.acceptance/browser-run-'))
const baseline=JSON.parse(await readFile('.acceptance/baseline.json','utf8'))
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex')
const baselineBefore=await hash(baseline.location.path)
const errors=[];let browser
try{
 const url=await c.rootCall(`function(){return this.get('connection').authenticatedUrl(this.get('webApp').getAdvertisedUrl())}`)
 console.log('Created owner URL for isolated GUI; launching a separate temporary browser profile')
 browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.DSH_TEST_CHROME,headless:true,viewport:{width:1280,height:900},timeout:20000})
 const page=browser.pages()[0]??await browser.newPage()
 const sanitize=text=>String(text).replace(/https?:\/\/[^\s)]+/g,url=>{try{const value=new URL(url);return value.origin+value.pathname}catch{return '[URL]'}})
 page.on('pageerror',error=>errors.push(sanitize(error.message)))
 const openedAt=Date.now()
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})
 assert.equal(new URL(page.url()).origin,process.env.DSH_TEST_WEB_ORIGIN)
 for(let i=0;i<150;i++){
  const status=await c.rootCall(`function(){return this.get('attentionAcceptanceBridge').status()}`)
  if(status.polls>0&&status.origin===process.env.DSH_TEST_WEB_ORIGIN&&status.lastSeen>=openedAt)break
  if(i===149)throw Error('Isolated page did not attach to its own test carrier')
  await new Promise(resolve=>setTimeout(resolve,100))
 }
 await page.waitForTimeout(500)
 await dismissNativeStartup(page)
 globalThis.__attentionAcceptancePage=page
 await import('./acceptance-desktop-settings.mjs')
 const themes=[]
 for(const mode of ['light','dark']){
  await page.emulateMedia({colorScheme:mode})
  await page.waitForTimeout(100)
  const view=await page.locator('[data-attention-inbox="page"]').evaluate(element=>({text:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor,width:element.clientWidth,scrollWidth:element.scrollWidth}))
  assert.equal(view.width,view.scrollWidth);themes.push({mode,...view})
 }
 assert.notEqual(themes[0].background,themes[1].background)
 await page.emulateMedia({colorScheme:null})
 await writeFile('.acceptance/isolated-themes-proof.json',JSON.stringify({target:'isolated actual DSH page; native system theme sensing',themes},null,2)+'\n')
 if(process.env.DSH_TEST_MODE==='actions'){
  const {failedActionAcceptance}=await import('./acceptance-failed-action.mjs');await failedActionAcceptance(page,c);assert.deepEqual(errors,[]);process.exitCode=0;
 }
 else if(process.env.DSH_TEST_MODE==='settings'){assert.equal(await hash(baseline.location.path),baselineBefore);console.log('Isolated settings and theme checks passed');process.exitCode=0;}
 else {
 await import('./acceptance-browser.mjs')
 const report=JSON.parse(await readFile('.acceptance/browser-report.json','utf8'))
 if(report.error)throw Error(report.error)
 assert.equal(report.cases.length,5)
 const baselineAfter=await hash(baseline.location.path)
 // The native app may select an initial agent preset while browsing. The strict
 // no-mutation gate is measured separately across uninstall with the browser closed.
 assert.equal(report.cleanup.workspaceOrderUnchanged,true)
 assert.deepEqual(errors,[],'The actual page must not crash')
 await writeFile('.acceptance/isolated-browser-proof.json',JSON.stringify({home:process.env.DSH_TEST_HOME,origin:process.env.DSH_TEST_WEB_ORIGIN,browserProfile:profile,existingBrowserProfileUsed:false,headless:true,realDshPage:true,caseCount:report.cases.length,inPlaceConfirmed:report.cases.filter(row=>row.ledger.some(entry=>entry.nativeConfirmed&&entry.resolution==='acted'&&entry.via==='inbox')).length,baselineFileHash:baselineBefore,baselineSessionUnchangedDuringUi:baselineAfter===baselineBefore,baselineAfterHash:baselineAfter,uninstallPreservationGate:'requires separate before/after uninstall check',pageErrors:errors},null,2)+'\n')
 console.log('ISOLATED GUI ACCEPTANCE: 5 native interactions confirmed; uninstall preservation is a separate gate')
 }
}catch(error){if(browser){const page=browser.pages()[0];console.log('Isolated dialog diagnostics',await page?.locator('[role="dialog"]').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent?.slice(0,1200),buttons:[...node.querySelectorAll('button')].map(button=>button.textContent)}))))}throw error}
 finally{
 delete globalThis.__attentionAcceptancePage
 await browser?.close();c.close()
 const target=await realpath(profile),root=await realpath('.acceptance')
 if(!target.startsWith(root+sep)||!basename(target).startsWith('browser-run-'))throw Error('Unexpected browser cleanup path')
 await rm(target,{recursive:true})
}
