---
name: upgrade-shippo
description: >-
  Guide for Shippo API version changes, webhook payload versioning, and how the
  hosted MCP server handles updates. Use when reasoning about backward
  compatibility, handling new fields in webhook payloads or API responses,
  troubleshooting OAuth/version-mismatch errors against the hosted MCP, or
  auditing an existing Shippo integration before a change.
---

The Shippo MCP is hosted at `https://mcp.shippo.com`. It is OAuth-only and auto-updates server-side, so there is nothing to install or upgrade on your side. This skill covers what stays your responsibility: API version awareness, webhook payload versioning, and troubleshooting the hosted session.

## API version handling

The current Shippo API version is **2018-02-08**. Shippo uses a single long-lived API version, and the hosted server manages it for you server-side. You do not set the `Shippo-API-Version` header yourself when going through the hosted MCP.

What backward-compatibility means in practice:

- Most changes are backward-compatible: new optional fields, new resources, additional webhook events. Existing calls keep working.
- Breaking changes are rare and announced via release notes.
- Because the server picks the version, you don't pin anything client-side. Your job is to handle new fields gracefully (see webhook versioning below) rather than to manage versions.

Shippo API changes are tracked in [the API changelog](https://docs.goshippo.com/changelog). As of 2026-06, no recent breaking changes affect the workflows covered by this skill set.

## Webhook event versioning

Webhook events can include new fields without bumping the API version. To handle them gracefully:

- Default to ignoring unknown fields in your webhook handler, never fail-closed on a field you don't recognize.
- Subscribe only to the specific event types you need (`track_updated`, `transaction_created`, `transaction_updated`, etc.).
- Verify webhook signatures using the `Shippo-Signature` header per [webhook docs](https://docs.goshippo.com/docs/tracking/webhooks).

## Troubleshooting the hosted MCP

### `401` or `403` errors

The OAuth session has expired or is not authorized. Re-authorize the Shippo OAuth session: in Claude Code, run `/mcp` and sign in again.

### Tools changed or missing after a server update

The hosted server auto-updates, so the tool catalog can shift without any action on your side. Re-list the current tools via `shippo_list_tools` to see what is available now.

### "Not found" errors for objects you expect to exist

Most likely the object does not exist on the authorized account, or it belongs to a different account. Confirm you are signed in to the account that owns the object (re-authorize via `/mcp` if needed).

## Auditing an existing integration

Before making a change to a production integration:

1. Don't pin anything client-side. The hosted server manages the API version, so there's nothing to pin.
2. Verify webhook handlers ignore unknown fields.
3. Review the [API changelog](https://docs.goshippo.com/changelog) for any breaking changes.
4. Re-list tools via `shippo_list_tools` after an update to catch renamed or added operations.
