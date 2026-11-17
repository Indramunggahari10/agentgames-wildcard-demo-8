// Round Scorer UI logic. Same-origin fetches only; no third-party code.
// All server-provided strings are HTML-escaped before rendering.

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtPoints(t) {
  if (t.status !== "scored") return '<span class="pts-unk">UNKNOWN</span>';
  const cls = t.points > 0 ? "pts-pos" : t.points < 0 ? "pts-neg" : "";
  const sign = t.points > 0 ? "+" : "";
  return `<span class="${cls}">${sign}${t.points}</span>`;
}

function proofCell(t) {
  if (t.timeout || t.offline) return "— (no response)";
  if (!t.proofAttached) return "none attached";
  return t.proofVerified ? "attached, verified" : "attached, NOT verified";
}

function correctCell(t) {
  if (t.correct === true) return "yes";
  if (t.correct === false) return "no";
  return "unknown";
}

const logEl = document.getElementById("log");
const errorEl = document.getElementById("error");
const resultsEl = document.getElementById("results");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
  resultsEl.hidden = true;
}

function render(result) {
  errorEl.hidden = true;
  resultsEl.hidden = false;
  document.getElementById("summary").innerHTML =
    `Round total (scored tasks only): <b>${result.totalPoints > 0 ? "+" : ""}${result.totalPoints}</b> &nbsp;·&nbsp; ` +
    `${result.scoredCount} scored, ${result.unscoredCount} unscored, ${result.taskCount} tasks total.`;
  const b = result.bonus;
  document.getElementById("bonus").innerHTML = b.applicable
    ? `<b>Reliability bonus (estimate): +${b.estimate.toFixed(2)}</b> &nbsp;·&nbsp; ` +
      `${b.verified} of ${b.provable} provable tasks verified` +
      (b.excluded ? `, ${b.excluded} PROOF_REUSED task(s) excluded` : "") +
      `. Range +0 to +${b.max}. ${esc(b.note)}`
    : `<b>Reliability bonus: not applicable.</b> ${esc(b.reason)}`;

  const rows = result.tasks
    .map((t) => {
      const rule = t.status === "scored"
        ? `${esc(t.ruleLabel)}<br><span class="note">${esc(t.explanation)}</span>`
        : `UNSCORED<br><span class="note">${esc(t.explanation)}</span>` +
          (t.candidates
            ? `<br><span class="note">Candidate readings: ${t.candidates.map((c) => `${c.points > 0 ? "+" : ""}${c.points} (${esc(c.basis)})`).join("; ")}</span>`
            : "");
      const notes = t.notes && t.notes.length
        ? `<br><span class="note">${t.notes.map(esc).join("<br>")}</span>`
        : "";
      return `<tr><td>${esc(t.id)}</td><td>${t.decision === null ? "—" : esc(t.decision)}</td>` +
        `<td>${esc(proofCell(t))}</td><td>${esc(correctCell(t))}</td>` +
        `<td>${rule}${notes}</td><td>${fmtPoints(t)}</td></tr>`;
    })
    .join("");
  document.getElementById("taskTable").innerHTML =
    `<tr><th>Task</th><th>Decision</th><th>Proof</th><th>Correct</th><th>Rule applied</th><th>Points</th></tr>${rows}`;

  document.getElementById("baselines").innerHTML = result.baselines
    .map((bl) => {
      const chips = bl.tasks
        .map((t) =>
          t.status === "scored"
            ? `<span>${t.points > 0 ? "+" : ""}${t.points}</span>`
            : `<span>?</span>`,
        )
        .join("");
      return `<h3>${esc(bl.label)}: ${bl.totalPoints > 0 ? "+" : ""}${bl.totalPoints} <span class="note">(${bl.scoredCount} scored, ${bl.unscoredCount} unscored)</span></h3>` +
        `<p class="note">Assumption: ${esc(bl.assumption)} ${esc(bl.note)}</p>` +
        `<div class="chips">${chips}</div>`;
    })
    .join("");
}

async function score() {
  let parsed;
  try {
    parsed = JSON.parse(logEl.value);
  } catch (e) {
    showError(`Not valid JSON: ${e.message}`);
    return;
  }
  let resp;
  try {
    resp = await fetch("/api/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed),
    });
  } catch (e) {
    showError(`Request failed: ${e.message}`);
    return;
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const details = Array.isArray(data.details)
      ? "\n" + data.details.map((d) => `- ${d.message}`).join("\n")
      : "";
    showError(`${data.error || `Scoring failed (HTTP ${resp.status})`}${details}`);
    return;
  }
  render(data);
}

async function loadSamples() {
  const box = document.getElementById("samples");
  try {
    const resp = await fetch("/api/examples");
    const data = await resp.json();
    for (const ex of data.examples) {
      const btn = document.createElement("button");
      btn.textContent = ex.name;
      btn.title = ex.description;
      btn.addEventListener("click", () => {
        logEl.value = JSON.stringify({ tasks: ex.tasks }, null, 2);
        score();
      });
      box.appendChild(btn);
    }
    if (data.examples.length) {
      logEl.value = JSON.stringify({ tasks: data.examples[0].tasks }, null, 2);
    }
  } catch (e) {
    box.textContent = "Samples could not be loaded; paste a round log manually.";
  }
}

document.getElementById("scoreBtn").addEventListener("click", score);
document.getElementById("clearBtn").addEventListener("click", () => {
  logEl.value = "";
  resultsEl.hidden = true;
  errorEl.hidden = true;
});
loadSamples();
