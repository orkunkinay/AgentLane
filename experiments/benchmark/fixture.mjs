import { createServer } from 'node:http';
const page = (
  path,
  authenticated,
) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Benchmark fixture</title>
<style>*{box-sizing:border-box}body{margin:0;font:20px system-ui;background:#f4f7fc;color:#15233a}header{height:52px;background:#15233a;color:white;padding:12px 30px}input,button,a{position:absolute;height:42px;font:18px system-ui}input{left:40px;width:300px}button{left:390px;width:170px}a{left:650px}#result{position:absolute;top:270px;left:40px}#doc{position:absolute;top:800px;left:40px;width:850px}#doc p{height:64px;margin:0}#status{position:absolute;top:330px;left:40px}</style>
<header>Controlled workspace · ${authenticated ? 'Synthetic account recognized' : 'No synthetic session'}</header>
<input id="query" aria-label="Search or first field" style="top:70px"><input id="second" aria-label="Second field" style="top:130px"><input id="third" aria-label="Third field" style="top:190px">
<button id="search" style="top:70px">Search</button><button id="save" style="top:130px">Save form</button><button id="step" style="top:190px">Advance step</button>
<a id="next" style="top:70px" href="/next">Continue</a><a style="top:130px" href="/auth">Account</a>
<div id="result" role="status">Ready</div><div id="status">Page: ${path} · Progress: 0</div>
<div id="doc">${Array.from({ length: 60 }, (_, i) => `<p>Section ${i + 1}: ${i === 35 ? 'Target parcel AL-204 costs 42 credits.' : 'Deterministic local reference paragraph for navigation and reading.'}</p>`).join('')}</div>
<script>
const query=document.getElementById('query'),second=document.getElementById('second'),third=document.getElementById('third'),result=document.getElementById('result');
let progress=0; window.bench={events:[],authenticated:${authenticated},path:${JSON.stringify(path)}};
for(const type of ['click','input','wheel','keydown'])addEventListener(type,e=>bench.events.push({type,trusted:e.isTrusted,at:performance.now()}));
document.getElementById('search').onclick=()=>{result.textContent=query.value==='AL-204'?'AL-204 | 42 credits':'No result'};
document.getElementById('save').onclick=()=>{result.textContent='Saved: '+[query.value,second.value,third.value].join('|')};
document.getElementById('step').onclick=()=>{progress++;document.getElementById('status').textContent='Page: '+bench.path+' · Progress: '+progress;result.textContent='Step '+progress};
</script></html>`;
export async function fixture(port = 0, sameSite = 'Lax') {
  if (!['Lax', 'Strict'].includes(sameSite)) throw Error('Invalid synthetic cookie policy');
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/seed') {
      res.setHeader(
        'Set-Cookie',
        `benchmark_session=synthetic; HttpOnly; SameSite=${sameSite}; Path=/`,
      );
      res.writeHead(302, { Location: '/human' });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      page(url.pathname, req.headers.cookie?.includes('benchmark_session=synthetic') || false),
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}
