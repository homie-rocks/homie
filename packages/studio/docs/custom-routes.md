# Studio Worker routes

In `site/src/worker.mjs`, register one handler at module evaluation. Keep the
existing exports and registrations. Do not wrap the default export's `fetch`.

```js
import {useRoutes, isOwner, hasRole, requireSameOrigin} from '@homie-rocks/studio/worker';

useRoutes(async (request, env, ctx) => {
  const url = new URL(request.url);
  if (url.pathname === '/.well-known/example.json') {
    return Response.json({name: 'My studio'});
  }
  if (url.pathname === '/api/custom/refresh') {
    if (request.method !== 'POST') return new Response('POST required', {status:405});
    const refused = requireSameOrigin(request);
    if (refused) return refused;
    if (!(await isOwner(request, env))) return new Response('Unauthorized', {status: 401});
    // Validate input, then perform the owner-authorized mutation here.
    return Response.json({ok: true});
  }
  // Return undefined or null to continue to the studio's static assets / 404.
});
```

Homie's matched routes always take precedence, including its office, OAuth,
MCP, discovery, app and game routes, and their authorization refusals. Use a
separate namespace under `/api/custom/`, such as `/api/custom/callbacks/provider` for your OAuth callback;
`/oauth/*` belongs to Homie. Unmatched requests reach your handler before static
assets inside the Worker. Cloudflare normally serves existing public static files
without invoking the Worker. If a custom route must override such a file, put
`{"assets":{"run_worker_first":true}}` in the studio's `wrangler.custom.json`;
build/deploy preserves that setting. To intercept only selected files, use
`{"assets":{"run_worker_first":["/feed.json"]}}`. These paths are unioned with
Homie's generated `/games/*`, `/_studio/*`, `/_site/*` and per-app paths. Those
paths must reach the Worker to enforce private app authorization; custom arrays
(including empty arrays) or `false` cannot remove them. Exclusion patterns (starting with `!`) are refused at build, because they would take those paths out from behind their access checks. A second `useRoutes` call replaces the handler; `useRoutes(null)` removes
it. Register configuration only, never request data, at module scope.

The handler may return a `Response`, `null` or `undefined`. Errors propagate as
Worker errors. Responses keep streaming and pass through Homie's normal HTML
security headers, concept-mode handling and database change delivery. Custom
responses also receive `X-Content-Type-Options: nosniff` and a default
`Referrer-Policy: strict-origin-when-cross-origin`. WebSocket upgrades are preserved.
Use `ctx.waitUntil(promise)` for work that must finish after the response.

`await isOwner(request, env)` recognizes the live owner session issued by passkey
sign-in (including expiry and revocation), configured owner player accounts, and
trusted owner tool identity. Read/office bearer keys alone do not make a browser
the owner. `await hasRole(request, env, appId, roleName)` uses the app's declared
role and existing access checks: public roles permit visitors; private roles
require the same private link or handoff session and live grants as the app.
Unknown apps and roles return false. The explicit role argument takes precedence
over query parameters. These helpers authorize identity; custom mutations must
also validate the request method, Origin/CSRF protection, input and OAuth state.

`requireSameOrigin(request)` reuses the studio's browser Origin checks and returns
`null` on success or a 403 `Response` to return immediately. Use it with an explicit
POST (or other mutation method) check before cookie-authorized changes.

Use `/api/custom/*` for studio-owned endpoints: `api` is reserved from game and app
IDs, so future experiences cannot take over that namespace. An app handoff cookie
is scoped to `/<app>/`; the browser does **not** send it to `/custom-api/...` or
`/api/custom/...`. For app role mutations, use the built-in `/<app>/api/app/records/*`
endpoints or an app tool with its existing grant checks. A studio-wide custom
endpoint can use the owner session; do not broaden app cookies or assume a handoff
cookie will authorize `hasRole` outside its app path. Private/invite launches
also require launch access even for a declared anonymous visitor role.

For function HTTP calls whose destination is `self`, use direct `/api/` endpoints
such as `/api/custom/refresh`, not page URLs that redirect. Self calls use
`redirect:'error'`; a redirect fails instead of forwarding credentials.
