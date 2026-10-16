# A studio hosted by a git host

Most studios deploy to their owner's own Cloudflare. Some live with a hosting service instead: it keeps the source in a
Git repository, builds a private preview on every push to `main`, and puts a version live when the owner says so. The
toolkit works with any host that does this with published standards; nothing here is specific to one host.

## The studio says so

```json
"hosting": { "git": "https://host.example/git/studio.git", "mcp": "https://host.example/mcp", "name": "host.example" }
```

`git` is the HTTPS remote (http is accepted only for `localhost` and `127.0.0.1`). `mcp` is the host's MCP server, when
it has one. With `hosting` set:

| | What it does |
| --- | --- |
| `homie-studio deploy`, studio_deploy | Pushes this folder's `HEAD` to `main` on the host. The host builds a private preview; if it has an MCP server, its `build_progress` answer for the commit is shown. |
| `deploy --plan`, studio_deploy `plan: true` | Says it is a push, and that nothing is created on Cloudflare. |
| `homie-studio publish`, studio_publish | Calls the host's `studio_publish` with `{commit, expected}` (the live commit you reviewed, or null). The host may wait for the owner's own approval and says so. |
| cloudflare_login, `storage add`, other deploy-only commands | Refuse, with the reason. |

## Signing in

`homie-studio hosted connect <git url> [folder]` asks for one browser approval:

1. An unauthenticated request to `<git url>/info/refs` gets 401 with `WWW-Authenticate: Bearer resource_metadata="…"`
   (OAuth 2.0 Protected Resource Metadata, RFC 9728). That document names the resource and its authorization server.
2. The authorization server's metadata comes from `/.well-known/oauth-authorization-server` (RFC 8414). It must offer
   PKCE with S256.
3. The toolkit registers itself as a public client (Dynamic Client Registration, RFC 7591) with a loopback redirect on
   `127.0.0.1` (RFC 8252), opens the authorization page, and exchanges the code with its PKCE verifier (RFC 7636),
   naming the resource (RFC 8707). With `--device` and a server that offers it, the device flow (RFC 8628) is used
   instead, for computers with no browser.
4. It clones the studio, sets `credential.<remote>.helper` to this toolkit's `git-credential` (pinned to the toolkit
   version that set it up; run `hosted connect` again to move it) for that remote only, and writes the `hosting` block
   into studio.json if it was not there.

The access token is short-lived and refreshed with the refresh token. Git asks `homie-studio git-credential get` for it
and gets `username=oauth`, `password=<access token>` and `password_expiry_utc`; `erase` (after a 401) forgets the access
token so the next request refreshes. The same token is used for the host's MCP server, which is the resource it was
issued for.

## What a host needs to offer

- HTTPS Git (smart HTTP) that answers 401 with RFC 9728 metadata, and accepts the access token as a Bearer token or as
  the password of Basic authentication;
- an RFC 8414 authorization server with S256 PKCE, dynamic registration and the `resource` parameter;
- optionally a Streamable HTTP MCP server with `build_progress {commit}` and `studio_publish {commit, expected}`.
