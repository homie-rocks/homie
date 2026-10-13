/** Shared build/live diagnosis: the studio's Worker must register its generated rules. */
export const RULES_WIRING_MESSAGE = "site/src/worker.mjs does not register this studio's server rules. Add hostRules to its import from '@homie-rocks/studio/worker', then add these two lines at module scope:\nimport rules from './rules/index.mjs';\nhostRules(rules);\nBuild and deploy again.";
