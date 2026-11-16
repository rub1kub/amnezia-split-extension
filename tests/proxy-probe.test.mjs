import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url)).replace(/[\\/]$/,'');
const libraries=Object.assign({}, ...await Promise.all(['rules','proxy','latency','version'].map(async name=>await import(pathToFileURL(`${root}/lib/${name}.js`).href))));
let source=await fs.readFile(`${root}/src/background.js`,'utf8');
source=source.replace(/^import\s+\{[\s\S]*?\}\s+from\s+["'][^"']+["'];?\s*/gm,'');
source=source.slice(0,source.lastIndexOf('\ninitialize().catch('));
function runtime(fetchImpl,initial={}) {
  let state=structuredClone(initial);
  const actions=[];
  const event={addListener(){}};
  const chrome={
    storage:{local:{async get(){return {state:structuredClone(state)};},async set(value){if(value.state)state=structuredClone(value.state);}}},
    proxy:{settings:{async set(value){actions.push(value.value);},async clear(){actions.push('CLEARED');}},onProxyError:event},
    action:{async setBadgeText(){},async setBadgeBackgroundColor(){},async setTitle(){}},
    runtime:{onMessage:event,onInstalled:event,onStartup:event,getManifest(){return {version:'0.9.1.1'};}},
    alarms:{onAlarm:event},webRequest:{onAuthRequired:event,onCompleted:event,onErrorOccurred:event}
  };
  const context=vm.createContext({...libraries,chrome,fetch:fetchImpl,URL,AbortSignal,crypto:webcrypto,TextEncoder,btoa,setTimeout,clearTimeout,console});
  vm.runInContext(source+'\nthis.probeTests={testProxy,saveServer,getState,fetchCountry};',context);
  return {api:context.probeTests,actions,stored:()=>structuredClone(state)};
}
const fixture={enabled:true,configured:true,activeServerId:'old',servers:[{id:'old',name:'Old',host:'www.ton4.pro',port:18443,username:'old-account',password:'old-password',scheme:'https',source:'manual'}],communityDomains:['youtube.com'],gateway:{enabled:true,apiUrl:'https://www.ton4.pro:18445',proxyServerId:'old',connected:true}};
test('test uses the configured proxy without requiring a direct IP request',async()=>{
  const urls=[];
  const r=runtime(async url=>{urls.push(url);assert.equal(r.actions[0].mode,'fixed_servers');return {ok:true,text:async()=> 'ip=203.0.113.17\nloc=NL\ntls=TLSv1.3\n'};},fixture);
  const result=await r.api.testProxy();
  assert.equal(result.proxyIp,'203.0.113.17');assert.equal(result.directIp,null);
  assert.equal(urls.length,1);assert.ok(!urls[0].includes('direct'));
  assert.ok(!r.actions.includes('CLEARED'));assert.equal(r.actions.at(-1).mode,'pac_script');
  const pac=r.actions.at(-1).pacScript.data;
  assert.ok(pac.includes('1.1.1.1'));
});
test('working HTTPS proxy remains successful without country metadata',async()=>{
  const r=runtime(async()=>({ok:true,text:async()=> 'ip=203.0.113.17\n'}),fixture);
  const result=await r.api.testProxy();assert.equal(result.proxyIp,'203.0.113.17');assert.equal(result.countryCode,'');
});
test('trace failure can fall back to existing GeoIP providers',async()=>{
  const r=runtime(async url=>{
    if(url.includes('/cdn-cgi/trace'))throw new Error('blocked test endpoint');
    return {ok:true,json:async()=>({ip:'203.0.113.21',country:'DE'})};
  },fixture);
  const result=await r.api.testProxy();assert.equal(result.proxyIp,'203.0.113.21');assert.equal(result.countryCode,'DE');
});
test('all network failures restore protected routing and report failure',async()=>{
  const r=runtime(async()=>{throw new Error('network unreachable');},fixture);
  await assert.rejects(r.api.testProxy(),/network unreachable/);
  assert.equal(r.actions.at(-1).mode,'pac_script');assert.ok(!r.actions.includes('CLEARED'));
});
test('saving a new personal connection rebinds Gateway away from the old account',async()=>{
  const r=runtime(async()=>{throw new Error('network should not be used');},fixture);
  await r.api.saveServer({name:'Friend',host:'www.ton4.pro',port:18453,scheme:'https',username:'routeva-friend',password:'new-test-password'});
  const saved=r.stored();
  assert.notEqual(saved.activeServerId,'old');assert.equal(saved.gateway.proxyServerId,saved.activeServerId);
  const active=saved.servers.find(s=>s.id===saved.activeServerId);
  assert.equal(active.username,'routeva-friend');assert.equal(active.port,18453);
  assert.equal(saved.gateway.apiUrl,'https://www.ton4.pro:18445');
});
