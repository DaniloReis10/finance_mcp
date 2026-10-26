import {Pluggy} from './pluggy.js';
export const DAY=24*60*60*1000;
export function due(data, now=Date.now()) {
  return Boolean(data.dailyEnabled && data.credentials && data.items?.length &&
    (!data.lastSuccess || now-Date.parse(data.lastSuccess)>=DAY) &&
    (!data.lastAttempt || now-Date.parse(data.lastAttempt)>=3600000));
}
export class Finance {
  constructor(store, provider) {this.store=store;this.provider=provider;this.busy=false;}
  client() {return this.provider ?? (this.cached ??=new Pluggy(this.store.data.credentials));}
  status() {
    const d=this.store.data;
    return {configured:!!d.credentials,dailyEnabled:d.dailyEnabled,busy:this.busy,
      lastSuccess:d.lastSuccess,lastAttempt:d.lastAttempt,items:d.items,
      nextSync:d.dailyEnabled && d.credentials && d.items.length ? new Date(Math.max(Date.now(),d.lastSuccess?Date.parse(d.lastSuccess)+DAY:0,d.lastAttempt?Date.parse(d.lastAttempt)+3600000:0)).toISOString():null,
      history:d.history,accounts:d.accounts,transactionCount:d.transactions.length};
  }
  transactions({accountId,from,to,limit=100,offset=0}={}) {
    const rows=this.store.data.transactions.filter(t=>(!accountId||t.accountId===accountId)&&(!from||t.date.slice(0,10)>=from)&&(!to||t.date.slice(0,10)<=to)).sort((a,b)=>b.date.localeCompare(a.date));
    return {total:rows.length,offset,limit,results:rows.slice(offset,offset+limit),lastSuccess:this.store.data.lastSuccess};
  }
  async register(id) {
    const item=await this.client().request('/items/'+encodeURIComponent(id));
    if(item.clientUserId!==this.store.data.userId || !item.connector?.isOpenFinance) throw new Error('Esta conexão não pertence a este aplicativo ou não é Open Finance.');
    this.upsertItem(item);this.store.save();
  }
  upsertItem(item) {
    const d=this.store.data;
    const previous=d.items.find(i=>i.id===item.id);
    const safe={...previous,id:item.id,name:item.connector?.name||'Banco',status:item.status};
    d.items=d.items.filter(i=>i.id!==item.id).concat(safe);
  }
  async sync(source='manual') {
    if(this.busy) return {started:false,message:'Uma sincronização já está em andamento.'};
    if(!this.store.data.credentials && !this.provider) throw new Error('Configure a Pluggy antes de sincronizar.');
    this.busy=true;
    const d=this.store.data, startedAt=new Date().toISOString();
    d.lastAttempt=startedAt;this.store.save();
    let successes=0,errors=[];
    try {
      const client=this.client();
      if(!d.items.length) throw new Error('Nenhum banco conectado. Use “Conectar banco” para autorizar o acesso.');
      for(const item of [...d.items]) {
        try {
          const updated=await client.refresh(item.id);
          const accounts=await client.pages('/accounts?itemId='+encodeURIComponent(item.id));
          const normalized=[],transactions=[];
          for(const a of accounts) {
            normalized.push({id:a.id,itemId:item.id,name:a.name,type:a.type,subtype:a.subtype,balance:a.balance,currency:a.currencyCode||'BRL'});
            const rows=await client.pages('/transactions?accountId='+encodeURIComponent(a.id));
            for(const t of rows) transactions.push({id:t.id,accountId:a.id,itemId:item.id,date:t.date,description:t.description,amount:t.amount,currency:t.currencyCode||a.currencyCode||'BRL',type:t.type,category:t.category||'Sem categoria',status:t.status});
          }
          // Replace only after every page succeeded, retaining other banks on failure.
          d.accounts=d.accounts.filter(a=>a.itemId!==item.id).concat(normalized);
          d.transactions=d.transactions.filter(t=>t.itemId!==item.id).concat([...new Map(transactions.map(t=>[t.id,t])).values()]);
          this.upsertItem(updated);
          Object.assign(d.items.find(i=>i.id===item.id),{lastSuccess:new Date().toISOString(),error:null});
          successes++;this.store.save();
        } catch(error) {
          errors.push({bank:item.name,message:error.message});
          Object.assign(d.items.find(i=>i.id===item.id),{error:error.message});
        }
      }
    } catch(error) {errors.push({message:error.message});}
    finally {
      const finishedAt=new Date().toISOString();
      if(successes && !errors.length) d.lastSuccess=finishedAt;
      const result={startedAt,finishedAt,source,successes,errors,status:errors.length?(successes?'partial':'error'):'success'};
      d.history=[result,...d.history].slice(0,50);this.busy=false;this.store.save();
    }
    return d.history[0];
  }
}
