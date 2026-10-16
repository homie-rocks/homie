# Round 10 current-runtime comparison

Candidate / live order. All rows are complete pairs with peak one-minute load ≤25 and unchanged runtime artifacts. The manifest and frozen harness for each pair are retained. Loss models ordered TCP retransmission delay. Network delay and jitter are per direction.
Qualified planned pairs: 55/55. Remaining: none.

| Profile | Pairs | Peak load | Observer frames C/L | >3-tile observer jumps C/L (raw) | Passes (deep) C/L | Contact opportunities C/L | Late catches C/L | Stomp reappeared/eligible C vs L |
|---|---:|---:|---|---|---|---|---|---|
| crowd2 | 1 | 8.94 | 10865/10862 | 0/0 (0/0) | 0/4 (0/2) | 5/9 | 0/0 | 0/0 vs 0/0 |
| crowd4 | 1 | 9.21 | 10866/10868 | 0/0 (0/0) | 0/8 (0/4) | 8/27 | 0/0 | 0/1 vs 0/0 |
| crowd5 | 1 | 9.07 | 10868/10866 | 0/0 (0/0) | 0/5 (0/3) | 5/11 | 0/0 | 0/1 vs 0/0 |
| crowd6 | 1 | 10.67 | 10870/10867 | 0/0 (0/0) | 0/3 (0/1) | 5/11 | 0/0 | 0/0 vs 0/0 |
| crowd7 | 1 | 14.60 | 10877/10870 | 0/0 (0/0) | 0/3 (0/2) | 3/13 | 0/0 | 0/0 vs 0/0 |
| crowd8 | 1 | 18.34 | 10883/10786 | 0/10 (0/10) | 1/1 (0/0) | 7/2 | 0/0 | 0/1 vs 0/3 |
| fastclock | 1 | 17.92 | 10869/10867 | 0/34 (0/43) | 2/1 (2/0) | 5/3 | 0/1 | 0/1 vs 0/0 |
| lagswitch | 1 | 12.63 | 10862/10855 | 0/14 (0/20) | 1/2 (1/0) | 9/5 | 0/0 | 0/4 vs 0/0 |
| 0 ms / host | 4 | 17.67 | 43419/43399 | 0/8 (0/14) | 2/0 (0/0) | 13/0 | 0/0 | 0/18 vs 0/14 |
| 0 ms / non-host | 2 | 20.47 | 21734/21707 | 0/18 (0/26) | 3/6 (0/0) | 13/16 | 0/0 | 0/5 vs 0/12 |
| 150 ms / host | 2 | 14.33 | 21736/21728 | 0/15 (0/20) | 0/0 (0/0) | 16/0 | 0/0 | 0/3 vs 0/7 |
| 150 ms / non-host | 2 | 17.08 | 21753/21740 | 0/82 (0/112) | 1/4 (0/2) | 16/14 | 0/0 | 0/4 vs 0/0 |
| 300 ms / host | 4 | 13.14 | 43540/43525 | 0/318 (0/323) | 4/0 (1/0) | 29/0 | 0/0 | 0/4 vs 0/16 |
| 300 ms / non-host | 2 | 8.81 | 21772/21764 | 0/47 (0/66) | 0/0 (0/0) | 10/3 | 0/0 | 0/3 vs 0/2 |
| 80 ms / host | 4 | 24.70 | 43459/43438 | 0/29 (0/43) | 3/0 (0/0) | 37/0 | 0/0 | 0/11 vs 0/15 |
| 80 ms / non-host | 2 | 19.26 | 21735/21727 | 0/32 (0/42) | 3/3 (0/1) | 29/7 | 0/0 | 0/2 vs 0/0 |
| stall15000 | 1 | 8.53 | 10861/10859 | 0/10 (0/13) | 1/0 (0/0) | 9/0 | 0/0 | 0/1 vs 0/5 |
| stall15000b | 1 | 9.57 | 10857/10852 | 0/11 (0/20) | 1/0 (1/0) | 6/2 | 0/1 | 0/2 vs 0/1 |
| stall3000 | 1 | 9.15 | 10863/10857 | 0/7 (0/9) | 2/4 (0/0) | 10/4 | 0/0 | 0/5 vs 0/3 |
| stall6000 | 1 | 8.52 | 10860/10854 | 0/8 (0/11) | 2/0 (0/0) | 6/0 | 0/0 | 0/2 vs 0/5 |

Jump counts exclude coordinate-near spawns plus recorded death/round changes and newly active spawn protection; the original coordinate-only count is retained in parentheses.

The profile role identifies the measured runner on live. The primary observer in network profiles is the third player (a non-host on live). Server-rules players have no browser authority role.

| Profile: live host observing a non-host runner | Pairs | Observer frames C/L | >3-tile jumps C/L (raw) | Passes (deep) C/L | Contact opportunities C/L |
|---|---:|---|---|---|---|
| fastclock | 1 | 10877/10873 | 0/0 (0/0) | 3/9 (1/4) | 5/22 |
| lagswitch | 1 | 10872/10862 | 0/0 (0/0) | 1/6 (1/2) | 11/13 |
| 0 ms / non-host | 2 | 21758/21732 | 0/0 (0/0) | 2/7 (0/0) | 13/20 |
| 150 ms / non-host | 2 | 21777/21760 | 0/0 (0/0) | 1/24 (0/12) | 16/53 |
| 300 ms / non-host | 2 | 21786/21776 | 0/0 (0/0) | 1/7 (0/4) | 11/16 |
| 80 ms / non-host | 2 | 21756/21747 | 0/0 (0/0) | 3/5 (0/1) | 29/15 |
| stall15000 | 1 | 10870/2703 | 0/0 (0/0) | 1/2 (0/1) | 9/3 |
| stall15000b | 1 | 10862/2698 | 0/0 (0/0) | 2/1 (1/1) | 7/7 |
| stall3000 | 1 | 10871/2701 | 0/0 (0/0) | 2/6 (0/1) | 10/7 |
| stall6000 | 1 | 10865/2701 | 0/0 (0/0) | 1/0 (0/0) | 6/2 |

Contacts exclude recorded invulnerability and arrival/round-transition protection. Opportunities count visible overlap episodes; an instantaneous authority catch may have no overlapping drawn frame. These are visible geometric passes, not assertions about every possible collision. Stomp reappearance means a hidden nearby monster reappears within 600 ms. A zero with no eligible events is not evidence of absence.

| Profile | Owner jumps / slides / freezes C vs L | Owner phantom candidates/catches C vs L | Observer phantom candidates/catches C vs L |
|---|---|---|---|
| crowd2 | 0/0/0 vs 1/2/0 | 7/9 vs 10/10 | 2/9 vs 2/9 |
| crowd4 | 0/0/0 vs 1/1/0 | 11/13 vs 15/24 | 3/13 vs 8/23 |
| crowd5 | 0/0/0 vs 0/0/0 | 6/9 vs 4/8 | 2/9 vs 1/8 |
| crowd6 | 0/0/0 vs 2/3/0 | 3/5 vs 9/10 | 2/5 vs 3/11 |
| crowd7 | 0/0/0 vs 0/0/0 | 6/7 vs 9/15 | 1/6 vs 4/14 |
| crowd8 | 0/0/0 vs 3/3/0 | 7/14 vs 1/2 | 6/13 vs 3/3 |
| fastclock | 0/0/0 vs 1/0/0 | 9/11 vs 16/23 | 6/9 vs 9/15 |
| lagswitch | 0/0/0 vs 1/1/0 | 8/12 vs 6/10 | 4/12 vs 2/3 |
| 0 ms / host | 0/0/0 vs 0/0/0 | 0/9 vs 1/3 | 0/9 vs 3/3 |
| 0 ms / non-host | 0/0/0 vs 0/0/0 | 1/9 vs 1/11 | 0/10 vs 1/8 |
| 150 ms / host | 0/0/0 vs 0/0/0 | 12/28 vs 0/5 | 9/28 vs 2/2 |
| 150 ms / non-host | 0/0/0 vs 3/5/0 | 17/28 vs 28/42 | 8/27 vs 20/39 |
| 300 ms / host | 0/0/0 vs 0/0/0 | 38/44 vs 2/13 | 14/43 vs 21/24 |
| 300 ms / non-host | 0/0/0 vs 0/1/0 | 19/23 vs 19/25 | 9/22 vs 18/21 |
| 80 ms / host | 0/0/0 vs 0/0/0 | 12/39 vs 0/17 | 4/38 vs 10/13 |
| 80 ms / non-host | 0/0/0 vs 0/0/0 | 12/24 vs 6/19 | 2/24 vs 8/14 |
| phone CPU4 | 0/0/0 vs 2/2/0 | 0/0 vs 0/0 | 0/0 vs 0/0 |
| stall15000 | 0/0/0 vs 0/1/0 | 5/11 vs 2/7 | 5/11 vs 3/7 |
| stall15000b | 0/0/0 vs 0/0/0 | 4/8 vs 3/9 | 1/8 vs 3/7 |
| stall3000 | 0/0/0 vs 0/0/0 | 2/7 vs 1/3 | 1/7 vs 2/2 |
| stall6000 | 0/0/0 vs 0/0/0 | 0/2 vs 3/5 | 0/1 vs 3/4 |

| Contact resolution audit | Raw passes C/L | Later monster disappearance + score increment C/L | Remaining flags C/L (deep) |
|---|---|---|---|
| crowd2 | 0/4 | 0/0 | 0/4 (0/2) |
| crowd4 | 0/8 | 0/0 | 0/8 (0/4) |
| crowd5 | 0/5 | 0/0 | 0/5 (0/3) |
| crowd6 | 0/3 | 0/0 | 0/3 (0/1) |
| crowd7 | 0/3 | 0/0 | 0/3 (0/2) |
| crowd8 | 1/1 | 0/0 | 1/1 (0/0) |
| fastclock | 2/1 | 0/0 | 2/1 (2/0) |
| fastclock / host observer | 3/9 | 0/3 | 3/6 (1/4) |
| lagswitch | 1/2 | 1/0 | 0/2 (0/0) |
| lagswitch / host observer | 1/6 | 1/1 | 0/5 (0/2) |
| 0 ms / host | 2/0 | 0/0 | 2/0 (0/0) |
| 0 ms / non-host | 3/6 | 0/0 | 3/6 (0/0) |
| 0 ms / non-host / host observer | 2/7 | 0/0 | 2/7 (0/0) |
| 150 ms / host | 0/0 | 0/0 | 0/0 (0/0) |
| 150 ms / non-host | 1/4 | 0/0 | 1/4 (0/2) |
| 150 ms / non-host / host observer | 1/24 | 0/1 | 1/23 (0/11) |
| 300 ms / host | 4/0 | 1/0 | 3/0 (0/0) |
| 300 ms / non-host | 0/0 | 0/0 | 0/0 (0/0) |
| 300 ms / non-host / host observer | 1/7 | 0/0 | 1/7 (0/4) |
| 80 ms / host | 3/0 | 0/0 | 3/0 (0/0) |
| 80 ms / non-host | 3/3 | 0/0 | 3/3 (0/1) |
| 80 ms / non-host / host observer | 3/5 | 0/0 | 3/5 (0/1) |
| stall15000 | 1/0 | 0/0 | 1/0 (0/0) |
| stall15000 / host observer | 1/2 | 0/0 | 1/2 (0/1) |
| stall15000b | 1/0 | 0/0 | 1/0 (1/0) |
| stall15000b / host observer | 2/1 | 0/0 | 2/1 (1/1) |
| stall3000 | 2/4 | 0/0 | 2/4 (0/0) |
| stall3000 / host observer | 2/6 | 0/0 | 2/6 (0/1) |
| stall6000 | 2/0 | 0/0 | 2/0 (0/0) |
| stall6000 / host observer | 1/0 | 0/0 | 1/0 (0/0) |

This supplemental audit preserves every raw pass above. A possible delayed stomp requires the contacted monster to disappear and the measured runner’s score to increase in the same drawn frame within one second after contact ends. It is supporting evidence, not certainty: a gold pickup and another runner’s stomp can coincide.


Phantom candidates are geometric respawn events with no drawn monster within 1.2 tiles in the preceding 600 ms, excluding detected round resets. They are not individually confirmed catches. Phone captures do not include observer/phantom metadata. Whole-run freeze diagnostics include deliberate outages; recovery-only results follow.

| Recovery pair | Cycles C/L | Post-resume owner snaps C/L | Observer >3-tile jumps C/L (raw) | Observer moving-owner holds ≥700 ms C/L |
|---|---|---|---|---|
| g10-lagswitch | 11/11 | 0/0 | 0/11 | 0/3 |
| g10-stall15000 | 3/3 | 0/0 | 0/2 | 0/0 |
| g10-stall15000b | 3/3 | 0/0 | 0/0 | 0/0 |
| g10-stall3000 | 3/3 | 0/0 | 0/0 | 0/0 |
| g10-stall6000 | 3/3 | 0/0 | 0/0 | 0/0 |

| Phone pair | Frames C/L | >33 ms C/L | >50 ms C/L | Frame p99 ms C/L |
|---|---|---|---|---|
| g10-phone1 | 10801/10801 | 0/0 | 0/0 | 18.8/18.1 |
| g10-phone2 | 10801/10801 | 0/0 | 0/0 | 19/18.5 |
| g10-phone3 | 10801/10801 | 0/0 | 0/0 | 19.5/19.1 |

Phone frame metrics above cover exactly 180 seconds from the first captured frame. Raw captures include a short control-release/shutdown tail; its outliers are retained below rather than mixed into the requested window. Motion-error counts cover the full capture.

| Phone pair | Full-capture >33 ms C/L | Full-capture >50 ms C/L | Tail outliers C/L |
|---|---|---|---|
| g10-phone1 | 1/1 | 0/1 | 1/1 |
| g10-phone2 | 1/1 | 1/1 | 1/1 |
| g10-phone3 | 1/1 | 0/0 | 1/1 |

| Input profile | Run p90 ms (n) C vs L | Jump p90 ms (n) C vs L |
|---|---|---|
| g10-feel150h | 28.1 (48) vs 31 (48) | 28.5 (40) vs 31.4 (40) |
| g10-feel150n | 32.6 (47) vs 31.1 (48) | 31.1 (40) vs 30.7 (39) |
| g10-feel150n2 | 31.3 (47) vs 30.6 (48) | 28.7 (40) vs 31 (40) |
| g10-feel150n3 | 29.8 (48) vs 28.5 (48) | 29.3 (40) vs 31.4 (40) |
| g10-feel150n4 | 30.9 (48) vs 31.7 (48) | 31.8 (40) vs 31.7 (40) |
| g10-feel300h | 32 (47) vs 30.8 (48) | 32.5 (40) vs 32 (40) |
| g10-feel300n | 31.3 (48) vs 30.2 (48) | 31.6 (40) vs 32.1 (40) |
| g10-feel300n2 | 31.1 (47) vs 31.4 (48) | 31.6 (40) vs 31.3 (40) |
| g10-feel300n3 | 31.9 (47) vs 32.3 (48) | 26.3 (40) vs 31.6 (39) |
| g10-feel300n4 | 33.3 (47) vs 31.9 (48) | 29.3 (40) vs 31.7 (37) |
| g10-feel80h | 34.4 (48) vs 31 (47) | 29.9 (40) vs 31.2 (40) |
| g10-feel80h2 | 30.2 (48) vs 30.9 (48) | 29.2 (40) vs 32.9 (40) |
| g10-feel80h3 | 31.7 (48) vs 31.8 (48) | 27.5 (40) vs 33.3 (40) |
| g10-feel80h4 | 32.9 (48) vs 31.6 (48) | 32.1 (40) vs 30.5 (40) |
| g10-feel80n | 28.5 (48) vs 30.7 (47) | 27.2 (40) vs 31.8 (40) |
| g10-feelh | 30.5 (46) vs 31.8 (48) | 29.1 (40) vs 31.8 (40) |
| g10-feeln | 29.5 (48) vs 37.8 (48) | 31.4 (40) vs 32 (40) |

Same-profile repeats pooled below; every individual attempt remains above. No network conditions or authority roles are mixed.

| Input profile | Pairs | Run p90 ms (n) C vs L | Jump p90 ms (n) C vs L |
|---|---:|---|---|
| g10-feel150h | 1 | 28.1 (48) vs 31 (48) | 28.5 (40) vs 31.4 (40) |
| g10-feel150n | 4 | 31.3 (190) vs 30.8 (192) | 30 (160) vs 31.3 (159) |
| g10-feel300h | 1 | 32 (47) vs 30.8 (48) | 32.5 (40) vs 32 (40) |
| g10-feel300n | 4 | 31.3 (189) vs 31.8 (192) | 29.5 (160) vs 31.6 (156) |
| g10-feel80h | 4 | 31.4 (192) vs 31.1 (191) | 28.6 (160) vs 32.3 (160) |
| g10-feel80n | 1 | 28.5 (48) vs 30.7 (47) | 27.2 (40) vs 31.8 (40) |
| g10-feelh | 1 | 30.5 (46) vs 31.8 (48) | 29.1 (40) vs 31.8 (40) |
| g10-feeln | 1 | 29.5 (48) vs 37.8 (48) | 31.4 (40) vs 32 (40) |

| Player coverage pair | Requested | Confirmed human slots C/L |
|---|---:|---|
| g10-crowd2 | 2 | 2/2 |
| g10-crowd4 | 4 | 4/4 |
| g10-crowd5 | 5 | 5/5 |
| g10-crowd6 | 6 | 6/6 |
| g10-crowd7 | 7 | 7/7 |
| g10-crowd8 | 8 | 8/8 |
| g10-n0n1 | 3 | 3/3 |

Complete round receipts: `g10-rounds` (raw results and screenshots retained).

No readiness verdict is inferred by this script. Sample adequacy, unmeasured cases and any regressions must be reviewed before the final verdict.
