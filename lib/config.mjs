// Single place that names the product and reads its env vars, so renaming the
// product (or the env var prefix) only ever touches this one file — every hook
// script imports from here instead of hardcoding "pendnt"/"PENDNT_*" itself.
// (The MCP server name registered in the host app — see /app/src/routes/mcp.ts
//  and README.md's "Remote MCP server" section — is kept in sync by hand; there's
//  no shared package between the two repos in this pass.)

export const PRODUCT_NAME = "pendnt";

const DEFAULT_BASE_URL = "https://api.pendnt.dev";

/** REST API base URL (no trailing slash), e.g. https://api.pendnt.dev — NOT including /mcp. */
export const BASE_URL = (process.env.PENDNT_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

export const API_KEY = process.env.PENDNT_API_KEY || "";

/** Total wall-clock budget for the PermissionRequest hook's poll loop, in seconds. */
export const APPROVAL_TIMEOUT_S = (() => {
  const n = Number(process.env.PENDNT_APPROVAL_TIMEOUT_S);
  return Number.isFinite(n) && n > 0 ? n : 600; // default 10 minutes
})();
