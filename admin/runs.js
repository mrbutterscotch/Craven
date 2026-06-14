const endpoint = "/admin/api/runs";

const state = {
  runs: [],
  loading: false
};

const elements = {
  refreshButton: document.querySelector("#refreshButton"),
  exportCsv: document.querySelector("#exportCsv"),
  outcomeFilter: document.querySelector("#outcomeFilter"),
  minGhostWins: document.querySelector("#minGhostWins"),
  heroFilter: document.querySelector("#heroFilter"),
  versionFilter: document.querySelector("#versionFilter"),
  limit: document.querySelector("#limit"),
  rows: document.querySelector("#runRows"),
  emptyState: document.querySelector("#emptyState"),
  errorNotice: document.querySelector("#errorNotice"),
  lastUpdated: document.querySelector("#lastUpdated"),
  serverStatus: document.querySelector("#serverStatus"),
  clockTime: document.querySelector("#clockTime"),
  clockDate: document.querySelector("#clockDate"),
  runCount: document.querySelector("#runCount"),
  winCount: document.querySelector("#winCount"),
  visibleCount: document.querySelector("#visibleCount")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateClock() {
  const now = new Date();
  elements.clockTime.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  elements.clockDate.textContent = now.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function playerName(run) {
  return run.player_name || run.owner_username || run.owner_user_id || "Unknown";
}

function boardSummary(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "-";
  }
  return items.map((item) => `<span class="data-chip">${escapeHtml(item.slot || "?")}: ${escapeHtml(item.name || item.card_id || "Card")}</span>`).join("");
}

function outcomeClass(outcome) {
  if (outcome === "win") {
    return "playing";
  }
  if (outcome === "loss") {
    return "stale";
  }
  return "idle";
}

function formatEnded(run) {
  if (run.ended_at_unix) {
    return new Date(Number(run.ended_at_unix) * 1000).toLocaleString();
  }
  return run.updated_at || "-";
}

function setError(message) {
  elements.errorNotice.textContent = message;
  elements.errorNotice.classList.toggle("hidden", !message);
  elements.serverStatus.textContent = message ? "Error" : "Online";
  elements.serverStatus.style.color = message ? "var(--red)" : "var(--green)";
}

function setLoading(loading) {
  state.loading = loading;
  elements.refreshButton.disabled = loading;
}

function render() {
  elements.runCount.textContent = state.runs.length;
  elements.winCount.textContent = state.runs.filter((run) => run.outcome === "win").length;
  elements.visibleCount.textContent = state.runs.length;
  elements.rows.innerHTML = state.runs.map((run) => `
    <tr>
      <td data-label="Player">
        <div class="player-name">${escapeHtml(playerName(run))}</div>
        <div class="player-sub">${escapeHtml(run.owner_user_id || "")}</div>
      </td>
      <td data-label="Outcome"><span class="activity-text ${outcomeClass(run.outcome)}">${escapeHtml(run.outcome || run.status || "-")}</span></td>
      <td data-label="Hero">${escapeHtml(run.hero || "-")}</td>
      <td data-label="Day">${escapeHtml(run.day || 0)}</td>
      <td data-label="Ghost Wins">${escapeHtml(run.ghost_wins || 0)}</td>
      <td data-label="Run Life">${escapeHtml(run.run_life || 0)}</td>
      <td data-label="Version">${escapeHtml(run.game_version || "-")}</td>
      <td data-label="Final Board"><div class="chip-wrap">${boardSummary(run.board_items)}</div></td>
      <td data-label="Ended">${escapeHtml(formatEnded(run))}</td>
    </tr>
  `).join("");
  elements.emptyState.classList.toggle("hidden", state.runs.length > 0);
}

async function refreshRuns() {
  if (state.loading) {
    return;
  }
  setLoading(true);
  setError("");
  const payload = {
    outcome: elements.outcomeFilter.value,
    min_ghost_wins: Number(elements.minGhostWins.value) || 0,
    hero: elements.heroFilter.value.trim(),
    game_version: elements.versionFilter.value.trim(),
    limit: Number(elements.limit.value) || 100
  };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Report request failed with HTTP ${response.status}`);
    }
    const data = await response.json();
    state.runs = Array.isArray(data.runs) ? data.runs : [];
    elements.lastUpdated.textContent = `Last refresh ${new Date().toLocaleTimeString()}`;
    render();
  } catch (error) {
    setError(error.message || "Could not load runs.");
  } finally {
    setLoading(false);
  }
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCsv() {
  const rows = state.runs.map((run) => [
    playerName(run),
    run.outcome || run.status || "",
    run.hero || "",
    run.day || 0,
    run.ghost_wins || 0,
    run.run_life || 0,
    run.game_version || "",
    Array.isArray(run.board_items) ? run.board_items.map((item) => `${item.slot}:${item.name || item.card_id}`).join(" | ") : "",
    formatEnded(run)
  ]);
  const csv = [["Player", "Outcome", "Hero", "Day", "Ghost Wins", "Run Life", "Version", "Final Board", "Ended"], ...rows]
    .map((row) => row.map(csvValue).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `craven-runs-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

elements.refreshButton.addEventListener("click", refreshRuns);
elements.exportCsv.addEventListener("click", exportCsv);
for (const control of [elements.outcomeFilter, elements.minGhostWins, elements.heroFilter, elements.versionFilter, elements.limit]) {
  control.addEventListener("change", refreshRuns);
}
updateClock();
setInterval(updateClock, 1000);
refreshRuns();
