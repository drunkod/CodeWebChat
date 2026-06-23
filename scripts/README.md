# CodeWebChat test scripts

All scripts run inside the nix dev shell by default. If you're already inside
`nix develop`, prefix with `CWC_NO_NIX=1` to skip the wrapper.

| Script                   | What it does                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `build.sh`               | `pnpm install` + build MCP server + browser extension                                |
| `test.sh`                | MCP server test suite (expect 21 pass / 0 fail / 2 skipped on macOS)                 |
| `jazz-server.sh`         | Start the standalone `jazz-tools@alpha server` for local Jazz sync                   |
| `run-jazz-external.sh`   | Run MCP server in Jazz mode against a standalone external sync server                |
| `test-jazz-canary.sh`    | Schema-admin canary — run FIRST after any jazz upgrade                               |
| `test-jazz-roundtrip.sh` | Real two-peer Jazz roundtrip (no browser). `JAZZ_DEBUG=1` for logs                   |
| `test-jazz-mcp-e2e.sh`   | Headless E2E: standalone Jazz server + schema deploy + MCP stdio + fake browser peer |
| `inspect-ws.sh`          | MCP Inspector → server in ws/clipboard mode (the working path)                       |
| `inspect-jazz.sh`        | MCP Inspector → server in Jazz mode via the validated standalone sync path           |

## Recommended order

```bash
scripts/build.sh
scripts/test.sh                # automated suite green?
scripts/inspect-ws.sh          # drive the real pipeline via the Inspector UI

# Jazz standalone sync server flow:
scripts/jazz-server.sh
npx jazz-tools@alpha deploy "$(cat .jazz/app-id)" --schema-dir packages/shared/src/jazz --server-url http://localhost:1625 --admin-secret cwc-rt-admin
JAZZ_EXTERNAL_SERVER=1 CWC_RUN_JAZZ_SCHEMA_ADMIN_CHECK=1 scripts/test-jazz-canary.sh

# MCP stdio against the standalone server; run from inside `nix develop`:
scripts/run-jazz-external.sh

# Jazz automated checks / Inspector:
scripts/test-jazz-canary.sh    # should PASS on alpha.51 (the old 404 was a non-UUID app id)
scripts/test-jazz-roundtrip.sh # real two-peer roundtrip
scripts/test-jazz-mcp-e2e.sh  # MCP tool roundtrip with fake browser Jazz peer
scripts/inspect-jazz.sh
```

## Notes

- ws + clipboard is the default/working transport. Jazz is behind `--transport jazz`.
- Jazz app IDs MUST be UUIDs — the scripts persist one in `.jazz/app-id`. The
  original `404 /apps/{appId}/admin/schemas` was caused by a non-UUID app id
  ("cwc-local-dev"), not a missing endpoint; with a UUID the schema-admin
  endpoint works and the canary passes.
- For Jazz cross-peer sync, the standalone `jazz-tools@alpha server` +
  `scripts/run-jazz-external.sh` is the validated path (schema deployed via
  `jazz-tools deploy`).
- `scripts/run-jazz-external.sh` is intended for MCP stdio, so run it from inside
  `nix develop` instead of wrapping it in `nix develop -c`.
- `jazz-napi` has no Linux-arm64 native binary, so Jazz tests can't run on that
  platform (macOS arm64/x64, Linux x64, Windows x64 are fine).
