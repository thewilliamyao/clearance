#!/usr/bin/env python3
"""Local server for Clearance (the surveillance digicam game).

    python3 serve.py            # http://localhost:8077  (a laptop webcam works on localhost)
                                # the controller: http://localhost:8077/editor/
    python3 serve.py --tunnel   # also a public https://*.trycloudflare.com link for the phone
                                # (phones only give the camera to HTTPS pages; needs
                                #  `brew install cloudflared`)

Serves only this folder. Run tools/fetch_models.sh once for offline copies of the models;
without them the game loads the same files from public CDNs.

The controller (editor/) saves William's edits to content/edits.json through /editor/api.
The controller and its save only answer this computer (localhost): never the tunnel, never
the LAN, never another site in the browser.
"""

import argparse
import datetime
import hashlib
import http.server
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE = {"public_url": None, "content": ROOT / "content" / "edits.json"}
LOCK = threading.Lock()
MAX_BODY = 1_000_000
KEEP_BACKUPS = 30

for ext, mime in {".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm",
                  ".onnx": "application/octet-stream", ".tflite": "application/octet-stream",
                  ".task": "application/octet-stream", ".webmanifest": "application/manifest+json"}.items():
    mimetypes.add_type(mime, ext)

HIDDEN = ("/tools", "/server", "/.", "/serve.py", "/package.json", "/content/backups")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}
# Headers a Cloudflare tunnel (or any proxy) adds: such a request is not from this computer,
# whatever its Host says.
PROXY_HEADERS = ("cf-ray", "cf-connecting-ip", "cdn-loop", "x-forwarded-for", "x-forwarded-host", "forwarded")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_content():
    p = STATE["content"]
    try:
        raw = p.read_bytes()
    except FileNotFoundError:
        raw = b'{\n  "v": 1\n}\n'
    try:
        content = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        content = None  # broken by hand: the controller shows it and starts from the game as written
    return content, sha(raw), raw


def check_content(c):
    """The shape only; the game checks every field when it loads (src/game/content.js)."""
    if not isinstance(c, dict):
        return "the edits must be a JSON object"
    if c.get("v") != 1:
        return 'the edits need "v": 1'
    extra = set(c) - {"v", "shifts", "quests", "lines"}
    if extra:
        return "unknown sections: " + ", ".join(sorted(extra))
    for k in ("shifts", "quests", "lines"):
        if k in c and not isinstance(c[k], dict):
            return f"{k} must be an object"
    return None


def write_content(c):
    p = STATE["content"]
    p.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(c, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    if p.exists():
        backups = p.parent / "backups"
        backups.mkdir(exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        shutil.copy2(p, backups / f"edits-{stamp}.json")
        for old in sorted(backups.glob("edits-*.json"))[:-KEEP_BACKUPS]:
            old.unlink()
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".edits-", suffix=".json")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, p)
    return sha(data)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if args and str(args[1])[:1] in "45":
            sys.stderr.write("%s  %s\n" % (self.address_string(), fmt % args))

    def list_directory(self, path):
        self.send_error(404)

    # --- who is asking ------------------------------------------------------------------
    def host_name(self, value):
        value = (value or "").strip().lower()
        if value.startswith("["):
            return value[: value.find("]") + 1] if "]" in value else value
        return value.rsplit(":", 1)[0] if value.count(":") == 1 else value

    def is_local(self):
        """This computer only: a local address, a localhost Host, no proxy headers."""
        if self.client_address[0] not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            return False
        if self.host_name(self.headers.get("Host")) not in LOCAL_HOSTS:
            return False
        return not any(self.headers.get(h) for h in PROXY_HEADERS)

    def same_origin(self):
        """A save has to come from the controller's own page (not another site in the browser)."""
        origin = self.headers.get("Origin")
        if origin:
            m = re.match(r"^http://([^/]+)$", origin.strip().lower())
            if not m or m.group(1) != (self.headers.get("Host") or "").strip().lower():
                return False
        return self.headers.get("X-Clearance-Controller") == "1"

    def path_only(self):
        return self.path.split("?", 1)[0].split("#", 1)[0]

    def hidden(self):
        p = self.path_only()
        if any(p.startswith(h) for h in HIDDEN):
            return True
        return p.startswith("/editor") and not self.is_local()

    # --- static -------------------------------------------------------------------------
    def do_GET(self):
        if self.hidden():
            return self.send_error(404)
        if self.path_only() == "/editor/api":
            return self.api_get()
        if self.path_only() == "/content/edits.json" and STATE["content"] != ROOT / "content" / "edits.json":
            return self.send_file(STATE["content"])  # --content: the game reads the same copy
        return super().do_GET()

    def send_file(self, p):
        try:
            data = p.read_bytes()
        except FileNotFoundError:
            return self.send_error(404)
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        if self.hidden():
            return self.send_error(404)
        return super().do_HEAD()

    def end_headers(self):
        p = self.path.split("?")[0]
        if p.startswith(("/vendor/", "/models/")):
            self.send_header("Cache-Control", "public, max-age=604800")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # --- the controller's save ----------------------------------------------------------
    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_get(self):
        with LOCK:
            content, digest, raw = read_content()
        broken = content is None
        self.send_json(200, {
            "content": {"v": 1} if broken else content,
            "sha": digest,
            "broken": raw.decode("utf-8", "replace")[:4000] if broken else None,
            "file": os.path.relpath(STATE["content"], ROOT),
            "writable": True,
        })

    def do_PUT(self):
        if self.path_only() != "/editor/api" or not self.is_local():
            return self.send_error(404)
        if not self.same_origin():
            return self.send_json(403, {"error": "saves only come from the controller page on this computer"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            return self.send_json(413 if n > MAX_BODY else 400, {"error": "no body, or too big"})
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self.send_json(415, {"error": "JSON only"})
        try:
            req = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {"error": "not JSON"})
        if not isinstance(req, dict):
            return self.send_json(400, {"error": "expected {content, base}"})
        content = req.get("content")
        why = check_content(content)
        if why:
            return self.send_json(400, {"error": why})
        with LOCK:
            current, digest, _ = read_content()
            if req.get("base") != digest and not req.get("force"):
                return self.send_json(409, {"error": "the file changed since the controller loaded it",
                                            "content": current, "sha": digest})
            new = write_content(content)
        return self.send_json(200, {"ok": True, "sha": new, "file": os.path.relpath(STATE["content"], ROOT),
                                    "saved": datetime.datetime.now().isoformat(timespec="seconds")})

    def do_POST(self):
        return self.send_error(405)


def start_tunnel(port):
    exe = shutil.which("cloudflared")
    if not exe:
        print("  --tunnel needs cloudflared. On the Mac: brew install cloudflared")
        return None
    # HTTP/2 rather than the default QUIC: on this Mac the QUIC tunnel answered most requests
    # with Cloudflare error 530; HTTP/2 answered every one (Nov 20 2026).
    proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", f"http://localhost:{port}"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def watch():
        for line in proc.stdout:
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if m and not STATE["public_url"]:
                STATE["public_url"] = m.group(0)
                print(f"\n  Phone link (HTTPS, anyone with it can open the game): {m.group(0)}/\n", flush=True)

    threading.Thread(target=watch, daemon=True).start()
    return proc


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8077)
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to allow other devices on the LAN (camera still needs HTTPS)")
    ap.add_argument("--tunnel", action="store_true", help="also open a public HTTPS link with cloudflared")
    ap.add_argument("--content", help="the edits file the controller saves (default content/edits.json; tests use a copy)")
    args = ap.parse_args()
    if args.content:
        STATE["content"] = Path(args.content).resolve()
    if not (ROOT / "models").exists():
        print("  (no models/ folder: the game will fetch models from public CDNs; run tools/fetch_models.sh for local copies)")
    srv = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"  Clearance on http://localhost:{args.port}/")
    print(f"  Controller on http://localhost:{args.port}/editor/ (this computer only; saves {os.path.relpath(STATE['content'], ROOT)})")
    tunnel = start_tunnel(args.port) if args.tunnel else None
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if tunnel:
            tunnel.terminate()


if __name__ == "__main__":
    main()
