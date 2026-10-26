const sleep = ms => new Promise(r=>setTimeout(r,ms));
export class Pluggy {
  constructor(credentials, fetcher=fetch) { this.credentials=credentials; this.fetcher=fetcher; }
  async request(route, method='GET', body, retry=true) {
    if (!this.credentials) throw new Error('Configure suas credenciais Pluggy primeiro.');
    if (!this.key || Date.now()>this.expires) {
      const response=await this.fetcher('https://api.pluggy.ai/auth',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.credentials),signal:AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error(`Autenticação Pluggy recusada (${response.status}). Confira as credenciais.`);
      this.key=(await response.json()).apiKey; this.expires=Date.now()+100*60000;
    }
    const response=await this.fetcher('https://api.pluggy.ai'+route,{
      method,headers:{'X-API-KEY':this.key,'Content-Type':'application/json'},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)
    });
    if (response.status===401 && retry) { this.key=null; return this.request(route,method,body,false); }
    if (!response.ok) throw new Error(response.status===429 ? 'Limite do provedor atingido. Tente novamente mais tarde.' : `O provedor retornou erro ${response.status}. Verifique a conexão no banco.`);
    return response.status===204?null:response.json();
  }
  async pages(route) {
    let all=[];
    for(let page=1;page<=1000;page++) {
      const result=await this.request(`${route}${route.includes('?')?'&':'?'}page=${page}&pageSize=500`);
      if (!Array.isArray(result.results)) throw new Error('Resposta de paginação inválida do provedor.');
      all.push(...result.results);
      if(page >= (result.totalPages ?? 1)) return all;
    }
    throw new Error('Limite de páginas excedido; os dados anteriores foram preservados.');
  }
  async refresh(id) {
    const route='/items/'+encodeURIComponent(id);
    let item=await this.request(route,'PATCH',{});
    for(let attempt=0;attempt<60;attempt++) {
      if(item.status==='UPDATED') return item;
      if(item.status!=='UPDATING') throw new Error('A conexão precisa de atenção ou renovação do consentimento no banco.');
      await sleep(2000); item=await this.request(route);
    }
    throw new Error('O banco ainda está processando a atualização. Tente novamente mais tarde.');
  }
}
