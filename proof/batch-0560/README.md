# Toolkit batch proof

## Secret capability self origin

`node --test packages/studio/test/secret-self.test.mjs` failed before the change
with `ERR_INVALID_URL` for the relative API path. After the change, that test and
`packages/studio/test/studio-mcp.test.mjs` pass (20 tests). Coverage includes the
runtime origin, relative and absolute URLs, delegated tools, rejected origins,
HTTP, URL credentials, redirect rejection and credential echo suppression.

## Private scaffold

The MCP scaffold regression failed first: an MCP directory connection wrote
`https://homie.rocks` instead of `null`. Removing that implicit choice makes the
new studio's deploy plan unlisted. `private-scaffold.test.mjs` passes (2 tests),
including preservation of an existing explicit directory. The first-run suite
also passes (10 tests). Existing studio configuration is not migrated.
