"""Local dev server, like `python -m http.server`, but with HTTP Range support.

    python scripts/serve.py          # http://localhost:8000
    python scripts/serve.py 9000     # other port

Why: the voice tracks have to jump to the right spot when you pause, skip or go back.
Browsers do that with Range requests ("give me bytes 3000000-"). Python's built-in server
ignores them, so seeking breaks in Chrome and Safari/iPhone often won't play audio at all.
GitHub Pages supports ranges, so this is only needed locally.
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class RangeHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")  # always pick up edited files
        super().end_headers()

    def send_head(self):
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path):
            return super().send_head()

        size = os.path.getsize(path)
        a, b = m.groups()
        if a == "":                       # "bytes=-500": the last 500 bytes
            start, end = max(0, size - int(b or 0)), size - 1
        else:
            start, end = int(a), min(int(b), size - 1) if b else size - 1
        if start >= size or start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        self._remaining = None
        try:
            while remaining > 0:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass  # the browser cancels range requests all the time while seeking


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(RangeHandler, directory=str(ROOT))
    print(f"Serving {ROOT} on http://localhost:{port} (Ctrl+C to stop)")
    ThreadingHTTPServer(("", port), handler).serve_forever()
