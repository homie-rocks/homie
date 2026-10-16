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

## First local notice

0.55.0 already registers functions before starting dev, but ignored migration
failure. Dev now gates startup on successful migrations and registration. The
fresh SQLite test applies the real migrations and declaration SQL, emits the
first notice, and verifies its handler runs once. Removing startup registration
makes that assertion fail (zero deliveries); restoring it passes. The startup
and customer-review suites pass (15 tests), including migration and registration
failure paths and preservation of subscription cursors.

The two selected local-dev integration tests also pass; see `dev-tests.log`.
