# Toolkit batch proof

## Secret capability self origin

`node --test packages/studio/test/secret-self.test.mjs` failed before the change
with `ERR_INVALID_URL` for the relative API path. After the change, that test and
`packages/studio/test/studio-mcp.test.mjs` pass (20 tests). Coverage includes the
runtime origin, relative and absolute URLs, delegated tools, rejected origins,
HTTP, URL credentials, redirect rejection and credential echo suppression.
