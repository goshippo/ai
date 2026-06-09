# Use Shippo in Claude

Connect Shippo to Claude to compare carrier rates, buy shipping labels, track packages, and validate addresses in natural language. Shippo runs an official remote MCP server that Claude connects to as a connector, so there is nothing to download and no code to run.

## Connection details

| Setting | Value |
|---|---|
| MCP server URL | `https://mcp.shippo.com` |
| Transport | Remote MCP over streamable HTTPS |
| Authentication | Sign in to Shippo (OAuth) |

You authorize once with your Shippo account. There is no API key to copy or paste.

## Prerequisites

- A Claude account that can add connectors (Claude apps: claude.ai web, Claude Desktop; available on Pro, Max, Team, and Enterprise).
- A Shippo account. You can [create one for free](https://apps.goshippo.com).

## Connect Shippo to Claude

### As an individual

1. Open **Settings** and go to **Connectors**.
2. Choose **Add custom connector**.
3. Give it a name (`Shippo`) and paste the server URL `https://mcp.shippo.com`.
4. Add the connector. Claude detects that the server requires sign-in and opens the Shippo authorization window. Complete the Shippo sign-in to authorize.

### For an organization (admins)

A Team or Enterprise admin can make Shippo available to everyone:

1. Go to **Organization settings** and choose **Connectors**.
2. Choose **Add** then **Custom**, and enter the server URL `https://mcp.shippo.com`.
3. Save. Members then enable the Shippo connector and complete the Shippo sign-in individually the first time they use it.

## Use Shippo in a chat

Enable Shippo for the conversation from the connectors control near the composer, then ask in plain language. Examples:

- "Compare USPS, UPS, and FedEx rates for a 2 lb package from San Francisco to Austin."
- "Buy the cheapest label for that shipment."
- "Track shipment 9400 1000 0000 0000 0000 00 and summarize its status."
- "Validate and standardize this address: 1600 Pennsylvania Ave, Washington."

Actions that buy a label or otherwise change your account ask for confirmation before they run.

## Permissions and data

Actions run against your live Shippo account; authorizing the connector signs you in to your live account. Read actions like comparing rates, validating addresses, and tracking do not incur charges, and purchasing a label is a live action that asks for confirmation first. To disconnect, remove the Shippo connector from your Connectors settings, and revoke access from your Shippo account if desired.

## Troubleshooting

- **Shippo does not appear in the connector picker:** confirm the connector was added and the Shippo sign-in completed. Re-open **Connectors** to check its status.
- **You are asked to sign in again:** the authorization session expired. Re-authorize from the connector settings.
- **The sign-in window is blocked:** allow pop-ups for Claude and retry.

For Shippo product help, see the [Shippo documentation](https://docs.goshippo.com).
