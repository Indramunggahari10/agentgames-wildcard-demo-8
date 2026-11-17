// Bundled sample rounds. Each is 8 tasks, the size of a scored
// gatekeeper round. The samples are invented illustrations of the
// published rules — not real platform data — and every total below
// is asserted by the test suite.

export const SAMPLES = [
  {
    id: "perfect-round",
    name: "Perfect round",
    description:
      "Every decision correct, every proof verified: 8 x +12 = +96. Reliability bonus estimate +5.00 (8 of 8 proofs verified).",
    tasks: [
      { id: "t1", decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true },
      { id: "t2", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
      { id: "t3", decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true },
      { id: "t4", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
      { id: "t5", decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true },
      { id: "t6", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
      { id: "t7", decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true },
      { id: "t8", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
    ],
  },
  {
    id: "reject-all-round",
    name: "Reject-all round",
    description:
      "The agent rejects everything, all proofs verified. 5 traps caught (+12 each) and 3 valid conditions wrongly rejected (-3 each): +51. Shows why caution beats recklessness but loses to accuracy.",
    tasks: [
      { id: "t1", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
      { id: "t2", decision: "REJECT", proofAttached: true, proofVerified: true, correct: false },
      { id: "t3", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
      { id: "t4", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
      { id: "t5", decision: "REJECT", proofAttached: true, proofVerified: true, correct: false },
      { id: "t6", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
      { id: "t7", decision: "REJECT", proofAttached: true, proofVerified: true, correct: false },
      { id: "t8", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
    ],
  },
  {
    id: "mixed-round",
    name: "Mixed round (every rule)",
    description:
      "One of each outcome: correct verified, wrong verified both ways, a timeout, a correct decision with no proof (-2), a wrong decision with an invalid proof (UNKNOWN: unresolved overlap), and a correct verified PROOF_REUSED task excluded from the bonus share. Scored total +23, 1 unscored.",
    tasks: [
      { id: "t1", decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true },
      { id: "t2", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
      { id: "t3", decision: "APPROVE", proofAttached: true, proofVerified: true, correct: false },
      { id: "t4", decision: "REJECT", proofAttached: true, proofVerified: true, correct: false },
      { id: "t5", decision: null, timeout: true, correct: null },
      { id: "t6", decision: "APPROVE", proofAttached: false, proofVerified: false, correct: true },
      { id: "t7", decision: "APPROVE", proofAttached: true, proofVerified: false, correct: false },
      { id: "t8", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true, proofReused: true },
    ],
  },
  {
    id: "timeout-heavy-round",
    name: "Timeout-heavy round",
    description:
      "Five tasks lost to timeouts/offline (-2 each), two correct verified (+12 each), one wrong verified reject (-3): +11. One offline task carries decision/proof flags to show they are ignored once no response was accepted.",
    tasks: [
      { id: "t1", decision: null, timeout: true, correct: null },
      { id: "t2", decision: null, timeout: true, correct: null },
      { id: "t3", decision: null, offline: true, correct: null },
      { id: "t4", decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true, offline: true },
      { id: "t5", decision: null, timeout: true, correct: null },
      { id: "t6", decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true },
      { id: "t7", decision: "REJECT", proofAttached: true, proofVerified: true, correct: true },
      { id: "t8", decision: "REJECT", proofAttached: true, proofVerified: true, correct: false },
    ],
  },
];
