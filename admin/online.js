const endpoint = "/admin/api/online";

const state = {
  players: [],
  visiblePlayers: [],
  timer: null,
  loading: false
};

const elements = {
  autoRefresh: document.querySelector("#autoRefresh"),
  autoState: document.querySelector("#autoState"),
  refreshEvery: document.querySelector("#refreshEvery"),
  freshOnly: document.querySelector("#freshOnly"),
  activityFilter: document.querySelector("#activityFilter"),
  maxAge: document.querySelector("#maxAge"),
  refreshButton: document.querySelector("#refreshButton"),
  exportCsv: document.querySelector("#exportCsv"),
  rows: document.querySelector("#playerRows"),
  emptyState: document.querySelector("#emptyState"),
  errorNotice: document.querySelector("#errorNotice"),
  lastUpdated: document.querySelector("#lastUpdated"),
  serverStatus: document.querySelector("#serverStatus"),
  clockTime: document.querySelector("#clockTime"),
  clockDate: document.querySelector("#clockDate"),
  onlineCount: document.querySelector("#onlineCount"),
  playingCount: document.querySelector("#playingCount"),
  menuCount: document.querySelector("#menuCount"),
  staleCount: document.querySelector("#staleCount"),
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

function formatAge(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) {
    return `${value}s ago`;
  }
  const minutes = Math.floor(value / 60);
  const remainingSeconds = value % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s ago` : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`;
}

function displayName(player) {
  return player.display_name || player.username || player.user_id || "Unknown player";
}

function secondaryName(player) {
  if (player.display_name && player.username && player.display_name !== player.username) {
    return player.username;
  }
  return player.user_id || "";
}

function normalizeActivity(activity) {
  const text = String(activity || "idle").toLowerCase();
  if (text === "playing" || text === "menu" || text === "idle") {
    return text;
  }
  return "idle";
}

function activityLabel(player) {
  if (player.stale) {
    return "Stale";
  }
  const activity = normalizeActivity(player.activity);
  return activity.charAt(0).toUpperCase() + activity.slice(1);
}

function rowStatusClass(player) {
  if (player.stale) {
    return "stale";
  }
  const activity = normalizeActivity(player.activity);
  return activity === "playing" ? "online" : activity;
}

function updateClock() {
  const now = new Date();
  elements.clockTime.textContent = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
  elements.clockDate.textContent = now.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function applyFilters() {
  const activity = elements.activityFilter.value;
  const freshOnly = elements.freshOnly.checked;
  state.visiblePlayers = state.players.filter((player) => {
    if (freshOnly && player.stale) {
      return false;
    }
    if (activity && normalizeActivity(player.activity) !== activity) {
      return false;
    }
    return true;
  });
}

function updateStats() {
  const freshPlayers = state.players.filter((player) => !player.stale);
  elements.onlineCount.textContent = freshPlayers.length;
  elements.playingCount.textContent = freshPlayers.filter((player) => normalizeActivity(player.activity) === "playing").length;
  elements.menuCount.textContent = freshPlayers.filter((player) => normalizeActivity(player.activity) === "menu").length;
  elements.staleCount.textContent = state.players.filter((player) => player.stale).length;
  elements.visibleCount.textContent = state.visiblePlayers.length;
}

function renderRows() {
  elements.rows.innerHTML = state.visiblePlayers.map((player) => {
    const statusClass = rowStatusClass(player);
    const activityClass = player.stale ? "stale" : normalizeActivity(player.activity);
    return `
      <tr>
        <td data-label="Player">
          <div class="player-cell">
            <span class="status-dot ${statusClass}"></span>
            <div>
              <div class="player-name">${escapeHtml(displayName(player))}</div>
              <div class="player-sub">${escapeHtml(secondaryName(player))}</div>
            </div>
          </div>
        </td>
        <td data-label="Activity"><span class="activity-text ${activityClass}">${escapeHtml(activityLabel(player))}</span></td>
        <td data-label="Hero">${escapeHtml(player.hero || "-")}</td>
        <td data-label="Day">${escapeHtml(player.day || 0)}</td>
        <td data-label="Phase">${escapeHtml(player.phase || "-")}</td>
        <td data-label="Ghost Wins">${escapeHtml(player.ghost_wins || 0)}</td>
        <td data-label="Run Life">${escapeHtml(player.run_life || 0)}</td>
        <td data-label="Last Seen">${escapeHtml(formatAge(player.age_seconds))}</td>
      </tr>
    `;
  }).join("");

  elements.emptyState.classList.toggle("hidden", state.visiblePlayers.length > 0);
}

function render() {
  applyFilters();
  updateStats();
  renderRows();
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
  elements.refreshButton.classList.toggle("loading", loading);
}

async function refreshPlayers() {
  if (state.loading) {
    return;
  }

  setLoading(true);
  setError("");

  const maxAgeSeconds = Number(elements.maxAge.value) || 120;
  const payload = {
    include_stale: true,
    max_age_seconds: maxAgeSeconds,
    limit: 500
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Report request failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    state.players = Array.isArray(data.players) ? data.players : [];
    elements.lastUpdated.textContent = `Last refresh ${new Date().toLocaleTimeString()}`;
    render();
  } catch (error) {
    setError(error.message || "Could not load online player report.");
  } finally {
    setLoading(false);
  }
}

function syncAutoState() {
  const enabled = elements.autoRefresh.checked;
  elements.autoState.innerHTML = `<span class="status-dot ${enabled ? "online" : ""}"></span>Auto refresh: ${enabled ? "On" : "Off"}`;

  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  if (enabled) {
    const seconds = Number(elements.refreshEvery.value) || 5;
    state.timer = setInterval(refreshPlayers, seconds * 1000);
  }
}

function csvValue(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  const headers = ["Player", "Username", "Activity", "Hero", "Day", "Phase", "Ghost Wins", "Run Life", "Last Seen Seconds"];
  const rows = state.visiblePlayers.map((player) => [
    displayName(player),
    player.username || "",
    activityLabel(player),
    player.hero || "",
    player.day || 0,
    player.phase || "",
    player.ghost_wins || 0,
    player.run_life || 0,
    player.age_seconds || 0
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `craven-online-players-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

elements.refreshButton.addEventListener("click", refreshPlayers);
elements.exportCsv.addEventListener("click", exportCsv);
elements.autoRefresh.addEventListener("change", syncAutoState);
elements.refreshEvery.addEventListener("change", syncAutoState);
elements.freshOnly.addEventListener("change", render);
elements.activityFilter.addEventListener("change", render);
elements.maxAge.addEventListener("change", refreshPlayers);

updateClock();
setInterval(updateClock, 1000);
syncAutoState();
refreshPlayers();
