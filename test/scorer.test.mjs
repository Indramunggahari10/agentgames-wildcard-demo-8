import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RULES,
  ValidationError,
  parseRound,
  scoreTask,
  scoreRound,
  scoreBaseline,
  reliabilityBonus,
} from "../src/scorer.js";
import { SAMPLES } from "../src/examples.js";

function one(overrides) {
  const [task] = parseRound({
    tasks: [
      {
        decision: "APPROVE",
        proofAttached: true,
        proofVerified: true,
        correct: true,
        ...overrides,
      },
    ],
  });
  return scoreTask(task);
}

describe("published per-task rules", () => {
  it("correct APPROVE with verified proof scores +12", () => {
    const r = one({});
    assert.equal(r.status, "scored");
    assert.equal(r.points, 12);
    assert.equal(r.rule, "correct-verified");
  });

  it("correct REJECT with verified proof scores +12", () => {
    const r = one({ decision: "REJECT" });
    assert.equal(r.points, 12);
    assert.equal(r.rule, "correct-verified");
  });

  it("wrong APPROVE with verified proof scores -6", () => {
    const r = one({ correct: false });
    assert.equal(r.points, -6);
    assert.equal(r.rule, "incorrect-approve");
  });

  it("wrong REJECT with verified proof scores -3", () => {
    const r = one({ decision: "REJECT", correct: false });
    assert.equal(r.points, -3);
    assert.equal(r.rule, "incorrect-reject");
  });

  it("timeout scores -2", () => {
    const r = one({ decision: null, timeout: true, correct: null });
    assert.equal(r.points, -2);
    assert.equal(r.rule, "delivery-timeout");
  });

  it("offline scores -2 and notes the forfeit mapping", () => {
    const r = one({ decision: null, offline: true, correct: null });
    assert.equal(r.points, -2);
    assert.equal(r.rule, "delivery-timeout");
    assert.match(r.notes.join(" "), /forfeit/);
    assert.match(r.notes.join(" "), /stated interpretation/);
  });

  it("timeout ignores decision/proof flags in the log", () => {
    const r = one({ timeout: true });
    assert.equal(r.points, -2);
    assert.match(r.notes.join(" "), /ignored/);
  });

  it("correct decision with no proof attached scores -2", () => {
    const r = one({ proofAttached: false, proofVerified: false });
    assert.equal(r.points, -2);
    assert.equal(r.rule, "missing-invalid-proof");
  });

  it("correct decision with an invalid proof scores -2", () => {
    const r = one({ proofVerified: false });
    assert.equal(r.points, -2);
    assert.equal(r.rule, "missing-invalid-proof");
  });
});

describe("unscored combinations", () => {
  it("wrong APPROVE with no proof is UNKNOWN with all three candidate readings", () => {
    const r = one({
      correct: false,
      proofAttached: false,
      proofVerified: false,
    });
    assert.equal(r.status, "unscored");
    assert.equal(r.points, null);
    assert.equal(r.rule, null);
    assert.deepEqual(
      r.candidates.map((c) => c.points),
      [-6, -2, -8],
    );
    assert.match(r.explanation, /no precedence/);
  });

  it("wrong REJECT with an invalid proof is UNKNOWN with candidates -3/-2/-5", () => {
    const r = one({
      decision: "REJECT",
      correct: false,
      proofVerified: false,
    });
    assert.equal(r.status, "unscored");
    assert.deepEqual(
      r.candidates.map((c) => c.points),
      [-3, -2, -5],
    );
  });

  it("verified proof with no correctness label is UNKNOWN", () => {
    const r = one({ correct: null });
    assert.equal(r.status, "unscored");
    assert.equal(r.points, null);
    assert.equal(r.candidates, null);
  });

  it("no valid proof and no correctness label scores -2 (only the missing-proof row can apply)", () => {
    const r = one({
      proofAttached: false,
      proofVerified: false,
      correct: null,
    });
    assert.equal(r.status, "scored");
    assert.equal(r.points, -2);
    assert.equal(r.rule, "missing-invalid-proof");
    assert.match(r.notes.join(" "), /absent/);
  });
});

describe("round totals and bonus", () => {
  it("empty round scores 0 with bonus not applicable", () => {
    const r = scoreRound({ tasks: [] });
    assert.equal(r.taskCount, 0);
    assert.equal(r.totalPoints, 0);
    assert.equal(r.scoredCount, 0);
    assert.equal(r.unscoredCount, 0);
    assert.equal(r.bonus.applicable, false);
  });

  it("all-timeout round scores -16 with bonus estimate 0", () => {
    const tasks = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i + 1}`,
      decision: null,
      timeout: true,
      correct: null,
    }));
    const r = scoreRound({ tasks });
    assert.equal(r.totalPoints, -16);
    assert.equal(r.bonus.applicable, true);
    assert.equal(r.bonus.verified, 0);
    assert.equal(r.bonus.provable, 8);
    assert.equal(r.bonus.estimate, 0);
  });

  it("perfect round scores +96 with bonus estimate +5", () => {
    const s = SAMPLES.find((x) => x.id === "perfect-round");
    const r = scoreRound({ tasks: s.tasks });
    assert.equal(r.totalPoints, 96);
    assert.equal(r.unscoredCount, 0);
    assert.equal(r.bonus.estimate, 5);
    assert.equal(r.bonus.share, 1);
  });

  it("reject-all round scores +51", () => {
    const s = SAMPLES.find((x) => x.id === "reject-all-round");
    const r = scoreRound({ tasks: s.tasks });
    assert.equal(r.totalPoints, 51);
    assert.equal(r.bonus.estimate, 5);
  });

  it("mixed round scores +23 with 1 unscored and exact rule counts", () => {
    const s = SAMPLES.find((x) => x.id === "mixed-round");
    const r = scoreRound({ tasks: s.tasks });
    assert.equal(r.totalPoints, 23);
    assert.equal(r.unscoredCount, 1);
    assert.deepEqual(r.counts, {
      correctVerified: 3,
      incorrectApprove: 1,
      incorrectReject: 1,
      deliveryTimeout: 1,
      missingInvalidProof: 1,
      unscored: 1,
    });
    assert.equal(r.bonus.provable, 7);
    assert.equal(r.bonus.verified, 4);
    assert.equal(r.bonus.excluded, 1);
    assert.equal(r.bonus.estimate, 2.86);
  });

  it("timeout-heavy round scores +11 with bonus estimate 1.88", () => {
    const s = SAMPLES.find((x) => x.id === "timeout-heavy-round");
    const r = scoreRound({ tasks: s.tasks });
    assert.equal(r.totalPoints, 11);
    assert.equal(r.bonus.verified, 3);
    assert.equal(r.bonus.provable, 8);
    assert.equal(r.bonus.estimate, 1.88);
  });

  it("PROOF_REUSED task scores normally but leaves the bonus fraction", () => {
    const r = scoreRound({
      tasks: [
        { decision: "REJECT", proofAttached: true, proofVerified: true, correct: true, proofReused: true },
        { decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true },
      ],
    });
    assert.equal(r.totalPoints, 24);
    assert.equal(r.bonus.provable, 1);
    assert.equal(r.bonus.verified, 1);
    assert.equal(r.bonus.excluded, 1);
    assert.equal(r.bonus.estimate, 5);
    assert.match(r.tasks[0].notes.join(" "), /excluded from the reliability-bonus share/);
  });

  it("all tasks PROOF_REUSED makes the bonus not applicable", () => {
    const b = reliabilityBonus(
      parseRound({
        tasks: [
          { decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true, proofReused: true },
        ],
      }),
    );
    assert.equal(b.applicable, false);
    assert.equal(b.estimate, null);
  });

  it("offline task proof flags do not count toward the bonus numerator", () => {
    const r = scoreRound({
      tasks: [
        { decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true, offline: true },
      ],
    });
    assert.equal(r.totalPoints, -2);
    assert.equal(r.bonus.verified, 0);
    assert.equal(r.bonus.provable, 1);
    assert.equal(r.bonus.estimate, 0);
  });
});

describe("baselines", () => {
  it("mixed round baselines: reject +37, approve +10, decision-only -10 with 3 unscored", () => {
    const s = SAMPLES.find((x) => x.id === "mixed-round");
    const r = scoreRound({ tasks: s.tasks });
    const byId = Object.fromEntries(r.baselines.map((b) => [b.id, b]));
    assert.equal(byId["always-reject"].totalPoints, 37);
    assert.equal(byId["always-reject"].unscoredCount, 0);
    assert.equal(byId["always-approve"].totalPoints, 10);
    assert.equal(byId["always-approve"].unscoredCount, 0);
    assert.equal(byId["decision-only"].totalPoints, -10);
    assert.equal(byId["decision-only"].unscoredCount, 3);
    for (const b of r.baselines) {
      assert.match(b.note, /bonus excluded/);
      assert.match(b.assumption, /carried over/);
    }
  });

  it("perfect round baselines: reject +36, approve +24, decision-only -16", () => {
    const s = SAMPLES.find((x) => x.id === "perfect-round");
    const r = scoreRound({ tasks: s.tasks });
    const byId = Object.fromEntries(r.baselines.map((b) => [b.id, b]));
    assert.equal(byId["always-reject"].totalPoints, 36);
    assert.equal(byId["always-approve"].totalPoints, 24);
    assert.equal(byId["decision-only"].totalPoints, -16);
    assert.equal(byId["decision-only"].unscoredCount, 0);
  });

  it("reject-all baselines: reject +51, approve +6, decision-only -10 with 3 unscored", () => {
    const s = SAMPLES.find((x) => x.id === "reject-all-round");
    const r = scoreRound({ tasks: s.tasks });
    const byId = Object.fromEntries(r.baselines.map((b) => [b.id, b]));
    assert.equal(byId["always-reject"].totalPoints, 51);
    assert.equal(byId["always-approve"].totalPoints, 6);
    assert.equal(byId["decision-only"].totalPoints, -10);
    assert.equal(byId["decision-only"].unscoredCount, 3);
  });

  it("timeout tasks are carried into every baseline at -2", () => {
    const tasks = parseRound({
      tasks: [{ decision: null, timeout: true, correct: null }],
    });
    for (const kind of ["always-reject", "always-approve", "decision-only"]) {
      const b = scoreBaseline(tasks, kind);
      assert.equal(b.totalPoints, -2);
      assert.equal(b.tasks[0].rule, "delivery-timeout");
    }
  });

  it("baseline inherits UNKNOWN when the log has no correctness label", () => {
    const tasks = parseRound({
      tasks: [{ decision: "APPROVE", proofAttached: true, proofVerified: true, correct: null }],
    });
    const b = scoreBaseline(tasks, "always-reject");
    assert.equal(b.tasks[0].status, "unscored");
    assert.equal(b.unscoredCount, 1);
  });

  it("decision-only turns a wrong verified decision into the unresolved overlap", () => {
    const tasks = parseRound({
      tasks: [{ decision: "APPROVE", proofAttached: true, proofVerified: true, correct: false }],
    });
    const b = scoreBaseline(tasks, "decision-only");
    assert.equal(b.tasks[0].status, "unscored");
    assert.deepEqual(
      b.tasks[0].candidates.map((c) => c.points),
      [-6, -2, -8],
    );
  });
});

describe("validation", () => {
  it("rejects a non-object body", () => {
    assert.throws(() => parseRound("nope"), ValidationError);
    assert.throws(() => parseRound(null), ValidationError);
  });

  it("rejects tasks that are not an array", () => {
    assert.throws(() => parseRound({ tasks: {} }), ValidationError);
    assert.throws(() => parseRound({}), ValidationError);
  });

  it("rejects a task that is not an object", () => {
    assert.throws(() => parseRound({ tasks: [42] }), ValidationError);
  });

  it("rejects an invalid decision value", () => {
    assert.throws(
      () => parseRound({ tasks: [{ decision: "MAYBE", correct: true }] }),
      (e) =>
        e instanceof ValidationError &&
        e.details[0].message.includes('"decision"'),
    );
  });

  it("rejects a missing decision on an answered task", () => {
    assert.throws(
      () => parseRound({ tasks: [{ correct: true }] }),
      (e) => e instanceof ValidationError && e.details[0].message.includes("required"),
    );
  });

  it("rejects a non-boolean flag", () => {
    assert.throws(
      () =>
        parseRound({
          tasks: [{ decision: "APPROVE", timeout: "yes", correct: true }],
        }),
      ValidationError,
    );
  });

  it("rejects proofVerified without proofAttached", () => {
    assert.throws(
      () =>
        parseRound({
          tasks: [{ decision: "APPROVE", proofAttached: false, proofVerified: true, correct: true }],
        }),
      (e) => e instanceof ValidationError && e.details[0].message.includes("proofVerified"),
    );
  });

  it("rejects a non-boolean correctness label", () => {
    assert.throws(
      () =>
        parseRound({
          tasks: [{ decision: "APPROVE", correct: "yes" }],
        }),
      ValidationError,
    );
  });

  it("collects problems from multiple tasks", () => {
    assert.throws(
      () =>
        parseRound({
          tasks: [
            { decision: "NOPE", correct: true },
            { decision: "APPROVE", proofAttached: false, proofVerified: true, correct: true },
          ],
        }),
      (e) => e instanceof ValidationError && e.details.length === 2,
    );
  });

  it("accepts lowercase decisions, bare arrays, numeric ids, and ignores unknown fields", () => {
    const tasks = parseRound([
      { id: 7, decision: "approve", proofAttached: true, proofVerified: true, correct: true, extraField: "ignored" },
    ]);
    assert.equal(tasks[0].decision, "APPROVE");
    assert.equal(tasks[0].id, "7");
    const r = scoreRound([
      { decision: "approve", proofAttached: true, proofVerified: true, correct: true },
    ]);
    assert.equal(r.totalPoints, 12);
  });

  it("defaults missing flags to false and missing correctness to null", () => {
    const [t] = parseRound({ tasks: [{ decision: "REJECT" }] });
    assert.equal(t.proofAttached, false);
    assert.equal(t.timeout, false);
    assert.equal(t.correct, null);
  });
});

describe("rules table", () => {
  it("publishes the five per-task rows with the published points", () => {
    assert.deepEqual(
      RULES.map((r) => [r.id, r.points]),
      [
        ["correct-verified", 12],
        ["incorrect-approve", -6],
        ["incorrect-reject", -3],
        ["delivery-timeout", -2],
        ["missing-invalid-proof", -2],
      ],
    );
  });
});
