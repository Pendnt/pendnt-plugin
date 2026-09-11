# pendnt (Claude Code plugin)
> **Try it in 10 seconds — no account:** `curl https://api.pendnt.dev/try?plain=1` returns a 72-hour trial key (20 requests) with a quickstart.

Wires a [Claude Code](https://code.claude.com) session — interactive or headless (`claude -p`) — up
to a [pendnt](../app) workspace: durable human approvals, notifications, and a "run finished" ping,
without the agent needing a terminal.

"pendnt" is a placeholder product name. It's kept in exactly one place — `PRODUCT_NAME` in
[`lib/config.mjs`](lib/config.mjs) — plus the `name` fields in
[`plugin.json`](.claude-plugin/plugin.json), [`marketplace.json`](.claude-plugin/marketplace.json) and
[`.mcp.json`](.mcp.json), and the matching MCP server name registered in
[`/app/src/routes/mcp.ts`](../app/src/routes/mcp.ts). Rename all of those together and it's renamed
everywhere that matters.

This plugin ships two independent ways to answer permission prompts headlessly — pick one (or both;
`--permission-prompt-tool` takes priority when both are wired up, see §1a below):

1. **A `PermissionRequest` hook** (`hooks/permission-request.mjs`) — works with plain `claude -p`, no
   extra flags. Runs automatically before every tool-use prompt.
2. **The `permission_prompt` MCP tool**, via `--permission-prompt-tool mcp__pendnt__permission_prompt` —
   Claude Code's own dedicated mechanism for headless permission prompts (see
   [`INTEGRATIONS.md` §1a](../product/INTEGRATIONS.md)).

Plus a `Notification` hook and a `Stop` hook that both relay to `POST /v1/notify` — see
[What's included](#whats-included) below.

## Install

### Local marketplace (for trying this out before publishing anywhere)

This repo doubles as its own local marketplace — [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)
lists this plugin with `source: "./"`, pointing at the same directory `plugin.json` lives in. From
Claude Code:

```
/plugin marketplace add Pendnt/pendnt-plugin
/plugin install pendnt@pendnt
```

(or non-interactively: `claude plugin marketplace add Pendnt/pendnt-plugin && claude plugin install pendnt@pendnt`)

To publish for real later, split `marketplace.json` out into its own repo with `source` pointing at
this plugin's repo (see [`INTEGRATIONS.md` §1d](../product/INTEGRATIONS.md) for the marketplace
manifest shape and `github`/`git-subdir`/`npm`/`archive` source types), then
`claude plugin marketplace add <owner>/<repo>` from anywhere.

### Env vars

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PENDNT_API_KEY` | yes | — | `Authorization: Bearer <key>` for every call to the API (`aio_...`, from `POST /dev/bootstrap` locally, or your real workspace's API key in production). Without it, the `PermissionRequest`/`Notification`/`Stop` hooks all fail closed (deny / no-op) rather than erroring the session. |
| `PENDNT_URL` | no | `https://api.pendnt.dev` | Base URL of the pendnt REST API — **not** including `/mcp` or `/v1`. Point this at `http://localhost:8787` for local dev against `wrangler dev` (see [below](#running-the-hook-locally-against-wrangler-dev)). |
| `PENDNT_APPROVAL_TIMEOUT_S` | no | `600` (10 min) | Total wall-clock budget the `PermissionRequest` hook spends re-polling before it gives up and denies. Each individual poll is capped server-side at 25s (`wait_s`), so the hook loops `GET /v1/requests/:id?wait_s=25` until this budget runs out. |

Set them in your shell, or in `.claude/settings.json` under `env` — see
[settings.json docs](https://code.claude.com/docs/en/settings). `.mcp.json`'s `${PENDNT_URL:-...}` /
`${PENDNT_API_KEY}` syntax is Claude Code's own env-var expansion for `.mcp.json` values (headers
*and* URLs) — see [`INTEGRATIONS.md` §1e](../product/INTEGRATIONS.md).

## What's included

- **`.mcp.json`** — registers the `pendnt` remote MCP server (`${PENDNT_URL:-https://api.pendnt.dev}/mcp`,
  `Authorization: Bearer ${PENDNT_API_KEY}`) so all 14 tools (`request_approval`, `check_request`,
  `permission_prompt`, `notify`, `create_endpoint`, `list_endpoints`, `wait_for_event`, `schedule_wakeup`,
  `list_wakeups`, `cancel_wakeup`, `kv_get`, `kv_set`, `kv_delete`, `whoami`) are available to the model
  directly, under `mcp__pendnt__<tool>` — except `permission_prompt`, which Claude Code removes from its
  own visible tool list once named by `--permission-prompt-tool` (see below), since it's meant to be
  called by the CLI itself, not by the model.
- **`hooks/hooks.json`** — wires three hooks (shape matches `settings.json`'s `hooks` key, see
  [`INTEGRATIONS.md` §1d](../product/INTEGRATIONS.md)):
  - **`PermissionRequest`** → `hooks/permission-request.mjs`. Fires before every tool-use prompt. POSTs
    a summary of the tool call to `POST /v1/requests` (`kind: "approval"`, `wait_s: 25`,
    `timeout_s: $PENDNT_APPROVAL_TIMEOUT_S`), then re-polls `GET /v1/requests/:id?wait_s=25` until it's
    answered or the total `PENDNT_APPROVAL_TIMEOUT_S` budget elapses. Prints exactly one JSON object per
    [`INTEGRATIONS.md` §1b](../product/INTEGRATIONS.md)'s `PermissionRequest` contract:
    ```json
    { "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow", "updatedInput": {} } } }
    ```
    or `{"behavior": "deny", "message": "..."}`. **Fails closed** on every error path (missing API key,
    network failure, operator denies, request expires, timeout) — the only way to get `allow` is an
    explicit approval. An operator using the answer page's free-text box (always shown, even for
    `kind: "approval"` requests) is treated as approval only if the text starts with
    yes/y/allow/approve/ok — anything else denies with that text as the reason.
  - **`Notification`** → `hooks/notify.mjs`. Relays `notification_type`/`message` to `POST /v1/notify`.
    Cannot block Claude Code (per the hook's own semantics) and never tries to — always exits 0.
  - **`Stop`** → `hooks/stop.mjs`. Relays a `"run finished"` message to `POST /v1/notify` at the end of
    every turn. Never returns `{"decision":"block"}` — it only notifies, it doesn't keep the agent going.
- **`lib/`** — the three hook scripts' shared bits: `config.mjs` (env vars + the `PRODUCT_NAME`
  constant), `client.mjs` (thin `fetch` wrappers for `/v1/requests` and `/v1/notify`), `stdin.mjs` (hook
  stdin JSON parsing). No npm dependencies — plain Node 18+ (`fetch`, `AbortController`) is enough.

## The `--permission-prompt-tool` path (§1a)

Instead of (or in addition to — Claude Code prefers `--permission-prompt-tool` over hooks when both
apply) the `PermissionRequest` hook, you can point Claude Code's dedicated permission-prompt mechanism
directly at the `permission_prompt` MCP tool this plugin's `.mcp.json` registers — the one tool in this
server purpose-built for this flag (see `/app/README.md`'s `permission_prompt` section for the full
contract):

```bash
export PENDNT_API_KEY=aio_...
export PENDNT_URL=https://api.pendnt.dev   # or http://localhost:8787 for local dev
export MCP_TOOL_TIMEOUT=600000              # ms — must exceed PERMISSION_PROMPT_WAIT_S (default 540s)

claude -p --permission-prompt-tool mcp__pendnt__permission_prompt "deploy to prod"
```

Three things worth knowing before you rely on this path:

- Claude Code blocks the first turn until the `pendnt` MCP server connects, capped by `MCP_TIMEOUT`
  (default 30s, env var, milliseconds) — bump it if your network is slow: `export MCP_TIMEOUT=60000`
  (from [`INTEGRATIONS.md` §1a](../product/INTEGRATIONS.md)).
- As of CLI ≥2.1.199, an `allow` from a `--permission-prompt-tool` is converted to `deny` for any MCP
  tool call flagged `_meta["anthropic/requiresUserInteraction"]` — this prompt tool can't rubber-stamp
  those regardless of what the operator answers (also from `INTEGRATIONS.md` §1a).
- **`permission_prompt` holds the MCP tool call open server-side** for up to `PERMISSION_PROMPT_WAIT_S`
  (env var on `/app`, default 540s = 9 min) waiting for the operator, unlike every other tool's ≤25s
  `wait_s`. Claude Code's own `MCP_TOOL_TIMEOUT` (its per-tool-call timeout, ms, default 30000) must be
  set higher than that or the CLI gives up first — hence `export MCP_TOOL_TIMEOUT=600000` above.

Unlike `request_approval`, `permission_prompt` *does* return Claude Code's exact `{behavior, updatedInput,
updatedPermissions, interrupt}` / `{behavior:"deny", message, interrupt}` contract natively — an `allow`
echoes the original `input` back as `updatedInput`, a `deny` (or an unanswered timeout) carries a
human-readable `message`. That's the same translation the `PermissionRequest` hook below does by hand for
its own hook-shaped contract; `permission_prompt` does it as the MCP tool result directly, which is what
`--permission-prompt-tool` actually reads.

## Headless example

```bash
export PENDNT_API_KEY=aio_...
export PENDNT_URL=https://api.pendnt.dev
export MCP_TOOL_TIMEOUT=600000

claude -p --permission-prompt-tool mcp__pendnt__permission_prompt \
  "review open PRs and merge the ones that pass CI"
```

Or, with the `PermissionRequest` hook doing the work instead (no extra flag needed once the plugin is
installed):

```bash
export PENDNT_API_KEY=aio_...
export PENDNT_URL=https://api.pendnt.dev

claude -p "review open PRs and merge the ones that pass CI"
```

Either way, every tool-use prompt now creates a durable approval request instead of blocking on a
terminal that doesn't exist — check your configured channels (email/web inbox — see `/app/README.md`'s
"Channels" section for what's actually implemented today), answer from your phone, and the agent
resumes.

## Running the hook locally against `wrangler dev`

From `/app`:

```bash
cd ../app
npm install
npm run db:migrate:local
npm run dev   # http://localhost:8787
```

In another terminal, bootstrap a workspace + API key (see `/app/README.md`) and point the plugin's env
vars at it:

```bash
BOOT=$(curl -s -X POST http://localhost:8787/dev/bootstrap -d '{}')
export PENDNT_API_KEY=$(echo "$BOOT" | jq -r .api_key)
export PENDNT_URL=http://localhost:8787
```

Then either run a hook script directly, feeding it the JSON a real Claude Code hook invocation would
send on stdin (useful for iterating on the hook without a full Claude Code session):

```bash
echo '{"session_id":"s1","cwd":"'"$PWD"'","tool_name":"Bash","tool_use_id":"toolu_1","tool_input":{"command":"deploy prod"}}' \
  | PENDNT_APPROVAL_TIMEOUT_S=60 node hooks/permission-request.mjs
```

...or install the plugin locally (`/plugin marketplace add Pendnt/pendnt-plugin` from Claude Code, see
[Install](#install)) and drive a real session — with `PENDNT_URL`/`PENDNT_API_KEY` exported in the
shell Claude Code runs in, every tool-use prompt round-trips through your local `wrangler dev`
instance. Answer the request the same way `/app/README.md`'s curl walkthrough does: compute the HMAC
signature yourself (it's a pure function of the request id and `SIGNING_SECRET`) and `POST
/a/<id>/<sig>`, or watch the `log` delivery channel's console output from `wrangler dev` for the
answer link once a real channel is wired up.

## Caveats

- No npm dependencies by design (`fetch`/`AbortController` only) — every hook script runs under plain
  `node hooks/*.mjs`, no `npm install` step inside the plugin itself.
- The `PermissionRequest` hook's fail-closed defaults (missing key, network error, timeout → deny) are a
  deliberate safety choice, not a limitation to work around — a headless agent with nobody to ask should
  not proceed by default.
- `hooks/hooks.json`'s `Notification` matcher is not narrowed to specific `notification_type`s — every
  notification (including ones that aren't permission-prompt-related) gets relayed. Narrow the matcher
  or filter inside `hooks/notify.mjs` if that's noisier than you want.

## Guides

Practical writeups on running agents unattended, at [pendnt.dev/guides](https://pendnt.dev/guides/):
[--dangerously-skip-permissions alternatives](https://pendnt.dev/guides/dangerously-skip-permissions) ·
[claude -p on cron](https://pendnt.dev/guides/claude-p-cron) ·
[the --permission-prompt-tool contract](https://pendnt.dev/guides/permission-prompt-tool) ·
[hooks for unattended runs](https://pendnt.dev/guides/claude-code-hooks) ·
[exit codes: retry vs stay dead](https://pendnt.dev/guides/agent-exit-codes)
