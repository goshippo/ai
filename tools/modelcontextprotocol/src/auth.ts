export interface AuthContext {
  headers: Record<string, string>;
  authProvider?: unknown;
  completeAuthorization?: (transport: { finishAuth(code: string): Promise<void> }) => Promise<void>;
}

export function buildApiKeyHeaders(
  apiKey: string,
  shippoAccount?: string,
): Record<string, string> {
  // NOTE (Task 9): pin "Bearer" vs "ShippoToken" against the #101 door's
  // code/api_key_auth.py scheme_for() before release. The door classifies by
  // the shippo_(live|test)_ prefix in the header value.
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (shippoAccount) headers['SHIPPO-ACCOUNT-ID'] = shippoAccount;
  return headers;
}
