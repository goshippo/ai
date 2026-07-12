export interface ClientInfo {
  name?: string;
  version?: string;
}

export function buildUserAgent(
  clientInfo: ClientInfo | undefined,
  name: string,
  version: string,
): string {
  const base = `${name}/${version}`;
  if (!clientInfo?.name) return base;
  const client = clientInfo.version
    ? `${clientInfo.name}/${clientInfo.version}`
    : clientInfo.name;
  return `${base} (${client})`;
}
