export interface ClientInfo {
  name?: string;
  version?: string;
}

// Strip control characters (including CR and LF) from a client-supplied value.
// clientInfo comes from the downstream MCP client's initialize message, and the
// result is interpolated into the outbound User-Agent header. undici rejects a
// header value that contains a control character, which would otherwise break
// the connection for a client whose name happens to carry one; cleaning it lets
// the client through with a sanitized User-Agent instead of failing the request.
function sanitize(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    // Drop C0 controls (below 0x20, which includes CR/LF/NUL/TAB) and DEL
    // (0x7f); everything printable, including non-ASCII, passes through.
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out.trim();
}

export function buildUserAgent(
  clientInfo: ClientInfo | undefined,
  name: string,
  version: string,
): string {
  const base = `${name}/${version}`;
  const clientName = clientInfo?.name ? sanitize(clientInfo.name) : '';
  if (!clientName) return base;
  const clientVersion = clientInfo?.version ? sanitize(clientInfo.version) : '';
  const client = clientVersion ? `${clientName}/${clientVersion}` : clientName;
  return `${base} (${client})`;
}
