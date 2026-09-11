/** Reads all of stdin as a UTF-8 string. Every Claude Code hook receives its input this way. */
export function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/** Best-effort JSON.parse of the hook's stdin payload — falls back to `{}` for anything malformed. */
export async function readHookInput() {
  try {
    const raw = await readStdin();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
