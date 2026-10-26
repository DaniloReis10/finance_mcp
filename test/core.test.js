import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {Finance,due,DAY} from '../src/service.js';
import {Pluggy} from '../src/pluggy.js';
import {createApp} from '../src/app.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
function store(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Store(dir);}
test('vault is encrypted, authenticated and private',t=>{const s=store(t);s.data.credentials={clientSecret:'secret-test'};s.save();assert.ok(!fs.readFileSync(s.file).includes('secret-test'));assert.equal(new Store(s.dir).data.credentials.clientSecret,'secret-test');assert.equal(fs.statSync(s.file).mode&0o777,0o600);const raw=fs.readFileSync(s.file);raw[30]^=1;fs.writeFileSync(s.file,raw);assert.throws(()=>new Store(s.dir));});
test('daily schedule persists timing, catches up after sleep, retries failures with backoff',()=>{const now=Date.now(),base={dailyEnabled:true,credentials:{},items:[{id:'a'}],lastSuccess:new Date(now-DAY-1).toISOString()};assert.equal(due(base,now),true);assert.equal(due({...base,lastAttempt:new Date(now-1000).toISOString()},now),false);assert.equal(due({...base,dailyEnabled:false},now),false);assert.equal(due({...base,lastSuccess:new Date(now-1000).toISOString()},now),false);});
test('pagination reads every page and escapes account identifiers',async()=>{const calls=[],p=new Pluggy({});p.request=async route=>{calls.push(route);return {results:[{id:calls.length}],totalPages:2};};assert.equal((await p.pages('/accounts?itemId=abc')).length,2);assert.match(calls[1],/page=2/);});
test('refresh waits until provider completes and rejects consent errors',async()=>{const p=new Pluggy({});p.request=async()=>({status:'WAITING_USER_INPUT'});await assert.rejects(p.refresh('a'),/consentimento/);p.request=async()=>({status:'UPDATED'});assert.equal((await p.refresh('a')).status,'UPDATED');});
test('sync deduplicates and preserves other banks on partial failure',async t=>{const s=store(t);s.data.items=[{id:'a',name:'A'},{id:'b',name:'B'}];s.data.accounts=[{id:'old-b',itemId:'b',balance:12}];s.data.transactions=[{id:'old-t',itemId:'b',accountId:'old-b',date:'2026-01-01'}];const provider={pages:async route=>route.startsWith('/items')?[]:route.startsWith('/accounts')?[{id:'new-a',name:'Conta',balance:10,type:'BANK'}]:[{id:'t',date:'2026-01-02',amount:1},{id:'t',date:'2026-01-02',amount:1}],refresh:async id=>{if(id==='b')throw new Error('Banco indisponível');return {id,connector:{name:'A'},status:'UPDATED'};}};const finance=new Finance(s,provider);const result=await finance.sync();assert.equal(result.status,'partial');assert.equal(s.data.transactions.length,2);assert.ok(s.data.accounts.some(a=>a.id==='old-b'));assert.equal(s.data.lastSuccess,null);assert.equal(finance.busy,false);await finance.sync();assert.equal(s.data.transactions.length,2);});
test('failed transaction page preserves previous entire bank snapshot',async t=>{const s=store(t);s.data.items=[{id:'a'}];s.data.accounts=[{id:'old',itemId:'a'}];const f=new Finance(s,{pages:async route=>{if(route.startsWith('/items'))return [];if(route.startsWith('/accounts'))return [{id:'new'}];throw new Error('timeout');},refresh:async()=>({id:'a'})});await f.sync();assert.equal(s.data.accounts[0].id,'old');});
test('concurrent sync requests are not duplicated',async t=>{const s=store(t);s.data.items=[{id:'a'}];let release;const f=new Finance(s,{refresh:async()=>({id:'a'}),pages:()=>new Promise(r=>release=r)});const a=f.sync();assert.equal((await f.sync()).started,false);await Promise.resolve();release([]);await a;assert.equal(f.busy,false);});
test('HTTP rejects unauthenticated access, forged host/origin and serves MCP SDK calls',async t=>{
  const s=store(t),f=new Finance(s);const app=createApp(f,{port:4387});const server=app.listen(4387,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:4387';assert.equal((await fetch(base+'/api/status')).status,401);assert.equal((await fetch(base+'/mcp',{method:'POST'})).status,401);assert.equal(await new Promise((resolve,reject)=>{http.get(base+'/health',{headers:{Host:'evil.test'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);}),403);assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:JSON.stringify({token:s.data.uiToken})})).status,403);
  const session=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:s.data.uiToken})});assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'/api/status',{headers:{Cookie:cookie}})).status,200);assert.equal((await fetch(base+'/api/transactions?limit=99999',{headers:{Cookie:cookie}})).status,400);
  const client=new Client({name:'integration-test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+s.data.mcpToken}}}));const tools=await client.listTools();assert.equal(tools.tools.length,4);const result=await client.callTool({name:'list_accounts',arguments:{}});assert.deepEqual(JSON.parse(result.content[0].text).accounts,[]);const invalid=await client.callTool({name:'list_transactions',arguments:{limit:1000}});assert.equal(invalid.isError,true);await client.close();
});

 test('sync without banks does not call restricted listing or the provider',async t=>{const s=store(t);let calls=0;const f=new Finance(s,{pages:async()=>{calls++;throw new Error('must not list');}});const result=await f.sync();assert.equal(calls,0);assert.match(result.errors[0].message,/Nenhum banco conectado/);assert.equal(due({...s.data,credentials:{}}),false);});
 test('401 refreshes API key once and reports application authorization, not a bank error',async()=>{let auth=0,reads=0;const p=new Pluggy({clientId:'test',clientSecret:'test'},async url=>{if(url.endsWith('/auth')){auth++;return new Response(JSON.stringify({apiKey:'fake'}),{status:200});}reads++;return new Response('{}',{status:401});});await assert.rejects(p.request('/accounts?itemId=test'),/autorização da aplicação/);assert.equal(auth,2);assert.equal(reads,2);});

test('Meu Pluggy import accepts an owner-selected Dashboard item and is idempotent',async t=>{
  const s=store(t);const id='12345678-1234-4234-8234-123456789012';
  const f=new Finance(s,{request:async route=>{assert.equal(route,'/items/'+id);return {id,clientUserId:'dashboard-user',connector:{id:200,name:'MeuPluggy',isOpenFinance:false},status:'UPDATED'};}});
  await f.importMeuPluggy(id,'Nubank');await f.importMeuPluggy(id,'Nubank');
  assert.equal(s.data.items.length,1);assert.equal(s.data.items[0].mode,'meu-pluggy');assert.equal(s.data.items[0].name,'Nubank');
});
test('Meu Pluggy import rejects sandbox and inaccessible items without persisting them',async t=>{
  const s=store(t);const f=new Finance(s,{request:async()=>({id:'a',connector:{isSandbox:true}})});
  await assert.rejects(f.importMeuPluggy('a','Teste'),/Item ID real/);assert.equal(s.data.items.length,0);
  f.provider.request=async()=>{throw new Error('unauthorized');};await assert.rejects(f.importMeuPluggy('a'),/unauthorized/);assert.equal(s.data.items.length,0);
});
test('Meu Pluggy sync reads existing data without PATCH and distinguishes provider freshness',async t=>{
  const s=store(t);s.data.items=[{id:'a',mode:'meu-pluggy',label:'Inter'}];let patched=false;
  const f=new Finance(s,{refresh:async()=>{patched=true;throw new Error('PATCH forbidden');},readAvailable:async()=>({id:'a',connector:{name:'MeuPluggy'},status:'UPDATED',lastUpdatedAt:'2026-01-01T00:00:00Z'}),pages:async route=>route.startsWith('/accounts')?[{id:'account',name:'Conta',balance:1,type:'BANK'}]:[{id:'tx',date:'2026-01-01',amount:1}]});
  assert.equal((await f.sync()).status,'success');assert.equal(patched,false);assert.equal(s.data.items[0].name,'Inter');assert.equal(s.data.items[0].providerUpdatedAt,'2026-01-01T00:00:00Z');assert.notEqual(s.data.items[0].providerUpdatedAt,s.data.items[0].lastSuccess);
});
test('expired Meu Pluggy consent preserves the cached snapshot even with UPDATED status',async t=>{
  const s=store(t);s.data.items=[{id:'a',mode:'meu-pluggy'}];s.data.accounts=[{id:'old',itemId:'a',balance:50}];s.data.transactions=[{id:'old-t',itemId:'a'}];
  const p=new Pluggy({});p.request=async()=>({id:'a',status:'UPDATED',consentExpiresAt:'2000-01-01T00:00:00Z'});p.pages=async()=>{throw new Error('must not read after expiry');};
  const f=new Finance(s,p);const result=await f.sync();assert.equal(result.status,'error');assert.match(result.errors[0].message,/expirou/);assert.equal(s.data.accounts[0].balance,50);assert.equal(s.data.transactions[0].id,'old-t');
});
test('Meu Pluggy live reader uses GET only and rejects login errors',async()=>{
  const p=new Pluggy({}),calls=[];p.request=async(...args)=>{calls.push(args);return {status:'UPDATED',consentExpiresAt:'2999-01-01T00:00:00Z'};};
  await p.readAvailable('a');assert.deepEqual(calls,[['/items/a']]);p.request=async()=>({status:'LOGIN_ERROR'});await assert.rejects(p.readAvailable('a'),/Renove/);
});
test('HTTP Meu Pluggy import requires session, validates UUID and removal stays local',async t=>{
  const s=store(t),calls=[],id='12345678-1234-4234-8234-123456789012';
  const f=new Finance(s,{request:async(...args)=>{calls.push(args);return {id,connector:{id:200,name:'MeuPluggy'},status:'UPDATED'};}});
  const server=createApp(f,{port:4388}).listen(4388,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:4388/api/';const headers={'Content-Type':'application/json'};
  assert.equal((await fetch(base+'meu-pluggy/items',{method:'POST',headers,body:JSON.stringify({id})})).status,401);
  const login=await fetch(base+'session',{method:'POST',headers,body:JSON.stringify({token:s.data.uiToken})});headers.Cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'meu-pluggy/items',{method:'POST',headers,body:JSON.stringify({id:'bad'})})).status,400);
  assert.equal((await fetch(base+'meu-pluggy/items',{method:'POST',headers,body:JSON.stringify({id,label:'PicPay'})})).status,200);
  assert.equal((await fetch(base+'disconnect',{method:'POST',headers,body:JSON.stringify({id})})).status,200);
  assert.equal(s.data.items.length,0);assert.equal(calls.length,1);assert.equal(calls[0][0],'/items/'+id);
});
