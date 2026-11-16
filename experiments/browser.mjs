import {chromium} from 'playwright';
import {mkdtemp,rm,mkdir,writeFile,cp,appendFile,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

// Synthetic session values remain local; never accesses a real profile.
const fixture = `<!doctype html><style>body{margin:0;font:24px system-ui}input{position:absolute;left:40px;top:60px;width:320px;height:40px}button{position:absolute;left:40px;top:140px;width:180px;height:50px}canvas{position:absolute;top:250px}#result{position:absolute;top:210px}#long{height:2500px}</style><input aria-label="Text"><button onclick="document.querySelector('#result').textContent='Saved '+document.querySelector('input').value">Save</button><div id="result"></div><canvas width="300" height="150"></canvas><div id="long"></div><script>window.trusted=[];for(const t of ['click','keydown','input','wheel'])addEventListener(t,e=>trusted.push({type:t,trusted:e.isTrusted}));let c=document.querySelector('canvas').getContext('2d');c.fillStyle='teal';c.fillRect(0,0,300,150);c.fillStyle='white';c.fillText('Real compositor pixels',20,60);</script>`;
const server = createServer((req,res)=>{
  if(req.url==='/seed'){res.setHeader('Set-Cookie','still_fixture=local-session; HttpOnly; SameSite=Lax; Path=/');res.end('Synthetic human session established');}
  else if(req.url==='/auth'){res.end(req.headers.cookie?.includes('still_fixture=local-session')?'AUTHENTICATED':'LOGGED OUT');}
  else {res.setHeader('Content-Type','text/html');res.end(fixture);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'still-experiment-'));
let context;let bridge;let observer;const nativeEvents=[];const operationStates=[];
await (async()=>{
try {
  const extension=join(profile,'test-extension');
  await cp(resolve('extension'),extension,{recursive:true});
  await appendFile(join(extension,'worker.js'),'\nglobalThis.testLane = lane; globalThis.testConnect = connect; globalThis.testPort = () => port; chrome.runtime.onConnect.addListener(()=>{}); // Instrumented disposable test build only\n');
  const opts={headless:!process.env.STILL_HEADED,channel:'chromium',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]};
  if(process.env.STILL_CHROME) {delete opts.channel;opts.executablePath=process.env.STILL_CHROME;}
  context=await chromium.launchPersistentContext(profile,opts);
  const human=context.pages()[0];await human.goto(origin+'/seed');await human.goto(origin+'/');
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const init=await worker.evaluate(async ({origin})=>{
    const lane=globalThis.testLane;
    const w=await chrome.windows.create({url:chrome.runtime.getURL('anchor.html'),focused:false,type:'normal'});
    lane.configure(w.id,[origin]);
    globalThis.testLane=lane;
    return {version:navigator.userAgent,windowId:w.id};
  },{origin});
  if(process.env.STILL_NATIVE || process.env.STILL_MCP){
    const id=new URL(worker.url()).host;
    const hosts=join(profile,'NativeMessagingHosts');await mkdir(hosts,{recursive:true});
    const state=join(profile,'bridge');const launcher=join(profile,'host-launcher');
    const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
    await writeFile(launcher,`#!/bin/sh\nSTILL_STATE_DIR=${quote(state)} exec ${quote(process.execPath)} ${quote(resolve('src/native-host.js'))} \"$@\"\n`,{mode:0o700});await chmod(launcher,0o700);
    await writeFile(join(hosts,'org.still.browser.json'),JSON.stringify({name:'org.still.browser',description:'Disposable test host',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]}));
    await worker.evaluate(()=>{globalThis.testConnect();globalThis.testPort().onDisconnect.addListener(()=>{globalThis.testNativeError=chrome.runtime.lastError?.message;});});
    for(let i=0;i<100;i++){try{await stat(join(state,'browser.sock'));break;}catch{await new Promise(r=>setTimeout(r,30));}}
    const nativeError=await worker.evaluate(()=>globalThis.testNativeError);if(nativeError)throw Error('Native connect: '+nativeError);
    process.env.STILL_STATE_DIR=state;
    if(process.env.STILL_MCP){
      const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
      const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
      const protocol=new Client({name:'still-live-test',version:'1.0'});
      await protocol.connect(new StdioClientTransport({command:process.execPath,args:[resolve('src/mcp.js')],env:{...process.env,STILL_STATE_DIR:state}}));
      bridge={call:async(op,args)=>{const r=await protocol.callTool({name:'lane_'+op,arguments:args});if(r.isError)throw Error(r.content[0].text);if(op==='screenshot')return {...JSON.parse(r.content[1].text),data:r.content[0].data,mimeType:r.content[0].mimeType};return JSON.parse(r.content[0].text);},close:()=>protocol.close()};
    }else{const {BrowserClient}=await import('../src/client.js');bridge=new BrowserClient();await bridge.connect();}
  }
  const call=async(op,args={})=>{
    if(process.env.STILL_VERBOSE)process.stderr.write('experiment: '+op+'\n');
    let deadline;try{const result=await Promise.race([(bridge?bridge.call(op,args):worker.evaluate(async ({op,args})=>globalThis.testLane.run({session:'experiment',op,args}),{op,args})),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Timed out: '+op)),8000);})]);if(process.env.STILL_HEADED)operationStates.push({op,windows:await worker.evaluate(()=>chrome.windows.getAll())});return result;}finally{clearTimeout(deadline);}
  };
  // Real native/OS focus is outside a headless experiment's observable surface.
  if(process.env.STILL_OBSERVER){
    observer=spawn(resolve(process.env.STILL_OBSERVER),[],{stdio:['ignore','pipe','inherit']});
    let partial='';observer.stdout.on('data',chunk=>{partial+=chunk;let n;while((n=partial.indexOf('\n'))>=0){nativeEvents.push(JSON.parse(partial.slice(0,n)));partial=partial.slice(n+1);}});
    await new Promise(r=>observer.stdout.once('data',r));
  }
  const before=await worker.evaluate(async()=>({windows:await chrome.windows.getAll(),tabs:await chrome.tabs.query({active:true})}));
  await call('open',{url:origin+'/auth'});
  let agent;
  for(let i=0;i<200;i++){agent=context.pages().find(p=>p.url()===origin+'/auth');if(agent)break;await new Promise(r=>setTimeout(r,20));}
  assert(agent,'Agent page discovered by fixture URL, excluding delayed anchor events');
  await agent.waitForLoadState();
  assert.equal(await agent.locator('body').innerText(),'AUTHENTICATED');
  await call('navigate',{url:origin+'/'});await agent.waitForURL(origin+'/');await agent.waitForLoadState();
  await human.locator('input').fill('human-keeps-this');
  async function act(op,args) {const shot=await call('screenshot');assert(Buffer.from(shot.data,'base64').subarray(1,4).equals(Buffer.from('PNG')));return call(op,{...args,frame:shot.frame});}
  await act('click',{x:100,y:80});
  await act('type',{text:'agent-only'});
  await act('click',{x:100,y:165});
  assert.equal(await agent.locator('#result').innerText(),'Saved agent-only');
  assert.equal(await human.locator('input').inputValue(),'human-keeps-this');
  const visibleShot=await call('screenshot');await mkdir('artifacts',{recursive:true});await writeFile('artifacts/workflow.png',Buffer.from(visibleShot.data,'base64'));
  await act('scroll',{x:600,y:450,deltaX:0,deltaY:300});
  await agent.waitForFunction(()=>scrollY>0,{},{timeout:5000});
  if(process.env.STILL_KEY_PROBE){
    const keyResults=[];
    for(const key of ['Enter','Escape','Backspace','ArrowDown','Tab']){
      await worker.evaluate(async id=>chrome.windows.update(id,{focused:true}),before.tabs.find(t=>t.windowId!==init.windowId).windowId);
      // Deliberately bypass production key allowlist to reproduce the unsafe Tab boundary.
      await worker.evaluate(async key=>{const s=globalThis.testLane.sessions.get('experiment');const code={Enter:13,Escape:27,Backspace:8,ArrowDown:40,Tab:9}[key];for(const type of ['rawKeyDown','keyUp'])await globalThis.testLane.command(s,'Input.dispatchKeyEvent',{type,key,windowsVirtualKeyCode:code});},key);
      keyResults.push({key,windows:await worker.evaluate(()=>chrome.windows.getAll())});
    }
    console.log(JSON.stringify(keyResults,null,2));
    await writeFile('artifacts/key-probe.json',JSON.stringify(keyResults,null,2));return;
  }
  for(let i=0;i<30;i++) {
    await Promise.all([human.locator('input').fill('human-'+i),act('key',{key:'ArrowDown'})]);
    assert.equal(await human.locator('input').inputValue(),'human-'+i);
  }
  const trusted=await agent.evaluate(()=>window.trusted);
  assert(trusted.some(e=>e.type==='click'&&e.trusted));
  assert(trusted.some(e=>e.type==='input'&&e.trusted));
  const shot=await call('screenshot');
  await assert.rejects(call('click',{x:1,y:1,frame:crypto.randomUUID()}),/Stale/);
  await assert.rejects(call('navigate',{url:'https://unapproved.example/'}),/approved/);
  await assert.rejects(call('Runtime.evaluate',{expression:'document.cookie'}),/Unsupported|not found|Unknown|Invalid/i);
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/agent.png',Buffer.from(shot.data,'base64'));
  const after=await worker.evaluate(async()=>({windows:await chrome.windows.getAll(),tabs:await chrome.tabs.query({active:true})}));
  const humanWindow=before.tabs.find(t=>t.windowId!==init.windowId)?.windowId;
  assert(humanWindow,'Human fixture window known');
  assert.equal(after.tabs.find(t=>t.windowId===humanWindow)?.id,before.tabs.find(t=>t.windowId===humanWindow)?.id);
  if(observer){observer.kill();assert.equal(nativeEvents.length,1,'No foreground PID, pointer or Space change during measured workload');}
  const report={...init,mode:opts.headless?'headless':'headed',backend:bridge?(process.env.STILL_MCP?'MCP stdio + native messaging + Unix socket + real chrome.debugger':'native messaging + Unix socket + real chrome.debugger'):'real chrome.debugger extension API',syntheticHttpOnlySession:true,visualCoordinateWorkflow:true,trustedClickAndText:true,concurrentRendererRounds:30,humanFieldUnchanged:true,humanSelectedTabPreserved:true,nativeMonitor:observer?{sampleMs:10,changes:nativeEvents.length-1,events:nativeEvents}:'NOT RUN',osKeyboardMouseSpaces:'Physical human participation NOT TESTED',realExistingAccount:'NOT TESTED'};
  console.log(JSON.stringify(report,null,2));
  await writeFile('artifacts/browser-report.json',JSON.stringify(report,null,2)+'\n');
  await call('close');
} catch(e) {
  await mkdir('artifacts',{recursive:true});
  let windows;try{windows=await context.serviceWorkers()[0].evaluate(()=>chrome.windows.getAll());}catch{}
  await writeFile('artifacts/browser-failure.json',JSON.stringify({message:e.message,nativeEvents,windows,operationStates},null,2));
  throw e;
} finally {await bridge?.close();observer?.kill();await context?.close();server.close();await rm(profile,{recursive:true,force:true});}

})();
