#!/usr/bin/env python3
"""Probe HISE's raw CSS parser endpoint."""

import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> int:
    file_path = sys.argv[1] if len(sys.argv) > 1 else "UI/style.css"
    payload = json.dumps({"filePath": file_path}).encode("utf-8")
    request = Request(
        "http://127.0.0.1:1900/api/parse_css",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            status = response.status
            body = response.read().decode("utf-8")
    except HTTPError as error:
        status = error.code
        body = error.read().decode("utf-8")
    except URLError as error:
        print(f"Request failed: {error.reason}", file=sys.stderr)
        return 1

    print(f"HTTP {status}")
    try:
        print(json.dumps(json.loads(body), indent=2))
    except json.JSONDecodeError:
        print(body)
    return 0 if 200 <= status < 300 else 1


if __name__ == "__main__":
    raise SystemExit(main())
