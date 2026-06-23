# Shippo

Ship packages with Shippo from inside Claude Code. This plugin bundles 10 agent skills covering rate-shopping, label generation, package tracking, interactive tracking maps, address validation, customs declarations, batch shipping, draft support tickets, and SDK upgrades, plus the workflow knowledge to know which API to call when. Skills teach the assistant *how* to ship; pair with the Shippo MCP server to give the assistant the *tools* to ship.

## Skills

| Skill | What it does |
|---|---|
| `shippo-best-practices` | Decision-router for Shippo integrations, which API to use, test vs. live mode discipline, response handling, critical rules |
| `address-validation` | Validate, parse, and standardize US and international addresses |
| `rate-shopping` | Compare rates across USPS, UPS, FedEx, DHL, and 30+ carriers |
| `label-purchase` | Purchase domestic and international shipping labels with customs handling |
| `tracking` | Track packages across carriers with status history, substatus codes, and webhooks |
| `batch-shipping` | Process CSV files of shipments and generate labels in bulk |
| `shipping-analysis` | Analyze costs, optimize package dimensions, compare carriers, review historical spend |
| `shippo-support-ticket` | Build an auto-classified, routing-tagged support ticket (human + JSON) for a single shipment or label; read-only, for Shippo support agents |
| `tracking-map` | Generate an interactive HTML map + chronological timeline of a package's journey from a tracking number (read-only GetTrack) |
| `upgrade-shippo` | Guide for upgrading SDK versions, MCP server updates, breaking-change migration |

## Usage

Skills are namespaced under `/shippo:`: invoke directly:

```
/shippo:rate-shopping
/shippo:label-purchase
/shippo:tracking
```

Or just describe what you're doing in natural language and Claude will pick the right skill.

## Setup

The plugin's `.mcp.json` points at the hosted Shippo MCP server at `https://mcp.shippo.com` over Streamable HTTP with per-user Shippo OAuth. There is no API key to copy and no `SHIPPO_API_KEY` to set.

### 1. Install the plugin

Install via `--plugin-dir` or the plugin marketplace.

### 2. Authorize Shippo

On first use, run `/mcp` in Claude Code, select the `shippo-mcp` server, and complete the Shippo sign-in in your browser. Claude Code stores the OAuth token and refreshes it automatically, you authorize once.

### 3. Account and charges

Authorize with your Shippo account via OAuth. Getting rates and validating addresses incur no charge; purchasing a label charges your account at Shippo's discounted carrier rates. Manage your account at the [Shippo Dashboard](https://apps.goshippo.com/settings/api).

## Issues / contributions

Source repo: https://github.com/goshippo/ai

File issues, request skills, or send PRs there.

## License

[MIT](LICENSE)
