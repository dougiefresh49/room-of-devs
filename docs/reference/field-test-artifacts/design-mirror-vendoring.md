<!-- Artifact 4: how the design-mirror snapshot was produced + its layout.
Cited by retro §1 (vendor the source of truth). The producing script is
copied verbatim alongside as figma-snapshot.py. -->

# Vendoring the design source of truth (design-mirror/)

Trigger: Figma MCP calls became quota-blocked on our seats mid-project.
Response: snapshot the file via the plain REST API into the repo, so every
agent (and every future worktree) gets the designs with zero live-service
dependency.

## The REST calls (all of it — two endpoints)

```
# 1. Spec subtrees — exact fills, typography, auto-layout, radii, copy:
GET https://api.figma.com/v1/files/{FILE_KEY}/nodes?ids=618:3523,618:7752,...
    Header: X-Figma-Token: $FIGMA_API_KEY

# 2. Rendered PNGs — returns short-lived S3 URLs to download:
GET https://api.figma.com/v1/images/{FILE_KEY}?ids=...&format=png&scale=1|2
    Header: X-Figma-Token: $FIGMA_API_KEY
```

Node-id lists are hand-curated in the script from the issue backlog:
`SCREENS` (full frames, 1x native 1280px), `MASTERS` (component masters
whose subtrees carry all variant specs, 2x), `VARIANTS` (individual states
for pixel matching, 2x). The key lives in `.env`, never committed.

Producing script: `figma-snapshot.py` (verbatim copy in this directory;
lives at `scripts/figma-snapshot.py` in the repo). Re-run to refresh when
the live file is newer; `manifest.json` records the file's `lastModified`
at snapshot time so staleness is checkable.

## Final sharded layout

```
design-mirror/
├── README.md            # usage rules for implementing agents
├── manifest.json        # node id → { name, png, scale } + snapshot_last_modified
├── spec-index.json      # node id → { name, file, bytes }
├── spec/
│   └── <node-id>.json   # one shard per subtree, ids dash-separated (618-3523.json)
└── frames/
    └── <node-id>@<scale>x.png
```

Sharding matters: the first version was one giant spec.json and it blew up
delegate context windows; PR #31 split it per node id. Rule of thumb —
**shard vendored artifacts by the key agents look things up with.**

## The consumption contract (from design-mirror/README.md)

1. Look up your issue's node ids in `manifest.json` / `spec-index.json`.
2. PNG for layout reference; `spec/<node-id>.json` for exact values + copy.
3. Side-by-side verification against the PNG.
4. A node missing from the mirror gets flagged on the PR and added to the
   script's lists — the mirror stays the single path.
