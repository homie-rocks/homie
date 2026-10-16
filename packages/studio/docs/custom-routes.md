# Studio Worker routes

In `site/src/worker.mjs`, register one handler at module evaluation. Keep the
existing exports and registrations. Do not wrap the default export's `fetch`.

```js
import {useRoutes, isOwner, hasRole} from '@homie-rocks/studio/worker';

useRoutes(async (request, env, ctx) => {
  const url = new URL(request.url);
  if (url.pathname === '/.well-known/example.json') {
    return Response.json({name: 'My studio'});
  }
  if (url.pathname === '/custom-api/status') {
    if (!(await isOwner(request, env))) return new Response('Unauthorized', {status: 401});
    return Response.json({ok: true});
  }
  // Return undefined or null to continue to the studio's static assets / 404.
});
```

Homie's matched routes always take precedence, including its office, OAuth,
MCP, discovery, app and game routes, and their authorization refusals. Use a
separate namespace such as `/callbacks/provider` for your OAuth callback;
`/oauth/*` belongs to Homie. Unmatched requests reach your handler before static
assets inside the Worker. Cloudflare normally serves existing public static files
without invoking the Worker. If a custom route must override such a file, put
`{"assets":{"run_worker_first":true}}` in the studio's `wrangler.custom.json`;
build/deploy preserves that setting. A second `useRoutes` call replaces the handler; `useRoutes(null)` removes
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
