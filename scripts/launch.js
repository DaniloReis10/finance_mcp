import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=process.env.FINANCE_DATA_DIR||path.join(os.homedir(),'Library/Application Support/OpenFinanceDesktop');
const url='http://127.0.0.1:4318';
async function healthy(){try{return (await (await fetch(url+'/health',{signal:AbortSignal.timeout(1000)})).json()).app==='open-finance-desktop';}catch{return false;}}
if(!await healthy()) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const fd=fs.openSync(path.join(dir,'service.log'),'a',0o600);
  const child=spawn(process.execPath,[path.join(root,'src/server.js')],{cwd:root,detached:true,stdio:['ignore',fd,fd],env:{...process.env,FINANCE_DATA_DIR:dir}});child.unref();fs.closeSync(fd);
  for(let i=0;i<30&&!await healthy();i++)await new Promise(r=>setTimeout(r,200));
}
if(!await healthy())throw new Error('Não foi possível iniciar o aplicativo. Verifique a porta 4318.');
const store=new Store(dir);
spawn('/usr/bin/open',[url+'/#session='+store.data.uiToken],{stdio:'ignore'}).on('error',()=>console.error('Abra o aplicativo novamente pelo atalho.'));
