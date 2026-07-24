# Shippo MCP Server

> **Note:** This package is a thin **local bridge** to the hosted Shippo MCP server at `https://mcp.shippo.com`. It runs over stdio for MCP clients that connect to a local command, and signs you in with **OAuth** in your browser (no API key required). Tool discovery and execution happen on the hosted server, so the local tool surface always matches hosted. If your client speaks remote MCP with OAuth, you can connect to `https://mcp.shippo.com` directly instead of using this package.

Model Context Protocol (MCP) Server for the Shippo API.

You must register for a [Shippo account](https://apps.goshippo.com/join) to use our API. It's free to sign up. Only pay to print a live label. Test labels are free.

You sign in through your browser (OAuth), so there is no API key to manage.

<!-- API-KEY-AUTH (hidden until the hosted key door ships; the code path stays live, this is docs-only):
For headless or automation use (CI, cron, service accounts) you can supply a Shippo [API token](https://docs.goshippo.com/guides/authentication) instead. A `shippo_test_` key runs in test mode and produces test labels; a `shippo_live_` key runs on your live account, where buying a label is billable.
-->

## Summary

Shippo MCP Server: use this MCP server to integrate with the Shippo service using natural language and agentic flows. Compare multi-carrier rates, buy and track labels, validate addresses, and handle customs, all from your MCP client.

## Requirements

- **Node.js 18+**: [Download Node.js](https://nodejs.org/en/download)

## Table of Contents

- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Features](#features)
- [Security](#security)
- [Contributions](#contributions)
- [Support](#support)
- [About Shippo](#about-shippo)

## Quick Start

<details>
<summary>Cursor</summary>

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en-US/install-mcp?name=shippo-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzaGlwcG8vc2hpcHBvLW1jcCJdfQ==)

> Click **Install** to add the server, then start it. The first request opens your browser to sign in to Shippo. No API key needed.

Or manually, paste this into your MCP server configuration:

```json
{
  "mcpServers": {
    "shippo-mcp": {
      "command": "npx",
      "args": ["-y", "@shippo/shippo-mcp"]
    }
  }
}
```

</details>

<details>
<summary>Claude Code CLI</summary>

Add the Shippo MCP server to Claude Code (opens your browser to sign in on first use):

```bash
claude mcp add --transport stdio shippo-mcp -- npx -y @shippo/shippo-mcp
```

Verify it was added:

```bash
claude mcp list
```

To remove if needed:

```bash
claude mcp remove shippo-mcp
```

</details>

<details>
<summary>Claude Desktop</summary>

**Desktop Extension (recommended):**

[![Add to Claude Desktop](https://img.shields.io/badge/Add_to_Claude_Desktop-Download_.dxt-d97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/goshippo/ai/releases/download/shippo-mcp-v3.0.3/shippo.dxt)

Click to download `shippo.dxt`, then open it in Claude Desktop to install (or Settings -> Extensions -> Advanced -> Install Extension). It signs in with OAuth on first use, so there is nothing to configure. You can also build it yourself with `npm run build-dxt`.

**Manual config:** Settings -> Developer -> Edit Config, then paste:

```json
{
  "mcpServers": {
    "shippo-mcp": {
      "command": "npx",
      "args": ["-y", "@shippo/shippo-mcp"]
    }
  }
}
```

</details>

<details>
<summary>Manual CLI usage</summary>

To start the server manually (for other MCP clients or debugging):

```bash
npx -y @shippo/shippo-mcp
```

> **Note:** This starts the server in stdio mode, waiting for MCP protocol messages. It won't show an interactive prompt; it's designed to be connected to by an MCP client like Cursor or Claude Desktop. On the first request it opens your browser to sign in.

For the full list of flags:

```bash
npx @shippo/shippo-mcp --help
```

</details>

## Configuration

### Authentication

No configuration needed. On the first request the bridge opens your browser to sign in to Shippo, then caches the session locally (see [Security](#security)).

```json
{
  "mcpServers": {
    "shippo-mcp": {
      "command": "npx",
      "args": ["-y", "@shippo/shippo-mcp"]
    }
  }
}
```

<!-- API-KEY-AUTH (hidden until the hosted key door ships; the code path stays live, this is docs-only):

### API key (headless / CI / automation)

Prefer the `SHIPPO_API_KEY` environment variable so the key is not visible in the process list or persisted into client config:

```bash
SHIPPO_API_KEY=<your-shippo-key> npx -y @shippo/shippo-mcp
```

The `--api-key=shippo_test_xxxxx` flag also works, but the key is then visible to other local users in the process list, so reserve it for throwaway test keys.

-->

### Flags

<!-- API-KEY-AUTH: restore this row to the table when the key door ships:
| `SHIPPO_API_KEY` (env, preferred) or `--api-key=<key>` | Use a Shippo API key instead of OAuth. |
-->

| Flag | Purpose |
|------|---------|
| `--url=<url>` | Override the server (default `https://mcp.shippo.com`). Must be `https`, except `localhost` for local testing, since credentials are sent to it. |
| `--shippo-account=<id>` | Act on a managed account (sends `SHIPPO-ACCOUNT-ID`). |
| `--callback-port=<n>` | Pin the OAuth loopback callback port (integer 1024-65535). By default it is derived deterministically per host, so re-authorization keeps matching the registered redirect. |
| `--help` | Print usage and exit. |
| `--version` | Print the version and exit. |

### Claude Code CLI

```bash
# Add the MCP server (OAuth)
claude mcp add --transport stdio shippo-mcp -- npx -y @shippo/shippo-mcp

# List configured servers
claude mcp list

# Get details about the server
claude mcp get shippo-mcp

# Remove the server
claude mcp remove shippo-mcp
```

## Updating

The MCP server is distributed via npm. To ensure you have the latest features and bug fixes, update periodically.

### Check Current Version

```bash
npx @shippo/shippo-mcp --version
```

### Update to Latest Version

```bash
npm update -g @shippo/shippo-mcp
```

Next time you start your MCP client (Cursor, Claude), it will fetch the latest version.

> **Tip:** After updating, toggle your MCP server off and on in Cursor/Claude settings for changes to take effect.

## Troubleshooting

### `ReferenceError: Response is not defined`

This error occurs when running with Node.js < 18, or when the npx cache contains a stale installation from an older Node version.

**If you use nvm (Node Version Manager):**

```bash
# 1. Set Node 18+ as default
nvm alias default 20
nvm use 20

# 2. Verify Node version
node --version   # Should show v20.x.x or v18.x.x

# 3. Clear npm/npx caches (this is the key step)
npm cache clean --force
rm -rf ~/.npm/_npx/

# 4. (Optional) Clear nvm's cache too
nvm cache clear

# 5. Restart terminal to pick up fresh environment
exec "$SHELL"

# 6. Verify npx will use correct Node
which npx   # Should point to v20 or v18 path
```

Then restart your MCP client (Cursor/Claude Desktop).

<!-- API-KEY-AUTH (hidden until the hosted key door ships; the workaround is API-key auth):

### Sign-in does not open a browser (headless / SSH)

OAuth needs a local browser and a loopback callback on the same machine. In CI, containers, or an SSH session with no display, sign-in cannot complete. Use an API key instead: `SHIPPO_API_KEY=<your-shippo-key>`.

-->

### Reset sign-in

OAuth session state (registered client, tokens, PKCE verifier) is cached under `~/.shippo-mcp`, in a per-host subdirectory. Delete that directory to fully reset and start a fresh sign-in on the next run.

## Features

### Address Management

- Create and validate addresses
- List existing addresses
- Retrieve address details

### Shipment Management

- Create shipments with from/to addresses and parcels
- List shipments with filtering options
- Retrieve shipment details and rates

### Rate Shopping

- Get shipping rates for shipments
- Compare rates across multiple carriers
- Live rate calculation at checkout

### Label Generation

- Purchase shipping labels
- Generate labels in multiple formats (PDF, PNG, ZPL)
- Track label status and download URLs

### Package Tracking

- Register tracking webhooks
- Get tracking status updates
- Monitor shipment progress

### Carrier Management

- List available carrier accounts
- Manage carrier configurations
- Support for USPS, UPS, FedEx, DHL, and more

### International Shipping

- Customs declarations
- International address validation
- Multi-country shipping support

### Batch Operations

- Create and manage batch shipments
- Bulk label generation
- Batch processing for high-volume shipping

## Security

### Authentication

- **OAuth**: sign in through your browser. No API key is stored; the session is cached locally under `~/.shippo-mcp` and can be reset by deleting that directory.

<!-- API-KEY-AUTH (hidden until the hosted key door ships; the code path stays live, this is docs-only):

- **API key (optional)**: for headless and automation use. Prefer the `SHIPPO_API_KEY` environment variable over the `--api-key` flag so the key stays out of the process list.

### API Key Management

- **Test Keys**: use test API keys (`shippo_test_...`) for development and testing.
- **Live Keys**: use live API keys (`shippo_live_...`) only in production environments.
- **Never commit** API keys to source control.
- **Environment variables** are recommended for sensitive data.

### Getting Your API Key

1. Sign up at [goshippo.com](https://goshippo.com)
2. Go to [API Keys](https://apps.goshippo.com/api)
3. Generate a key
4. Use it via `SHIPPO_API_KEY`

### Best Practices

- Use test keys during development
- Rotate keys regularly
- Never share keys publicly
- Store sensitive configuration in environment variables

-->

## Contributions

We welcome contributions! Please:

- Open issues for bug reports or feature requests
- Submit pull requests for improvements
- Share feedback and suggestions

## Support

For support and questions:

- Check the [Shippo API docs](https://docs.goshippo.com)
- Contact [Shippo support](https://goshippo.com/contact/)

## About Shippo

Connect with multiple different carriers, get discounted shipping labels, track parcels, and much more with just one integration. You can use your own carrier accounts or take advantage of Shippo's discounted rates. Shippo simplifies carrier integrations, rate shopping, tracking, and the entire shipping workflow.
