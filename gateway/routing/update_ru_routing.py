#!/usr/bin/env python3
"""Build validated, atomic, data-only routing lists. Never publishes VPN secrets."""
import argparse
import concurrent.futures
import datetime
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import tempfile
import urllib.request
import zipfile

SOURCES = {
    'domains': 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ru.yaml',
    'ipv4': 'https://www.ipdeny.com/ipblocks/data/aggregated/ru-aggregated.zone',
    'ipv6': 'https://www.ipdeny.com/ipv6/ipaddresses/aggregated/ru-aggregated.zone',
}
PROTECTED = ['openai.com','chatgpt.com','claude.ai','youtube.com','googlevideo.com','telegram.org','t.me','discord.com','instagram.com','whatsapp.com']
BUILTIN = ['ru','su','xn--p1ai','max.ru','oneme.ru','vk.com','vk.me','userapi.com','vk-cdn.net','ok.ru','yandex.com','yandex.net','yastatic.net','sberbank.ru','gosuslugi.ru']

def domain(value):
    value = value.strip().lower().rstrip('.').encode('idna').decode('ascii')
    if not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)*', value) or len(value)>253:
        raise ValueError('Invalid domain in upstream')
    return value

def parse_domains(text):
    suffixes=set(BUILTIN);exact=set()
    lines=text.splitlines()
    if not lines or lines[0].strip()!='payload:':raise ValueError('Unexpected domain format')
    count=0
    for line in lines[1:]:
        value=line.strip()
        if not value or value.startswith('#'):continue
        if not value.startswith('- '):raise ValueError('Unexpected domain entry')
        value=value[2:].strip().strip("'\"")
        target=suffixes if value.startswith('+.') else exact
        target.add(domain(value[2:] if value.startswith('+.') else value));count+=1
    if not 500<count<20000:raise ValueError('Suspicious domain count')
    # Keep the most general suffix, preserving exact-only semantics elsewhere.
    suffixes={d for d in suffixes if not any('.'.join(d.split('.')[i:]) in suffixes for i in range(1,len(d.split('.'))))}
    exact={d for d in exact if not any(d==s or d.endswith('.'+s) for s in suffixes)}
    for host in PROTECTED:
        if host in exact or any(host==s or host.endswith('.'+s) for s in suffixes):raise ValueError('Foreign VPN destination in direct list')
    if not 100<len(suffixes)<10000:raise ValueError('Suspicious suffix coverage')
    return sorted(suffixes),sorted(exact)

def parse_networks(text,version):
    networks=sorted(set(ipaddress.ip_network(line.strip()) for line in text.splitlines() if line.strip()))
    if not (1000<len(networks)<50000 if version==4 else 100<len(networks)<20000):raise ValueError('Suspicious IP count')
    for n in networks:
        if n.version!=version or n.prefixlen<(8 if version==4 else 12) or not n.network_address.is_global:raise ValueError('Unsafe country range')
    networks=list(ipaddress.collapse_addresses(networks))
    if version==4 and not 1_000_000<sum(n.num_addresses for n in networks)<200_000_000:raise ValueError('Unsafe IPv4 coverage')
    return networks

def intervals(networks):
    result=[]
    for n in networks:
        start,end=int(n.network_address),int(n.broadcast_address)
        if result and start<=result[-1][1]+1:result[-1][1]=max(end,result[-1][1])
        else:result.append([start,end])
    return result

def download(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Routeva-Routing/1.0'})
    with urllib.request.urlopen(req,timeout=35) as response:data=response.read(2_000_001)
    if len(data)>2_000_000:raise ValueError('Upstream too large')
    return data.decode('utf-8-sig')

def resolve(host):
    if '.' not in host:return host,[]
    try:
        p=subprocess.run(['getent','ahostsv4',host],capture_output=True,text=True,timeout=3)
        ips=sorted({line.split()[0] for line in p.stdout.splitlines() if line.split() and ipaddress.ip_address(line.split()[0]).is_global})
        return host,ips
    except (OSError,subprocess.TimeoutExpired,ValueError):return host,[]

def build(source_texts,resolve_domains=True):
    suffixes,exact=parse_domains(source_texts['domains'])
    v4=parse_networks(source_texts['ipv4'],4);v6=parse_networks(source_texts['ipv6'],6)
    content={'schemaVersion':1,'domainSuffixes':suffixes,'exactDomains':exact,'ipv4Ranges':intervals(v4),
             'ipv4Cidrs':[str(n) for n in v4],'ipv6Cidrs':[str(n) for n in v6]}
    digest=hashlib.sha256(json.dumps(content,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    stamp=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
    policy={**content,'id':digest,'generatedAt':stamp,'refreshHours':6,'sources':SOURCES}
    amnezia=[{'hostname':str(n),'ip':str(n),'ips':[str(n)]} for n in v4]
    resolved={}
    if resolve_domains:
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            resolved={host:ips for host,ips in pool.map(resolve,[*suffixes,*exact]) if ips}
        amnezia += [{'hostname':host,'ip':ips[0],'ips':ips} for host,ips in sorted(resolved.items())]
    return policy,amnezia,len(resolved)

def publish(root,policy,amnezia,resolved_count,source_texts=None):
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=True)
    current=root/'current'
    if (current/'ru-direct.json').exists():
        old=json.loads((current/'ru-direct.json').read_text())
        for key in ['domainSuffixes','ipv4Ranges']:
            if len(policy[key])<len(old[key])*.7:raise ValueError('Unexpected shrink; previous release retained')
    temp=pathlib.Path(tempfile.mkdtemp(prefix='release-',dir=root))
    try:
        temp.chmod(0o755)
        files={'ru-direct.json':policy,'amnezia-ru-direct.json':amnezia,
               'status.json':{'id':policy['id'],'updatedAt':policy['generatedAt'],'domainSuffixes':len(policy['domainSuffixes']),
                   'exactDomains':len(policy['exactDomains']),'ipv4Cidrs':len(policy['ipv4Cidrs']),
                   'ipv6Cidrs':len(policy['ipv6Cidrs']),'resolvedDomains':resolved_count,'sources':SOURCES}}
        for name,data in files.items():
            (temp/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n');(temp/name).chmod(0o644)
        (temp/'ru-ipv4.txt').write_text('\n'.join(policy['ipv4Cidrs'])+'\n');(temp/'ru-ipv4.txt').chmod(0o644)
        (temp/'ru-domains.txt').write_text('\n'.join(policy['domainSuffixes']+policy['exactDomains'])+'\n');(temp/'ru-domains.txt').chmod(0o644)
        (temp/'SOURCES.txt').write_text('Domain snapshot: MetaCubeX/meta-rules-dat (GPL-3.0), derived from v2fly/domain-list-community (MIT).\nRouting code is an independent MIT-licensed reader.\nCountry IP data: IPdeny, https://www.ipdeny.com/ipblocks/ ; see licenses/IPdeny-Copyrights.txt.\n'+json.dumps(SOURCES,indent=2)+'\n');(temp/'SOURCES.txt').chmod(0o644)
        licenses=pathlib.Path(__file__).parent/'licenses'
        if not licenses.is_dir():raise ValueError('Install the accompanying source licenses before publishing')
        shutil.copytree(licenses,temp/'licenses');(temp/'licenses').chmod(0o755)
        for license_file in (temp/'licenses').iterdir():license_file.chmod(0o644)
        if source_texts:
            (temp/'source-category-ru.yaml').write_text(source_texts['domains']);(temp/'source-category-ru.yaml').chmod(0o644)
        with zipfile.ZipFile(temp/'amnezia-ru-direct.zip','w',zipfile.ZIP_DEFLATED) as archive:
            for item in [temp/'amnezia-ru-direct.json',temp/'SOURCES.txt',*(temp/'licenses').iterdir()]:archive.write(item,item.relative_to(temp))
        (temp/'amnezia-ru-direct.zip').chmod(0o644)
        link=root/'.current-next'
        link.unlink(missing_ok=True);link.symlink_to(temp.name,target_is_directory=True);os.replace(link,current)
        print(json.dumps(files['status.json']))
    except BaseException:
        shutil.rmtree(temp);raise

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',default='/var/lib/routeva-rules');parser.add_argument('--fixtures');parser.add_argument('--no-resolve',action='store_true');args=parser.parse_args()
    if args.fixtures:
        texts={key:pathlib.Path(args.fixtures,'source-'+{'domains':'category','ipv4':'geoip4','ipv6':'geoip6'}[key]+'.txt').read_text() for key in SOURCES}
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:texts=dict(zip(SOURCES,pool.map(download,SOURCES.values())))
    policy,amnezia,count=build(texts,not args.no_resolve);publish(args.root,policy,amnezia,count,texts)

if __name__=='__main__':main()
