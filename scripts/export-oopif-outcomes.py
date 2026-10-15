"""Export only opaque test IDs and outcome enums from a private Playwright report."""
import base64
import io
import json
import re
import sys
import zipfile
from pathlib import Path


def export(source):
    try:
        if source.stat().st_size > 64 * 1024 * 1024:
            return {"available": False}
        match = re.search(r'<template id="playwrightReportBase64">data:application/zip;base64,([^<]+)</template>', source.read_text())
        if not match:
            return {"available": False}
        archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(match[1], validate=True)))

        def read(name):
            if archive.getinfo(name).file_size > 32 * 1024 * 1024:
                raise ValueError("bounded report")
            return json.loads(archive.read(name))

        report = read("report.json")
        tests = []
        for file in report["files"]:
            file_id = file["fileId"]
            if not isinstance(file_id, str) or not re.fullmatch(r"[a-f0-9]{20}", file_id):
                raise ValueError("opaque file ID required")
            details = read(file_id + ".json")
            outcomes = {test["testId"]: test["outcome"] for test in file["tests"]}
            for test in details["tests"]:
                test_id = test["testId"]
                if not re.fullmatch(r"[a-f0-9]{20}-[a-f0-9]{20}", test_id):
                    raise ValueError("opaque test ID required")
                attempts = []
                for result in test["results"]:
                    status = result.get("status")
                    retry = result.get("retry")
                    if status not in ["passed", "failed", "timedOut", "skipped", "interrupted"] or retry not in [0, 1]:
                        raise ValueError("unexpected attempt")
                    attempts.append({"retry": retry, "status": status})
                if len(attempts) > 2:
                    raise ValueError("unexpected retry count")
                outcome = outcomes[test_id]
                if outcome not in ["expected", "unexpected", "flaky", "skipped"]:
                    raise ValueError("unexpected outcome")
                tests.append({"id": test_id, "outcome": outcome, "attempts": attempts})
        result = {"available": True, "globalErrorCount": len(report.get("errors", [])), "tests": tests}
        if len(tests) > 200 or len(json.dumps(result)) > 65536:
            return {"available": False}
        return result
    except Exception:
        # Do not export parser errors: they may contain raw input or private paths.
        return {"available": False}


if __name__ == "__main__":
    Path(sys.argv[2]).write_text(json.dumps(export(Path(sys.argv[1]))))
