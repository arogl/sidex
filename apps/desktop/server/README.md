# Agent server

Holds the built `sidex-server` binary that Tauri bundles (`server/*` in `tauri.conf.json`).
Build it with `bun run build:server`; the binary is not committed. This file keeps the bundle glob
matching on targets that have no server build.
