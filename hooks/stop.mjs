#!/usr/bin/env node
// Stop hook — see INTEGRATIONS.md §1b. Fires at the end of a turn. This hook never
// returns {"decision":"block",...}, so it never forces Claude to keep going — it
// only relays a "run finished" notification via POST /v1/notify, fire-and-forget.
import { notify } from "../lib/client.mjs";
import { API_KEY, PRODUCT_NAME } from "../lib/config.mjs";
import { readHookInput } from "../lib/stdin.mjs";

async function main() {
  const input = await readHookInput();
  if (!API_KEY) return;

  const parts = [`[${PRODUCT_NAME}] run finished`];
  if (input.cwd) parts.push(`(${input.cwd})`);
  if (input.session_id) parts.push(`— session ${input.session_id}`);

  try {
    await notify(parts.join(" "), "info", { timeoutMs: 8000 });
  } catch {
    // best-effort
  }
}

main().then(() => {
  process.exitCode = 0;
});
