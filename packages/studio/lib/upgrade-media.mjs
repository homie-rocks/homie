/** Retire the exact guidance shipped by Homie without opening credential files. */
export const RETIRED_MEDIA_GUIDANCE = "### Existing provider credentials\n\nThe tools read `FAL_KEY` or `ELEVENLABS_API_KEY` first, then the plain single-line\nkey in `~/.homie/keys/fal-key` or `~/.homie/keys/elevenlabs-key`. They also accept\n`~/.homie/workspace/fal-key` and `~/.homie/workspace/elevenlabs-key` from earlier\ninstalls. Checks name the source, never the key. Keep these files private (mode\n0600); never copy them into a studio. ElevenLabs also accepts its CLI browser\nsign-in and the existing Stripe Projects connection. Run the tool\u2019s `check`\nbefore declaring a provider disconnected.\n";
export const OFFICIAL_MEDIA_GUIDANCE = `### Official media connections

Use the official fal and ElevenLabs plugins in the AI client, with their browser sign-in.
Homie never reads provider credentials. Cloudflare deploys use Wrangler login; official
Cloudflare MCP tools inspect logs, Workers Issues and D1. Follow the matching toolkit's
guides/studio-setup/references/OFFICIAL-MEDIA.md. Retired Homie generation scripts have
no compatibility path. Keep existing assets and receipts; do not migrate credential files.
`;
export function upgradeMediaGuidance(text) {
  return text.replace(RETIRED_MEDIA_GUIDANCE.trimEnd(), OFFICIAL_MEDIA_GUIDANCE.trimEnd());
}
