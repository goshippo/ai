# Using the Shippo MCP from the OpenAI Responses API / Agents SDK

This guide is for developers building on OpenAI who want to call Shippo's remote MCP server directly from [`responses.create`](https://platform.openai.com/docs/api-reference/responses) or the [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/). There is nothing to submit or register with Shippo. This is config plus code. OpenAI's Responses runtime connects to the remote MCP server over Streamable HTTP, lists its tools, and calls them on your behalf.

If you are building on Claude instead, see the [repo README](../README.md). It is the same MCP server.

## Endpoint

Shippo hosts a remote MCP server that authenticates with a Shippo OAuth bearer token.

| Endpoint | Transport | Auth | Tool surface |
|---|---|---|---|
| `https://mcp.shippo.com` | Streamable HTTP | Shippo OAuth bearer token | 4-tool meta-API |

This is the production endpoint. Authenticate with a Shippo OAuth bearer token (see the credentials section below).

### The 4-tool meta-API

The endpoint does not surface Shippo's full operation catalog as individual tools. It surfaces four meta-tools that wrap the catalog:

- `shippo_list_tools`: list the available Shippo operations.
- `shippo_describe_tool`: get the input schema for one operation.
- `shippo_read_execute_tool`: run a read operation (GET-style, non-mutating).
- `shippo_write_execute_tool`: run a write operation (creates, purchases, mutations).

The read/write split is deliberate. It lets you scope approval policy so reads run unattended and writes require a human in the loop (see [Approvals](#approvals-require_approval) below).

## How OpenAI handles credentials (read this first)

OpenAI does **not** persist your credentials. There is no stored connection, no saved secret, and no token vault for a custom `server_url`.

That means:

1. **You inject the token on every call.** The `authorization` value goes into each `responses.create` request. If you omit it, OpenAI sends an unauthenticated request and Shippo rejects it.
2. **You own minting the Shippo OAuth token.** OpenAI will not drive an interactive OAuth flow for a custom MCP `server_url`. It does not pop a consent screen and it does not run the authorization-code dance. You mint the Shippo OAuth bearer token yourself (out of band) and pass the current access token on each request. See [Getting a Shippo OAuth token](#getting-a-shippo-oauth-token) below.

Treat the token like any other secret: load it from your environment or secrets manager at request time, never hard-code it.

### Getting a Shippo OAuth token

You obtain the token through Shippo's OAuth, not through OpenAI. The flow is the standard `authorization_code` grant: redirect the user to Shippo's authorize endpoint, then exchange the returned code at Shippo's token endpoint for an `access_token`. See Shippo's [OAuth guide](https://docs.goshippo.com/docs/oauth_integrations/oauth/) and the [shippo-demos-oauth](https://github.com/goshippo/shippo-demos-oauth) example.

Token lifetime: Shippo's classic platform `access_token` does not expire, so there is no refresh step to implement. (The production OAuth issuer's token lifetime is not yet published; revisit this when it ships.)

## Auth: the `authorization` field takes a bare token

Put the Shippo OAuth access token in the `authorization` field of the MCP tool block. Pass the **raw token only**. OpenAI builds the HTTP header itself and emits `Authorization: Bearer <value>`, so a value that already starts with `Bearer ` would produce `Authorization: Bearer Bearer <token>` and fail auth.

```
"authorization": "<shippo-oauth-access-token>"      ✅ bare token
"authorization": "Bearer <shippo-oauth-access-token>"   ❌ double Bearer, 401
```

## Responses API (raw JSON)

The `tools` array entry below registers the Shippo MCP server, restricts the model to the four meta-tools, and gates writes behind approval.

```json
{
  "model": "gpt-5.5",
  "input": "List my 5 most recent Shippo shipments.",
  "tools": [
    {
      "type": "mcp",
      "server_label": "shippo",
      "server_url": "https://mcp.shippo.com",
      "authorization": "SHIPPO_OAUTH_ACCESS_TOKEN",
      "allowed_tools": [
        "shippo_list_tools",
        "shippo_describe_tool",
        "shippo_read_execute_tool",
        "shippo_write_execute_tool"
      ],
      "require_approval": {
        "never": {
          "tool_names": [
            "shippo_list_tools",
            "shippo_describe_tool",
            "shippo_read_execute_tool"
          ]
        }
      }
    }
  ]
}
```

`SHIPPO_OAUTH_ACCESS_TOKEN` is a placeholder for the raw token value (no `Bearer ` prefix). With this config the list/describe/read tools run unattended, and `shippo_write_execute_tool` (anything not listed under `never`) triggers an approval request that your application must answer. See [Approvals](#approvals-require_approval).

## OpenAI Agents SDK (Python)

The Agents SDK wraps the same MCP tool block in [`HostedMCPTool`](https://openai.github.io/openai-agents-python/mcp/). Because writes are gated, you supply an `on_approval_request` callback. The runtime calls it whenever a tool needs sign-off, and you return whether to approve.

```python
import os
from agents import (
    Agent,
    HostedMCPTool,
    Runner,
    MCPToolApprovalRequest,
    MCPToolApprovalFunctionResult,
)

# You mint and refresh this yourself. OpenAI will not run the OAuth flow
# for a custom server_url. Load the current access token at request time.
# Pass the RAW token. OpenAI adds the "Bearer " prefix itself.
SHIPPO_OAUTH_TOKEN = os.environ["SHIPPO_OAUTH_ACCESS_TOKEN"]

# Tools that mutate state. Anything here needs a human to approve.
WRITE_TOOLS = {"shippo_write_execute_tool"}


def on_approval_request(
    request: MCPToolApprovalRequest,
) -> MCPToolApprovalFunctionResult:
    name = request.data.name
    if name in WRITE_TOOLS:
        # Replace this with your real gate: a UI prompt, a Slack
        # approval, a policy check, whatever fits your app.
        # Note: request.data.arguments is a JSON-encoded string, so json.loads()
        # it first if you need the parsed arguments.
        approved = prompt_human_to_approve(name, request.data.arguments)
        if approved:
            return {"approve": True}
        return {"approve": False, "reason": "Operator declined the write."}
    # Reads should not reach here given require_approval below, but
    # default-allow keeps the agent unblocked if policy changes.
    return {"approve": True}


agent = Agent(
    name="Shippo agent",
    instructions=(
        "Use the Shippo MCP tools to fulfill shipping requests. "
        "Use the read tools to inspect, and only call the write tool "
        "to create or purchase when the user has clearly asked for it."
    ),
    tools=[
        HostedMCPTool(
            tool_config={
                "type": "mcp",
                "server_label": "shippo",
                "server_url": "https://mcp.shippo.com",
                "authorization": SHIPPO_OAUTH_TOKEN,
                "allowed_tools": [
                    "shippo_list_tools",
                    "shippo_describe_tool",
                    "shippo_read_execute_tool",
                    "shippo_write_execute_tool",
                ],
                "require_approval": {
                    "never": {
                        "tool_names": [
                            "shippo_list_tools",
                            "shippo_describe_tool",
                            "shippo_read_execute_tool",
                        ]
                    }
                },
            },
            on_approval_request=on_approval_request,
        )
    ],
)

result = Runner.run_sync(agent, "Buy the cheapest label for shipment SHIPMENT_ID.")
print(result.final_output)
```

### Token freshness in the SDK

The example reads `SHIPPO_OAUTH_ACCESS_TOKEN` once at module load. That is fine for a short script. For a long-running service, build the `tool_config` per request from a freshly minted/refreshed token rather than capturing it once, since OpenAI does not refresh it for you.

## Approvals (`require_approval`)

The recommended policy:

- **Allow reads.** Mark `shippo_list_tools`, `shippo_describe_tool`, and `shippo_read_execute_tool` as `never` requiring approval. They do not change anything, so unattended use is safe and keeps the agent fast.
- **Gate writes.** Leave `shippo_write_execute_tool` to require approval. Purchasing a label, creating a shipment, or any other mutation should pass through a human (or a programmatic policy check) before it runs. This matters most against live-mode Shippo accounts, where a write spends real money.

In the raw Responses API, an approval surfaces as an `mcp_approval_request` item in the response output. You answer it by sending an `mcp_approval_response` item (with `approve: true` or `false`) on a follow-up `responses.create` call, referencing the request via `approval_request_id` (the `mcpr_...` id). In the Agents SDK, the same handshake is handled for you through the `on_approval_request` callback shown above.

## Errors

OpenAI surfaces MCP failures on the `mcp_call` output item's `error` field rather than as a thrown exception, so check it on each tool call. It covers connectivity failures (the server unreachable), auth rejections (a missing or invalid token), and tool-execution errors returned by Shippo. A first smoke-test call to `shippo_list_tools` (which you can mark `never` under `require_approval`) is the quickest way to confirm your token and connection before wiring up writes.

## Quick reference

- Mint and refresh the Shippo OAuth token yourself. OpenAI will not.
- Inject the credential on every `responses.create` call. Nothing is persisted.
- The `authorization` value is the raw OAuth token. OpenAI adds `Bearer ` itself, so do not prefix it.
- Production endpoint is `mcp.shippo.com`.
- Allow reads, gate writes. Require approval on `shippo_write_execute_tool`.
