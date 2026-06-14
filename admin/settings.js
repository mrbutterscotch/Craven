const endpoints = {
  me: "/admin/api/me",
  users: "/admin/api/users"
};

const state = {
  currentUser: null,
  users: [],
  canManageUsers: false
};

const elements = {
  refreshButton: document.querySelector("#refreshButton"),
  serverStatus: document.querySelector("#serverStatus"),
  clockTime: document.querySelector("#clockTime"),
  clockDate: document.querySelector("#clockDate"),
  lastUpdated: document.querySelector("#lastUpdated"),
  currentUser: document.querySelector("#currentUser"),
  canManageUsers: document.querySelector("#canManageUsers"),
  form: document.querySelector("#userForm"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  canManage: document.querySelector("#canManage"),
  saveUser: document.querySelector("#saveUser"),
  formNotice: document.querySelector("#formNotice"),
  errorNotice: document.querySelector("#errorNotice"),
  userRows: document.querySelector("#userRows"),
  userCount: document.querySelector("#userCount"),
  emptyState: document.querySelector("#emptyState")
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

function setError(message) {
  elements.errorNotice.textContent = message;
  elements.errorNotice.classList.toggle("hidden", !message);
  elements.serverStatus.textContent = message ? "Error" : "Online";
  elements.serverStatus.style.color = message ? "var(--red)" : "var(--green)";
}

function setNotice(message, isError = false) {
  elements.formNotice.textContent = message;
  elements.formNotice.classList.toggle("hidden", !message);
  elements.formNotice.classList.toggle("success", !isError);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `Request failed with HTTP ${response.status}`);
  }
  return data;
}

function renderCurrentUser() {
  const user = state.currentUser || {};
  state.canManageUsers = Boolean(user.can_manage_users);
  elements.currentUser.textContent = user.username || "-";
  elements.canManageUsers.textContent = state.canManageUsers ? "Yes" : "No";
  elements.form.classList.toggle("disabled-panel", !state.canManageUsers);
  for (const control of [elements.username, elements.password, elements.canManage, elements.saveUser]) {
    control.disabled = !state.canManageUsers;
  }
  if (!state.canManageUsers) {
    setNotice("Your admin account can view reports but cannot create or update admin users.", true);
  }
}

function renderUsers() {
  elements.userCount.textContent = state.users.length;
  elements.userRows.innerHTML = state.users.map((user) => `
    <tr>
      <td data-label="Username">
        <button class="link-button" data-edit-user="${escapeHtml(user.username)}" type="button">${escapeHtml(user.username)}</button>
      </td>
      <td data-label="Can Manage Users">${user.can_manage_users ? "Yes" : "No"}</td>
      <td data-label="Updated">${escapeHtml(user.updated_at || "-")}</td>
      <td data-label="Action">
        <button class="danger-button" data-delete-user="${escapeHtml(user.username)}" type="button" ${state.currentUser && state.currentUser.username === user.username ? "disabled" : ""}>Delete</button>
      </td>
    </tr>
  `).join("");
  elements.emptyState.classList.toggle("hidden", state.users.length > 0);
}

async function refreshSettings() {
  setError("");
  try {
    const me = await requestJson(endpoints.me);
    state.currentUser = me.user;
    renderCurrentUser();
    if (state.canManageUsers) {
      const users = await requestJson(endpoints.users);
      state.users = Array.isArray(users.users) ? users.users : [];
    } else {
      state.users = state.currentUser ? [state.currentUser] : [];
    }
    elements.lastUpdated.textContent = `Last refresh ${new Date().toLocaleTimeString()}`;
    renderUsers();
  } catch (error) {
    setError(error.message || "Could not load settings.");
  }
}

async function saveUser(event) {
  event.preventDefault();
  if (!state.canManageUsers) {
    return;
  }
  setNotice("");
  setError("");
  try {
    const payload = {
      username: elements.username.value.trim(),
      password: elements.password.value,
      can_manage_users: elements.canManage.checked
    };
    const result = await requestJson(endpoints.users, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setNotice(`Saved ${result.user.username}.`);
    elements.password.value = "";
    await refreshSettings();
  } catch (error) {
    setNotice(error.message || "Could not save admin user.", true);
  }
}

async function deleteUser(username) {
  if (!state.canManageUsers || !username) {
    return;
  }
  setNotice("");
  setError("");
  try {
    await requestJson(`${endpoints.users}?username=${encodeURIComponent(username)}`, {
      method: "DELETE"
    });
    setNotice(`Deleted ${username}.`);
    await refreshSettings();
  } catch (error) {
    setNotice(error.message || "Could not delete admin user.", true);
  }
}

elements.form.addEventListener("submit", saveUser);
elements.refreshButton.addEventListener("click", refreshSettings);
elements.userRows.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-user]");
  if (editButton) {
    const username = editButton.dataset.editUser;
    const user = state.users.find((entry) => entry.username === username);
    if (user) {
      elements.username.value = user.username;
      elements.password.value = "";
      elements.canManage.checked = Boolean(user.can_manage_users);
      setNotice(`Editing ${user.username}. Leave password blank to keep it unchanged.`);
    }
    return;
  }
  const deleteButton = event.target.closest("[data-delete-user]");
  if (deleteButton && !deleteButton.disabled) {
    deleteUser(deleteButton.dataset.deleteUser);
  }
});

updateClock();
setInterval(updateClock, 1000);
refreshSettings();
