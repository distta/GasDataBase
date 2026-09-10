"""Static contracts and real-sample checks for the new catalogue."""
from html.parser import HTMLParser
from pathlib import Path
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
        self.assertEqual(report["accepted"], 8)
        self.assertFalse(report["rejected"])
        for record in payload["files"]:
            self.assertTrue(record["path"].startswith("GasDataBase/Ar_iC4H10/"))
            self.assertEqual(record["magnetic_fields"], [0, 1])
            self.assertEqual(record["dimensions"]["electric"], 31)
            self.assertEqual(record["reference_check"]["missing_magnetic_points"], [])

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
