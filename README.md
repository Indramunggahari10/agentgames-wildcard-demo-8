# Round Scorer

Score a zkVerify Agent Games gatekeeper round from a decision log, using
only the published scoring rules. Paste a round log as JSON — or pick a
bundled sample round — and get a per-task breakdown naming which published
rule applied and why, a round total, a reliability-bonus estimate, and a
what-if comparison against simple baselines.

Zero dependencies. Node.js built-ins only. No persistence: pasted logs
are processed in memory and never stored.

## Honest scope

- This tool scores the log **you** paste. Correctness labels come from
  your log; nothing here verifies them against the platform, and the
  tool has no live platform data.
- No rank prediction: rank depends on other agents and on
  tie-breakers, which order equal totals but never change a score.
- Any outcome combination the published rules do not resolve shows as
  **UNSCORED / UNKNOWN** with an explicit flag. This tool never
  invents a number.
- The reliability bonus (+0 to +5) is an **estimate only**, shown
  separately and never folded into the round total: the published
  text pro-rates it by the verified share but does not publish the
  exact rounding.
- Offline tasks are scored as delivery timeouts (-2): the rules page
  says an offline agent forfeits the task. That mapping is this
  tool's stated interpretation, not a separately published number.
- The tool trusts the log's `timeout` flag. It has no timestamps and
  cannot judge lateness or deadline semantics.

## Published score model

Source: [Proof Gatekeeper event page](https://agentgames.zkverify.io/events/proof-gatekeeper),
"Score model / Points per decision", checked 17 Nov 2026. Forfeit
sentence: [Rules page](https://agentgames.zkverify.io/rules).

| Outcome | Points |
|---|---|
| Correct APPROVE (verified) | +12 |
| Correct REJECT (verified) | +12 |
| Incorrect APPROVE | -6 |
| Incorrect REJECT | -3 |
| Delivery timeout (no accepted response within 60 seconds) | -2 |
| Missing / invalid proof (a provable task answered without a valid Groth16 proof) | -2 |
| Reliability bonus (pro-rated by the share of provable tasks whose proof verified) | +0 to +5 |

The bonus paragraph adds: "A correct decision without a valid proof
earns no bonus and costs an extra -2. PROOF_REUSED tasks have no proof
to submit and are excluded."

## Reading notes

These are the interpretation decisions behind the encoding. Each one
is stated here so a reviewer can disagree with the reading rather
than guess at it.

1. **One row per decision.** The published table gives one points
   value per decision outcome. The encoding applies exactly one
   applicable row per task. When zero rows can apply (verified proof
   but no correctness label) or several conflicting rows apply, the
   task is UNKNOWN.
2. **Correct decision + no valid proof = -2.** The missing-proof row
   covers "a provable task answered without a valid Groth16 proof",
   and the bonus paragraph confirms the cost. The alternative reading
   (+12 - 2 = +10) was considered and rejected: the +12 rows
   explicitly say "(verified)", so +12 cannot apply to an unverified
   decision.
3. **Wrong decision + no valid proof = UNKNOWN.** Both the
   wrong-decision row (-6/-3) and the missing-proof row (-2) apply,
   and the published text gives no precedence and no stacking rule.
   The breakdown shows all three candidate readings (wrong-row only,
   missing-proof only, both stacked) without choosing one.
4. **Offline = delivery timeout (-2).** Stated interpretation; see
   Honest scope above. A forfeited task produces no accepted
   response, which is exactly the timeout row's condition.
5. **PROOF_REUSED tasks are excluded from the bonus fraction only.**
   The exclusion sentence sits in the bonus paragraph, so it is
   applied there (neither numerator nor denominator). Per-task
   scoring still applies to those tasks.
6. **Timeout wins over decision/proof flags.** An unanswered task
   cannot satisfy the "answered" rows, so only the timeout row can
   apply. The score is -2 either way; the flags are noted as ignored.
7. **Bonus estimate.** Estimate = 5 x (verified / provable), rounded
   to two decimals, with PROOF_REUSED tasks excluded. Timeout/offline
   tasks stay in the denominator (their proofs did not verify in the
   round) but never in the numerator. When there are no provable
   tasks (empty round, or all tasks excluded), the bonus shows as
   not applicable instead of a number.
8. **Baselines.** Always-REJECT and always-APPROVE assume a verified
   proof (stated on each baseline); decision-only keeps the log's
   decisions with no proofs. Ground truth is derived from the log
   itself, so UNKNOWNs propagate into baselines. Timeout/offline
   outcomes are carried over with a footnote. The bonus is excluded
   from every baseline total so the comparison is task points
   against task points.
9. **No ranking.** Tie-breakers (more correct decisions, then fewer
   timeouts) only order equal totals. The tool reports scores only.

## Round log format

`POST /api/score` accepts `{"tasks": [...]}` or a bare array. A
scored round has 8 tasks. Each task:

```json
{
  "id": "t1",
  "decision": "APPROVE",
  "proofAttached": true,
  "proofVerified": true,
  "timeout": false,
  "offline": false,
  "correct": true,
  "proofReused": false
}
```

- `decision`: `"APPROVE"` or `"REJECT"` (case-insensitive). Required
  unless the task timed out or the agent was offline.
- `proofAttached`, `proofVerified`, `timeout`, `offline`,
  `proofReused`: booleans, default `false`. `proofVerified` cannot be
  true when `proofAttached` is false.
- `correct`: `true`, `false`, or `null` when the log carries no
  ground-truth label for the task. Missing means `null`.
- `id`: optional string/number label; defaults to `task-N`.
- Unknown fields are ignored. Invalid logs get HTTP 400 with a
  per-task list of problems; nothing is scored.

## Endpoints

| Method & path | What it does |
|---|---|
| `GET /health`, `GET /api/health` | `{ok: true, service: "round-scorer", version: "1.0.0"}` |
| `GET /` | The UI (single page, no third-party scripts) |
| `GET /app.js` | The UI script (same origin) |
| `GET /api/examples` | The four bundled sample rounds |
| `GET /api/rules` | The published rows, bonus text, source, and notes |
| `POST /api/score` | Scores a round log (64 KB body cap; 413 over the cap) |

All responses carry `Cache-Control: no-store`, a strict
Content-Security-Policy, `X-Content-Type-Options: nosniff`, and
`Referrer-Policy: no-referrer`.

## Run locally

```sh
node server.js            # listens on $PORT (default 3000)
npm test                  # 54 tests, all passing
```

## Project layout

```
server.js            HTTP server (default export for Vercel; listens when run directly)
src/scorer.js        Pure scoring logic: validation, per-task rules, bonus, baselines
src/examples.js      Four bundled sample rounds
public/index.html    UI
public/app.js        UI logic (same-origin fetch only)
test/                node:test suites (unit + HTTP round-trips)
```

## License

MIT. See LICENSE.
