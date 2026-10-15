# Chrome launcher evidence

Split from runtime PR #144. Independent of the runtime changes; no migrations.

[Runner comparison](https://github.com/homie-rocks/homie/actions/runs/38823144183/job/116724266015): 12 endpoint-URL launches and 12 pipe launches, all successful, with the same flags apart from transport. Original median 185 ms (176–7403); pipe median 177 ms (173–287). The artifact `chrome-launch-comparison` contains raw stderr, process exits and process/shared-memory inventories. The measured first original launch was slow but did not hit 30 seconds. No timeout was increased.

The earlier instrumented shard also recorded successful concurrent Chrome instances and about 8.38 GB available shared memory. Neither observation establishes the cause of the historical timeout: its log lacks stderr, exit status and resource evidence. Pipe transport remains a mitigation, not a proven causal fix.

Validation: `node --test scripts/ci-shards.test.mjs` (5 checks). Run the explicit comparison with `HOMIE_CHROME_EVIDENCE=ci-results/chrome node --import ./scripts/chrome-launch-evidence.mjs scripts/probe-chrome-launch.mjs`. The diagnostic is outside the test inventory.
