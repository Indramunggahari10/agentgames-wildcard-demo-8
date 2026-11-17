// Round Scorer — pure scoring logic for zkVerify Agent Games gatekeeper
// rounds. Encodes ONLY the published score model from the Proof Gatekeeper
// event page (https://agentgames.zkverify.io/events/proof-gatekeeper,
// "Score model / Points per decision") plus the forfeit sentence on
// https://agentgames.zkverify.io/rules.
//
// Encoding principle: exactly one applicable published row => its points.
// Zero applicable rows (e.g. verified proof but no correctness label) or
// multiple conflicting rows (wrong decision + no valid proof) => UNKNOWN
// with an explicit flag. No number is ever invented. See README.md
// ("Reading notes") for every interpretation decision and what the
// published text does and does not say.

export const SCORE_SOURCE =
  "https://agentgames.zkverify.io/events/proof-gatekeeper";

export const RULES = [
  {
    id: "correct-verified",
    points: 12,
    label: "Correct decision (verified)",
    description:
      "Correct APPROVE or REJECT with a valid Groth16 proof. Published as two rows (+12 each); one rule here because both score equally.",
  },
  {
    id: "incorrect-approve",
    points: -6,
    label: "Incorrect APPROVE",
    description: "Approved a trapped or invalid condition.",
  },
  {
    id: "incorrect-reject",
    points: -3,
    label: "Incorrect REJECT",
    description: "Rejected a genuinely valid condition.",
  },
  {
    id: "delivery-timeout",
    points: -2,
    label: "Delivery timeout",
    description: "No accepted response within 60 seconds.",
  },
  {
    id: "missing-invalid-proof",
    points: -2,
    label: "Missing / invalid proof",
    description:
      "A provable task answered without a valid Groth16 proof. A correct decision without a valid proof earns no bonus and costs -2.",
  },
];

export const BONUS_MAX = 5;

export const BONUS_TEXT =
  "Reliability bonus, applied at round close, pro-rated by the fraction of provable tasks whose Groth16 proof verified against the registered key. PROOF_REUSED tasks have no proof to submit and are excluded.";

const DECISIONS = ["APPROVE", "REJECT"];
const BOOL_FIELDS = [
  "proofAttached",
  "proofVerified",
  "timeout",
  "offline",
  "proofReused",
];

export class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

function isBool(v) {
  return typeof v === "boolean";
}

// Validates a posted round log and returns normalized tasks.
// Accepts { tasks: [...] } or a bare array. Throws ValidationError
// listing every problem found; nothing is scored when input is invalid.
export function parseRound(input) {
  const errors = [];
  let raw = input;
  if (Array.isArray(raw)) raw = { tasks: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError(
      'body must be a JSON object with a "tasks" array (or a bare array of tasks)',
      [],
    );
  }
  const list = raw.tasks;
  if (!Array.isArray(list)) {
    throw new ValidationError('"tasks" must be an array', []);
  }
  const tasks = [];
  list.forEach((t, i) => {
    const label = `task #${i + 1}`;
    const errs = [];
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      errors.push({ index: i, message: `${label}: must be an object` });
      return;
    }
    let id = `task-${i + 1}`;
    if (t.id !== undefined) {
      if (typeof t.id === "string" && t.id.trim() !== "") id = t.id.trim();
      else if (typeof t.id === "number" && Number.isFinite(t.id))
        id = String(t.id);
      else errs.push(`${label}: "id" must be a non-empty string or a number`);
    }
    const bools = {};
    for (const f of BOOL_FIELDS) {
      if (t[f] === undefined) bools[f] = false;
      else if (isBool(t[f])) bools[f] = t[f];
      else errs.push(`${label}: "${f}" must be true or false`);
    }
    let correct = null;
    if (t.correct === undefined || t.correct === null) correct = null;
    else if (isBool(t.correct)) correct = t.correct;
    else errs.push(`${label}: "correct" must be true, false, or null`);
    let decision = null;
    const decisionProvided =
      t.decision !== undefined &&
      t.decision !== null &&
      !(typeof t.decision === "string" && t.decision.trim() === "");
    if (!decisionProvided) {
      decision = null;
    } else if (
      typeof t.decision === "string" &&
      DECISIONS.includes(t.decision.trim().toUpperCase())
    ) {
      decision = t.decision.trim().toUpperCase();
    } else {
      errs.push(`${label}: "decision" must be "APPROVE" or "REJECT"`);
    }
    if (
      decision === null &&
      !decisionProvided &&
      !bools.timeout &&
      !bools.offline
    ) {
      errs.push(
        `${label}: "decision" is required unless the task timed out or the agent was offline`,
      );
    }
    if (bools.proofVerified && !bools.proofAttached) {
      errs.push(
        `${label}: "proofVerified" cannot be true when "proofAttached" is false`,
      );
    }
    if (errs.length) {
      for (const m of errs) errors.push({ index: i, message: m });
      return;
    }
    tasks.push({ id, decision, correct, ...bools });
  });
  if (errors.length) {
    throw new ValidationError(
      `invalid round log: ${errors.length} problem(s)`,
      errors,
    );
  }
  return tasks;
}

// Scores one normalized task. Returns a stable shape: status is
// "scored" (points is a number, rule names the published row) or
// "unscored" (points is null; candidates, when present, list the
// readings the published text leaves open — never a chosen number).
export function scoreTask(task) {
  const base = {
    id: task.id,
    decision: task.decision,
    correct: task.correct,
    proofAttached: task.proofAttached,
    proofVerified: task.proofVerified,
    timeout: task.timeout,
    offline: task.offline,
    proofReused: task.proofReused,
    notes: [],
  };
  if (task.proofReused) {
    base.notes.push(
      "PROOF_REUSED: excluded from the reliability-bonus share (published bonus text); per-task scoring still applies.",
    );
  }
  const hasValidProof = task.proofAttached && task.proofVerified;

  // No accepted response: only the timeout row can apply. The
  // missing-proof row requires an answer, so there is no conflict.
  if (task.timeout || task.offline) {
    if (task.offline) {
      base.notes.push(
        "Agent offline: the rules page says an offline agent forfeits the task; scored as a delivery timeout (no accepted response). This mapping is this tool's stated interpretation, not a separately published number.",
      );
    }
    if (task.decision !== null || task.proofAttached) {
      base.notes.push(
        "Timeout: decision/proof flags in the log are ignored because no response was accepted.",
      );
    }
    return {
      ...base,
      status: "scored",
      points: -2,
      rule: "delivery-timeout",
      ruleLabel: "Delivery timeout",
      explanation: task.offline
        ? "Agent offline: task forfeited, no accepted response."
        : "No accepted response within 60 seconds.",
      candidates: null,
    };
  }

  if (hasValidProof) {
    if (task.correct === true) {
      return {
        ...base,
        status: "scored",
        points: 12,
        rule: "correct-verified",
        ruleLabel: "Correct decision (verified)",
        explanation: `Correct ${task.decision} with a valid proof.`,
        candidates: null,
      };
    }
    if (task.correct === false) {
      const points = task.decision === "APPROVE" ? -6 : -3;
      return {
        ...base,
        status: "scored",
        points,
        rule:
          task.decision === "APPROVE"
            ? "incorrect-approve"
            : "incorrect-reject",
        ruleLabel:
          task.decision === "APPROVE"
            ? "Incorrect APPROVE"
            : "Incorrect REJECT",
        explanation:
          task.decision === "APPROVE"
            ? "Approved a trapped or invalid condition (proof verified, decision wrong)."
            : "Rejected a genuinely valid condition (proof verified, decision wrong).",
        candidates: null,
      };
    }
    return {
      ...base,
      status: "unscored",
      points: null,
      rule: null,
      ruleLabel: null,
      explanation:
        "No correctness label in the log: cannot tell +12 (correct) from -6/-3 (wrong).",
      candidates: null,
    };
  }

  // No valid proof.
  if (task.correct === true) {
    return {
      ...base,
      status: "scored",
      points: -2,
      rule: "missing-invalid-proof",
      ruleLabel: "Missing / invalid proof",
      explanation:
        "Correct decision without a valid proof: earns no +12 and no bonus, costs -2 (published bonus text).",
      candidates: null,
    };
  }
  if (task.correct === false) {
    const wrongPoints = task.decision === "APPROVE" ? -6 : -3;
    return {
      ...base,
      status: "unscored",
      points: null,
      rule: null,
      ruleLabel: null,
      explanation: `Unresolved overlap: the wrong-decision row (${wrongPoints}) and the missing/invalid-proof row (-2) both apply, and the published text gives no precedence. No number is assigned.`,
      candidates: [
        { points: wrongPoints, basis: "wrong-decision row only" },
        { points: -2, basis: "missing/invalid-proof row only" },
        { points: wrongPoints - 2, basis: "both rows stacked" },
      ],
    };
  }
  // No correctness label and no valid proof: only the missing-proof
  // row can apply, and it needs no label. The +12/-6/-3 rows cannot
  // apply without knowing whether the decision was right.
  return {
    ...base,
    status: "scored",
    points: -2,
    rule: "missing-invalid-proof",
    ruleLabel: "Missing / invalid proof",
    explanation:
      "Answered without a valid proof (-2). No correctness label in the log, but the missing-proof row does not need one.",
    candidates: null,
    notes: [
      ...base.notes,
      "Correctness label absent; scored under the missing-proof row only.",
    ],
  };
}

// Reliability bonus estimate. The published text pro-rates the +0..+5
// bonus by the verified share of provable tasks and excludes
// PROOF_REUSED tasks, but does not publish the exact rounding, so the
// result is an estimate and is never folded into the round total.
export function reliabilityBonus(tasks) {
  const provable = tasks.filter((t) => !t.proofReused);
  const excluded = tasks.length - provable.length;
  if (provable.length === 0) {
    return {
      applicable: false,
      reason:
        tasks.length === 0
          ? "Empty round: no tasks."
          : "All tasks are PROOF_REUSED and excluded.",
      provable: 0,
      verified: 0,
      excluded,
      share: null,
      estimate: null,
      max: BONUS_MAX,
      note: "Bonus not applicable: no provable tasks.",
    };
  }
  // A task with no accepted response contributed no verified proof to
  // the round, even if the log carries proof flags: timeout/offline
  // tasks stay in the denominator but never in the numerator.
  const verified = provable.filter(
    (t) => t.proofVerified && !t.timeout && !t.offline,
  ).length;
  const share = verified / provable.length;
  const estimate = Math.round(share * BONUS_MAX * 100) / 100;
  return {
    applicable: true,
    reason: null,
    provable: provable.length,
    verified,
    excluded,
    share,
    estimate,
    max: BONUS_MAX,
    note: "Estimate only: the published text says the bonus is pro-rated by the verified share but does not publish the exact rounding. Not included in the round total.",
  };
}

const BASELINES = {
  "always-reject": {
    label: "Always REJECT",
    assumption:
      "Every task answered REJECT with an assumed verified proof. Timeout/offline outcomes are carried over from the log.",
  },
  "always-approve": {
    label: "Always APPROVE",
    assumption:
      "Every task answered APPROVE with an assumed verified proof. Timeout/offline outcomes are carried over from the log.",
  },
  "decision-only": {
    label: "Same decisions, no proofs",
    assumption:
      "The log's own decisions, answered with no proof attached. Timeout/offline outcomes are carried over from the log.",
  },
};

// What-if baselines reuse the same scorer, so UNKNOWNs propagate from
// the log instead of being papered over. Ground truth is derived from
// the log itself: when the logged decision was correct, the truth is
// that decision; when wrong, it is the opposite. A missing
// correctness label means the truth is unknown, so the baseline task
// is unscored too.
export function scoreBaseline(tasks, kind) {
  const def = BASELINES[kind];
  if (!def) throw new Error(`unknown baseline: ${kind}`);
  const mapped = tasks.map((t) => {
    if (kind === "decision-only") {
      return { ...t, proofAttached: false, proofVerified: false };
    }
    const fixed = kind === "always-reject" ? "REJECT" : "APPROVE";
    let correct = null;
    if (t.correct !== null && t.decision !== null) {
      const truth = t.correct
        ? t.decision
        : t.decision === "APPROVE"
          ? "REJECT"
          : "APPROVE";
      correct = fixed === truth;
    }
    return {
      ...t,
      decision: fixed,
      proofAttached: true,
      proofVerified: true,
      correct,
    };
  });
  const results = mapped.map(scoreTask);
  const scored = results.filter((r) => r.status === "scored");
  return {
    id: kind,
    label: def.label,
    assumption: def.assumption,
    note: "Reliability bonus excluded from baseline comparison.",
    tasks: results,
    totalPoints: scored.reduce((s, r) => s + r.points, 0),
    scoredCount: scored.length,
    unscoredCount: results.length - scored.length,
  };
}

export function scoreRound(input) {
  const tasks = parseRound(input);
  const results = tasks.map(scoreTask);
  const scored = results.filter((r) => r.status === "scored");
  const counts = {
    correctVerified: 0,
    incorrectApprove: 0,
    incorrectReject: 0,
    deliveryTimeout: 0,
    missingInvalidProof: 0,
    unscored: 0,
  };
  for (const r of results) {
    if (r.status !== "scored") {
      counts.unscored += 1;
    } else if (r.rule === "correct-verified") counts.correctVerified += 1;
    else if (r.rule === "incorrect-approve") counts.incorrectApprove += 1;
    else if (r.rule === "incorrect-reject") counts.incorrectReject += 1;
    else if (r.rule === "delivery-timeout") counts.deliveryTimeout += 1;
    else if (r.rule === "missing-invalid-proof")
      counts.missingInvalidProof += 1;
  }
  return {
    taskCount: tasks.length,
    scoredCount: scored.length,
    unscoredCount: results.length - scored.length,
    totalPoints: scored.reduce((s, r) => s + r.points, 0),
    counts,
    tasks: results,
    bonus: reliabilityBonus(tasks),
    baselines: Object.keys(BASELINES).map((kind) =>
      scoreBaseline(tasks, kind),
    ),
    source: SCORE_SOURCE,
  };
}
