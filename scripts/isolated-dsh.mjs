import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdir,realpath} from 'node:fs/promises'
import {resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)), sandbox=resolve(root,'.acceptance')
const runtime=process.env.DSH_TEST_RUNTIME
if(!runtime)throw Error('Set DSH_TEST_RUNTIME to the read-only SDK package directory')
const args=process.argv.slice(2)
if(args.some(arg=>arg==='--profile'||arg.startsWith('--profile=')||arg==='--home'||arg.startsWith('--home=')))throw Error('The acceptance profile and home cannot be overridden')
await mkdir(sandbox,{recursive:true})
const canonicalSandbox=await realpath(sandbox),home=resolve(sandbox,'isolated-home'),agents=resolve(sandbox,'isolated-agents')
await mkdir(home,{recursive:true});await mkdir(agents,{recursive:true})
if(!(await realpath(home)).startsWith(canonicalSandbox+sep)||!(await realpath(agents)).startsWith(canonicalSandbox+sep))throw Error('Test homes must stay physically inside the project sandbox')
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DSH_')))
Object.assign(env,{DSH_HOME:home,DSH_AGENTS_HOME:agents})
const cliArgs=args[0]==='plugin'?['plugin','--profile','attention-acceptance',...args.slice(1)]:['--profile','attention-acceptance',...args]
const child=spawn(process.execPath,[resolve(runtime,'dsh/lib/bin.js'),...cliArgs],{cwd:root,env,stdio:'inherit'})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))
const [code,signal]=await once(child,'exit');process.exitCode=code??(signal?1:0)
