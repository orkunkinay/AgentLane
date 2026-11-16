#!/usr/bin/env node
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {BrowserClient} from './client.js';
const server=new McpServer({name:'still',version:'0.1.0'});
const client=new BrowserClient();
let connected=false;
const text=r=>({content:[{type:'text',text:JSON.stringify(r)}]});
function tool(name,description,schema,op){
  server.registerTool(name,{description,inputSchema:schema},async args=>{
    try {
      if(!connected){await client.connect();connected=true;}
      const r=await client.call(op,args);
      if(op==='screenshot')return {content:[{type:'image',data:r.data,mimeType:r.mimeType},{type:'text',text:JSON.stringify({frame:r.frame,width:r.width,height:r.height})}]};
      return text(r);
    }catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
  });
}
const frame=z.string().uuid();const x=z.number().min(0).max(1099);const y=z.number().min(0).max(759);
tool('lane_open','Create your own tab in a human-prepared lane, using the existing profile. Never use native computer tools for this workflow.',{url:z.string().url()},'open');
tool('lane_screenshot','Observe actual rendered page pixels. Use its frame token in exactly one next input action. Coordinates are CSS pixels.',{},'screenshot');
tool('lane_click','Click a coordinate observed in your latest screenshot.',{frame,x,y},'click');
tool('lane_type','Insert text into the field focused by your previous click; no clipboard access.',{frame,text:z.string().max(10000)},'type');
tool('lane_key','Send a renderer key; browser and OS shortcuts are deliberately unavailable.',{frame,key:z.enum(['Enter','Escape','Backspace','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'])},'key');
tool('lane_scroll','Scroll at a viewport coordinate.',{frame,x,y,deltaX:z.number().min(-3000).max(3000),deltaY:z.number().min(-3000).max(3000)},'scroll');
tool('lane_navigate','Navigate your owned target to a setup-approved starting origin. This does not restrict redirects or links.',{url:z.string().url()},'navigate');
tool('lane_close','Close only your owned tab. Always call when finished.',{},'close');
const transport=new StdioServerTransport();await server.connect(transport);
process.stdin.on('end',()=>client.close());process.on('SIGTERM',()=>{client.close();process.exit();});
