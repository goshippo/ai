# @shippo/shippo-mcp

Local bridge to the hosted [Shippo MCP server](https://docs.goshippo.com/docs/Guides_general/MCPServer). Multi-carrier shipping for AI agents: compare rates, buy labels, track packages, validate addresses.

## Quickstart

OAuth (opens a browser to sign in to Shippo):

```sh
npx -y @shippo/shippo-mcp
```

API key (headless, CI, or test mode). Prefer the environment variable so the key is not visible in the process list (`ps`) or persisted into client config:

```sh
SHIPPO_API_KEY=<your-shippo-key> npx -y @shippo/shippo-mcp
```

The `--api-key=shippo_test_xxxxx` flag also works, but the key is then visible to other local users in the process list, so reserve it for throwaway test keys.

A `shippo_test_` key runs in test mode and produces test labels. A `shippo_live_` key runs on your live account, where buying a label is billable.

## Flags

- `SHIPPO_API_KEY` (env, preferred) or `--api-key=<key>`: use a Shippo API key instead of OAuth. The env var keeps the key out of the process list.
- `--url=<url>`: override the server (default `https://mcp.shippo.com`). Must be `https`, except `localhost` for local testing, since credentials are sent to it.
- `--shippo-account=<id>`: act on a managed account (sends `SHIPPO-ACCOUNT-ID`).
- `--callback-port=<n>`: pin the OAuth loopback callback port (integer 1024-65535). By default the port is derived deterministically per host, so re-authorization keeps matching the registered redirect.
- `--help`: print usage and exit.
- `--version`: print the version and exit.

## Client config

```json
{ "mcpServers": { "shippo": { "command": "npx", "args": ["-y", "@shippo/shippo-mcp"] } } }
```

## Credential cache

OAuth sign-in state (the registered client, tokens, and PKCE verifier) is cached under `~/.shippo-mcp`, in a per-host subdirectory. Delete that directory to fully reset sign-in state and start a fresh sign-in on the next run.

## Versioning

v3 is a thin stdio bridge to the hosted server (tools and execution live server-side, so the local surface always matches hosted). The former self-contained build remains available by pinning v2.x.
