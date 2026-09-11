#!/usr/bin/env node
// PermissionRequest hook — see INTEGRATIONS.md §1b for the exact I/O contract this
// implements: stdin is a JSON object with (at least) tool_name/tool_input/tool_use_id/
// session_id/cwd; stdout must be exactly one JSON object of the shape
//   { "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": {...} } }
// with `decision` being `{behavior:"allow", updatedInput, message?}` or
// `{behavior:"deny", message}`. Exit code is not honored for this hook (unlike
// PreToolUse's exit-2 shortcut) — the JSON on stdout is the only signal that matters,
// so this script always exits 0 and always prints a decision, even on failure.
import { createRequest, getRequest } from "../lib/client.mjs";
import { API_KEY, APPROVAL_TIMEOUT_S, PRODUCT_NAME } from "../lib/config.mjs";
import { readHookInput } from "../lib/stdin.mjs";

const POLL_WAIT_S = 25; // the server clamps wait_s to 0-25 regardless of what's sent

function summarizeInput(input) {
  try {
    const json = JSON.stringify(input, null, 2);
    return json.length > 4000 ? `${json.slice(0, 4000)}\n...(truncated)` : json;
  } catch {
    return String(input);
  }
}

/** Maps a /v1/requests row to a hook decision, or `null` if it's still pending. */
function toDecision(row) {
  switch (row.status) {
    case "approved":
      return { behavior: "allow", updatedInput: {} };
    case "answered": {
      // The operator answer page always offers a free-text box, even for an
      // approval-kind request (the operator can type instead of clicking a
      // button) — fail closed unless the text clearly reads as approval.
      const text = String(row.answer ?? "").trim().toLowerCase();
      if (/^(yes|y|allow|approve|approved|ok|okay)\b/.test(text)) {
        return { behavior: "allow", updatedInput: {} };
      }
      return { behavior: "deny", message: `Operator answered: ${row.answer || "(empty)"}` };
    }
    case "denied":
      return { behavior: "deny", message: row.answer ? `Denied by operator: ${row.answer}` : "Denied by operator" };
    case "expired":
      return { behavior: "deny", message: "Approval request expired before it was answered" };
    case "cancelled":
      return { behavior: "deny", message: "Approval request was cancelled" };
    default:
      return null; // "pending"
  }
}

async function decide(input) {
  if (!API_KEY) {
    return { behavior: "deny", message: `${PRODUCT_NAME}: PENDNT_API_KEY is not set — denying by default (nobody to ask).` };
  }

  const toolName = input.tool_name || "unknown tool";
  const details = [
    `cwd: ${input.cwd || "?"}`,
    `session: ${input.session_id || "?"}`,
    `tool_use_id: ${input.tool_use_id || "?"}`,
    "",
    "input:",
    summarizeInput(input.tool_input ?? {}),
  ].join("\n");

  const startedAt = Date.now();
  let id;
  try {
    const created = await createRequest(
      {
        kind: "approval",
        title: `Approve tool call: ${toolName}`,
        details,
        wait_s: POLL_WAIT_S,
        timeout_s: APPROVAL_TIMEOUT_S,
      },
      { timeoutMs: (POLL_WAIT_S + 10) * 1000 },
    );
    id = created.id;
    const immediate = toDecision(created);
    if (immediate) return immediate;
  } catch (err) {
    return { behavior: "deny", message: `${PRODUCT_NAME}: failed to create approval request (${err.message}) — denying by default.` };
  }

  // Keep re-polling GET /v1/requests/:id?wait_s=25 until it resolves or the
  // overall PENDNT_APPROVAL_TIMEOUT_S budget (default 10 min) runs out.
  while (Date.now() - startedAt < APPROVAL_TIMEOUT_S * 1000) {
    const remainingS = APPROVAL_TIMEOUT_S - Math.floor((Date.now() - startedAt) / 1000);
    const waitS = Math.max(1, Math.min(POLL_WAIT_S, remainingS));
    try {
      const row = await getRequest(id, waitS, { timeoutMs: (waitS + 10) * 1000 });
      const decision = toDecision(row);
      if (decision) return decision;
    } catch {
      // transient network error — brief backoff, then keep polling within the overall timeout
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return {
    behavior: "deny",
    message:
      `${PRODUCT_NAME}: no answer within ${APPROVAL_TIMEOUT_S}s (request ${id}) — denying by default. ` +
      `Check your configured channels, or resume this decision later with check_request({ id: "${id}" }).`,
  };
}

async function main() {
  const input = await readHookInput();
  let decision;
  try {
    decision = await decide(input);
  } catch (err) {
    decision = { behavior: "deny", message: `${PRODUCT_NAME}: hook crashed (${err?.message || err}) — denying by default.` };
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } }));
  process.exitCode = 0;
}

main();
