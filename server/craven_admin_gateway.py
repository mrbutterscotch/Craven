#!/usr/bin/env python3
import base64
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import grp
except ImportError:
    grp = None


HOST = os.environ.get("CRAVEN_ADMIN_HOST", "127.0.0.1")
PORT = int(os.environ.get("CRAVEN_ADMIN_PORT", "8181"))
DATA_DIR = Path(os.environ.get("CRAVEN_ADMIN_DATA_DIR", "/etc/craven-admin"))
USERS_PATH = DATA_DIR / "users.json"
HTPASSWD_PATH = Path(os.environ.get("CRAVEN_ADMIN_HTPASSWD", "/etc/nginx/.htpasswd-craven-admin"))
RUNTIME_SNIPPET_PATH = Path(os.environ.get("CRAVEN_RUNTIME_KEY_SNIPPET", "/etc/nginx/snippets/craven-admin-runtime-key.conf"))
NAKAMA_URL = os.environ.get("CRAVEN_NAKAMA_URL", "http://127.0.0.1:7350")
BOOTSTRAP_USER = os.environ.get("CRAVEN_ADMIN_BOOTSTRAP_USER", "").strip()
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,40}$")


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        return default


def write_json_atomic(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name, dir=str(path.parent))
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(tmp_name, path)


def load_users():
    data = read_json(USERS_PATH, {"users": {}})
    if not isinstance(data, dict):
        data = {"users": {}}
    if not isinstance(data.get("users"), dict):
        data["users"] = {}
    if BOOTSTRAP_USER and BOOTSTRAP_USER not in data["users"]:
        data["users"][BOOTSTRAP_USER] = {
            "can_manage_users": True,
            "created_at": utc_now(),
            "updated_at": utc_now(),
        }
        write_json_atomic(USERS_PATH, data)
    return data


def save_users(data) -> None:
    write_json_atomic(USERS_PATH, data)


def public_user(username: str, record: dict) -> dict:
    return {
        "username": username,
        "can_manage_users": bool(record.get("can_manage_users")),
        "created_at": record.get("created_at", ""),
        "updated_at": record.get("updated_at", ""),
    }


def runtime_http_key() -> str:
    text = RUNTIME_SNIPPET_PATH.read_text(encoding="utf-8")
    match = re.search(r'set\s+\$craven_runtime_http_key\s+"([^"]+)"', text)
    if not match:
        raise RuntimeError("Could not read Nakama runtime HTTP key snippet.")
    return match.group(1)


def nakama_rpc(name: str, payload: dict) -> dict:
    query = urllib.parse.urlencode({"http_key": runtime_http_key(), "unwrap": ""})
    url = f"{NAKAMA_URL}/v2/rpc/{urllib.parse.quote(name)}?{query}"
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(message or f"Nakama RPC {name} failed with HTTP {error.code}") from error


def current_htpasswd_lines() -> list[str]:
    try:
        return HTPASSWD_PATH.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []


def write_htpasswd_lines(lines: list[str]) -> None:
    HTPASSWD_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=HTPASSWD_PATH.name, dir=str(HTPASSWD_PATH.parent))
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        for line in lines:
            handle.write(line.rstrip("\n") + "\n")
    os.replace(tmp_name, HTPASSWD_PATH)
    if grp is not None and hasattr(os, "chown"):
        try:
            os.chown(HTPASSWD_PATH, 0, grp.getgrnam("www-data").gr_gid)
        except Exception:
            pass
    os.chmod(HTPASSWD_PATH, 0o640)


def hash_password(password: str) -> str:
    result = subprocess.run(
        ["openssl", "passwd", "-apr1", "-stdin"],
        input=password,
        text=True,
        check=True,
        capture_output=True,
    )
    return result.stdout.strip()


def upsert_htpasswd_user(username: str, password: str | None) -> None:
    if password is None:
        return
    password_hash = hash_password(password)
    replacement = f"{username}:{password_hash}"
    lines = current_htpasswd_lines()
    next_lines = []
    replaced = False
    for line in lines:
        if line.split(":", 1)[0] == username:
            next_lines.append(replacement)
            replaced = True
        elif line.strip():
            next_lines.append(line)
    if not replaced:
        next_lines.append(replacement)
    write_htpasswd_lines(next_lines)


def delete_htpasswd_user(username: str) -> None:
    next_lines = [
        line for line in current_htpasswd_lines()
        if line.strip() and line.split(":", 1)[0] != username
    ]
    write_htpasswd_lines(next_lines)


class Handler(BaseHTTPRequestHandler):
    server_version = "CravenAdminGateway/1.0"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        data = self.rfile.read(length).decode("utf-8")
        return json.loads(data or "{}")

    def admin_username(self) -> str:
        username = self.headers.get("X-Admin-User", "").strip()
        if username:
            return username
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("basic "):
            try:
                decoded = base64.b64decode(auth.split(" ", 1)[1]).decode("utf-8")
                return decoded.split(":", 1)[0].strip()
            except Exception:
                return ""
        return ""

    def require_user(self) -> tuple[str, dict] | None:
        username = self.admin_username()
        users = load_users()
        record = users["users"].get(username)
        if not username or not isinstance(record, dict):
            self.send_json(403, {"ok": False, "message": "Admin user is not allowed."})
            return None
        return username, record

    def require_manager(self) -> tuple[str, dict] | None:
        user = self.require_user()
        if user is None:
            return None
        username, record = user
        if not record.get("can_manage_users"):
            self.send_json(403, {"ok": False, "message": "This admin cannot manage users."})
            return None
        return username, record

    def handle_rpc_proxy(self, rpc_name: str) -> None:
        if self.require_user() is None:
            return
        try:
            payload = self.read_body()
            self.send_json(200, nakama_rpc(rpc_name, payload))
        except Exception as error:
            self.send_json(502, {"ok": False, "message": str(error)})

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/me":
            user = self.require_user()
            if user is None:
                return
            username, record = user
            self.send_json(200, {"ok": True, "user": public_user(username, record)})
            return
        if path == "/api/users":
            if self.require_manager() is None:
                return
            users = load_users()["users"]
            listed = [public_user(username, record) for username, record in sorted(users.items())]
            self.send_json(200, {"ok": True, "users": listed})
            return
        self.send_json(404, {"ok": False, "message": "Not found."})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/online":
            self.handle_rpc_proxy("admin_online_players")
            return
        if path == "/api/ghosts":
            self.handle_rpc_proxy("admin_ghosts_report")
            return
        if path == "/api/runs":
            self.handle_rpc_proxy("admin_runs_report")
            return
        if path == "/api/users":
            manager = self.require_manager()
            if manager is None:
                return
            try:
                body = self.read_body()
                username = str(body.get("username", "")).strip()
                password = str(body.get("password", ""))
                can_manage_users = bool(body.get("can_manage_users"))
                if not USERNAME_PATTERN.match(username):
                    self.send_json(400, {"ok": False, "message": "Use 3-40 letters, numbers, dots, dashes, or underscores."})
                    return
                users = load_users()
                existing = users["users"].get(username)
                if existing is None and len(password) < 10:
                    self.send_json(400, {"ok": False, "message": "New admin passwords must be at least 10 characters."})
                    return
                if existing is not None and password and len(password) < 10:
                    self.send_json(400, {"ok": False, "message": "Replacement passwords must be at least 10 characters."})
                    return
                now = utc_now()
                record = existing if isinstance(existing, dict) else {"created_at": now}
                record["can_manage_users"] = can_manage_users
                record["updated_at"] = now
                users["users"][username] = record
                upsert_htpasswd_user(username, password if password else None)
                save_users(users)
                self.send_json(200, {"ok": True, "user": public_user(username, record)})
            except Exception as error:
                self.send_json(500, {"ok": False, "message": str(error)})
            return
        self.send_json(404, {"ok": False, "message": "Not found."})

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        if path != "/api/users":
            self.send_json(404, {"ok": False, "message": "Not found."})
            return
        manager = self.require_manager()
        if manager is None:
            return
        current_username, _ = manager
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        username = str((query.get("username") or [""])[0]).strip()
        if username == current_username:
            self.send_json(400, {"ok": False, "message": "You cannot delete your own admin user."})
            return
        users = load_users()
        if username not in users["users"]:
            self.send_json(404, {"ok": False, "message": "Admin user was not found."})
            return
        del users["users"][username]
        delete_htpasswd_user(username)
        save_users(users)
        self.send_json(200, {"ok": True, "message": "Admin user deleted."})


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    load_users()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Craven admin gateway listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
