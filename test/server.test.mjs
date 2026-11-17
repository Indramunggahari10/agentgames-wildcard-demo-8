import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import { SAMPLES } from "../src/examples.js";

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("health and static routes", () => {
  it("GET /health returns ok", async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "round-scorer");
  });

  it("GET /api/health returns the same payload", async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "round-scorer");
  });

  it("GET / returns the UI", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    const html = await res.text();
    assert.match(html, /Round Scorer/);
    assert.match(html, /Honest scope/);
    assert.match(html, /\/app\.js/);
  });

  it("GET /app.js returns the client script", async () => {
    const res = await fetch(`${base}/app.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /javascript/);
    assert.match(await res.text(), /api\/score/);
  });

  it("responses carry no-store, CSP, and nosniff headers", async () => {
    for (const p of ["/", "/api/health", "/api/rules"]) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.match(
        res.headers.get("content-security-policy"),
        /script-src 'self'/,
      );
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    }
  });

  it("unknown routes 404", async () => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});

describe("data routes", () => {
  it("GET /api/examples returns the four 8-task samples", async () => {
    const res = await fetch(`${base}/api/examples`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.examples.length, 4);
    for (const ex of body.examples) {
      assert.equal(ex.tasks.length, 8);
    }
    assert.deepEqual(
      body.examples.map((e) => e.id),
      SAMPLES.map((s) => s.id),
    );
  });

  it("GET /api/rules returns the published rows, bonus, and source", async () => {
    const res = await fetch(`${base}/api/rules`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.rules.length, 5);
    assert.equal(body.bonus.max, 5);
    assert.match(body.source, /agentgames\.zkverify\.io/);
    assert.ok(Array.isArray(body.notes) && body.notes.length > 0);
  });
});

describe("POST /api/score", () => {
  it("scores the mixed sample end to end", async () => {
    const sample = SAMPLES.find((s) => s.id === "mixed-round");
    const res = await fetch(`${base}/api/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tasks: sample.tasks }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalPoints, 23);
    assert.equal(body.unscoredCount, 1);
    assert.equal(body.baselines.length, 3);
    assert.equal(body.bonus.estimate, 2.86);
  });

  it("accepts a bare array body", async () => {
    const res = await fetch(`${base}/api/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { decision: "APPROVE", proofAttached: true, proofVerified: true, correct: true },
      ]),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).totalPoints, 12);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await fetch(`${base}/api/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /valid JSON/);
  });

  it("rejects an invalid round log with 400 and per-task details", async () => {
    const res = await fetch(`${base}/api/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tasks: [{ decision: "MAYBE", correct: true }] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(Array.isArray(body.details));
    assert.equal(body.details.length, 1);
    assert.match(body.details[0].message, /APPROVE/);
  });

  it("rejects bodies over the 64 KB cap with 413", async () => {
    const res = await fetch(`${base}/api/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(70 * 1024),
    });
    assert.equal(res.status, 413);
  });

  it("GET on /api/score is not routed", async () => {
    const res = await fetch(`${base}/api/score`);
    assert.equal(res.status, 404);
  });
});
