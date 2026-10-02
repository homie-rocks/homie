# Homie plugin

The Homie plugin for Claude Code and Codex: a studio in a box for your AI. It makes games,
music and video, and publishes them from a studio that runs on your own Cloudflare account,
on the free plan.

- **Skills** (`skills/`): `studio-setup`, `plan`, `parallel`, `game`, `port`, `publish`,
  `office`, `sound`, `music`, `art`, `video`, `playtest`, `perf` and `lab`.
- **MCP server** (`.mcp.json`): the Homie MCP server at `https://homie.rocks/mcp`, which has
  creator tools only. Nothing in this folder runs a command on install.
- **Manifests:** `.claude-plugin/plugin.json` (Claude Code), `.codex-plugin/plugin.json`
  (Codex), and `plugin.json` (the agent-plugins standard). They say the same thing, and
  `test/manifests.test.mjs` checks that they do.

Install it, and read what a studio is and what it costs, in the
[repository's README](https://github.com/homie-rocks/homie#readme). Report a vulnerability
as [SECURITY.md](SECURITY.md) says.

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
