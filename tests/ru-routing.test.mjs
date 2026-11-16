import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url)).replace(/[\\/]$/,'');
const {generatePac,routeSource,effectiveDomains}=await import(pathToFileURL(root+'/lib/rules.js'));
const {validateRuPolicy,ruPolicyUrlForHost}=await import(pathToFileURL(root+'/lib/ru-policy.js'));
const policy=validateRuPolicy(JSON.parse(await fs.readFile(root+'/data/ru-direct.json','utf8')));
const connection={domains:['youtube.com','chatgpt.com','max.ru'],bypassDomains:[],proxyHost:'vpn.example.net',proxyPort:18443,ruPolicy:policy};
function pac(options={},resolve=()=>null){
 const calls=[];
 const ctx=vm.createContext({isPlainHostName:host=>!host.includes('.'),dnsResolve:host=>{calls.push(host);return resolve(host);}});
 vm.runInContext(generatePac({...connection,...options}),ctx);
 return {route:host=>ctx.FindProxyForURL('https://'+host+'/',host),calls};
}

test('MAX, Cyrillic-zone hosts and Russian companies bypass even all-traffic mode',()=>{
 const p=pac({routeMode:'all'},()=>{throw new Error('unnecessary DNS');});
 for(const host of ['max.ru','web.max.ru','api.oneme.ru','example.ru','example.su','example.xn--p1ai','vk.com','login.vk.com','yastatic.net','userapi.com'])assert.equal(p.route(host),'DIRECT',host);
 assert.equal(p.calls.length,0);
});
test('foreign domains retain proxy routing and do not gain a direct fallback on DNS failure',()=>{
 const p=pac({routeMode:'all'},()=>{throw new Error('DNS blocked');});
 for(const host of ['youtube.com','chatgpt.com','notvk.com','max.ru.evil.example'])assert.equal(p.route(host),'HTTPS vpn.example.net:18443',host);
});
test('GeoIP handles IPv4 range boundaries and Russian-hosted domains',()=>{
 const [start,end]=policy.ipv4Ranges[0];
 const ip=n=>[24,16,8,0].map(shift=>(n>>>shift)&255).join('.');
 const p=pac({routeMode:'all'},()=>ip(start));
 assert.equal(p.route(ip(start)),'DIRECT');assert.equal(p.route(ip(end)),'DIRECT');
 assert.equal(p.route('hosted-in-russia.example'),'DIRECT');
 assert.equal(pac({routeMode:'all'}).route('1.1.1.1'),'HTTPS vpn.example.net:18443');
});
test('Russian IPv6 literals bypass; foreign IPv6 literals stay on proxy',()=>{
 const p=pac({routeMode:'all'});
 assert.equal(p.route(policy.ipv6Cidrs[0].split('/')[0]),'DIRECT');
 assert.equal(p.route('2606:4700:4700::1111'),'HTTPS vpn.example.net:18443');
});
test('selected mode and manual bypass retain existing behavior',()=>{
 const p=pac({bypassDomains:['status.openai.com']});
 assert.equal(p.route('youtube.com'),'HTTPS vpn.example.net:18443');
 assert.equal(p.route('unlisted.example'),'DIRECT');assert.equal(p.route('status.openai.com'),'DIRECT');
 assert.equal(routeSource('max.ru',{routeMode:'all',ruPolicy:policy}),'direct');
 assert.ok(!effectiveDomains({useCommunityList:false,customDomains:['max.ru'],ruPolicy:policy}).includes('max.ru'));
});
test('corrupt, overly broad, or incomplete updates are rejected',()=>{
 assert.throws(()=>validateRuPolicy({...policy,domainSuffixes:['ru']}));
 assert.throws(()=>validateRuPolicy({...policy,domainSuffixes:[...policy.domainSuffixes,'com']}));
 assert.throws(()=>validateRuPolicy({...policy,ipv4Ranges:[[0,4294967295],...policy.ipv4Ranges.slice(1)]}));
 assert.throws(()=>validateRuPolicy({...policy,ipv4Ranges:[...policy.ipv4Ranges].reverse()}));
});

const libraries=Object.assign({},...await Promise.all(['rules','proxy','latency','version','ru-policy'].map(async name=>await import(pathToFileURL(`${root}/lib/${name}.js`)))));
let source=await fs.readFile(root+'/src/background.js','utf8');
source=source.replace(/^import\s+\{[\s\S]*?\}\s+from\s+["'][^"']+["'];?\s*/gm,'');
source=source.slice(0,source.lastIndexOf('\ninitialize().catch('));
function runtime(fetchImpl){
 let state={enabled:true,activeServerId:'owner',servers:[{id:'owner',name:'Owner',host:'vpn.example.net',port:18443,scheme:'https',username:'owner',password:'test-only'}],communityDomains:['youtube.com'],ruPolicy:structuredClone(policy),proxyRevision:3};
 const applied=[],event={addListener(){}};
 const chrome={storage:{local:{async get(){return {state:structuredClone(state)}},async set(v){if(v.state)state=structuredClone(v.state)}}},
   proxy:{settings:{async set(v){applied.push(v)},async clear(){}},onProxyError:event},action:{async setBadgeText(){},async setBadgeBackgroundColor(){},async setTitle(){}},
   runtime:{onMessage:event,onInstalled:event,onStartup:event,getManifest(){return {version:'0.9.2'}}},alarms:{onAlarm:event},webRequest:{onAuthRequired:event,onCompleted:event,onErrorOccurred:event}};
 const ctx=vm.createContext({...libraries,chrome,fetch:fetchImpl,URL,AbortSignal,crypto:webcrypto,TextEncoder,btoa,setTimeout,clearTimeout,console});
 vm.runInContext(source+'\nthis.tests={refreshRuPolicy,getState,saveState};',ctx);
 return {api:ctx.tests,stored:()=>structuredClone(state),applied};
}
test('failed refresh keeps last good rules and account credentials',async()=>{
 const r=runtime(async()=>{throw new Error('offline')});
 await assert.rejects(r.api.refreshRuPolicy(),/offline/);
 assert.equal(r.stored().ruPolicy.id,policy.id);assert.equal(r.stored().servers[0].password,'test-only');
 assert.equal(r.applied.length,0);assert.equal(r.stored().ruPolicyError,'offline');
});
test('a complete new revision replaces removed entries without losing a concurrent server change',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve});
 const revised={...policy,id:'b'.repeat(64),domainSuffixes:policy.domainSuffixes.filter(d=>d!=='vk-cdn.net')};
 const r=runtime(async url=>{assert.equal(url,ruPolicyUrlForHost('vpn.example.net'));await pending;return {ok:true,text:async()=>JSON.stringify(revised)}});
 const update=r.api.refreshRuPolicy();
 const old=await r.api.getState();await r.api.saveState({...old,activeServerId:'friend',servers:[...old.servers,{...old.servers[0],id:'friend',port:18453,username:'friend'}]});
 finish();await update;
 assert.equal(r.stored().activeServerId,'friend');assert.equal(r.stored().servers[1].port,18453);
 assert.equal(r.stored().ruPolicy.id,revised.id);assert.ok(!r.stored().ruPolicy.domainSuffixes.includes('vk-cdn.net'));
 assert.equal(r.applied.length,1);assert.ok(r.applied[0].value.pacScript.data.includes('18453'));
});
