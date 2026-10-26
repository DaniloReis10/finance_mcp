import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {equalSecret} from './store.js';
import {Pluggy} from './pluggy.js';
import {mountMcp,transactionSchema} from './mcp.js';
export function createApp(finance,{port=4318}={}) {
  const app=express(), origin=`http://127.0.0.1:${port}`;
  const sessions=new Map();
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)) return res.status(403).end();
    if(req.headers.origin && req.headers.origin!==origin && req.headers.origin!==`http://localhost:${port}`) return res.status(403).end();
    if(req.headers['sec-fetch-site']==='cross-site') return res.status(403).end();
    next();
  });
  app.use(express.json({limit:'16kb'}));
  app.get('/health',(_req,res)=>res.json({app:'open-finance-desktop',ok:true}));
  mountMcp(app,finance);
  app.post('/api/session',(req,res)=>{
    if(!equalSecret(req.body?.token,finance.store.data.uiToken)) return res.status(401).json({error:'Abra o aplicativo pelo atalho do desktop.'});
    const token=crypto.randomBytes(32).toString('hex');
    for(const [key,expiry] of sessions) if(expiry<Date.now()) sessions.delete(key);
    sessions.set(token,Date.now()+12*3600000);
    res.cookie('finance_session',token,{httpOnly:true,sameSite:'strict',maxAge:12*3600000,path:'/'}).json({ok:true});
  });
  app.use('/api',(req,res,next)=>{
    const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('finance_session='))?.slice(16);
    if(!cookie || (sessions.get(cookie)||0)<Date.now()) return res.status(401).json({error:'Abra pelo atalho “Open Finance” para entrar.'});
    if(req.method!=='GET' && !req.is('application/json')) return res.status(415).json({error:'JSON obrigatório.'});
    next();
  });
  app.get('/api/status',(_req,res)=>res.json(finance.status()));
  app.get('/api/transactions',(req,res)=>res.json(finance.transactions(transactionSchema.parse(req.query))));
  app.post('/api/settings',async(req,res)=>{
    if(finance.busy) return res.status(409).json({error:'Aguarde a sincronização terminar.'});
    const body=z.object({clientId:z.string().min(1).max(500),clientSecret:z.string().min(1).max(500)}).parse(req.body);
    if(finance.store.data.items.length) return res.status(409).json({error:'Remova as conexões antes de trocar as credenciais.'});
    const provider=new Pluggy(body);
    await provider.request('/connectors?isOpenFinance=true');
    finance.store.data.credentials=body;finance.cached=provider;finance.store.save();res.json({ok:true});
  });
  app.post('/api/schedule',(req,res)=>{
    finance.store.data.dailyEnabled=z.object({enabled:z.boolean()}).parse(req.body).enabled;finance.store.save();res.json({ok:true});
  });
  app.get('/api/connectors',async(_req,res)=>{
    const rows=await finance.client().pages('/connectors?isOpenFinance=true');
    res.json(rows.filter(c=>c.isOpenFinance && !c.isSandbox).map(c=>({id:c.id,name:c.name,type:c.type})));
  });
  app.post('/api/connect-token',async(req,res)=>{
    const {itemId}=z.object({itemId:z.string().uuid().optional()}).parse(req.body);
    if(itemId&&!finance.store.data.items.some(i=>i.id===itemId)) return res.status(404).json({error:'Conexão desconhecida.'});
    res.json(await finance.client().request('/connect_token','POST',{...(itemId?{itemId}:{}),options:{clientUserId:finance.store.data.userId,avoidDuplicates:true}}));
  });
  app.post('/api/items',async(req,res)=>{
    if(finance.busy) return res.status(409).json({error:'A conexão será recuperada na próxima sincronização.'});
    await finance.register(z.object({id:z.string().uuid()}).parse(req.body).id);res.json({ok:true});
  });
  app.post('/api/disconnect',async(req,res)=>{
    if(finance.busy) return res.status(409).json({error:'Aguarde a sincronização terminar.'});
    const {id}=z.object({id:z.string().uuid()}).parse(req.body),d=finance.store.data;
    if(!d.items.some(i=>i.id===id)) return res.status(404).json({error:'Conexão desconhecida.'});
    await finance.client().request('/items/'+encodeURIComponent(id),'DELETE');
    d.items=d.items.filter(i=>i.id!==id);d.accounts=d.accounts.filter(i=>i.itemId!==id);d.transactions=d.transactions.filter(i=>i.itemId!==id);finance.store.save();res.json({ok:true});
  });
  app.post('/api/sync',(_req,res)=>{
    if(!finance.store.data.credentials) return res.status(400).json({error:'Configure a Pluggy primeiro.'});
    if(finance.busy) return res.status(409).json({error:'Sincronização em andamento.'});
    void finance.sync('manual').catch(()=>{});res.status(202).json({started:true});
  });
  app.post('/api/mcp-token',(_req,res)=>res.json({token:finance.store.data.mcpToken}));
  app.post('/api/mcp-rotate',(_req,res)=>{finance.store.data.mcpToken=crypto.randomBytes(32).toString('hex');finance.store.save();res.json({ok:true});});
  app.use(express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public')));
  app.use((err,req,res,_next)=>{
    if(res.headersSent) return;
    res.status(err instanceof z.ZodError?400:502).json({error:err instanceof z.ZodError?'Dados inválidos. Confira os campos.':(err.message||'Não foi possível completar a operação.')});
  });
  return app;
}
