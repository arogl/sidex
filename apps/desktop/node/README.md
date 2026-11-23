# Bundled Node.js

Holds the Node.js binary that Tauri bundles (`node/**/*` in `tauri.conf.json`) for the real extension host.
Stage it with `bun run build:node`; the binary is not committed. This file keeps the bundle glob matching
when no binary has been staged.
