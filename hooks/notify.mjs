#!/usr/bin/env node
// Notification hook — see INTEGRATIONS.md §1b. Fires on internal Claude Code events
// (`notification_type`: "permission_prompt", "agent_needs_input", etc). It cannot
// block Claude Code either way, so this is pure fire-and-forget: relay it to
// POST /v1/notify and exit 0 regardless of outcome (never let a delivery hiccup
// here affect the session).
import { notify } from "../lib/client.mjs";
import { API_KEY, PRODUCT_NAME } from "../lib/config.mjs";
import { readHookInput } from "../lib/stdin.mjs";

async function main() {
  const input = await readHookInput();
  if (!API_KEY) return;

  const kind = input.notification_type || input.hook_event_name || "notification";
  const text = input.message || `Claude Code notification: ${kind}`;
  const message = `[${PRODUCT_NAME}] ${text}${input.cwd ? ` (${input.cwd})` : ""}`;

  try {
    await notify(message, "info", { timeoutMs: 8000 });
  } catch {
    // best-effort
  }
}

main().then(() => {
  process.exitCode = 0;
});
