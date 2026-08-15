#!/usr/bin/env python3
"""Snapshot the Figma file into design-mirror/ via the REST API.

Reads FIGMA_API_KEY from .env (or the environment). Fetches spec JSON for the
screens + component masters referenced by the issue backlog, renders PNGs for
every node id (screens at 1x, components at 2x), and writes a manifest.

Usage: python3 scripts/figma-snapshot.py
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

FILE_KEY = "PUJtQssPDolWK5S3ZDScvW"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "design-mirror"

SCREENS = [  # rendered at 1x (native 1280px)
    "618:3523", "618:3589", "619:123", "619:196", "618:3808",
    "618:5939", "638:6991", "618:7435", "618:3676", "618:6405",
    "618:6558", "618:6109", "618:6162", "694:1786",
]
# Top-level masters whose subtrees carry all variant specs.
MASTERS = [
    "618:7752", "626:8142", "618:7316", "626:8117", "626:8227",
    "626:8293", "626:8290", "632:3607", "632:3934", "626:8244",
    "626:8262", "632:4169", "638:6529", "638:6570", "638:6623", "638:6689",
]
# Individual variants rendered at 2x for state-by-state pixel matching.
VARIANTS = [
    "618:7751", "638:6384", "634:915", "638:6481", "634:955", "634:993",
    "634:1031", "634:1069", "634:1105", "634:1141",
    "626:8116", "626:8118", "626:8226", "628:802", "628:814", "628:828",
    "628:840", "628:852", "628:864", "628:876",
    "626:8288", "626:8289", "618:7660", "632:3608",
    "626:8243", "626:8245", "626:8261", "632:1461", "626:8263",
    "632:3933", "632:3935", "638:6728",
    "643:1011", "584:7995", "643:844", "643:923", "643:1111", "584:7811",
]


def token() -> str:
    if os.environ.get("FIGMA_API_KEY"):
        return os.environ["FIGMA_API_KEY"]
    env = ROOT / ".env"
    if env.exists():
        m = re.search(r"^FIGMA_API_KEY=(.+)$", env.read_text(), re.M)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    sys.exit("FIGMA_API_KEY not found in environment or .env")


def api(path: str, tok: str):
    req = urllib.request.Request(
        f"https://api.figma.com{path}", headers={"X-Figma-Token": tok}
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def download(url: str, dest: Path):
    for attempt in range(4):
        r = subprocess.run(
            ["curl", "-sSf", "--retry", "3", "-o", str(dest), url],
            capture_output=True, text=True,
        )
        if r.returncode == 0:
            return
        time.sleep(2 * (attempt + 1))
    sys.exit(f"download failed after retries: {url}\n{r.stderr}")


def walk_names(node, out):
    out[node["id"]] = node.get("name", "")
    for child in node.get("children", []):
        walk_names(child, out)


def write_spec_shards(spec: dict) -> int:
    spec_dir = OUT / "spec"
    spec_dir.mkdir(parents=True, exist_ok=True)
    spec_index = {}
    for nid, entry in spec.get("nodes", {}).items():
        fname = f"{nid.replace(':', '-')}.json"
        text = json.dumps(entry, indent=1)
        (spec_dir / fname).write_text(text)
        doc_name = ""
        if entry and entry.get("document"):
            doc_name = entry["document"].get("name", "")
        spec_index[nid] = {
            "name": doc_name,
            "file": f"spec/{fname}",
            "bytes": len(text.encode("utf-8")),
        }
    (OUT / "spec-index.json").write_text(json.dumps(spec_index, indent=1))
    return len(spec_index)


def main():
    tok = token()
    frames_dir = OUT / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    spec_ids = ",".join(SCREENS + MASTERS)
    print(f"Fetching spec JSON for {len(SCREENS + MASTERS)} subtrees…")
    spec = api(f"/v1/files/{FILE_KEY}/nodes?ids={spec_ids}", tok)
    shard_count = write_spec_shards(spec)

    names: dict[str, str] = {}
    missing_spec = []
    for nid, entry in spec.get("nodes", {}).items():
        if entry is None:
            missing_spec.append(nid)
        else:
            walk_names(entry["document"], names)

    manifest = {}
    render_plan = [(SCREENS, 1), (MASTERS + VARIANTS, 2)]
    missing_render = []
    for ids, scale in render_plan:
        print(f"Rendering {len(ids)} nodes at {scale}x…")
        res = api(
            f"/v1/images/{FILE_KEY}?ids={','.join(ids)}&format=png&scale={scale}",
            tok,
        )
        if res.get("err"):
            sys.exit(f"images endpoint error: {res['err']}")
        for nid in ids:
            url = res["images"].get(nid)
            if not url:
                missing_render.append(nid)
                continue
            fname = f"{nid.replace(':', '-')}@{scale}x.png"
            download(url, frames_dir / fname)
            manifest[nid] = {
                "name": names.get(nid, ""),
                "png": f"frames/{fname}",
                "scale": scale,
            }

    manifest_doc = {
        "file_key": FILE_KEY,
        "file_url": f"https://www.figma.com/design/{FILE_KEY}/Social-Scheduling",
        "snapshot_last_modified": spec.get("lastModified"),
        "nodes": manifest,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest_doc, indent=1))

    print(
        f"Done. {len(manifest)} PNGs, {shard_count} spec shards + "
        "spec-index.json + manifest.json in design-mirror/"
    )
    if missing_spec:
        print(f"WARNING — ids with no spec subtree: {missing_spec}")
    if missing_render:
        print(f"WARNING — ids that failed to render: {missing_render}")


if __name__ == "__main__":
    main()
