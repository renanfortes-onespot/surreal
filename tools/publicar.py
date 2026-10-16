# -*- coding: utf-8 -*-
"""Carimba a versão antes de publicar: version.json + window.SG_BUILD nas páginas + cache do sw.js.
   python -I -X utf8 tools/publicar.py   (depois: git add -A, commit e push)"""
import os, re, json, datetime
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
v = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
with open(os.path.join(R, 'version.json'), 'w', encoding='utf-8') as f:
    json.dump({'v': v}, f)
for p in ('index.html', 'gestao/index.html'):
    fp = os.path.join(R, p); s = open(fp, encoding='utf-8').read()
    s, n = re.subn(r"window\.SG_BUILD='[^']*';", "window.SG_BUILD='%s';" % v, s)
    assert n == 1, p
    open(fp, 'w', encoding='utf-8').write(s)
fp = os.path.join(R, 'sw.js'); s = open(fp, encoding='utf-8').read()
s = re.sub(r"const CACHE = 'surreal-[^']*';", "const CACHE = 'surreal-%s';" % v, s)
open(fp, 'w', encoding='utf-8').write(s)
print('versão', v)
