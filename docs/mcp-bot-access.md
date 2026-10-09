# External bot access over MCP

The optional endpoint is `http://127.0.0.1:8799/mcp` in stable and
`http://127.0.0.1:18799/mcp` in development. It uses the existing harness
listener, which binds to `127.0.0.1`. It is off until the owner enables it.

## Enable and create a client

Open **Settings → Connections → External bot access (MCP)**. Turn on
**Enable MCP access**, enter a client name, select its allowed bots, and
choose whether it is read-only. **Create client token** displays the bearer
once. Save it in the external client's secret storage before dismissing it.

Each client has its own token and allowlist. An empty allowlist is refused.
To change a client's access, revoke its token and create a replacement.
**Revoke token** takes effect on the next request and while a reply is being
awaited. Disabling MCP blocks every client. Revocation or disconnection does
not undo actions already started; use the conversation's **Stop** control.

Only SHA-256 token hashes are saved, in a private `0600` `mcp-access.json`
inside the selected workspace data directory. Plaintext tokens are never
returned by later reads, logged, or broadcast. Workspace backups exclude
MCP access credentials and retain the destination's access settings.

## Tools

- `list_bots` returns only allowed visible bots, with `id`, `name`, `model`,
  and `description`.
- `send_message` takes `bot_id`, `text`, and `request_id`. It starts work in
  a separate visible **MCP · client name** thread on that bot and awaits the
  complete reply. A read-only client cannot call it. Use a new `request_id`
  for each new message. Retrying the same id and text retrieves the same
  send, including after a disconnect; changing its text is refused.
- `get_thread` takes `bot_id`, optional `thread_id`, and optional `limit`
  from 1 to 100, default 30. It returns recent active-branch messages and
  the bot's memory index, bounded to 32,000 characters. Without a thread id
  it reads this client's MCP thread, or the bot's selected thread before
  the client's first send. A specified thread must belong to the allowed bot.

`create_task` is deferred. MCP turns cannot create additional threads or
start delegated bot turns in this version. Direct tool work and bot memory
use remain available through the existing engine and permission broker.

MCP threads always use **Ask**, including when the bot's default is Auto,
Custom, or Full Access. Provider permission requests appear as the existing
approval cards and wait for a person in crewbot. MCP exposes no approval or
permission-setting tool. Clients cannot use MCP tokens on the owner HTTP API.
MCP threads preserve this restriction through app restarts and card continuations.

Authenticated requests, including rejected tool calls, append an activity
entry with the client name/id and method to the allowed bot's conversation.
Discovery/handshake calls are recorded on each allowed bot; a denied target
is recorded on allowed conversations without writing into a forbidden bot.
No call arguments or bearers enter these audit entries. Unauthenticated calls
have no bot authority and are recorded as credential rejections in the server
log. Conversation text is stored through the normal transcript path.

## Streamable HTTP client

Use an MCP client with Streamable HTTP transport and an
`Authorization: Bearer TOKEN` header. The endpoint implements stateless
JSON responses for MCP protocol versions `2025-03-26`, `2025-06-18`, and
`2025-11-25`. It requires JSON content type and both MCP Accept types.
Notifications return 202. GET and DELETE return 405; no session id or
standalone SSE stream is needed. This is the JSON response mode allowed by
the [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

`send_message` waits up to five minutes. A longer turn returns its thread id
and `running` or `needs-approval`; read it with `get_thread` or retry the same
send id after approval. A disconnected client does not cancel the bot.
`notifications/cancelled` cancels the caller's wait, with Stop still in the UI.
Configure your client/proxy timeout to accommodate the wait.

For example, after initializing and sending `notifications/initialized`,
use this JSON-RPC body with the saved bearer header:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_bots","arguments":{}}}
```

Then send to an id returned by that list:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"send_message","arguments":{"bot_id":"BOT_ID","text":"What should we focus on today?","request_id":"daily-question-1"}}}
```

The existing `pnpm mcp` stdio script remains the owner control/verification
interface. Its broader tools and paired session token are separate from this
scoped external endpoint.

## Publish through a tunnel

Keep the harness on loopback. Publish only the MCP path over HTTPS. Do not
expose the whole owner API or configure a listener on `0.0.0.0`. Forward the
Authorization header unchanged. CLI clients normally omit Origin; a browser
Origin must be loopback or match the published request's origin. The endpoint
sets no cross-origin credential permissions.

For a named Cloudflare Tunnel, use an ingress path filter and catch-all:

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /path/to/YOUR_TUNNEL_UUID.json
ingress:
  - hostname: bots.example.com
    path: ^/mcp$
    service: http://127.0.0.1:8799
  - service: http_status:404
```

Validate and run it with `cloudflared tunnel ingress validate` and
`cloudflared tunnel run YOUR_TUNNEL_UUID`. Configure DNS for that named tunnel.
The client's endpoint is `https://bots.example.com/mcp`. For development,
replace `8799` with `18799`. See the
[Cloudflare configuration guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/).

For Tailscale, publish the `/mcp` mount to your local loopback service with
`tailscale serve --bg --https=443 --set-path=/mcp http://127.0.0.1:8799/mcp`.
Use `tailscale serve status` to find the HTTPS hostname and append `/mcp`.
Serve is limited to your tailnet. Funnel publishes publicly; use the
corresponding `tailscale funnel --bg --https=443 --set-path=/mcp http://127.0.0.1:8799/mcp`
only when public access is intended. Keep other mounts on that hostname
unconfigured and test that `/api/bots` is not published. The bearer is still
required with either transport. See the [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
and [Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel).
The backend target includes `/mcp` because Serve strips its mount prefix
before proxying, as implemented in [Tailscale's proxy handler](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go).
These deployment recipes require your own tunnel/network setup; acceptance
fixtures do not create a public tunnel or modify an installed Tailscale service.
