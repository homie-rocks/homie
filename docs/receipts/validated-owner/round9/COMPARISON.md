# Round 9 current-runtime comparison

Candidate / live order. All rows are complete pairs with peak one-minute load ≤25 and unchanged runtime artifacts. The manifest and frozen harness for each pair are retained. Loss models ordered TCP retransmission delay. Network delay and jitter are per direction.
Qualified planned pairs: 42/42. Remaining: none.

| Profile | Pairs | Peak load | Observer frames C/L | >3-tile observer jumps C/L (raw) | Passes (deep) C/L | Contact opportunities C/L | Late catches C/L | Stomp reappeared/eligible C vs L |
|---|---:|---:|---|---|---|---|---|---|
| crowd2 | 1 | 6.99 | 10868/10864 | 0/0 (0/0) | 0/3 (0/2) | 2/13 | 0/0 | 0/1 vs 0/0 |
| crowd4 | 1 | 6.40 | 10870/10865 | 0/0 (0/0) | 2/8 (1/4) | 8/19 | 0/0 | 0/2 vs 0/0 |
| crowd5 | 1 | 7.39 | 10876/10863 | 0/0 (0/0) | 2/1 (1/1) | 11/11 | 0/0 | 0/0 vs 0/0 |
| crowd6 | 1 | 9.05 | 10871/10864 | 0/0 (0/0) | 0/2 (0/1) | 5/12 | 0/0 | 0/0 vs 0/0 |
| crowd7 | 1 | 9.90 | 10869/10864 | 0/0 (0/0) | 1/8 (1/4) | 5/26 | 0/0 | 0/0 vs 0/1 |
| crowd8 | 1 | 12.75 | 10874/10866 | 0/0 (0/0) | 0/2 (0/0) | 1/13 | 0/0 | 0/0 vs 0/0 |
| fastclock | 1 | 6.24 | 10868/10863 | 0/25 (0/38) | 0/2 (0/0) | 10/5 | 0/0 | 0/2 vs 0/1 |
| lagswitch | 1 | 5.24 | 10861/10860 | 0/14 (0/19) | 5/0 (2/0) | 9/2 | 0/0 | 0/2 vs 0/0 |
| 0 ms / host | 2 | 6.74 | 21697/21691 | 0/14 (0/24) | 2/0 (0/0) | 10/0 | 0/0 | 0/7 vs 0/1 |
| 0 ms / non-host | 2 | 7.70 | 21698/21693 | 0/18 (0/23) | 6/8 (0/1) | 13/17 | 0/0 | 0/11 vs 0/11 |
| 150 ms / host | 2 | 7.43 | 21736/21726 | 0/7 (0/11) | 0/0 (0/0) | 21/0 | 0/0 | 0/2 vs 0/8 |
| 150 ms / non-host | 2 | 7.58 | 21734/21725 | 0/51 (0/66) | 3/1 (1/0) | 14/3 | 0/0 | 0/1 vs 0/1 |
| 300 ms / host | 2 | 5.60 | 21769/21764 | 0/164 (0/168) | 1/0 (0/0) | 26/1 | 0/0 | 0/2 vs 0/6 |
| 300 ms / non-host | 2 | 6.07 | 21770/21763 | 0/62 (0/74) | 3/0 (2/0) | 15/10 | 0/0 | 0/1 vs 0/0 |
| 80 ms / host | 2 | 6.54 | 21718/21711 | 0/8 (0/11) | 5/0 (2/0) | 24/0 | 0/0 | 0/4 vs 0/7 |
| 80 ms / non-host | 2 | 8.07 | 21718/21708 | 0/36 (0/57) | 2/4 (1/1) | 18/10 | 0/0 | 0/10 vs 0/0 |
| stall15000 | 1 | 5.67 | 10859/10854 | 0/13 (0/21) | 4/1 (1/0) | 14/4 | 0/0 | 0/4 vs 0/6 |
| stall15000b | 1 | 6.69 | 10857/10855 | 0/6 (0/8) | 9/1 (9/0) | 14/1 | 0/0 | 0/4 vs 0/4 |
| stall3000 | 1 | 6.62 | 10858/10854 | 0/5 (0/8) | 4/0 (2/0) | 16/2 | 0/0 | 0/5 vs 0/4 |
| stall6000 | 1 | 6.70 | 10858/10853 | 0/13 (0/17) | 4/1 (2/0) | 11/2 | 0/0 | 0/3 vs 0/4 |

Jump counts exclude coordinate-near spawns plus recorded death/round changes and newly active spawn protection; the original coordinate-only count is retained in parentheses.

The profile role identifies the measured runner on live. The primary observer in network profiles is the third player (a non-host on live). Server-rules players have no browser authority role.

| Profile: live host observing a non-host runner | Pairs | Observer frames C/L | >3-tile jumps C/L (raw) | Passes (deep) C/L | Contact opportunities C/L |
|---|---:|---|---|---|---|
| fastclock | 1 | 10873/10870 | 0/0 (0/0) | 0/6 (0/6) | 9/20 |
| lagswitch | 1 | 10867/10865 | 0/0 (0/0) | 5/2 (2/1) | 9/6 |
| 0 ms / non-host | 2 | 21710/21704 | 0/0 (0/0) | 5/5 (0/2) | 11/16 |
| 150 ms / non-host | 2 | 21746/21737 | 0/0 (0/0) | 3/15 (1/9) | 14/34 |
| 300 ms / non-host | 2 | 21783/21774 | 0/0 (0/0) | 3/13 (2/12) | 16/34 |
| 80 ms / non-host | 2 | 21731/21721 | 0/0 (0/0) | 3/14 (1/3) | 17/20 |
| stall15000 | 1 | 10865/2702 | 0/0 (0/0) | 5/1 (1/0) | 15/6 |
| stall15000b | 1 | 10864/2703 | 0/0 (0/0) | 10/0 (9/0) | 16/0 |
| stall3000 | 1 | 10865/2702 | 0/0 (0/0) | 5/0 (2/0) | 17/5 |
| stall6000 | 1 | 10864/2701 | 0/0 (0/0) | 4/3 (2/2) | 11/5 |

Contacts exclude recorded invulnerability and arrival/round-transition protection. Opportunities count visible overlap episodes; an instantaneous authority catch may have no overlapping drawn frame. These are visible geometric passes, not assertions about every possible collision. Stomp reappearance means a hidden nearby monster reappears within 600 ms. A zero with no eligible events is not evidence of absence.

| Profile | Owner jumps / slides / freezes C vs L | Owner phantom candidates/catches C vs L | Observer phantom candidates/catches C vs L |
|---|---|---|---|
| crowd2 | 0/0/0 vs 2/2/0 | 3/7 vs 7/14 | 3/7 vs 4/15 |
| crowd4 | 0/0/0 vs 2/3/0 | 8/10 vs 10/13 | 1/10 vs 2/11 |
| crowd5 | 0/0/0 vs 0/0/0 | 7/10 vs 9/12 | 1/8 vs 4/12 |
| crowd6 | 0/0/0 vs 1/0/0 | 3/5 vs 9/11 | 2/6 vs 4/12 |
| crowd7 | 0/0/0 vs 0/0/0 | 4/7 vs 15/22 | 3/6 vs 4/21 |
| crowd8 | 0/0/0 vs 1/1/0 | 1/1 vs 6/13 | 0/1 vs 1/12 |
| fastclock | 0/0/0 vs 1/1/0 | 14/20 vs 9/14 | 7/19 vs 4/8 |
| lagswitch | 0/0/0 vs 0/0/0 | 3/6 vs 2/7 | 2/5 vs 2/4 |
| 0 ms / host | 0/0/0 vs 1/1/0 | 0/5 vs 1/10 | 0/5 vs 4/7 |
| 0 ms / non-host | 0/0/0 vs 0/1/0 | 0/4 vs 1/11 | 1/4 vs 3/8 |
| 150 ms / host | 0/0/0 vs 0/0/0 | 17/25 vs 0/6 | 2/24 vs 2/5 |
| 150 ms / non-host | 0/0/0 vs 1/3/0 | 12/18 vs 19/33 | 5/16 vs 17/26 |
| 300 ms / host | 0/0/0 vs 0/0/0 | 24/32 vs 2/6 | 4/33 vs 10/11 |
| 300 ms / non-host | 0/0/0 vs 0/0/0 | 20/20 vs 26/34 | 7/19 vs 14/31 |
| 80 ms / host | 0/0/0 vs 0/0/0 | 8/19 vs 0/4 | 3/19 vs 1/3 |
| 80 ms / non-host | 1/0/0 vs 1/1/0 | 9/16 vs 14/23 | 4/16 vs 9/13 |
| phone CPU4 | 0/0/0 vs 3/3/0 | 0/0 vs 0/0 | 0/0 vs 0/0 |
| stall15000 | 0/0/0 vs 0/0/0 | 6/12 vs 3/9 | 4/12 vs 1/3 |
| stall15000b | 0/0/0 vs 1/1/0 | 3/7 vs 0/3 | 2/8 vs 3/3 |
| stall3000 | 0/0/0 vs 1/2/0 | 9/11 vs 2/4 | 2/12 vs 1/2 |
| stall6000 | 0/0/0 vs 0/1/0 | 4/7 vs 2/7 | 2/7 vs 2/2 |

| Contact resolution audit | Raw passes C/L | Later monster disappearance + score increment C/L | Remaining flags C/L (deep) |
|---|---|---|---|
| crowd2 | 0/3 | 0/0 | 0/3 (0/2) |
| crowd4 | 2/8 | 2/0 | 0/8 (0/4) |
| crowd5 | 2/1 | 2/0 | 0/1 (0/1) |
| crowd6 | 0/2 | 0/0 | 0/2 (0/1) |
| crowd7 | 1/8 | 1/1 | 0/7 (0/4) |
| crowd8 | 0/2 | 0/0 | 0/2 (0/0) |
| fastclock | 0/2 | 0/0 | 0/2 (0/0) |
| fastclock / host observer | 0/6 | 0/0 | 0/6 (0/6) |
| lagswitch | 5/0 | 2/0 | 3/0 (0/0) |
| lagswitch / host observer | 5/2 | 2/0 | 3/2 (0/1) |
| 0 ms / host | 2/0 | 0/0 | 2/0 (0/0) |
| 0 ms / non-host | 6/8 | 1/2 | 5/6 (0/0) |
| 0 ms / non-host / host observer | 5/5 | 0/1 | 5/4 (0/1) |
| 150 ms / host | 0/0 | 0/0 | 0/0 (0/0) |
| 150 ms / non-host | 3/1 | 3/0 | 0/1 (0/0) |
| 150 ms / non-host / host observer | 3/15 | 3/3 | 0/12 (0/9) |
| 300 ms / host | 1/0 | 1/0 | 0/0 (0/0) |
| 300 ms / non-host | 3/0 | 3/0 | 0/0 (0/0) |
| 300 ms / non-host / host observer | 3/13 | 3/0 | 0/13 (0/12) |
| 80 ms / host | 5/0 | 4/0 | 1/0 (0/0) |
| 80 ms / non-host | 2/4 | 1/0 | 1/4 (0/1) |
| 80 ms / non-host / host observer | 3/14 | 1/2 | 2/12 (0/2) |
| stall15000 | 4/1 | 4/0 | 0/1 (0/0) |
| stall15000 / host observer | 5/1 | 4/0 | 1/1 (0/0) |
| stall15000b | 9/1 | 4/0 | 5/1 (5/0) |
| stall15000b / host observer | 10/0 | 4/0 | 6/0 (5/0) |
| stall3000 | 4/0 | 3/0 | 1/0 (0/0) |
| stall3000 / host observer | 5/0 | 4/0 | 1/0 (0/0) |
| stall6000 | 4/1 | 1/0 | 3/1 (1/0) |
| stall6000 / host observer | 4/3 | 1/0 | 3/3 (1/2) |

This supplemental audit preserves every raw pass above. A possible delayed stomp requires the contacted monster to disappear and the measured runner’s score to increase in the same drawn frame within one second after contact ends. It is supporting evidence, not certainty: a gold pickup and another runner’s stomp can coincide.


Phantom candidates are geometric respawn events with no drawn monster within 1.2 tiles in the preceding 600 ms, excluding detected round resets. They are not individually confirmed catches. Phone captures do not include observer/phantom metadata. Whole-run freeze diagnostics include deliberate outages; recovery-only results follow.

| Recovery pair | Cycles C/L | Post-resume owner snaps C/L | Observer >3-tile jumps C/L (raw) | Observer moving-owner holds ≥700 ms C/L |
|---|---|---|---|---|
| u9-lagswitch | 11/11 | 0/0 | 0/13 | 0/2 |
| u9-stall15000 | 3/3 | 0/0 | 0/6 | 0/0 |
| u9-stall15000b | 3/3 | 0/0 | 0/0 | 0/0 |
| u9-stall3000 | 3/3 | 0/0 | 0/0 | 0/0 |
| u9-stall6000 | 3/3 | 0/0 | 0/0 | 0/0 |

| Phone pair | Frames C/L | >33 ms C/L | >50 ms C/L | Frame p99 ms C/L |
|---|---|---|---|---|
| u9-phone1 | 10801/10801 | 0/1 | 0/0 | 19/18.9 |
| u9-phone2 | 10801/10801 | 0/0 | 0/0 | 19.2/18.1 |
| u9-phone3 | 10801/10801 | 0/1 | 0/0 | 18.6/19.2 |

Phone frame metrics above cover exactly 180 seconds from the first captured frame. Raw captures include a short control-release/shutdown tail; its outliers are retained below rather than mixed into the requested window. Motion-error counts cover the full capture.

| Phone pair | Full-capture >33 ms C/L | Full-capture >50 ms C/L | Tail outliers C/L |
|---|---|---|---|
| u9-phone1 | 1/1 | 1/0 | 1/0 |
| u9-phone2 | 1/0 | 0/0 | 1/0 |
| u9-phone3 | 1/1 | 0/0 | 1/0 |

| Input profile | Run p90 ms (n) C vs L | Jump p90 ms (n) C vs L |
|---|---|---|
| u9-feel150h | 33.3 (48) vs 32.3 (48) | 33.3 (40) vs 32.4 (40) |
| u9-feel150n | 35 (48) vs 31.7 (47) | 32.2 (38) vs 31.9 (39) |
| u9-feel150n2 | 37.5 (47) vs 31.8 (48) | 29.8 (38) vs 31 (40) |
| u9-feel300h | 32.7 (48) vs 31 (48) | 32.6 (40) vs 31.6 (40) |
| u9-feel300n | 34.4 (48) vs 31.8 (47) | 38.1 (40) vs 31.9 (39) |
| u9-feel300n2 | 34.3 (48) vs 32.2 (46) | 34.3 (40) vs 30.2 (40) |
| u9-feel80h | 30.6 (47) vs 32.2 (47) | 30.3 (40) vs 32.4 (40) |
| u9-feel80n | 31.9 (48) vs 32.4 (48) | 32.3 (40) vs 32.5 (40) |
| u9-feelh | 33.1 (48) vs 32 (48) | 34.8 (40) vs 33.1 (40) |
| u9-feeln | 31.2 (48) vs 32.3 (48) | 30.6 (39) vs 32.1 (40) |

Same-profile repeats pooled below; every individual attempt remains above. No network conditions or authority roles are mixed.

| Input profile | Pairs | Run p90 ms (n) C vs L | Jump p90 ms (n) C vs L |
|---|---:|---|---|
| u9-feel150h | 1 | 33.3 (48) vs 32.3 (48) | 33.3 (40) vs 32.4 (40) |
| u9-feel150n | 2 | 35.9 (95) vs 31.8 (95) | 31.5 (76) vs 31.3 (79) |
| u9-feel300h | 1 | 32.7 (48) vs 31 (48) | 32.6 (40) vs 31.6 (40) |
| u9-feel300n | 2 | 34.3 (96) vs 32 (93) | 35.5 (80) vs 31.6 (79) |
| u9-feel80h | 1 | 30.6 (47) vs 32.2 (47) | 30.3 (40) vs 32.4 (40) |
| u9-feel80n | 1 | 31.9 (48) vs 32.4 (48) | 32.3 (40) vs 32.5 (40) |
| u9-feelh | 1 | 33.1 (48) vs 32 (48) | 34.8 (40) vs 33.1 (40) |
| u9-feeln | 1 | 31.2 (48) vs 32.3 (48) | 30.6 (39) vs 32.1 (40) |

| Player coverage pair | Requested | Confirmed human slots C/L |
|---|---:|---|
| u9-crowd2 | 2 | 2/2 |
| u9-crowd4 | 4 | 4/4 |
| u9-crowd5 | 5 | 5/5 |
| u9-crowd6 | 6 | 6/6 |
| u9-crowd7 | 7 | 7/7 |
| u9-crowd8 | 8 | 8/8 |
| u9-n0n1 | 3 | 3/3 |

Complete round receipts: `u9-rounds` (raw results and screenshots retained).

No readiness verdict is inferred by this script. Sample adequacy, unmeasured cases and any regressions must be reviewed before the final verdict.
