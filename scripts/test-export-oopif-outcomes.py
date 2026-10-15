"""Offline privacy and failed-attempt preservation checks; no application or network."""
import base64
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("exporter", Path(__file__).with_name("export-oopif-outcomes.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExportTests(unittest.TestCase):
    def test_preserves_failure_without_private_fields(self):
        file_id = "a" * 20
        test_id = file_id + "-" + "b" * 20
        private = "private-page-profile-secret"
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("report.json", json.dumps({"files": [{"fileId": file_id, "fileName": private, "tests": [{"testId": test_id, "outcome": "flaky", "title": private}]}], "errors": [{"message": private}]}))
            archive.writestr(file_id + ".json", json.dumps({"tests": [{"testId": test_id, "results": [{"retry": 0, "status": "failed", "error": private}, {"retry": 1, "status": "passed", "attachments": [private]}]}]}))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.html"
            path.write_text('<template id="playwrightReportBase64">data:application/zip;base64,' + base64.b64encode(stream.getvalue()).decode() + '</template>')
            result = module.export(path)
        self.assertTrue(result["available"])
        self.assertEqual(result["globalErrorCount"], 1)
        self.assertEqual(result["tests"][0]["attempts"], [{"retry": 0, "status": "failed"}, {"retry": 1, "status": "passed"}])
        self.assertNotIn(private, json.dumps(result))

    def test_missing_report_is_unavailable_without_path(self):
        self.assertEqual(module.export(Path("/private-profile/missing.html")), {"available": False})


if __name__ == "__main__":
    unittest.main()
