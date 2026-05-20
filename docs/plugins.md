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
ct plugin config set ado round-minutes 15
ct plugin config get ado round-minutes
ct plugin config list ado
ct plugin schema ado            # required / secret / status / env-var-name per key
```

For sensitive values, see **Plugin secrets** below.

## Plugin config schema (recommended)

Declare every config key your plugin accepts in `plugin.json` under `configSchema`. This drives:

- **Encryption at rest** for keys marked `secret`.
- **`CT_PLUGIN_<ID>_<KEY>` env-var override** for secret keys.
- **Required-key gating** — `ct plugin run <id>` refuses to spawn when a `required: true` key is unset and no env override exists.
- **`ct plugin schema <id>`** — printed help, JSON output via `--json`.

```json
{
  "id": "ado",
  "name": "Azure DevOps Sync",
  "version": "0.1.0",
  "entrypoint": "node sync.js",
  "configSchema": {
    "pat":          { "required": true,  "secret": true,  "description": "Personal access token" },
    "organization": { "required": true,  "secret": false, "description": "ADO org slug" },
    "round-minutes":{ "required": false, "secret": false, "description": "Time bucket (default 15)" }
  }
}
```

Manifests without `configSchema` keep working — they just don't get encryption, env overrides, required-key gating, or schema listings.

## Plugin secrets

Central Tracking has **one** standard for secret storage. It applies to plugin config today, and any future call site in main can reuse the same `src/main/secretStorage.ts` module.

**At rest.** Values for keys declared `secret: true` are encrypted with Electron `safeStorage` (OS keychain: macOS Keychain, Windows DPAPI, Linux libsecret/kwallet) and stored in `plugin_config.value` with the sentinel prefix `enc:v1:<base64>`. There is no separate secrets table — same column, self-describing format. The DB file (`{userData}/central-tracking.db`) lives under the OS user data dir and is never checked into git.

**On the wire.** Plugin config moves over the loopback HTTP server (`127.0.0.1`, bearer-token auth, host header validation). The body is JSON. Cleartext only flows to the plugin process after it presents the session token; the renderer's IPC bridge has no way to ask for cleartext (no `reveal` opt by design).

**On screen.** `ct plugin config list <id>` masks secret values:

- `[encrypted]` — value is encrypted at rest (expected).
- `[plaintext-secret]` — value is declared-secret but stored plaintext (legacy or explicit `--allow-plaintext`). Re-set the value to migrate.

Use `--reveal` to print cleartext. Both `get` and `list` accept the flag.

**In the shell.** Never paste a secret as a positional argument — it ends up in your shell history. Instead pipe via stdin:

```bash
echo "$ADO_PAT" | ct plugin config set ado pat --secret-from-stdin
# or, even better, source from a password manager
op read 'op://Personal/ADO/pat' | ct plugin config set ado pat --secret-from-stdin
```

`--secret-from-stdin` implies `--secret`. The single trailing newline is stripped.

**At run time, without storing.** Declared-secret keys can be sourced from env vars instead of (or overriding) the DB. The env-var name is `CT_PLUGIN_<ID_UPPER>_<KEY_UPPER>` with hyphens converted to underscores on both sides.

```bash
export CT_PLUGIN_ADO_PAT="$(op read 'op://Personal/ADO/pat')"
ct plugin run ado sync           # plugin sees the env value, no DB write needed
```

Non-secret keys are NOT env-overridable — shadowing values like `round-minutes` would be surprising. Use `ct plugin config set` for those.

**When `safeStorage` is unavailable.** On Linux without `libsecret-1-0` / `gnome-keyring` / `kwalletd`, `--secret` writes fail with `NO_KEYRING` and the error message lists remediation packages. Install the relevant package, ensure the session keyring is unlocked, then retry. As a last-resort opt-out, `--allow-plaintext` proceeds (value stored plaintext + a warning is printed). The flag must be explicit per write.

**What gets logged.** Nothing. The logger (`src/main/logger.ts`) never reads config values, and the loopback HTTP server never logs request bodies.

**Re-using the same standard from new code.** If you need to store a secret outside the plugin config path, import `src/main/secretStorage.ts`:

```ts
import * as secretStorage from '../secretStorage';
const stored = secretStorage.encrypt(value);   // throws DomainError('NO_KEYRING', …) if unavailable
const value  = secretStorage.decrypt(stored);  // passes plaintext through unchanged
```

The sentinel-prefix convention is `enc:v1:<base64>`; `isEncrypted()` is the predicate. Same module, same on-disk shape, one place to upgrade if the encryption format ever changes.

## Running a plugin

```bash
ct plugin run ado
```

`ct plugin run` spawns the manifest's `entrypoint` with env vars: `CT_PLUGIN_ID`, `CT_SERVER_URL` (loopback), and `CT_TOKEN` (session bearer token). The plugin can call back into the HTTP API with that token, and verify incoming webhook signatures with the same token.

## Webhook payloads

JSON shape: `{ version, event, route, data, timestamp }`

| Field | Type | Notes |
|---|---|---|
| `version` | `"1"` | Envelope version. Bumps on breaking change. Plugins MUST tolerate unknown versions (log + accept) rather than hard-fail. |
| `event` | string | e.g. `task.created`, `timeEntry.stopped`, `comment.updated`. Source of truth: `event` field on the route in `src/main/server/apiManifest.ts`. |
| `route` | string | The HTTP route that produced the event, e.g. `tasks/create`. |
| `data` | unknown | The handler return value. Shape varies by event; consult the route's handler. |
| `timestamp` | ISO string | When the envelope was built. |

Envelope versioning rules:

- Additive change (new optional field on `data`, new event name, new top-level optional field): no bump. Receivers must tolerate unknown fields.
- Breaking change (field renamed, semantics changed, required field removed): bump `version` and treat older versions as a compatibility layer.

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
