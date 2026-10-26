import {PluggyConnect} from 'pluggy-connect-sdk';
const $=s=>document.querySelector(s);
let state,offset=0,connectors=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>s?new Date(s).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Ainda não realizada';
const money=(n,c='BRL')=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:c}).format(n);
function notice(message,error=false){$('#notice').textContent=message;$('#notice').className=error?'error':'';$('#notice').hidden=false;}
async function api(url,body){const r=await fetch('/api/'+url,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Não foi possível concluir.');return data;}
const action=fn=>async e=>{try{await fn(e);}catch(err){notice(err.message,true);}};
const desired=[['Bradesco','#c42b49','B',/bradesco/i],['Santander','#e73832','S',/santander/i],['Nubank','#7a29af','nu',/nubank/i],['Inter','#f57926','in',/inter\b/i],['PicPay','#21a66a','P',/pic\s?pay/i]];
function bankCard(name,color,mark,item){return `<article class="bank-card"><div class="bank-mark" style="--bank-color:${color}">${esc(mark)}</div><h3>${esc(name)}</h3><p>${item?(item.error?'Atenção necessária':item.lastSuccess?'Lido no Mac: '+esc(date(item.lastSuccess)):'Aguardando sincronização'):'Não conectado'}</p>${item?`${item.mode==='meu-pluggy'?`<p>Meu Pluggy · Banco atualizado: ${esc(date(item.providerUpdatedAt))}</p><a class="text-link" href="https://dashboard.pluggy.ai" target="_blank" rel="noreferrer">Renovar no Dashboard ↗</a>`:`<button data-renew="${esc(item.id)}">Renovar autorização</button>`}<button data-disconnect="${esc(item.id)}">${item.mode==='meu-pluggy'?'Remover deste aplicativo':'Desconectar e apagar dados'}</button>${item.error?`<p>${esc(item.error)}</p>`:''}`:''}</article>`;}
async function render(){
  state=await api('status');
  $('#sync').disabled=state.busy||!state.configured;$('#sync').textContent=state.busy?'↻ Sincronizando…':'↻ Sincronizar agora';
  $('#connect').disabled=!state.configured;$('#import-meu').disabled=!state.configured;$('#daily').checked=state.dailyEnabled;
  $('#onboarding').hidden=state.configured;
  $('#credential-status').textContent=state.configured?'Credenciais configuradas. Para trocá-las, remova as conexões existentes.':'Ainda não configuradas. Não informe sua senha bancária aqui.';
  $('#bank-count').innerHTML=`${state.items.length} <small>conexões ativas</small>`;
  $('#last-sync').textContent=date(state.lastSuccess);$('#next-sync').textContent=state.nextSync?'Próxima tentativa: '+date(state.nextSync):'Sincronização automática inativa';
  const accounts=state.accounts.filter(a=>a.type==='BANK'&&a.currency==='BRL');
  $('#balance').textContent=accounts.length?money(accounts.reduce((sum,a)=>sum+a.balance,0)):'—';
  $('#bank-list').innerHTML=desired.map(([name,color,mark,regex])=>{const matches=state.items.filter(i=>regex.test(i.name));return matches.length?matches.map(i=>bankCard(i.name,color,mark,i)).join(''):bankCard(name,color,mark);}).join('')+state.items.filter(i=>!desired.some(d=>d[3].test(i.name))).map(i=>bankCard(i.name,'#174d43','B',i)).join('');
  $('#bank-caption').textContent=state.items.length?'Consentimento gerenciado nos bancos':'Prontos para sua autorização';
  $('#history').innerHTML=state.history.length?state.history.slice(0,6).map(h=>`<article><b>${h.status==='success'?'Concluída':h.status==='partial'?'Concluída parcialmente':'Não concluída'}</b><p>${esc(date(h.finishedAt))} · ${esc({daily:'Automática',manual:'Pelo aplicativo',mcp:'Pelo assistente'}[h.source])} · ${h.successes} banco(s)</p>${h.errors.map(e=>`<p>${esc(e.bank||'')}: ${esc(e.message)}</p>`).join('')}</article>`).join(''):'<p class="muted">Nenhuma sincronização realizada.</p>';
  const chosen=$('#account-filter').value;
  $('#account-filter').innerHTML='<option value="">Todas as contas</option>'+state.accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.currency)} · ${esc(a.type)}</option>`).join('');$('#account-filter').value=chosen;
  await transactions();
}
async function transactions(){const params=new URLSearchParams({limit:'20',offset:String(offset)});for(const [field,id]of [['accountId','account-filter'],['from','from'],['to','to']])if($('#'+id).value)params.set(field,$('#'+id).value);const data=await api('transactions?'+params);$('#transaction-count').textContent=data.total+' registros';$('#empty').hidden=!!data.results.length;$('#rows').innerHTML=data.results.map(t=>`<tr><td>${esc(t.description)}</td><td>${esc(t.category)}</td><td>${esc(t.date.slice(0,10).split('-').reverse().join('/'))}</td><td class="amount">${esc(money(t.amount,t.currency))}</td></tr>`).join('');$('#prev').disabled=offset===0;$('#next').disabled=offset+20>=data.total;$('#page-label').textContent='Página '+(offset/20+1);}
async function connect(itemId){
  const {accessToken}=await api('connect-token',itemId?{itemId}:{});
  const options={connectToken:accessToken,includeSandbox:false,countries:['BR'],language:'pt',products:['ACCOUNTS','CREDIT_CARDS','TRANSACTIONS'],
    ...(itemId?{updateItem:itemId}:{connectorIds:connectors.map(c=>c.id),selectedConnectorId:Number($('#connector-select').value)}),
    onSuccess:async({item})=>{try{await api('items',{id:item.id});await api('sync',{});notice('Banco conectado. Sincronização iniciada.');await render();}catch(e){notice(e.message,true);}},
    onError:()=>notice('A conexão requer atenção. Conclua a autorização no banco e tente sincronizar novamente.',true)};
  const widget=new PluggyConnect(options);widget.init();
}
$('#sync').onclick=action(async()=>{await api('sync',{});notice('Atualização iniciada. Você pode acompanhar no histórico.');await render();});
$('#credentials').onsubmit=action(async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await api('settings',{clientId:$('#client-id').value.trim(),clientSecret:$('#client-secret').value.trim()});$('#client-secret').value='';notice('Credenciais validadas. Agora importe os Item IDs do Meu Pluggy.');await render();}finally{button.disabled=false;}});
$('#daily').onchange=action(async()=>{await api('schedule',{enabled:$('#daily').checked});await render();});
$('#connect').onclick=action(async()=>{connectors=await api('connectors');connectors.sort((a,b)=>Number(desired.some(d=>d[3].test(b.name)))-Number(desired.some(d=>d[3].test(a.name)))||a.name.localeCompare(b.name));if(!connectors.length)throw new Error('Nenhum conector Open Finance habilitado. Confira seu plano Pluggy.');$('#connector-select').innerHTML=connectors.map(c=>`<option value="${c.id}">${esc(c.name)} · ${esc(c.type)}</option>`).join('');$('#bank-dialog').showModal();});
$('#import-meu').onclick=()=>$('#meu-dialog').showModal();
$('#import-form').onsubmit=action(async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await api('meu-pluggy/items',{id:$('#item-id').value.trim(),label:$('#item-label').value.trim()});$('#item-id').value='';$('#item-label').value='';$('#meu-dialog').close();await api('sync',{});notice('Conexão importada. Buscando os dados disponíveis no Meu Pluggy.');await render();}finally{button.disabled=false;}});
$('#authorize').onclick=action(async()=>{$('#bank-dialog').close();await connect();});
$('#bank-list').onclick=action(async e=>{const renew=e.target.dataset.renew,id=e.target.dataset.disconnect;if(renew)await connect(renew);if(id&&confirm(state.items.find(i=>i.id===id)?.mode==='meu-pluggy'?'Remover os dados deste aplicativo? A conexão no Meu Pluggy continuará ativa.':'Remover esta conexão no provedor e apagar os dados locais desse banco? Você poderá conectar novamente.')){await api('disconnect',{id});await render();notice('Conexão removida deste aplicativo. Gerencie seus consentimentos no Meu Pluggy ou no banco.');}});
$('#filters').onsubmit=action(async e=>{e.preventDefault();offset=0;await transactions();});
$('#prev').onclick=action(async()=>{offset=Math.max(0,offset-20);await transactions();});$('#next').onclick=action(async()=>{offset+=20;await transactions();});
$('#mcp-help').onclick=()=>$('#mcp-dialog').showModal();
$('#copy-token').onclick=action(async()=>{const {token}=await api('mcp-token',{});await navigator.clipboard.writeText(token);$('#copy-token').textContent='Token copiado';});
$('#rotate-token').onclick=action(async()=>{if(confirm('Revogar o token atual? Clientes conectados precisarão do novo token.')){await api('mcp-rotate',{});$('#copy-token').textContent='Copiar novo token';}});
document.querySelectorAll('nav a').forEach(a=>a.onclick=()=>{document.querySelectorAll('nav a').forEach(n=>n.classList.remove('active'));a.classList.add('active');});
const token=new URLSearchParams(location.hash.slice(1)).get('session');if(token)history.replaceState(null,'',location.pathname);
try{const health=await (await fetch('/health')).json();if(health.version!=='1.1.0')throw new Error('Atualização Meu Pluggy instalada. Reinicie o servidor do Open Finance e abra novamente o atalho para ativá-la.');if(token)await api('session',{token});await render();setInterval(()=>render().catch(e=>notice(e.message,true)),5000);}catch(e){notice(e.message,true);$('#sync').disabled=true;$('#connect').disabled=true;$('#import-meu').disabled=true;}
