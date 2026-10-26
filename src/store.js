import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class Store {
  constructor(dir) {
    fs.mkdirSync(dir, {recursive:true, mode:0o700});
    this.dir = dir;
    const keyFile = path.join(dir, 'master.key');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), {mode:0o600, flag:'wx'});
    this.key = fs.readFileSync(keyFile);
    this.file = path.join(dir, 'vault.enc');
    this.data = fs.existsSync(this.file) ? this.read() : {
      userId:crypto.randomUUID(), uiToken:crypto.randomBytes(32).toString('hex'),
      mcpToken:crypto.randomBytes(32).toString('hex'), credentials:null,
      items:[], accounts:[], transactions:[], lastSuccess:null, lastAttempt:null,
      dailyEnabled:true, history:[]
    };
    if (!fs.existsSync(this.file)) this.save();
  }
  read() {
    const raw = fs.readFileSync(this.file);
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0,12));
    d.setAuthTag(raw.subarray(12,28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString());
  }
  save() {
    const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);
    const body=Buffer.concat([cipher.update(JSON.stringify(this.data)),cipher.final()]);
    fs.writeFileSync(this.file+'.tmp',Buffer.concat([iv,cipher.getAuthTag(),body]),{mode:0o600});
    fs.renameSync(this.file+'.tmp',this.file);
  }
}

export function equalSecret(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x=Buffer.from(a), y=Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x,y);
}
