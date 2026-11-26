export async function dismissNativeStartup(page){
 let changed=false
 for(let i=0;i<3;i++){
  const dialog=page.getByRole('dialog').first()
  if(!await dialog.isVisible())break
  const text=await dialog.innerText()
  if(/预览版说明|Preview version/i.test(text))await dialog.getByRole('button',{name:/^(继续|Continue)$/}).click()
  else if(/开始使用|Get started/i.test(text))await dialog.getByRole('button',{name:/关闭|close/i}).click()
  else break
  changed=true
  await page.waitForTimeout(100)
 }
 return changed
}
export async function performIsolatedInput(page,command){
 if(new URL(page.url()).origin!==process.env.DSH_TEST_WEB_ORIGIN)throw Error('Refusing input outside the isolated GUI')
 const matches=page.locator('[data-attention-inbox="page"]').locator(command.selector)
 const element=command.index===undefined?matches:matches.nth(command.index)
 const perform=async()=>{
  if(command.op==='click'){if(await element.isDisabled())throw Error('Acceptance target disabled');await element.click({timeout:5000})}
  else await element.fill(command.value,{timeout:5000})
 }
 await dismissNativeStartup(page)
 try{await perform()}catch(error){if(!await dismissNativeStartup(page))throw error;await perform()}
 return {performed:true}
}
