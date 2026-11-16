// Scripted visual-action transport load. Human observations are required for acceptance.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const origin=process.argv[2]||'http://127.0.0.1:8741';
const seconds=Number(process.argv[3]||120);
if(!Number.isFinite(seconds)||seconds<1||seconds>1800)throw Error('Duration must be 1–1800 seconds');
const client=new Client({name:'still-concurrency-demo',version:'0.1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('src/mcp.js')],env:process.env}));
let calls=0;let rounds=0;let observationRetries=0;let lastShot;let opened=false;
async function call(op,args={}){const r=await client.callTool({name:'lane_'+op,arguments:args});calls++;if(r.isError)throw Error(r.content[0].text);return r;}
async function shot(){
  for(let attempt=0;attempt<8;attempt++){
    try{const r=await call('screenshot');lastShot=r;return JSON.parse(r.content[1].text).frame;}
    catch(e){if(attempt===7 || !/Not attached to an active page/.test(e.message))throw e;observationRetries++;await delay(150);}
  }
}
async function act(op,args){return call(op,{...args,frame:await shot()});}
const started=Date.now();
try {
  await call('open',{url:origin+'/task'});opened=true;
  do {
    if(rounds)await call('navigate',{url:origin+'/task'});
    // Allow network/paint to settle; screenshot observations remain required.
    await delay(250);
    await act('click',{x:150,y:215});await act('type',{text:'concurrent round '+rounds});
    await act('click',{x:110,y:282});await act('click',{x:117,y:370});
    await act('scroll',{x:720,y:530,deltaX:0,deltaY:1100});await delay(100);
    await act('scroll',{x:720,y:530,deltaX:0,deltaY:-1100});await delay(100);
    await act('click',{x:130,y:427});await shot();
    rounds++;
    if(rounds%10===0)console.log(JSON.stringify({rounds,calls,elapsedSeconds:Math.round((Date.now()-started)/1000)}));
  }while(Date.now()-started<seconds*1000);
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/concurrency-final.png',Buffer.from(lastShot.content[0].data,'base64'));
  const report={elapsedSeconds:(Date.now()-started)/1000,rounds,calls,completed:true,observationRetries,physicalHumanIndependence:'requires human observation',workflowInterpretation:'fixed-coordinate scripted load; visually inspect final screenshot'};
  await writeFile('artifacts/concurrency-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){await mkdir('artifacts',{recursive:true});await writeFile('artifacts/concurrency-failure.json',JSON.stringify({message:e.message,rounds,calls,observationRetries,elapsedSeconds:(Date.now()-started)/1000},null,2));throw e;}finally{if(opened)await call('close').catch(()=>{});await client.close();}
