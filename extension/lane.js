// Only this module holds real Chrome tab IDs. Never accept one from an agent.
export class Lane {
  constructor(api, commandTimeoutMs = 10000) {
    this.api = api;
    this.commandTimeoutMs = commandTimeoutMs;
    this.failed = null;
    this.windowId = null;
    this.origins = [];
    this.sessions = new Map();
    this.cancelled = new Set();
    this.tail = Promise.resolve();
  }
  configure(windowId, origins) {
    if (this.sessions.size) throw Error('Close all sessions before reconfiguring');
    this.windowId = windowId;
    this.origins = origins.map(o => new URL(o).origin);
  }
  url(value) {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !this.origins.includes(u.origin))
      throw Error('Initial navigation origin is not approved in extension setup');
    return u.href;
  }
  run(message) {
    const next = this.tail.then(() => this.execute(message));
    this.tail = next.catch(() => {});
    return next;
  }
  async assertLane() {
    if (this.windowId === null) throw Error('Prepare a lane in the extension first');
    const w = await this.api.windows.get(this.windowId);
    if (w.focused) throw Error('Lane is focused by a human; input is paused. Switch to your own window.');
    if (w.state === 'minimized') throw Error('Lane is minimized; restore it manually. No focus fallback.');
  }
  async owned(session, allowDetached = false) {
    const s = this.sessions.get(session);
    if (!s) throw Error('No owned tab; create a session first');
    const tab = await this.api.tabs.get(s.tabId);
    if (tab.windowId !== this.windowId) {
      this.sessions.delete(session);
      await this.api.debugger.detach({tabId:s.tabId}).catch(() => {});
      throw Error('Tab moved outside its lane; ownership revoked');
    }
    if (s.detached && !allowDetached) throw Error('Debugger detached ('+(s.detachReason||'unknown')+'); close session and create again');
    return s;
  }
  async command(s, method, params = {}) {
    let timer;
    try {
      return await Promise.race([
        this.api.debugger.sendCommand({tabId:s.tabId}, method, params),
        new Promise((_,reject)=>{timer=setTimeout(()=>{
          this.failed='Renderer command timed out; reload extension and prepare a new lane';
          this.api.debugger.detach({tabId:s.tabId}).catch(()=>{});
          reject(Error(this.failed));
        },this.commandTimeoutMs);})
      ]);
    } catch(e) { throw Error(method + ': ' + e.message); }
    finally { clearTimeout(timer); }
  }
  cancel(session) {
    this.cancelled.add(session);
    return this.run({session,op:'close'}).catch(()=>{}).finally(()=>this.cancelled.delete(session));
  }
  invalidate(tabId) {
    for (const s of this.sessions.values()) if (s.tabId === tabId) s.frame = null;
  }
  async execute({session, op, args = {}}) {
    if (this.cancelled.has(session) && op !== 'close') throw Error('Session disconnected');
    if (typeof session !== 'string' || !session) throw Error('Missing session');
    if (!['open','close','screenshot','click','type','key','scroll','navigate'].includes(op)) throw Error('Unsupported operation');
    if (op === 'close') {
      const s = await this.owned(session, true);
      this.sessions.delete(session);
      await this.api.debugger.detach({tabId:s.tabId}).catch(() => {});
      await this.api.tabs.remove(s.tabId);
      return {closed:true};
    }
    if (this.failed) throw Error(this.failed);
    await this.assertLane();
    if (op === 'open') {
      if (this.sessions.has(session)) throw Error('Session already owns a tab');
      const url = this.url(args.url);
      const tab = await this.api.tabs.create({windowId:this.windowId, url:'about:blank', active:false});
      const s = {tabId:tab.id, frame:null, detached:false};
      this.sessions.set(session, s);
      try {
        await this.api.debugger.attach({tabId:tab.id}, '1.3');
        await this.command(s, 'Page.enable');
        await this.command(s, 'Page.setInterceptFileChooserDialog', {enabled:true});
        await this.command(s, 'Emulation.setDeviceMetricsOverride', {width:1100,height:760,deviceScaleFactor:1,mobile:false});
        await this.command(s, 'Emulation.setFocusEmulationEnabled', {enabled:true});
        // Changes selection only inside the dedicated lane, never focuses its window.
        await this.api.tabs.update(tab.id, {active:true, autoDiscardable:false});
        await this.command(s, 'Page.navigate', {url});
        return {opened:true, width:1100, height:760};
      } catch (e) {
        this.sessions.delete(session);
        await this.api.debugger.detach({tabId:tab.id}).catch(() => {});
        await this.api.tabs.remove(tab.id).catch(() => {});
        throw e;
      }
    }
    const s = await this.owned(session);
    // Stage only the exact owned tab; never touch the human's selected tab.
    await this.api.tabs.update(s.tabId, {active:true});
    if (op === 'screenshot') {
      const result = await this.command(s, 'Page.captureScreenshot', {format:'png',fromSurface:true,captureBeyondViewport:false});
      s.frame = crypto.randomUUID();
      return {data:result.data, mimeType:'image/png', frame:s.frame, width:1100, height:760};
    }
    if (op === 'navigate') {
      s.frame = null;
      const result = await this.command(s, 'Page.navigate', {url:this.url(args.url)});
      if (result.errorText) throw Error(result.errorText);
      return {navigated:true};
    }
    if (!s.frame || args.frame !== s.frame) throw Error('Stale or missing frame; take a screenshot before each action');
    s.frame = null;
    const point = () => {
      if (![args.x,args.y].every(Number.isFinite) || args.x < 0 || args.x >= 1100 || args.y < 0 || args.y >= 760) throw Error('Coordinates outside viewport');
      return {x:args.x,y:args.y};
    };
    if (op === 'click') {
      const p = point();
      await this.command(s,'Input.dispatchMouseEvent',{type:'mouseMoved',...p});
      await this.command(s,'Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
      await this.command(s,'Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
    } else if (op === 'type') {
      if (typeof args.text !== 'string' || args.text.length > 10000) throw Error('Invalid text');
      await this.command(s,'Input.insertText',{text:args.text});
    } else if (op === 'key') {
      const keys = {Enter:13,Escape:27,Backspace:8,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39};
      if (!Object.hasOwn(keys,args.key)) throw Error('Key is not allowed; browser shortcuts are unavailable');
      const p = {key:args.key,windowsVirtualKeyCode:keys[args.key]};
      await this.command(s,'Input.dispatchKeyEvent',{type:'rawKeyDown',...p});
      await this.command(s,'Input.dispatchKeyEvent',{type:'keyUp',...p});
    } else if (op === 'scroll') {
      const p = point();
      if (![args.deltaX,args.deltaY].every(n=>Number.isFinite(n)&&Math.abs(n)<=3000)) throw Error('Invalid scroll delta');
      await this.command(s,'Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:args.deltaX,deltaY:args.deltaY});
    }
    return {performed:op};
  }
}
