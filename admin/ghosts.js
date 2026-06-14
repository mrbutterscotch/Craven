const endpoint = "/admin/api/ghosts";

const state = {
  ghosts: [],
  loading: false
};

const elements = {
  refreshButton: document.querySelector("#refreshButton"),
  exportCsv: document.querySelector("#exportCsv"),
  minGhostWins: document.querySelector("#minGhostWins"),
  dayFilter: document.querySelector("#dayFilter"),
  heroFilter: document.querySelector("#heroFilter"),
  versionFilter: document.querySelector("#versionFilter"),
  limit: document.querySelector("#limit"),
  rows: document.querySelector("#ghostRows"),
  emptyState: document.querySelector("#emptyState"),
  errorNotice: document.querySelector("#errorNotice"),
  lastUpdated: document.querySelector("#lastUpdated"),
  serverStatus: document.querySelector("#serverStatus"),
  clockTime: document.querySelector("#clockTime"),
  clockDate: document.querySelector("#clockDate"),
  ghostCount: document.querySelector("#ghostCount"),
  tenWinCount: document.querySelector("#tenWinCount"),
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

function displayOwner(ghost) {
  return ghost.owner_username || ghost.owner_user_id || "Unknown";
}

function boardSummary(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "-";
  }
  return items.map((item) => {
    const name = item.name || item.card_id || "Card";
    const rarity = item.rarity ? ` ${item.rarity}` : "";
    return `<span class="data-chip">${escapeHtml(item.slot || "?")}: ${escapeHtml(name)}${escapeHtml(rarity)}</span>`;
  }).join("");
}

function badgeSummary(badges) {
  if (!Array.isArray(badges) || badges.length === 0) {
    return "-";
  }
  return badges.map((badge) => `<span class="data-chip muted-chip">${escapeHtml(badge.name || badge.id || badge)}</span>`).join("");
}

function formatUpdated(value, fallbackUnix) {
  if (fallbackUnix) {
    return new Date(Number(fallbackUnix) * 1000).toLocaleString();
  }
  return value || "-";
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
  elements.ghostCount.textContent = state.ghosts.length;
  elements.tenWinCount.textContent = state.ghosts.filter((ghost) => Number(ghost.ghost_wins) >= 10).length;
  elements.visibleCount.textContent = state.ghosts.length;
  elements.rows.innerHTML = state.ghosts.map((ghost) => `
    <tr>
      <td data-label="Owner">
        <div class="player-name">${escapeHtml(displayOwner(ghost))}</div>
        <div class="player-sub">${escapeHtml(ghost.owner_user_id || "")}</div>
      </td>
      <td data-label="Hero">${escapeHtml(ghost.hero || "-")}</td>
      <td data-label="Day">${escapeHtml(ghost.day || 0)}</td>
      <td data-label="Ghost Wins"><span class="activity-text ${Number(ghost.ghost_wins) >= 10 ? "stale" : "playing"}">${escapeHtml(ghost.ghost_wins || 0)}</span></td>
      <td data-label="Run Life">${escapeHtml(ghost.run_life || 0)}</td>
      <td data-label="Version">${escapeHtml(ghost.game_version || "-")}</td>
      <td data-label="Final Board"><div class="chip-wrap">${boardSummary(ghost.board_items)}</div></td>
      <td data-label="Badges"><div class="chip-wrap">${badgeSummary(ghost.badges)}</div></td>
      <td data-label="Updated">${escapeHtml(formatUpdated(ghost.updated_at, ghost.saved_at_unix))}</td>
    </tr>
  `).join("");
  elements.emptyState.classList.toggle("hidden", state.ghosts.length > 0);
}

async function refreshGhosts() {
  if (state.loading) {
    return;
  }
  setLoading(true);
  setError("");
  const day = Number(elements.dayFilter.value) || 0;
  const payload = {
    min_ghost_wins: Number(elements.minGhostWins.value) || 0,
    day,
    hero: elements.heroFilter.value.trim(),
    game_version: elements.versionFilter.value.trim(),
    limit: Number(elements.limit.value) || 100,
    only_verified: true
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
    state.ghosts = Array.isArray(data.ghosts) ? data.ghosts : [];
    elements.lastUpdated.textContent = `Last refresh ${new Date().toLocaleTimeString()}`;
    render();
  } catch (error) {
    setError(error.message || "Could not load ghosts.");
  } finally {
    setLoading(false);
  }
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCsv() {
  const rows = state.ghosts.map((ghost) => [
    displayOwner(ghost),
    ghost.hero || "",
    ghost.day || 0,
    ghost.ghost_wins || 0,
    ghost.run_life || 0,
    ghost.game_version || "",
    Array.isArray(ghost.board_items) ? ghost.board_items.map((item) => `${item.slot}:${item.name || item.card_id}`).join(" | ") : "",
    Array.isArray(ghost.badges) ? ghost.badges.map((badge) => badge.name || badge.id).join(" | ") : "",
    ghost.updated_at || ""
  ]);
  const csv = [["Owner", "Hero", "Day", "Ghost Wins", "Run Life", "Version", "Final Board", "Badges", "Updated"], ...rows]
    .map((row) => row.map(csvValue).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `craven-ghosts-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

elements.refreshButton.addEventListener("click", refreshGhosts);
elements.exportCsv.addEventListener("click", exportCsv);
for (const control of [elements.minGhostWins, elements.dayFilter, elements.heroFilter, elements.versionFilter, elements.limit]) {
  control.addEventListener("change", refreshGhosts);
}
updateClock();
setInterval(updateClock, 1000);
refreshGhosts();
