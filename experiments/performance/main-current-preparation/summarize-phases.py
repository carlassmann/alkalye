"""Unrun adapter: reuse the verified full-task summarizer for separate input/Undo traces."""
import json
import pathlib
import subprocess
import sys
import tempfile

source = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
summarizer = pathlib.Path(sys.argv[3])
rows = json.loads(source.read_text())
phases = []
for row in rows:
    phases.append({**row, "cell": row["cell"] + ":input",
                   "status": "complete" if row.get("editedReceipt") else row["status"],
                   "stage": None if row.get("editedReceipt") else row.get("stage"),
                   "error": None if row.get("editedReceipt") else row.get("error")})
    if row.get("undoTrace"):
        phases.append({**row, "cell": row["cell"] + ":undo",
                       "trace": row["undoTrace"], "observation": row.get("undoObservation") or {},
                       "status": "complete" if row.get("undoReceipt") else "failed"})
with tempfile.TemporaryDirectory() as directory:
    adapted = pathlib.Path(directory) / "phases.json"
    adapted.write_text(json.dumps(phases))
    subprocess.run([sys.executable, str(summarizer), str(adapted), str(output)], check=True)
