# Official media proof fixtures

Checked 2026-10-14. `fal-result.json` is the recorded result of one real official fal
OAuth MCP `run_model` call. `forest.png` is that result, 512×512, request
`01a13c26-3085-71b2-8d3a-7e9726c0ba83`, endpoint `fal-ai/flux/schnell`.
Quoted rate: USD 0.003/megapixel; reserve USD 0.003 for rounding. Actual billing was
not read. No second image or paid sound was generated.

`lantern.wav` is a 0.3-second locally synthesized 660 Hz fading tone. It is a
**synthetic sound fixture**, not an ElevenLabs-generated sound or an authenticated
ElevenLabs result capture. The test marks it `fixture: true`, cost unknown. It proves
the shared local placement/provenance path, not ElevenLabs generation. A real audio
MCP capture remains dependent on connecting ElevenLabs in the AI client.

This session exposed fal and Cloudflare MCP tools, but no ElevenLabs tools. To enable
it, the person selects ElevenLabs in the AI client's Connectors directory, clicks
Connect, and signs in/approves workspace access in the browser. The official remote
URL is https://api.elevenlabs.io/v1/mcp. No key is needed. The existing signed-in
ElevenLabs CLI and fal key file were not inspected or reused.

The official-media test places both into a temporary Forest studio, wires them into
`games/forest/index.html`, records request/tool/model/style/rights/cost/hash in
`media/provenance.json`, checks repeat import and failure cases, and deletes the studio.
Rights are deliberately recorded as proof-only, not a commercial permission claim.

![Generated forest](forest.png)

[Sound fixture](lantern.wav) · [Recorded fal response](fal-result.json)
