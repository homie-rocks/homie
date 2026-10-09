# Human steps from nothing to a live studio

Audited against `origin/main` at `daab673` (2026-10-09), then exercised in scratch folders with
this checkout's stand-ins. No real provider account was signed into or deployed to. This is a
source-and-execution audit, not an observation of a new person completing provider registration.

**Counting:** one human task/response is a step. An account registration form is one task; its
unobservable fields, CAPTCHA, MFA and host-specific permission clicks can add steps. Four responses
are counted for the old plan's documented “three or four messages” path. Existing accounts subtract
the creation and email-verification steps. Optional branches are counted separately below, never
silently included in the shortest path. Opening the result and asking for a later change are included.
The old “just build it” exception already skipped some gates; the before counts describe the ordinary
step-by-step path the old instructions mandated, not that exception. Counts are task counts, not timings.

The automation pattern is already present in `cloudflare_login` and `shop connect`: the AI installs/starts the
provider tool, the provider opens its approval page, the AI follows the job and completes the work.
Keys and account ids are implementation details. GitHub is optional for a local studio.

Re-fitted to main `51227fc` (studio 0.37.0 / plugin 0.38.0): app requests use `app new`,
roles and a shared-action check, with no game tutorial. The optional keyless shop keeps its visible
Shop control. These add no mandatory human tasks. The before counts and source permalinks remain
the historical baseline above.

## Counts

| Path | Before | After |
| --- | ---: | ---: |
| Claude Code plugin · studio owner | 27 | 12 |
| Claude Code plugin · business owner | 27 | 12 |
| Claude Code plugin · non-profit organiser | 27 | 12 |
| Claude Desktop extension · studio owner | 26 | 11 |
| Claude Desktop extension · business owner | 26 | 11 |
| Claude Desktop extension · non-profit organiser | 26 | 11 |
| Codex plugin · studio owner | 28 | 12 |
| Codex plugin · business owner | 28 | 12 |
| Codex plugin · non-profit organiser | 28 | 12 |
| Grok Build/Bot plugin · studio owner | 27 | 12 |
| Grok Build/Bot plugin · business owner | 27 | 12 |
| Grok Build/Bot plugin · non-profit organiser | 27 | 12 |

## Claude Code plugin · studio owner

Make a small multiplayer game and its studio site. Human tasks: **27 → 12**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Find Homie and ask Claude Code to install from homie-rocks/homie | Human | Discover/install | AI can run install commands after request | hand to the AI | 1 → 1 |
| 4. Confirm marketplace and choose installation scope | Human | Host trust | Host UI; AI defaults user scope where possible | keep | 2 → 2 |
| 5. Ask for the outcome and to put it live | Human | Intent | Must come from owner | keep | 1 → 1 |
| 6. Answer status-line offer | Human → none | Optional decoration | Do not offer in first run | remove | 1 → 0 |
| 7. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 8. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 9. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 10. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 11. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 12. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 13. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 14. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 15. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 16. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 17. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 18. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 19. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 20. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 21. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 22. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 23. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 24. Approve deploy through Homie host hold | Human | Existing exact-call production safeguard | Not removed in this change; see residuals | keep | 1 → 1 |
| 25. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 26. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 27. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Claude Code plugin · business owner

Make the requested pub game, customer app or business site. Do not force a game when the request is an app. Human tasks: **27 → 12**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Find Homie and ask Claude Code to install from homie-rocks/homie | Human | Discover/install | AI can run install commands after request | hand to the AI | 1 → 1 |
| 4. Confirm marketplace and choose installation scope | Human | Host trust | Host UI; AI defaults user scope where possible | keep | 2 → 2 |
| 5. Ask for the outcome and to put it live | Human | Intent | Must come from owner | keep | 1 → 1 |
| 6. Answer status-line offer | Human → none | Optional decoration | Do not offer in first run | remove | 1 → 0 |
| 7. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 8. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 9. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 10. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 11. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 12. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 13. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 14. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 15. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 16. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 17. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 18. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 19. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 20. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 21. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 22. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 23. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 24. Approve deploy through Homie host hold | Human | Existing exact-call production safeguard | Not removed in this change; see residuals | keep | 1 → 1 |
| 25. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 26. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 27. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Claude Code plugin · non-profit organiser

Make the requested event game, community app or charity site. Payments are optional; never assume tax-deductibility or invent charity status. Human tasks: **27 → 12**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Find Homie and ask Claude Code to install from homie-rocks/homie | Human | Discover/install | AI can run install commands after request | hand to the AI | 1 → 1 |
| 4. Confirm marketplace and choose installation scope | Human | Host trust | Host UI; AI defaults user scope where possible | keep | 2 → 2 |
| 5. Ask for the outcome and to put it live | Human | Intent | Must come from owner | keep | 1 → 1 |
| 6. Answer status-line offer | Human → none | Optional decoration | Do not offer in first run | remove | 1 → 0 |
| 7. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 8. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 9. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 10. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 11. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 12. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 13. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 14. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 15. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 16. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 17. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 18. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 19. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 20. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 21. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 22. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 23. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 24. Approve deploy through Homie host hold | Human | Existing exact-call production safeguard | Not removed in this change; see residuals | keep | 1 → 1 |
| 25. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 26. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 27. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Claude Desktop extension · studio owner

Make a small multiplayer game and its studio site. Human tasks: **26 → 11**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Download homie-studio.mcpb from the release link | Human | Host extension bootstrap | Download can be assisted, host must install | keep | 1 → 1 |
| 4. Open bundle and approve Install (unsigned warning) | Human | Host trust | Claude owns this approval | keep | 1 → 1 |
| 5. Choose Studios folder / inspect its setting | Human → AI default | Choose storage | Home/Studios already works; do not make a step of it | remove | 1 → 0 |
| 6. Start a chat and ask for the live outcome | Human | Intent | Owner supplies outcome | keep | 1 → 1 |
| 7. Choose Always allow for Homie tools | Human | Desktop per-tool prompts | Host permission; otherwise potentially dozens of prompts | keep | 1 → 1 |
| 8. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 9. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 10. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 11. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 12. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 13. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 14. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 15. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 16. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 17. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 18. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 19. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 20. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 21. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 22. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 23. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 24. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 25. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 26. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 27. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Claude Desktop extension · business owner

Make the requested pub game, customer app or business site. Do not force a game when the request is an app. Human tasks: **26 → 11**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Download homie-studio.mcpb from the release link | Human | Host extension bootstrap | Download can be assisted, host must install | keep | 1 → 1 |
| 4. Open bundle and approve Install (unsigned warning) | Human | Host trust | Claude owns this approval | keep | 1 → 1 |
| 5. Choose Studios folder / inspect its setting | Human → AI default | Choose storage | Home/Studios already works; do not make a step of it | remove | 1 → 0 |
| 6. Start a chat and ask for the live outcome | Human | Intent | Owner supplies outcome | keep | 1 → 1 |
| 7. Choose Always allow for Homie tools | Human | Desktop per-tool prompts | Host permission; otherwise potentially dozens of prompts | keep | 1 → 1 |
| 8. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 9. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 10. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 11. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 12. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 13. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 14. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 15. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 16. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 17. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 18. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 19. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 20. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 21. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 22. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 23. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 24. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 25. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 26. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 27. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Claude Desktop extension · non-profit organiser

Make the requested event game, community app or charity site. Payments are optional; never assume tax-deductibility or invent charity status. Human tasks: **26 → 11**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Download homie-studio.mcpb from the release link | Human | Host extension bootstrap | Download can be assisted, host must install | keep | 1 → 1 |
| 4. Open bundle and approve Install (unsigned warning) | Human | Host trust | Claude owns this approval | keep | 1 → 1 |
| 5. Choose Studios folder / inspect its setting | Human → AI default | Choose storage | Home/Studios already works; do not make a step of it | remove | 1 → 0 |
| 6. Start a chat and ask for the live outcome | Human | Intent | Owner supplies outcome | keep | 1 → 1 |
| 7. Choose Always allow for Homie tools | Human | Desktop per-tool prompts | Host permission; otherwise potentially dozens of prompts | keep | 1 → 1 |
| 8. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 9. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 10. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 11. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 12. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 13. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 14. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 15. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 16. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 17. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 18. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 19. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 20. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 21. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 22. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 23. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 24. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 25. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 26. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 27. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Codex plugin · studio owner

Make a small multiplayer game and its studio site. Human tasks: **28 → 12**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Ask Codex to install Homie from the repository | Human | Discover/install | AI runs marketplace add and plugin add | hand to the AI | 1 → 1 |
| 4. Run the two installation commands manually | Human → AI | Old README terminal instructions | AI runs both | hand to the AI | 2 → 0 |
| 5. Start a new session | Human | Host loads tools/skills | Host lifecycle | keep | 1 → 1 |
| 6. Trust Homie hooks in /hooks | Human | Host permission | Host requires user trust | keep | 1 → 1 |
| 7. Ask for the live outcome | Human | Intent | Owner supplies outcome | keep | 1 → 1 |
| 8. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 9. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 10. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 11. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 12. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 13. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 14. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 15. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 16. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 17. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 18. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 19. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 20. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 21. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 22. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 23. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 24. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 25. Approve deploy through Homie host hold | Human | Existing exact-call production safeguard | Not removed in this change; see residuals | keep | 1 → 1 |
| 26. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 27. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 28. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Codex plugin · business owner

Make the requested pub game, customer app or business site. Do not force a game when the request is an app. Human tasks: **28 → 12**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Ask Codex to install Homie from the repository | Human | Discover/install | AI runs marketplace add and plugin add | hand to the AI | 1 → 1 |
| 4. Run the two installation commands manually | Human → AI | Old README terminal instructions | AI runs both | hand to the AI | 2 → 0 |
| 5. Start a new session | Human | Host loads tools/skills | Host lifecycle | keep | 1 → 1 |
| 6. Trust Homie hooks in /hooks | Human | Host permission | Host requires user trust | keep | 1 → 1 |
| 7. Ask for the live outcome | Human | Intent | Owner supplies outcome | keep | 1 → 1 |
| 8. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 9. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 10. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 11. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 12. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 13. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 14. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 15. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 16. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 17. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 18. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 19. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 20. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 21. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 22. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 23. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 24. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 25. Approve deploy through Homie host hold | Human | Existing exact-call production safeguard | Not removed in this change; see residuals | keep | 1 → 1 |
| 26. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 27. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 28. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Codex plugin · non-profit organiser

Make the requested event game, community app or charity site. Payments are optional; never assume tax-deductibility or invent charity status. Human tasks: **28 → 12**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Ask Codex to install Homie from the repository | Human | Discover/install | AI runs marketplace add and plugin add | hand to the AI | 1 → 1 |
| 4. Run the two installation commands manually | Human → AI | Old README terminal instructions | AI runs both | hand to the AI | 2 → 0 |
| 5. Start a new session | Human | Host loads tools/skills | Host lifecycle | keep | 1 → 1 |
| 6. Trust Homie hooks in /hooks | Human | Host permission | Host requires user trust | keep | 1 → 1 |
| 7. Ask for the live outcome | Human | Intent | Owner supplies outcome | keep | 1 → 1 |
| 8. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 9. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 10. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 11. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 12. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 13. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 14. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 15. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 16. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 17. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 18. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 19. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 20. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 21. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 22. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 23. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 24. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 25. Approve deploy through Homie host hold | Human | Existing exact-call production safeguard | Not removed in this change; see residuals | keep | 1 → 1 |
| 26. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 27. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 28. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Grok Build/Bot plugin · studio owner

Make a small multiplayer game and its studio site. Human tasks: **27 → 12**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Ask Grok to install Homie from the repository/install page | Human | Discover/install | AI runs grok plugin install | hand to the AI | 1 → 1 |
| 4. Run plugin installation command manually | Human → AI | Old README terminal instructions | AI runs it | hand to the AI | 1 → 0 |
| 5. Trust the plugin | Human | Host permission | Provider trust UI | keep | 1 → 1 |
| 6. Start a new session | Human | Host loads tools/skills | Host lifecycle | keep | 1 → 1 |
| 7. Ask for the live outcome | Human | Intent | Owner supplies outcome | keep | 1 → 1 |
| 8. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 9. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 10. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 11. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 12. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 13. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 14. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 15. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 16. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 17. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 18. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 19. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 20. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 21. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 22. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 23. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 24. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 25. Approve deploy through Homie host hold | Human | Existing exact-call production safeguard | Not removed in this change; see residuals | keep | 1 → 1 |
| 26. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 27. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 28. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Grok Build/Bot plugin · business owner

Make the requested pub game, customer app or business site. Do not force a game when the request is an app. Human tasks: **27 → 12**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Ask Grok to install Homie from the repository/install page | Human | Discover/install | AI runs grok plugin install | hand to the AI | 1 → 1 |
| 4. Run plugin installation command manually | Human → AI | Old README terminal instructions | AI runs it | hand to the AI | 1 → 0 |
| 5. Trust the plugin | Human | Host permission | Provider trust UI | keep | 1 → 1 |
| 6. Start a new session | Human | Host loads tools/skills | Host lifecycle | keep | 1 → 1 |
| 7. Ask for the live outcome | Human | Intent | Owner supplies outcome | keep | 1 → 1 |
| 8. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 9. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 10. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 11. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 12. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 13. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 14. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 15. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 16. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 17. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 18. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 19. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 20. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 21. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 22. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 23. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 24. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 25. Approve deploy through Homie host hold | Human | Existing exact-call production safeguard | Not removed in this change; see residuals | keep | 1 → 1 |
| 26. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 27. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 28. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Grok Build/Bot plugin · non-profit organiser

Make the requested event game, community app or charity site. Payments are optional; never assume tax-deductibility or invent charity status. Human tasks: **27 → 12**. The AI handles all commands.

| Step, in order | Who does it | Why it exists | Can the AI do it instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| 1. Get the AI client/app on this computer | Human | Host bootstrap | AI is not installed yet; host download/install is required | keep | 1 → 1 |
| 2. Create/sign into the AI account and choose any required plan | Human | Provider identity/access | Provider login and terms | keep | 1 → 1 |
| 3. Ask Grok to install Homie from the repository/install page | Human | Discover/install | AI runs grok plugin install | hand to the AI | 1 → 1 |
| 4. Run plugin installation command manually | Human → AI | Old README terminal instructions | AI runs it | hand to the AI | 1 → 0 |
| 5. Trust the plugin | Human | Host permission | Provider trust UI | keep | 1 → 1 |
| 6. Start a new session | Human | Host loads tools/skills | Host lifecycle | keep | 1 → 1 |
| 7. Ask for the live outcome | Human | Intent | Owner supplies outcome | keep | 1 → 1 |
| 8. Run setup_status and read its checklist | AI | Detect prerequisites | Yes | keep | 0 → 0 |
| 9. Install Node/npm; understand a runtime is needed | Human → AI | Run the toolkit | setup_prepare/private runtime; shell AI installs | hand to the AI | 1 → 0 |
| 10. Approve installation of Chrome and required dependencies | Human → AI | Browser checks | chrome install and package manager | hand to the AI | 1 → 0 |
| 11. Choose a studio name | Human → AI | Name folders/site | Use request/business name, otherwise My Studio | hand to the AI | 1 → 0 |
| 12. Scaffold and install the pinned toolkit | AI | Create an editable owned folder | studio_scaffold installs; follow job | keep | 0 → 0 |
| 13. Say to continue to demo | Human → none | Old staged tutorial | Skip unless tutorial requested | remove | 1 → 0 |
| 14. Open and play the demo before continuing | Human → none | Old proof of capability | AI checks its actual result instead | remove | 1 → 0 |
| 15. Describe a practice change and reload | Human → none | Old teach-the-loop lesson | Build requested outcome immediately | remove | 1 → 0 |
| 16. Say to start the plan interview | Human → none | Old stage gate | AI plans immediately | merge with another step | 1 → 0 |
| 17. Answer four interview messages: genre/look/devices/rooms/saves/art/sound/scope | Human → AI | Old design collection | Infer defaults; record in codex | hand to the AI | 4 → 0 |
| 18. Approve the completed codex | Human → AI | Old build gate | Show choices and continue; changes remain possible | merge with another step | 1 → 0 |
| 19. Choose one agent or parallel agents | Human → AI | Implementation staffing | One agent by default | hand to the AI | 1 → 0 |
| 20. Build, preview, fix and run real-browser checks | AI | Prove the requested result works | Already AI work | keep | 0 → 0 |
| 21. Approve outside reviewer during standard playtest | Human → none | Optional disclosure of screenshots | Local review by default; outside review only on request | remove | 1 → 0 |
| 22. Create Cloudflare account in browser | Human | Provider identity and terms | No; AI opens login/signup when needed | merge with another step | 1 → 1 |
| 23. Click Cloudflare verification email | Human | Provider requires verified ownership | No; exact email link belongs to provider | keep | 1 → 1 |
| 24. Approve Cloudflare OAuth in browser | Human | Authorize own infrastructure | No; cloudflare_login does everything around approval | keep | 1 → 1 |
| 25. Approve deploy through Homie host hold | Human | Existing exact-call production safeguard | Not removed in this change; see residuals | keep | 1 → 1 |
| 26. Deploy Worker, D1, rooms and migrations; check live result | AI | Make it live | studio_deploy; never handle account ids | keep | 0 → 0 |
| 27. Open the finished live link | Human | See the result | AI supplies link; person decides to view | keep | 1 → 1 |
| 28. Ask for a change in the same chat | Human | Express new intent | Cannot infer an unexpressed change | keep | 1 → 1 |

## Optional branches, in order when requested (all twelve paths)

Add these tasks only when that branch is wanted. These are not prerequisites for the first workers.dev site.

| Step | Who does it | Why | AI instead? | Verdict | Human before → after |
| --- | --- | --- | --- | --- | --- |
| List on homie.rocks: ask once, or include in initial request | Human | Public directory consent | Existing request counts; AI runs publish, challenge and verification | keep | 1 → 1 (0 extra when already requested) |
| Account has no workers.dev address | Human → AI | First hosting address | Deploy registers a default through existing OAuth, preserving an existing address | hand to the AI | 1 → 0 when this fallback occurs |
| Choose a custom domain | Human | Brand ownership and possible purchase | Use the requested domain, never make up ownership | keep | 1 → 1 |
| Find zone/account ids, configure exact hostname, DNS and certificate | AI | Route owned domain | `studio_domain` / `homie-studio domain` plus deploy; no ids through person | hand to the AI | 0 → 0; manual configuration eliminated from guidance |
| Domain not on Cloudflare: connect registrar/account and approve nameserver change | Human + AI | Ownership and registrar access | AI enters DNS values; owner signs in/approves purchase or ownership challenge | keep | provider-dependent; not claimed as one click |
| Existing hostname belongs to another site | Human + AI | Avoid replacing someone else's site | AI explains affected hostname; choose another or authorize transfer | keep | 1 → 1 |
| Request a shop/tips/donations and supply real item/price intent | Human | Commercial intent | AI infers implementation; cannot invent prices or charity status | keep | 1 → 1 |
| Create/activate Stripe account if none | Human | Stripe identity, business, bank and eligibility checks | Provider owns form; exact browser flow from Stripe CLI | keep | 1 task → 1 task, possibly many form fields |
| Approve Stripe browser connection | Human | Own payments account | `shop connect` installs CLI, syncs products/prices/links/webhook | keep | 1 → 1 |
| Find/paste Stripe key or webhook secret | Nobody | Not needed by keyless shop | Already handled by tool | remove | 0 → 0 (already fixed on main) |
| Repeat shop connection after editing products | AI | Sync catalogue | Same login; only provider reauthentication needs person | hand to the AI | 0 → 0 |
| Check for toolkit upgrade when opening studio | AI | Discover fixes | Card/upgrade plan provides changes | keep | 0 → 0 |
| Approve concrete upgrade plan | Human | Change pinned dependency | One yes covers apply, install, build, preview and diff | keep | 1 → 1 |
| Resolve edited-template differences after upgrade | AI | Preserve owner's edits | Read diff, reconcile within request; no manual patching for owner | hand to the AI | 0 → 0 |
| Update plugin/extension itself | AI + host | New instructions/tools | AI updates plugin; Desktop still requires opening/installing new bundle | keep | plugin 1 → 1; Desktop download/install 2 → 2 |
| Request private backup on GitHub | Human | Optional off-machine copy | Request authorizes AI to create private repo and push | keep | 1 → 1 |
| Create GitHub account | Human | Provider identity | https://github.com/signup | keep | 1 → 1 |
| Install GitHub CLI | AI | Device login/backup | Install through package manager; no user terminal | hand to the AI | 1 → 0 |
| GitHub device approval | Human + AI | GitHub device flow | AI opens https://github.com/login/device and can enter displayed code in a browser-capable host; owner approves | keep | 1 → 1; Desktop without browser control still needs the device code |
| Move computer: install host/plugin/extension | Human + AI | New host trust | Repeat entry table, not design interview | keep | entry-specific |
| Identify which studio to open | Human | Select intended repository/folder | Infer from prior context if unique; AI lists repositories and clones via studio_open | keep | 1 → 1 |
| Install studio dependencies, recover version, run checks | AI | New machine | studio_open starts install; no manual ids/configuration | keep | 0 → 0 |
| Reauthorize Cloudflare/Stripe on new computer when needed | Human | Provider session is machine-local | AI starts browser flows only when work needs them | keep | 1 per provider → 1 per provider |
| Add collaborator: name the person and access needed | Human | Access consent | AI defaults repository collaboration, not Cloudflare billing/admin | keep | 1 → 1 |
| AI creates GitHub invitation; collaborator accepts | AI + invitee | Repository access | AI resolves username from explicit identity, invites through gh; invitee accepts provider link | hand to the AI | 2 → 1 owner/admin tasks; invitation acceptance remains |
| Cloudflare team access, only if actually needed | Human + AI | Infrastructure access separate from repo edits | AI navigates account members; owner approves named member/role; invitee accepts | keep | provider-dependent |

A collaborator can propose changes by PR without the owner's Cloudflare or Stripe login. Do not send credentials
or `.studio/local.json` to another computer or collaborator. Move the repository and media, then sign in through
the provider. GitHub need not exist for the initial local studio. An offline folder backup is also possible.

## Remote Claude chat/phone and Grok chat

The remote connector and its hosted setup cards are not implemented in this open-source checkout. The repo
contains the client, template, handoff and instructions. Do not claim this PR changes the hosted connector.
Each persona follows the same remote entry and provider steps; the AI should choose a site/app/game from intent.

| Step | Who | Why | AI instead? | Verdict |
| --- | --- | --- | --- | --- |
| Open host, add custom connector https://homie.rocks/mcp | Human | Host trust | AI may guide; host controls connector settings | keep |
| Ask for live outcome | Human | Intent | No | keep |
| Tap Make the studio on Cloudflare | Human | Hosted Deploy to Cloudflare | Hosted implementation outside checkout | keep |
| Create/sign into GitHub and grant repository access | Human | Template gets a repository | Provider approval | keep |
| Create/sign into Cloudflare, verify email, approve | Human | Own hosting | Provider approval | keep |
| Name repository/studio | Human → AI default | Old template/setup card | Template default My Studio; hosted form may still ask | hand to the AI where host permits |
| Let a coding session access the repository | Human | Remote chat cannot edit files itself | Host authorization | keep |
| Copy “Continue building … hb_…” into coding session | Human | Cross-session handoff | No bridge in this checkout; prefer Desktop extension on computer | keep, residual |
| Change cloud-session network settings if blocked | Human → AI browser | Host network policy | Browser-capable AI can enter homie.rocks; human approves policy | hand to the AI where host permits |
| AI attaches setup/build, installs, builds, checks, opens PR | AI | Carry context across sessions | Already AI work | keep |
| Approve/merge publish PR; Cloudflare Builds deploys | Human | Repo/host publication permission | AI can merge if explicitly authorized; no need to copy ids | keep |
| Ask for change | Human | New intent | No | keep |

There is no defensible exact remote “after” click count from local stand-ins: the hosted card and provider
forms were not signed into. The documented minimum task sequence is **12 → 12** for each of Claude remote
and Grok chat, for each of the three personas; naming/network work may be delegated when host capabilities
permit. This is explicitly a residual, not a completed one-approval remote flow.

## Questions the AI should decide

| Source | Former question/gate | Default / action | Verdict |
| --- | --- | --- | --- |
| studio-setup; MCP instructions/scaffold | What should it be called? | Requested business name, otherwise My Studio | hand to the AI |
| studio-setup; setup card checklist | Ready for demo? What small change? Continue? | Omit tutorial unless requested | remove |
| plan; game_plan; INTERVIEW.md | Genre, camera, palette, style board or automatic? | Infer genre; automatic style from premise | hand to the AI |
| plan | Phone/computer, room size, teams, bots, rounds? | Both devices; small room and short rounds appropriate to premise | hand to the AI |
| plan | Persistent progress, inventories, lifetime stats, hardcore death? | Saves for persistent characters/collections; no irreversible death by default | hand to the AI |
| plan | Which art, film, sound, tempo, scope? | CC0/local sound; playable first version; no paid media | hand to the AI |
| plan/studio-setup/parallel | One agent or several? | One by default | remove |
| studio-setup | Want a status line? | Existing progress card/page; status line only on request | remove |
| style | Show directions/pick/mix/lock? | Automatic; only hands-on when requested | keep only on request |
| playtest | Share screenshots with independent reviewer? | Local review by default; outside disclosure only on request/consent | remove from first run |
| doctor/jobs | Install Node, Chrome, npm? Retry after install? | AI prepares and follows jobs | hand to the AI |
| publish | Which account id/zone/DNS value? | Discover ids; ask account NAME only if ownership ambiguous | hand to the AI |
| upgrade/scaffold | Patch generated files yourself? | AI applies plan, reconciles preserved edits and verifies | hand to the AI |
| music/art/video/models | Install tool? Find a provider key? | AI installs; browser sign-in or already connected account; local assets by default | hand to the AI; paid fal script residual below |
| standalone | Choose app id, install JDK/Xcode, set signing variables? | AI derives app id from owned domain and discovers signing identity; host/provider approvals remain | hand to the AI |

Questions that express ownership or new intent remain: which existing business account when ambiguous;
which existing studio when ambiguous; what event/time to announce; who a collaborator is; permission to
spend beyond an agreed budget; imported asset rights if unknown; deletion of an old folder; publication of
private work; acceptance of provider terms; model downloads of 11–18 GB. These are not design questions.
An earlier folder is never silently deleted. A request to import it covers copying its notes; deletion is separate.

## Source coverage and residuals

Read `packages/studio/lib/mcp.mjs`, `mcp-tools.mjs`, `doctor.mjs`, `jobs.mjs`, `scaffold.mjs`, `setup.mjs`,
`cloudflare.mjs`, `routes.mjs`, `upgrade.mjs`, `domain.mjs`, `prepare.mjs`, the CLI, generated template,
Desktop manifest/README/build script, README, all plugin manifests and provider catalogue. Searched every
skill and reference for ask/agree/yes/choose/pick/install/terminal/key language. Reviewed these families:

| Family | Where human interaction remains | Verdict |
| --- | --- | --- |
| setup/plan/parallel/style | Optional hands-on steering, protected decisions, old-folder deletion | keep consent; defaults replace first-run questions |
| game/port/parts | Intended source game, ownership/licence and publishing shared parts | AI chooses implementation; keep rights/intent |
| art/models/animate/music/sound/video | Paid budgets, provider sign-in, supplied assets' rights | Local/CC0 defaults; keep spending/rights |
| playtest/perf/lab | Optional external review, requested hands-on tuning | AI runs local checks and chooses fixes |
| publish/office/servers/shop | Provider auth, live money, destructive owner actions and moderation | keep explicit intent; AI handles ids and settings |
| standalone | Apple/Google/store accounts, signing authorization, real-device install | provider/OS approval; never owner terminal commands |
| feedback | Exact outgoing note, destination consent | keep; sending is optional and separate from setup |

**Not solved by this PR:** Homie's exact-call deploy holds still add an approval beyond Cloudflare OAuth in
Code/Codex/Grok. They are a Homie safeguard, not a provider limitation; removing or binding them to a broader
“make it live” authorization needs a separate guard design. Desktop still asks per tool unless the user chooses
Always allow (and host policy may refuse). A phone-only chat still has a cross-session handoff. GitHub's device
flow in Desktop without browser control still asks for its one-time code. These are not keys, but do violate
the ideal of no copying. The new runtime installer supports macOS/Linux/Windows x64/arm64; unsupported machines,
locked-down hosts, blocked downloads and missing system archive tools still need an AI with OS access or an
administrator. It verifies the archive against Node's HTTPS SHA-256 list; it does not independently validate a
release signature. Automatic package installation may itself trigger an OS authorization prompt.

Paid fal scripts still require a credential already in the environment; the OAuth MCP's generation path is not
integrated with those scripts' budget/receipt/resume machinery. New people should get local art/footage, not a key
setup assignment. Full keyless paid fal generation remains work. Apple notarization and store submission were not
run with real credentials; no claim of one-click signing is made. Account creation/KYC and registrar delegation
cannot truthfully be collapsed to “one click” by this repo. Exact links: [Cloudflare signup](https://dash.cloudflare.com/sign-up),
[GitHub signup](https://github.com/signup), [GitHub device approval](https://github.com/login/device),
[Stripe dashboard](https://dashboard.stripe.com/register), [Cloudflare domains](https://dash.cloudflare.com/?to=/:account/domains),
[Desktop extension](https://github.com/homie-rocks/homie/releases/latest/download/homie-studio.mcpb).
OAuth approval URLs contain per-session state and are returned by the running provider CLI, not hard-coded.

The [Workers subdomain API](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/update/) lets the toolkit register the initial account address with Workers Scripts Write permission. No new key or account setting is assigned to the person.

Cloudflare creates DNS and certificates for Workers custom domains on an active zone;
[Cloudflare's documentation](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
explains the ownership and existing-record constraints. A route configuration alone is not proof that a live
hostname works: deploy and check it. An external registrar purchase/delegation remains outside Cloudflare's
current sign-in. The AI must never replace another website's DNS merely to finish onboarding.

## Execution and release evidence

`first-run-steps.test.mjs` uses scratch homes/studios and injected download/extraction stand-ins to test missing
runtime setup, checksum rejection, discovery, reuse, default naming, a five-step setup card, no interview,
custom-domain validation, idempotence, preservation of existing routes, and workers.dev registration without overwriting an existing address. Existing MCP, cloud, studio,
shop, upgrade and browser tests exercise the rest of the flow against stand-in providers and local servers.
The full `npm test` is run with real Chrome via CHROME_PATH. No provider login/deploy is needed by these tests.

Scaffold instructions changed, so the next unused patch after main is **studio 0.37.1 / plugin 0.38.1**.
The package, workspace lock, Worker version, all plugin manifests, marketplace, generated template and template
fingerprints are bumped together, following the previous release. Both changelog copies include the new version section; released sections remain unchanged. A real private-runtime trial on this Mac downloaded Node v22.23.3, verified its archive, ran Node and npm 10.9.9, and removed the scratch installation. Final gate results are recorded in the PR.

## Release-train verification (0.37.1)

The full package suite passed 1,391 tests, skipped 6 optional integrations, and failed none with
Chrome configured and release tags fetched. The focused first-run suite, including the new app-only
checklist case, passed 10/10. The plugin suite passed 118, skipped 1, failed none. Install, build,
plugin validation, the packed Desktop check, changelog check and publish check passed; publish plans
one new studio version and leaves the other 22 npm packages unchanged.

The four hostile-rule timing failures were already corrected on main by measuring CPU work rather
than wall time. The 200,000-row shop read now does the same: its 15,000 ms limit is unchanged, and the
full-suite read used 1,961 CPU ms. This excludes time the operating system gives other test processes;
there is no retry or weakened threshold. The rolling-upgrade test already ignores tags at or above
the checkout's own version, including the tag on the commit being published.

Trials: a disposable copy of /Users/ryan/Studios/homie-arcade, initially without node_modules, built and passed all five game checks with the packed toolkit, matching released 0.37.0. Both browsers drew 60–61 fps (baseline 60). The complete app-first-run trial went from an empty folder through the AI-chosen default name, app creation, custom-domain preparation, install/build, a real Chrome shared action on a wall and two phones, reconnect, and the same studio's first deployment using provider stand-ins with automatic workers.dev registration/retry. All temporary copies were deleted; the original studio was untouched.

## Appendix: source locations of human-directed prompts on main

These are the matching instruction/result sites, including conditional and optional branches. Long source
lines are clipped around the human instruction; the permalink has the complete text. References to an
owner confirmation in gameplay are included when they appear in a skill. This inventory is from main,
so removed instructions remain visible as audit evidence. The path tables above determine whether a
prompt actually adds a first-run step; a conditional mention is not another counted task.

| Source on main | Instruction/result excerpt | Disposition |
| --- | --- | --- |
| [README.md:78](https://github.com/homie-rocks/homie/blob/daab673/README.md#L78) | ahead of time): its skills, its MCP server and its hooks load only once you do. Then start a new session and | keep only if intent is missing; default implementation choices |
| [README.md:92](https://github.com/homie-rocks/homie/blob/daab673/README.md#L92) | https://homie.rocks/install.md and install Homie, then ask for a studio. Checked 2026-10-04: from that one | hand to the AI; provider/host limits noted above |
| [README.md:94](https://github.com/homie-rocks/homie/blob/daab673/README.md#L94) | then asked for the Cloudflare approval. In Grok chat the Homie connector is the same address, | keep intent/consent; merge prior authorization |
| [README.md:125](https://github.com/homie-rocks/homie/blob/daab673/README.md#L125) | person chooses, knowing parallel is faster and uses more of their plan. Every build has a progress | hand to the AI / remove default gate |
| [README.md:348](https://github.com/homie-rocks/homie/blob/daab673/README.md#L348) | - **Start a new session after installing** the plugin in Codex or Grok, so its skills and tools | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/art-tools.mjs:279](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/art-tools.mjs#L279) | … ' (no art budget yet: free routes only until the person sets one)'}.`, ...(lib?.error ? [`Library: ${lib.error}`] : [])].join('\n'), data);… | keep intent/consent; merge prior authorization |
| [packages/studio/lib/art-tools.mjs:299](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/art-tools.mjs#L299) | …cc0, cc-by-4.0 with attribution, eula:<store>, …; ask the person whose it is). It is checked first (a file with an external URI, or one over the size caps, is refused), made phone-sized (triangles, pictures, pivot, height in metres), copied into games/<id>/pub… | keep intent/consent; merge prior authorization |
| [packages/studio/lib/cloudflare.mjs:108](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/cloudflare.mjs#L108) | …e domain>" }. If it IS the studio's own hostname, ask the person: only they can unassign it from the other Worker, in the zone's Workers Routes in the Cloudflare dashboard.` };… | keep intent/consent; merge prior authorization |
| [packages/studio/lib/cloudflare.mjs:247](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/cloudflare.mjs#L247) | …older: it opens Cloudflare in the browser and the person approves once (a free account works, no payment method). Then run `npm run deploy` again.' };… | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/cloudflare.mjs:251](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/cloudflare.mjs#L251) | … login can reach ${who.accounts.length} accounts; ask the person which one this studio uses and put its id in studio.json (cloudflare.accountId).`, accounts: who.accounts };… | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/cloudflare.mjs:302](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/cloudflare.mjs#L302) | // with no payment method is never asked anything about R2. Each file is read back and its SHA-256 compared before | keep only if intent is missing; default implementation choices |
| [packages/studio/lib/cloudflare.mjs:713](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/cloudflare.mjs#L713) | …payment method on the account before R2 works, so ask the person first. Games never need it.' };… | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/doctor.mjs:195](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/doctor.mjs#L195) | fix: major >= 22 ? null : { who: 'person', open: 'https://nodejs.org/en/download', say: 'Install Node.js 22 or newer (the LTS download), then start a new session.' }, | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/doctor.mjs:253](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/doctor.mjs#L253) | …cks/homie, then codex plugin add homie@homie) and start a new session. Grok Build: grok plugin install homie-rocks/homie#plugins/homie (Grok asks whether to trust it), then a new session. The Claude app, or Grok chat: add the connector https://homie.rocks/mcp;… | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/doctor.mjs:259](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/doctor.mjs#L259) | …s the other server as it is; you approve it, then start a new session. Until then your AI goes on with the studio's own commands.`,… | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/doctor.mjs:272](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/doctor.mjs#L272) | ? { who: 'person', say: `In claude.ai/code, open this environment's settings, set Network access to Custom, add ${host} (keep the default package managers), and start a new session.` } | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/doctor.mjs:298](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/doctor.mjs#L298) | …install homie-rocks/homie#plugins/homie --trust), start a new session (/hooks lists Homie\'s three), then run this again. Until then nothing is held, so your AI asks you before each of those itself.',… | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/doctor.mjs:401](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/doctor.mjs#L401) | …on', open: 'https://fal.ai/dashboard/keys', say: 'Make a key, put FAL_KEY in the environment your AI runs in (for example a line in your shell profile), and start a new session. Never paste it into the chat.' },… | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/handoff.mjs:82](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/handoff.mjs#L82) | const instead = `If the Homie connector's tools are in this session, call build_progress with { "build": "${build}" }: it answers with the brief. Otherwise ask the person what to build; the card in their chat shows it.`; | keep only if intent is missing; default implementation choices |
| [packages/studio/lib/handoff.mjs:118](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/handoff.mjs#L118) | r.brief ? `The person's brief, from the chat:\n${r.brief.split('\n').map((l) => `  ${l}`).join('\n')}` : 'No brief beyond the title: ask the person one question if anything is unclear.', | keep only if intent is missing; default implementation choices |
| [packages/studio/lib/jobs.mjs:164](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/jobs.mjs#L164) | if (!node) throw new Error('no Node.js 22 or newer on this computer: install it from https://nodejs.org/en/download (the LTS), then ask again'); | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/jobs.mjs:172](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/jobs.mjs#L172) | if (!node?.npm) throw new Error('npm was not found next to Node.js on this computer: install Node.js 22 or newer from https://nodejs.org/en/download, then ask again'); | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/local-ai.mjs:61](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/local-ai.mjs#L61) | say: `Ollama ${version} is here without Clef. Downloading it is the person's choice: ask first. \`ollama pull ${flash.name}\` downloads ${flash.size} (the ${flash.params} model; ${LOCAL_MODELS[1].name} is ${LOCAL_MODELS[1].size}). Then run dev again.`, | keep intent/consent; merge prior authorization |
| [packages/studio/lib/mcp-tools.mjs:256](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L256) | // homie.rocks). The card never asks for an address, and an agent never types one in for the person. | keep only if intent is missing; default implementation choices |
| [packages/studio/lib/mcp-tools.mjs:271](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L271) | `Homie updates by email (optional): ${HOMIE_UPDATES} (the person signs up there themselves; never type an address in for them).`, | keep intent/consent; merge prior authorization |
| [packages/studio/lib/mcp-tools.mjs:366](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L366) | …["upgrade"] } shows the plan and changes nothing; with their yes, ["upgrade","--apply"], then studio_install.`,… | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/mcp-tools.mjs:559](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L559) | …o the plan with the person (the game's CODEX.md), then ask whether to remove the old folder (studio_fold with remove: true moves it to the Trash).${shown ? `\n${shown}` : ''}`, { kind: 'fold', from, to: `notes/earlier/${basename(from)}`, files: copied });… | keep intent/consent; merge prior authorization |
| [packages/studio/lib/mcp-tools.mjs:577](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L577) | const GITHUB_REFUSED = 'GitHub did not let this computer read that repository. Sign this computer in to GitHub (github_login: a one-time code in the browser), or check the repository\'s name; then ask again. Never paste a token into the chat.'; | keep intent/consent; merge prior authorization |
| [packages/studio/lib/mcp-tools.mjs:620](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L620) | /** github_login: GitHub's device sign-in through the GitHub CLI; the person types the one-time code in the browser. */ | keep intent/consent; merge prior authorization |
| [packages/studio/lib/mcp-tools.mjs:672](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L672) | * after the person's yes), decline (the person said no: nothing is sent, and no note is offered again this session). | keep intent/consent; merge prior authorization |
| [packages/studio/lib/mcp-tools.mjs:701](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L701) | … again, show them the new note, and send that one after their yes.', view('changed', { draft: String(a.draft), note: known.note, taken: known.taken, with: withLine(known.note), studio: facts.studio, why: 'changed since the draft' }));… | keep intent/consent; merge prior authorization |
| [packages/studio/lib/mcp-tools.mjs:730](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L730) | if (!a.draft) return fail(`Not sent: a send names the draft the person saw (homie_feedback { "action": "draft", … } first, show it, and send its "draft" id after their yes).`, view('invalid', { why: 'no draft' })); | keep intent/consent; merge prior authorization |
| [packages/studio/lib/mcp-tools.mjs:731](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L731) | … again, show them the new note, and send that one after their yes.', view('changed', { ...shown, why: 'changed since the draft' }));… | keep intent/consent; merge prior authorization |
| [packages/studio/lib/mcp-tools.mjs:921](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L921) | …nd get the plan interview to run with the person: two or three questions a message, each with options and your pick, about game type and genre, style, devices, players and rooms, art and film, music and sound, and scope. A game is planned before it is made: wi… | hand to the AI / remove default gate |
| [packages/studio/lib/mcp-tools.mjs:935](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp-tools.mjs#L935) | 'Now the interview: two or three questions a message, each with concrete options and your pick, so "yes" is an answer. Say back what you heard in one line before the next. Stop after three or four rounds; "just build it" means fill the rest with your own choic… | hand to the AI / remove default gate |
| [packages/studio/lib/mcp.mjs:36](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp.mjs#L36) | A new studio follows one checklist, in order and never ahead. Show it in your first reply and again, ticked, as each step ends: | keep only if intent is missing; default implementation choices |
| [packages/studio/lib/mcp.mjs:41](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp.mjs#L41) | …. Plan their game (game_plan): a short interview, two or three questions a message with options and your pick; then fill games/<id>/CODEX.md and show it (game_codex). Look for pieces first: the @homie-rocks/* packages for general mechanisms, and parts_find for… | hand to the AI / remove default gate |
| [packages/studio/lib/mcp.mjs:47](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/mcp.mjs#L47) | If studio_scaffold finds an earlier folder of the studio's name that is not a studio, ask the person whether to fold its premise in (studio_fold), and remove it only with a second yes. | keep intent/consent; merge prior authorization |
| [packages/studio/lib/projects.mjs:10](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/projects.mjs#L10) | *      Stripe's sign-in in the browser: the person signs in, then this runs again); | keep intent/consent; merge prior authorization |
| [packages/studio/lib/projects.mjs:161](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/projects.mjs#L161) | return stop('stripe-cli', { who: 'ai', run: 'npm install -g @stripe/cli@latest', say: 'Stripe\'s own CLI (or on a Mac: brew install stripe/stripe-cli/stripe); the person approves the install.' }, 'the Stripe CLI is not on this computer'); | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/projects.mjs:178](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/projects.mjs#L178) | say: 'Stripe opens its sign-in in the browser: the person signs in to THEIR OWN Stripe account (a new free one is fine; never a work or client account that happens to be signed in here). Wait until they say it is done, then run this again.', | keep intent/consent; merge prior authorization |
| [packages/studio/lib/projects.mjs:223](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/projects.mjs#L223) | : 'ElevenLabs\' own approval page may open: the person approves once. Then run this again.', | keep intent/consent; merge prior authorization |
| [packages/studio/lib/scaffold.mjs:186](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/scaffold.mjs#L186) | If Wrangler is not signed in, run \`npx wrangler login\`: the person approves once in | keep intent/consent; merge prior authorization |
| [packages/studio/lib/scaffold.mjs:353](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/scaffold.mjs#L353) | it; a locked one changes only with the person's yes after \`style blast\` shows what goes stale and what remaking | keep intent/consent; merge prior authorization |
| [packages/studio/lib/scaffold.mjs:374](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/scaffold.mjs#L374) | - The owner runs the studio's live games from \`/_studio/office\` (\`npx --no-install homie-studio office link\` gives | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/standalone-tools.mjs:32](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/standalone-tools.mjs#L32) | …lease: true) signs from environment variables the person sets themselves, needs the app's id written in game.json first (the tool gives the exact lines), and says UNSIGNED when it could not sign. In a copy, Quick play finds a room only when the studio's live s… | hand to the AI; provider/host limits noted above |
| [packages/studio/lib/standalone.mjs:967](https://github.com/homie-rocks/homie/blob/daab673/packages/studio/lib/standalone.mjs#L967) | …, Developer Mode, turn it on. The phone restarts, then asks once more to turn it on: say yes, unlock it, and run this again. (The switch appears only after the phone has been plugged in to a Mac with Xcode.)' };… | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/art/SKILL.md:60](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/art/SKILL.md#L60) | it, and the person signs in on fal's own page (no key): in Claude Code `claude mcp add --transport http | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/game/SKILL.md:4](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/game/SKILL.md#L4) | … decisions on this computer under dev (downloaded only after the person's yes).… | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/music/SKILL.md:20](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/music/SKILL.md#L20) | ask the person something (the go-ahead on the cost, a budget, an install). | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/music/SKILL.md:24](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/music/SKILL.md#L24) | A studio that never makes music is never asked about ElevenLabs. **Free first:** sound effects, a | keep only if intent is missing; default implementation choices |
| [plugins/homie/skills/music/SKILL.md:42](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/music/SKILL.md#L42) | browser; the person signs in once and the sign-in stays in the OS keychain. Nobody pastes a key. | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/music/SKILL.md:43](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/music/SKILL.md#L43) | The person approves the install. An older CLI works; `brew upgrade elevenlabs` keeps it current | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/music/SKILL.md:60](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/music/SKILL.md#L60) | No ffmpeg: offer `brew install ffmpeg` (macOS) or the system package; the person approves. | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/music/SKILL.md:150](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/music/SKILL.md#L150) | node <music.mjs> stems <slug> --yes                   # paid, priced by measurement; ask first | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/music/SKILL.md:184](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/music/SKILL.md#L184) | - Never print, paste or store a key; never ask for one in chat. | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/parallel/SKILL.md:9](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/parallel/SKILL.md#L9) | the game at the same time, finish sooner and use more. The person chooses. | keep only if intent is missing; default implementation choices |
| [plugins/homie/skills/parallel/SKILL.md:14](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/parallel/SKILL.md#L14) | the Agent tool), ask once, with your pick: | keep only if intent is missing; default implementation choices |
| [plugins/homie/skills/parts/SKILL.md:59](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/parts/SKILL.md#L59) | the studio edited is not replaced unless you pass `overwrite`: ask the person first. | keep only if intent is missing; default implementation choices |
| [plugins/homie/skills/perf/references/METHOD.md:84](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/perf/references/METHOD.md#L84) | Trades, never optimisations (say them, and only with the person's yes): a lower resolution or pixel ratio, fewer bots, | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/plan/SKILL.md:29](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/plan/SKILL.md#L29) | 5. **Progress and saves**: always ask it plainly: "Does progress need to persist across sessions or devices?" | keep only if intent is missing; default implementation choices |
| [plugins/homie/skills/playtest/SKILL.md:112](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/playtest/SKILL.md#L112) | **The review hands the game's screenshots to someone outside this session, so ask first, once.** | keep only if intent is missing; default implementation choices |
| [plugins/homie/skills/port/SKILL.md:203](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/port/SKILL.md#L203) | Follow the `publish` skill: `npm run deploy` (the person approves Cloudflare once | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/port/SKILL.md:228](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/port/SKILL.md#L228) | - Never ask the person to run a command. | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/port/references/RECIPE.md:228](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/port/references/RECIPE.md#L228) | - `movement: 'owner'`: the owner runs the game's own physics for its own body | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/publish/SKILL.md:59](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/publish/SKILL.md#L59) | person approves on any device. | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/publish/SKILL.md:60](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/publish/SKILL.md#L60) | 3. Several accounts: ask the person which one, and put its id in `studio.json` | keep only if intent is missing; default implementation choices |
| [plugins/homie/skills/publish/SKILL.md:242](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/publish/SKILL.md#L242) | without keys, tokens or private addresses in it. Or, with their yes, send a short note | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/servers/SKILL.md:4](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/servers/SKILL.md#L4) | compatibility: The studio's own Cloudflare account, with Workers AI through its Worker (Clef by default), Wrangler for the model catalogue and the doctor's probe; optionally Ollama with clef-flash on the person's own computer, downloaded only after their yes. | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/servers/SKILL.md:46](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/servers/SKILL.md#L46) | …n <game> <server> owner-key --budget 1`, then the owner runs `npx --no-install homie-studio agents brain key` on their own computer \| The key is typed into a page on their computer and goes straight to the Worker secret; **never ask for a key in the chat**. c… | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/servers/SKILL.md:49](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/servers/SKILL.md#L49) | …ith no `clef-flash` it says what the download is: ask first (below). \|… | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/shop/SKILL.md:48](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/shop/SKILL.md#L48) | - Never silently select `--manual`. Only when the owner chooses the fallback, run | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/sound/SKILL.md:22](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/sound/SKILL.md#L22) | No ffmpeg: offer `brew install ffmpeg` (macOS) or the system package; the person approves. | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/standalone/SKILL.md:104](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/standalone/SKILL.md#L104) | `HOMIE_APPLE_TEAM`, else the keychain's only one: never ask for a team id, a phone's id or a name in the chat, | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/standalone/SKILL.md:118](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/standalone/SKILL.md#L118) | 3. Signing comes from **environment variables the person sets themselves**: `HOMIE_APPLE_IDENTITY` and | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/studio-setup/SKILL.md:36](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/studio-setup/SKILL.md#L36) | plays, their change, the codex page), and the next starts when they say so. Keep it natural, not | hand to the AI / remove default gate |
| [plugins/homie/skills/studio-setup/SKILL.md:94](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/studio-setup/SKILL.md#L94) | say its size first (`ollama pull clef-flash`, about 11 GB) and run it only after their yes. | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/studio-setup/SKILL.md:101](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/studio-setup/SKILL.md#L101) | `--trust` and start a new session. Until then I'll ask you before a deploy, a Cloudflare change, a paid | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/studio-setup/SKILL.md:117](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/studio-setup/SKILL.md#L117) | with the person's yes, and never wait for it. | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/studio-setup/SKILL.md:216](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/studio-setup/SKILL.md#L216) | 4. In Claude Code, offer the status line in one line (above), then ask about step 2. | hand to the AI / remove default gate |
| [plugins/homie/skills/studio-setup/SKILL.md:352](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/studio-setup/SKILL.md#L352) | - `stripe-cli` / `projects-plugin`: run the command it names (the person approves the install); | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/studio-setup/SKILL.md:356](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/studio-setup/SKILL.md#L356) | - `accept-terms`: ask the person; only after their yes, run it again with `--accept-tos`; | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/studio-setup/SKILL.md:402](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/studio-setup/SKILL.md#L402) | 3. Only with their yes: the `--apply` command the plan names, then `npm install` (`studio_install`), `npm run build`, | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/studio-setup/SKILL.md:429](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/studio-setup/SKILL.md#L429) | - Never ask the person to type a command. | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/style/SKILL.md:83](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/style/SKILL.md#L83) | npx --no-install homie-studio style set <id> style.palette <value> --unlock --reason "<their words>" --confirm  # after their yes | hand to the AI; provider/host limits noted above |
| [plugins/homie/skills/video/SKILL.md:134](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/video/SKILL.md#L134) | because video endpoints retire and reprice monthly. Not connected? Offer it, and the person signs in | keep intent/consent; merge prior authorization |
| [plugins/homie/skills/video/SKILL.md:142](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/video/SKILL.md#L142) | ask the person for a cap in dollars: | keep only if intent is missing; default implementation choices |
| [plugins/homie/skills/video/references/RECORD.md:17](https://github.com/homie-rocks/homie/blob/daab673/plugins/homie/skills/video/references/RECORD.md#L17) | ask the person before `npm install --no-save puppeteer-core`). | hand to the AI; provider/host limits noted above |
| [template/AGENTS.md:77](https://github.com/homie-rocks/homie/blob/daab673/template/AGENTS.md#L77) | If Wrangler is not signed in, run `npx wrangler login`: the person approves once in | keep intent/consent; merge prior authorization |
| [template/AGENTS.md:244](https://github.com/homie-rocks/homie/blob/daab673/template/AGENTS.md#L244) | it; a locked one changes only with the person's yes after `style blast` shows what goes stale and what remaking | keep intent/consent; merge prior authorization |
| [template/AGENTS.md:265](https://github.com/homie-rocks/homie/blob/daab673/template/AGENTS.md#L265) | - The owner runs the studio's live games from `/_studio/office` (`npx --no-install homie-studio office link` gives | hand to the AI; provider/host limits noted above |
