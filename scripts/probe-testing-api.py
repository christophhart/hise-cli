#!/usr/bin/env python3
"""Probe the HISE testing endpoints without shell-specific JSON quoting."""

import argparse
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request(base_url: str, path: str, payload: dict | None, timeout: float) -> tuple[int, dict]:
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = Request(f"{base_url.rstrip('/')}{path}", data=body, headers=headers, method="POST" if body else "GET")
    try:
        with urlopen(req, timeout=timeout) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        try:
            return error.code, json.load(error)
        except json.JSONDecodeError:
            return error.code, {"error": error.reason}


def print_result(name: str, status: int, result: dict) -> None:
    print(f"\n{name} [{status}]")
    print(json.dumps(result, indent=2, ensure_ascii=True))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:1900")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--screenshot-component", help="Add an E2E screenshot for this component")
    args = parser.parse_args()

    try:
        status, result = request(args.base_url, "/api/status", None, args.timeout)
        print_result("status", status, result)
        if status != 200 or not result.get("success"):
            return 1

        e2e_interactions = [
            {
                "type": "repl",
                "id": "e2e_probe",
                "expression": "1 + 2",
            },
        ]
        if args.screenshot_component:
            e2e_interactions.append({
                "type": "screenshot",
                "id": "e2e_probe_screenshot",
                "componentId": args.screenshot_component,
                "scale": 0.5,
            })

        status, result = request(
            args.base_url,
            "/api/testing/e2e",
            {"interactions": e2e_interactions},
            args.timeout,
        )
        print_result("e2e", status, result)
        if status != 200 or not result.get("success"):
            return 1

        status, result = request(
            args.base_url,
            "/api/testing/sequence",
            {
                "messages": [
                    {
                        "type": "repl",
                        "timestamp": 0,
                        "id": "sequence_probe",
                        "expression": "1 + 2",
                        "moduleId": "Interface",
                    },
                ],
                "blocking": True,
            },
            args.timeout,
        )
        print_result("sequence", status, result)
        if status != 200 or not result.get("success"):
            return 1
    except (URLError, TimeoutError) as error:
        print(f"Request failed: {error}", file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
