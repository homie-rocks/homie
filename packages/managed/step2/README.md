# Managed step 2

Work in progress: isolated source/build/release modules, independent of step 1's
operator harness. No customer onboarding is enabled by this experiment.

Provider references checked 2026-10-15:

- https://developers.cloudflare.com/artifacts/api/rest-api/
- https://developers.cloudflare.com/artifacts/api/workers-binding/
- https://developers.cloudflare.com/artifacts/guides/event-subscriptions/
- https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/
- https://developers.cloudflare.com/containers/api/durable-object-container/
- https://developers.cloudflare.com/containers/guides/image-management/
- https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/

The custom pipeline follows Artifacts' documented event-driven WFP alternative
to Workers Builds. Repository build commands must never run with Cloudflare
deployment credentials. A fresh remote container per build receives only its
source snapshot; a trusted service assembles binding metadata from its registry.

Rollback changes code, never restores database contents. Compatible additive
migrations remain applied. Destructive migrations and DO class lifecycle changes
must fail the automatic rollback gate.
