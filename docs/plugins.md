# Plugin Development Guide

External integrations run as separate processes and interact with the app through the CLI plus optional webhook subscriptions.

## Plugin manifest (`plugin.json`)

```json
{
  "id": "ado",
  "name": "Azure DevOps Sync",
  "version": "0.1.0",
  "entrypoint": "node sync.js",
  "events": ["task.created", "task.updated", "timeEntry.created"],
  "webhook": { "url": "http://127.0.0.1:9901/ct-events" }
}
```

Webhook URLs must be loopback-only (`127.0.0.1`, `localhost`, or `[::1]`). Events are the `event` fields declared in `src/main/server/apiManifest.ts` (e.g. `task.created`, `timeEntry.stopped`, `category.deleted`). Use `"*"` to match everything.

## Lifecycle

```bash
ct plugin install ./plugin.json   # persists manifest in the plugins table
ct plugin list                    # shows id/version/enabled/webhook
ct plugin disable <id>            # stops webhook delivery
ct plugin enable <id>
ct plugin uninstall <id>          # also clears the plugin's config
```

## Configuration (uses the `plugin_config` table)

```bash
ct plugin config set ado api-key $ADO_TOKEN
ct plugin config get ado api-key
ct plugin config list ado
```

## Running a plugin

```bash
ct plugin run ado
```

`ct plugin run` spawns the manifest's `entrypoint` with env vars: `CT_PLUGIN_ID`, `CT_SERVER_URL` (loopback), and `CT_TOKEN` (session bearer token). The plugin can call back into the HTTP API with that token, and verify incoming webhook signatures with the same token.

## Webhook payloads

JSON shape: `{ event, route, data, timestamp }`

Headers:
- `X-CT-Signature: sha256=<hex>` — HMAC of the body using the session token
- `X-CT-Plugin-Id: <id>`

Delivery is best-effort: failures are logged to stderr and never block the originating mutation.

## Alternative: CLI-only scripts (no install required)

```bash
external-tool list --json | ct import execute - --update-existing
ct task create "External Item" --source plugin
ct time add <task-id> --duration 2h
```
