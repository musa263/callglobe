import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('service worker rejects expired and canceled calls and closes displayed calls at deadline', async () => {
  const handlers: Record<string, Function> = {};
  const markers = new Map<string, Response>();
  const notifications: Array<{tag:string;close:()=>void}> = [];
  let shown=0, closed=0;
  const context = {
    self:{skipWaiting(){},__WB_MANIFEST:[],location:{origin:'https://fixture.invalid'},addEventListener(type:string,handler:Function){handlers[type]=handler;},
      registration:{async getNotifications({tag}: {tag?:string} = {}){return notifications.filter(n=>!tag || n.tag===tag);},async showNotification(_title:string,options:{tag:string}){shown++;notifications.push({tag:options.tag,close(){closed++;}});}}},
    clientsClaim(){},cleanupOutdatedCaches(){},precacheAndRoute(){},console,Date,URL,Response,
    setTimeout(resolve:Function){resolve();},
    caches:{async open(){return {async keys(){return [...markers.keys()];},async match(key:string){return markers.get(key)?.clone();},async put(key:string,value:Response){markers.set(key,value);},async delete(key:string){markers.delete(key);}};}},
  };
  vm.runInNewContext(readFileSync(new URL('./sw.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
  async function push(data: object){let completion:Promise<unknown>|undefined;handlers.push({data:{json:()=>data},waitUntil(p:Promise<unknown>){completion=p;}});await completion;}
  await push({tag:'expired',expiresAt:new Date(Date.now()-1000).toISOString()});
  assert.equal(shown,0);
  await push({tag:'cancelled',type:'vocivo.call_ended'});
  await push({tag:'cancelled',expiresAt:new Date(Date.now()+45000).toISOString()});
  assert.equal(shown,0);
  await push({tag:'live',expiresAt:new Date(Date.now()+45000).toISOString()});
  assert.equal(shown,1); assert.equal(closed,1);
});
