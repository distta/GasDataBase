"""Static contracts and real-sample checks for the new catalogue."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
import tempfile
import unittest

from tools import catalog

ROOT = Path(__file__).resolve().parents[1]


class Elements(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.ids = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])


class CatalogueTests(unittest.TestCase):
    def test_actual_sample_scope_and_conditions(self):
        payload, report = catalog.assemble(ROOT)
        self.assertFalse(report["rejected"])
        provenance = json.loads((ROOT / 'catalog/provenance.json').read_text())['files']
        metadata = json.loads((ROOT / 'catalog/metadata.json').read_text())['files']
        current = {p for p in provenance if metadata.get(p, {}).get('status', 'current') == 'current'}
        self.assertEqual({r['path'] for r in payload['files']}, current)
        self.assertEqual(report['accepted'], len(current))
        self.assertEqual({p.relative_to(ROOT).as_posix() for p in (ROOT / 'GasDataBase').rglob('*.gas')}, set(provenance))
        self.assertEqual({r['path'] for r in report['ignored']}, set(provenance) - current)
        self.assertTrue(any(p.get('origin') == 'legacy' for p in provenance.values()))
        for path, source in provenance.items():
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), source['sha256'])
            self.assertTrue(source['source_files'])
            if source.get('origin') in {'legacy', 'user-import'}:
                self.assertTrue(all(s['sha256'] == source['sha256'] for s in source['source_files']))
                self.assertIsNone(source['config']['penning_enabled'])
        for record in payload["files"]:
            source = provenance[record['path']]
            self.assertEqual(len(record['magnetic_fields']), 1)
            self.assertEqual(len(record['angles_deg']), 1)
            config = source['config']
            parts = sorted(config['components'].items(), key=lambda item: catalog.component_order(item[0]))
            expected = '_'.join(f'{name}-{value:g}' for name, value in parts)
            expected += f'_T{config["temperature_k"]:g}K_P{config["pressure_torr"]:g}Torr'
            expected += f'_B{record["magnetic_fields"][0]:g}T_A{record["angles_deg"][0]:g}deg.gas'
            actual_name = Path(record['path']).name
            if '__legacy-' in actual_name:
                self.assertEqual(source.get('origin'), 'legacy-supplement')
                expected = expected[:-4] + '__legacy-' + source['restored_from']['sha256'][:12] + '.gas'
            self.assertEqual(actual_name, expected)
            self.assertEqual(record['download_name'], actual_name)
            if source.get('origin') not in {'legacy', 'user-import'}:
                self.assertEqual(record['dimensions']['electric'], len(source['config']['electric_fields_v_cm']))
                self.assertTrue(all(any(catalog.close(e, v) for v in source['config']['electric_fields_v_cm'])
                                    for e in record['electric_fields']))
                self.assertEqual(record['reference_check']['missing_magnetic_points'],
                                 [b for b in [0, 1] if b not in record['magnetic_fields']])

    def test_disjoint_magnetic_tables_and_overlap_rejection(self):
        payload, _ = catalog.assemble(ROOT)
        sample = next(f for f in payload['files'] if len(f['magnetic_fields']) == 1)
        original = (ROOT / sample['path']).read_text()
        def with_b(value):
            return re.sub(r'(B fields\s+).*?(?=Mixture\b)',
                          lambda m: m[1] + str(value) + '\n ', original, flags=re.S)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'catalog').mkdir()
            folder = root / 'GasDataBase/test'
            folder.mkdir(parents=True)
            config = json.loads((ROOT / 'catalog/config.json').read_text())
            config['collections'] = [{'id': 'test', 'label': 'test', 'directory': 'GasDataBase/test'}]
            (root / 'catalog/config.json').write_text(json.dumps(config))
            (root / 'catalog/metadata.json').write_text(json.dumps({'schema_version': 1, 'files': {}}))
            (root / 'catalog/gas_aliases.json').write_bytes((ROOT / 'catalog/gas_aliases.json').read_bytes())
            (folder / 'a.gas').write_text(with_b(0))
            (folder / 'b.gas').write_text(with_b(100))
            data, report = catalog.assemble(root)
            self.assertEqual(len(data['files']), 2)
            self.assertFalse(report['rejected'])
            self.assertEqual(len({f['download_name'] for f in data['files']}), 2)
            (folder / 'b.gas').write_text(with_b(0) + '\n')
            _, report = catalog.assemble(root)
            self.assertEqual(len(report['rejected']), 1)
            shifted = re.sub(r'(E fields\s+)(.*?)(?=E-B angles)',
                             lambda m: m[1] + ' '.join(str(x + .123456)
                                 for x in catalog.legacy.parse_float_tokens(m[2])) + '\n ',
                             with_b(0), flags=re.S)
            (folder / 'b.gas').write_text(shifted)
            data, report = catalog.assemble(root)
            self.assertEqual(len(data['files']), 2)
            self.assertFalse(report['rejected'])

    def test_classified_paths_follow_component_count(self):
        cases = [(['CO2', 'Ar'], 'GasDataBase/Ar+X/Ar_CO2'),
                 (['O2', 'Ar', 'CH4'], 'GasDataBase/Ar+X+Y/Ar_CH4_O2'),
                 (['He'], 'GasDataBase/Pure/He'),
                 (['CF4', 'Ne'], 'GasDataBase/Ne+X/Ne_CF4'),
                 (['CH4', 'CO2'], 'GasDataBase/X+Y/CH4_CO2')]
        for components, expected in cases:
            self.assertEqual(catalog.family_directory(components), expected)
        data, _ = catalog.assemble(ROOT)
        for record in data['files']:
            self.assertEqual(str(Path(record['path']).parent),
                             catalog.family_directory([c['name'] for c in record['components']]))

    def test_page_has_one_shared_plot_and_unique_ids(self):
        html = (ROOT / "index.html").read_text()
        ids = Elements(html).ids
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("filterDrawer", ids)
        self.assertIn("returnComparison", ids)
        self.assertNotIn("view-compare", ids)
        self.assertEqual(ids.count("chart"), 1)

    def test_script_references_existing_or_dynamic_elements(self):
        ids = set(Elements((ROOT / "index.html").read_text()).ids)
        script = (ROOT / "assets/js/catalog-app.js").read_text()
        references = set(re.findall(r"\$\('([\w-]+)'\)", script))
        self.assertFalse(references - ids - {"recordIndex", "recordData"})

    def test_maintenance_link_exists(self):
        self.assertTrue((ROOT / "Doc/简易数据库维护说明.md").is_file())

    def test_focused_recipe_interface(self):
        html = (ROOT / "index.html").read_text()
        ids = set(Elements(html).ids)
        self.assertFalse(ids & {"queryText", "collections", "temperatures", "magneticFields"})
        self.assertTrue({"parameterTabs", "showPoints", "plotXAxis"} <= ids)
        self.assertFalse(ids & {'filterB', 'filterAngle', 'filterEMin', 'filterEMax', 'exactSet', 'partialCoverage', 'fractionTolerance'})
        self.assertIn('Better Gas', html)
        self.assertTrue((ROOT / "assets/images/garfield-header.png").is_file())


if __name__ == "__main__":
    unittest.main()
