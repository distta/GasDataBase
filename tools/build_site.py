#!/usr/bin/env python3
"""Package the static Pages site, without computation runs or historical stock."""
import json
import shutil
from pathlib import Path

try:
    from . import catalog
except ImportError:
    import catalog


def build(root):
    if catalog.build(root):
        raise ValueError('目录生成失败')
    site = root / '_site'
    if site.is_symlink():
        raise ValueError('_site 不能为符号链接')
    if site.exists():
        shutil.rmtree(site)
    site.mkdir()
    shutil.copy2(root / 'index.html', site / 'index.html')
    shutil.copytree(root / 'assets', site / 'assets')
    shutil.copytree(root / 'Doc', site / 'Doc')
    (site / 'catalog').mkdir()
    shutil.copy2(root / 'catalog/gases.json', site / 'catalog/gases.json')
    payload = json.loads((root / 'catalog/gases.json').read_text())
    for item in payload['files']:
        source = catalog.safe_path(root, item['path'])
        target = site / item['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    (site / '.nojekyll').touch()
    print(f'Pages site: {site}, {len(payload["files"])} gas files')


if __name__ == '__main__':
    build(Path(__file__).resolve().parents[1])
