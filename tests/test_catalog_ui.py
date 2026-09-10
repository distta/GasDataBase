"""Static contracts and real-sample checks for the new catalogue."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
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
        self.assertEqual({r['path'] for r in payload['files']}, set(provenance))
        self.assertEqual(report['accepted'], len(provenance))
        self.assertTrue(any(p.get('origin') == 'legacy' for p in provenance.values()))
        for record in payload["files"]:
            source = provenance[record['path']]
            self.assertEqual(hashlib.sha256((ROOT / record['path']).read_bytes()).hexdigest(), source['sha256'])
            self.assertTrue(source['source_files'])
            if source.get('origin') == 'legacy':
                self.assertTrue(all(s['sha256'] == source['sha256'] for s in source['source_files']))
                self.assertIsNone(source['config']['penning_enabled'])
            else:
                self.assertEqual(record['dimensions']['electric'], 31)
                self.assertEqual(record['reference_check']['missing_magnetic_points'],
                                 [b for b in [0, 1] if b not in record['magnetic_fields']])

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
