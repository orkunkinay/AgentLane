import {createServer} from 'node:http';
const html=({human=false,authenticated=false,next=false})=>`<!doctype html><meta charset="utf-8"><title>Still ${human?'human':'agent'} demo</title>
<style>body{font:20px system-ui;margin:40px;background:#f2f5f4;color:#18342e}main{max-width:850px}input,textarea,button{font:inherit;padding:12px;margin:8px 0}textarea{width:95%;height:300px}button{cursor:pointer}#menu{padding:20px;background:white}#result{padding:18px;background:#d5e9dd}canvas{display:block;margin-top:24px}footer{margin-top:800px}</style><main>
<h1>${human?'Your independent workspace':'Agent visual workspace'}</h1>
<p>Local synthetic authentication: <strong>${authenticated?'recognized':'not set; visit /seed first'}</strong></p>
${human?'<p>Keep typing here while the agent works in its own window. Switch tabs, apps and Spaces. No content is sent to a server.</p><textarea placeholder="Type a paragraph continuously here"></textarea>':next?'<h2>Workflow complete</h2><p>You navigated to the second page using the shared synthetic session.</p><a href="/task">Repeat task</a>':`<label>Task note<br><input id="note" placeholder="Enter a task note"></label><br><button id="open" onclick="document.querySelector('#menu').hidden=false">Open actions</button><section id="menu" hidden><button onclick="document.querySelector('#result').textContent='Saved: '+document.querySelector('#note').value;document.querySelector('#menu').hidden=true">Save note</button></section><p id="result">Awaiting action</p><a href="/next">Continue workflow</a><canvas width="500" height="140"></canvas><script>const c=document.querySelector('canvas').getContext('2d');let frame=0;function draw(){c.fillStyle='#18483c';c.fillRect(0,0,500,140);c.fillStyle='white';c.font='24px system-ui';c.fillText('Compositor animation '+frame++,24,75);requestAnimationFrame(draw)}draw();</script><footer>Scroll verification reached.</footer>`}
</main>`;
const server=createServer((req,res)=>{
  if(req.url==='/seed'){
    res.writeHead(302,{'Set-Cookie':'still_demo_session=synthetic-only; HttpOnly; SameSite=Lax; Path=/','Location':'/human'});res.end();return;
  }
  const authenticated=req.headers.cookie?.includes('still_demo_session=synthetic-only')||false;
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
  res.end(html({human:req.url==='/human',next:req.url==='/next',authenticated}));
});
const port=Number(process.env.STILL_DEMO_PORT||8741);
server.listen(port,'127.0.0.1',()=>console.log(`Still local demo: http://127.0.0.1:${port}/seed\nApprove starting origin http://127.0.0.1:${port} in extension setup.`));
