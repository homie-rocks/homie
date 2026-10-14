/** Provider connections belong to the AI host. Never inspect credentials or host configuration. */
export const INTEGRATIONS = Object.freeze({
  fal: { label: 'fal', url: 'https://mcp.fal.ai/mcp-relay', connectUrl: 'https://fal.ai/docs/documentation/setting-up/mcp', unlocks: 'Images, 3D and generated video', connect: 'Install the official fal plugin in your AI client, or add this remote MCP URL, then approve its browser sign-in once.' },
  elevenlabs: { label: 'ElevenLabs', url: 'https://api.elevenlabs.io/v1/mcp', connectUrl: 'https://elevenlabs.io/mcp', unlocks: 'Music, speech and sound where exposed by the connected MCP', connect: 'Install elevenlabs/plugin in your AI client, or add this remote MCP URL, then approve its browser sign-in once. Discover the workspace tools before promising a media capability.' },
  cloudflare: { label: 'Cloudflare MCP', url: 'https://mcp.cloudflare.com/mcp', connectUrl: 'https://github.com/cloudflare/skills', unlocks: 'Inspect Workers Issues, logs and D1 through official tools', connect: 'Connect the official Cloudflare plugin or this MCP URL and approve account access in the browser. Deploys separately use Wrangler login (cloudflare_login).' },
});
export function officialConnections(evidence = {}) {
  return Object.entries(INTEGRATIONS).map(([provider, p]) => {
    const connected = evidence[provider] === 'connected';
    return { id: provider === 'cloudflare' ? 'cloudflare-mcp' : provider, label: p.label, need: 'optional', state: connected ? 'ok' : 'optional',
      connection: connected ? 'connected' : evidence[provider] === 'unavailable' ? 'unavailable' : 'unknown',
      detail: connected ? 'Official MCP connected (authenticated call reported by this AI session)' : evidence[provider] === 'unavailable' ? 'Official MCP unavailable in this AI session' : 'Connection unknown: the AI host must discover tools and verify an authenticated read',
      unlocks: p.unlocks, fix: connected ? null : { who: 'person', open: p.connectUrl, say: `${p.connect} MCP URL: ${p.url}` } };
  });
}
