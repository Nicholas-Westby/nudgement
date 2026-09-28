#!/usr/bin/env python3
"""Receive GitHub webhooks and append each verified event to a JSON Lines file.

    WEBHOOK_SECRET=... WEBHOOK_LOG=events.jsonl PORT=8080 webhook_receiver.py

A request whose X-Hub-Signature-256 does not match the shared secret is refused
before its body is parsed, so an unsigned request costs one hash and nothing else.
"""

import hashlib
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ["WEBHOOK_SECRET"].encode()
LOG_PATH = os.environ.get("WEBHOOK_LOG", "events.jsonl")
MAX_BODY = 5 * 1024 * 1024  # GitHub caps payloads at 25 MB; ours never come near 5.

_log_lock = threading.Lock()


def signature_matches(body, header):
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    # compare_digest takes the same time however much of a guess is right.
    return hmac.compare_digest(expected, header.removeprefix("sha256="))


def append_event(event):
    line = json.dumps(event, separators=(",", ":")) + "\n"
    # One write per event, under a lock: the server is threaded, and two
    # deliveries arriving together must not interleave inside one line.
    with _log_lock, open(LOG_PATH, "a", encoding="utf-8") as log:
        log.write(line)


class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.send_error(413, "payload too large")
            return
        body = self.rfile.read(length)
        if not signature_matches(body, self.headers.get("X-Hub-Signature-256")):
            self.send_error(401, "bad signature")
            return
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "body is not JSON")
            return
        append_event({
            "received": time.time(),
            "event": self.headers.get("X-GitHub-Event"),
            "delivery": self.headers.get("X-GitHub-Delivery"),
            "payload": payload,
        })
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    print(f"listening on :{port}, writing to {LOG_PATH}")
    ThreadingHTTPServer(("", port), WebhookHandler).serve_forever()
