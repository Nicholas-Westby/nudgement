#!/usr/bin/env python3
"""Receive GitHub webhooks and append each verified event to a JSON Lines file.

    WEBHOOK_SECRET=... WEBHOOK_LOG=events.jsonl PORT=8080 webhook_receiver.py

A request whose X-Hub-Signature-256 does not match the shared secret is refused
before its body is parsed, so an unsigned request costs one hash and nothing else.

Overview:
    This module implements a small HTTP server that listens for webhook
    deliveries from GitHub. Each delivery is verified, parsed and appended
    to a log file as a single line of JSON.

Environment variables:
    WEBHOOK_SECRET: The shared secret used to verify signatures (required).
    WEBHOOK_LOG: The path of the file events are appended to
        (default: events.jsonl).
    PORT: The port the server listens on (default: 8080).

Responses:
    204: The event was verified and recorded.
    400: The body is not valid JSON.
    401: The signature is missing or does not match.
    413: The body is larger than MAX_BODY.
"""

import hashlib
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# =============================================================================
# Configuration
# =============================================================================

# The shared secret, as bytes
SECRET = os.environ["WEBHOOK_SECRET"].encode()

# The path of the log file
LOG_PATH = os.environ.get("WEBHOOK_LOG", "events.jsonl")

# The maximum body size in bytes
MAX_BODY = 5 * 1024 * 1024  # GitHub caps payloads at 25 MB; ours never come near 5.

# Lock that protects the log file
_log_lock = threading.Lock()


# =============================================================================
# Helpers
# =============================================================================


def signature_matches(body, header):
    """Check whether a request body matches its signature header.

    Args:
        body: The raw request body, as bytes.
        header: The value of the X-Hub-Signature-256 header, or None.

    Returns:
        True if the signature is valid, False otherwise.
    """
    # Reject a missing header or one without the sha256= prefix
    if not header or not header.startswith("sha256="):
        return False
    # Compute the expected signature
    expected = hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    # compare_digest takes the same time however much of a guess is right.
    return hmac.compare_digest(expected, header.removeprefix("sha256="))


def append_event(event):
    """Append an event to the log file.

    Args:
        event: The event to append, as a dictionary.

    Returns:
        None
    """
    # Serialize the event as a single line of JSON
    line = json.dumps(event, separators=(",", ":")) + "\n"
    # One write per event, under a lock: the server is threaded, and two
    # deliveries arriving together must not interleave inside one line.
    with _log_lock, open(LOG_PATH, "a", encoding="utf-8") as log:
        # Write the line to the file
        log.write(line)


# =============================================================================
# Request handling
# =============================================================================


class WebhookHandler(BaseHTTPRequestHandler):
    """HTTP request handler for GitHub webhook deliveries."""

    def do_POST(self):
        """Handle a POST request containing a webhook delivery.

        Returns:
            None
        """
        # Read the Content-Length header
        length = int(self.headers.get("Content-Length") or 0)
        # Reject bodies that are too large
        if length > MAX_BODY:
            self.send_error(413, "payload too large")
            return
        # Read the request body
        body = self.rfile.read(length)
        # Verify the signature
        if not signature_matches(body, self.headers.get("X-Hub-Signature-256")):
            self.send_error(401, "bad signature")
            return
        # Parse the JSON payload
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            # Reject bodies that are not valid JSON
            self.send_error(400, "body is not JSON")
            return
        # Build the event record and append it to the log
        append_event({
            "received": time.time(),  # When the event was received
            "event": self.headers.get("X-GitHub-Event"),  # The event type
            "delivery": self.headers.get("X-GitHub-Delivery"),  # The delivery ID
            "payload": payload,  # The parsed payload
        })
        # Respond with 204 No Content
        self.send_response(204)
        self.end_headers()


# =============================================================================
# Entry point
# =============================================================================

if __name__ == "__main__":
    # Read the port from the environment
    port = int(os.environ.get("PORT", "8080"))
    # Print a startup message
    print(f"listening on :{port}, writing to {LOG_PATH}")
    # Start the server
    ThreadingHTTPServer(("", port), WebhookHandler).serve_forever()
