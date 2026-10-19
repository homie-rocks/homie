# A studio hosted by a git host

Most studios deploy to their owner's own Cloudflare. Some live with a hosting service instead: it keeps the source in a
Git repository, builds a private preview on every push to `main`, and puts a version live when the owner says so. The
toolkit works with any host that does this with published standards; nothing here is specific to one host.

## The studio says so

```json
"hosting": { "git": "https://host.example/git/studio.git", "mcp": "https://host.example/mcp", "name": "host.example" }
```

`git` is the HTTPS remote (http is accepted only for `localhost` and `127.0.0.1`). `mcp` is the host's MCP server, when
it has one.

studio.json is repository content, which any change can edit, so it never decides where things go. `deploy` pushes to
the remote this clone was made from (`origin`), and the access token goes only to the resource it was issued for
(RFC 8707). If the `hosting` block names a different remote or MCP server, `deploy` and `publish` refuse, and nothing is
pushed or sent. With `hosting` set:

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
4. It clones the studio, and sets `credential.<remote>.helper` for that remote only, in the clone's own Git config. The
   helper is the studio's own installed toolkit (`node_modules/.bin/homie-studio git-credential`), so Git's sign-in
   needs neither the network nor npx's cache; until `npm ci` has run, it is the toolkit version that set it up, run
   through npx. It writes the `hosting` block into studio.json if it was not there.

The access token is short-lived and refreshed with the refresh token. Git asks `homie-studio git-credential get` for it
and gets `username=oauth`, `password=<access token>` and `password_expiry_utc`; `erase` (after a 401) forgets the access
token so the next request refreshes. The same token is used for the host's MCP server, which is the resource it was
issued for, and for nothing else.

## Addresses on a host that requires a pass

A host in front of the studio may serve it, for one viewer, under a path of its own: a private preview, for one, lets
in only addresses under its pass path. It says so in the `homie-link-base` request header (an absolute path). The
studio's shared room links, the television's join code, the landing's phone code, the game frame and its room sockets
then start with that path. The game frame runs at an opaque origin and sends no cookie, so a pass held in a cookie
would never reach its assets or sockets; one in the path does, and every relative address in the frame keeps it. A
host that requires nothing sends nothing, and every address stays as it was.

## What a host needs to offer

- HTTPS Git (smart HTTP) that answers 401 with RFC 9728 metadata, and accepts the access token as a Bearer token or as
  the password of Basic authentication;
- an RFC 8414 authorization server with S256 PKCE, dynamic registration and the `resource` parameter;
- optionally a Streamable HTTP MCP server with `build_progress {commit}` and `studio_publish {commit, expected}`.
