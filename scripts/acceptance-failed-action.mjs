import assert from 'node:assert/strict'
import {performIsolatedInput} from './browser-actions.mjs'
import {writeFile} from 'node:fs/promises'
export async function failedActionAcceptance(page,c){
 let key
 try{
  key=await c.rootCall(`async function(){
   await this.plugin({name:'isolated-action-fixture',inject:['attention'],async apply(scope){
    let attempts=0;const api=scope.attention
    api.registerSubjectType({type:'isolated-check',describe:()=>({title:'Isolated validation source'})})
    api.registerKind({id:'isolated-hard',blocking:'hard',label:'Isolated validation'})
    api.registerAction({id:'isolated.retry',label:'Retry validation',side:'host',async run(item){attempts++;if(attempts===1)throw Error('Expected isolated action failure');await api.withdraw(item.key,'acted')}})
    const item=await api.raise({key:'failure',kind:'isolated-hard',subject:{type:'isolated-check',ref:'validation'},title:'Isolated validation needs attention',actions:['isolated.retry']})
    scope.provide('isolatedActionFixture',{key:item.key,status:()=>({attempts,open:api.list().some(row=>row.key===item.key)}),cleanup:()=>scope.fiber.dispose()})
   }})
   return this.get('isolatedActionFixture').key
  }`)
  const card=page.locator(`[data-attention-key=${JSON.stringify(key)}]`)
  await card.waitFor({state:'visible',timeout:15000})
  await page.keyboard.press('Escape')
  await performIsolatedInput(page,{op:'click',selector:`[data-attention-key=${JSON.stringify(key)}] [data-action-id="isolated.retry"]`})
  await card.getByText(/操作未完成|The action did not complete/).waitFor({state:'visible',timeout:10000})
  assert.equal(await card.isVisible(),true)
  assert.deepEqual(await c.rootCall(`function(){return this.get('isolatedActionFixture').status()}`),{attempts:1,open:true})
  await performIsolatedInput(page,{op:'click',selector:`[data-attention-key=${JSON.stringify(key)}] [data-action-id="isolated.retry"]`})
  await card.waitFor({state:'detached',timeout:10000})
  assert.deepEqual(await c.rootCall(`function(){return this.get('isolatedActionFixture').status()}`),{attempts:2,open:false})
  const proof={target:'isolated real DSH page',failedActionShowsError:true,hardItemRemainsOnFailure:true,retrySucceeds:true}
  await writeFile('.acceptance/failed-action-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(proof)
 }catch(error){console.log('Isolated overlay diagnostics',await page.locator('[role="dialog"],[role="presentation"]').evaluateAll(nodes=>nodes.map(node=>({role:node.getAttribute('role'),text:node.textContent?.slice(0,1500),buttons:[...node.querySelectorAll('button')].map(button=>button.textContent)}))));throw error}
 finally{await c.rootCall(`async function(){await this.get('isolatedActionFixture')?.cleanup()}`).catch(()=>{})}
}
