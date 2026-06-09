# Use Shippo in ChatGPT

Connect Shippo to ChatGPT to compare carrier rates, buy shipping labels, track packages, and validate addresses in natural language. Shippo runs an official remote MCP server that ChatGPT connects to as an app (connector), so there is nothing to download and no code to run.

## Connection details

| Setting | Value |
|---|---|
| MCP server URL | `https://mcp.shippo.com` |
| Transport | Remote MCP over streamable HTTPS |
| Authentication | Sign in to Shippo (OAuth) |

You authorize once with your Shippo account. There is no API key to copy or paste.

## Prerequisites

- A ChatGPT account that can add apps / connectors.
- A Shippo account. You can [create one for free](https://apps.goshippo.com).

## Connect Shippo to ChatGPT

1. Open **Settings** in ChatGPT and go to **Connectors** (labeled **Apps & Connectors** on some clients).
2. Enable **Developer Mode** (under Advanced settings) to add a custom connector.
3. Choose **Create**, give it a name (`Shippo`) and a short description, and paste the connector URL `https://mcp.shippo.com`.
4. Create the connector. ChatGPT detects that the server requires sign-in and opens the Shippo authorization popup. Complete the Shippo sign-in to authorize.

Once Shippo is published to the ChatGPT App Directory, you can add it from the directory without Developer Mode. The connection model is the same.

## Use Shippo in a chat

Start a conversation, click the **+** near the composer, choose **More**, and select **Shippo** from your connectors. Then ask in plain language. Examples:

- "Compare USPS, UPS, and FedEx rates for a 2 lb package from San Francisco to Austin."
- "Buy the cheapest label for that shipment."
- "Track shipment 9400 1000 0000 0000 0000 00 and summarize its status."
- "Validate and standardize this address: 1600 Pennsylvania Ave, Washington."

## Permissions and data

Actions run against your live Shippo account; authorizing the connector signs you in to your live account. Read actions like comparing rates, validating addresses, and tracking do not incur charges, and purchasing a label is a live action that asks for confirmation first. To disconnect, remove the Shippo connector from your ChatGPT **Apps & Connectors** settings, and revoke access from your Shippo account if desired.

## Troubleshooting

- **Shippo does not appear in the app picker:** confirm the connector was added and the OAuth sign-in completed. Re-open **Apps & Connectors** to check its status.
- **You are asked to sign in again:** the OAuth session expired. Re-authorize from the connector settings.
- **The sign-in popup is blocked:** allow popups for ChatGPT and retry.

For Shippo product help, see the [Shippo documentation](https://docs.goshippo.com).
