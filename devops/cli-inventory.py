#!/usr/bin/env python3
"""Walk every command of a built bk binary and emit a leaf inventory as Markdown.

Reads the BINARY, never the source: a command that exists but whose help is
stale looks identical to a correct one in the source, and this is the artefact
the 2026-08-11 parity audit measured the docs against.

Writes to stdout. See docs/cli-inventory.md for what to do with it, and why
that file is a dated snapshot rather than a reference.
"""
import subprocess, json, os, sys, re

# usage: ./devops/cli-inventory.py <path-to-bk-binary> [path-to-routes.json]
#        writes the Markdown inventory to STDOUT.
BIN = sys.argv[1] if len(sys.argv) > 1 else ""
ROUTES_JSON = sys.argv[2] if len(sys.argv) > 2 else "cli/routes.json"
if not BIN or not os.path.exists(BIN):
    sys.exit("usage: cli-inventory.py <bk-binary> [routes.json]\n"
             "  build one first: cd cli && go build -o /tmp/bk-inv ./cmd/bk")
ENV = dict(os.environ, BK_CONFIG_DIR="/tmp/bk-audit", NO_COLOR="1")

def help_of(path):
    r = subprocess.run([BIN] + path + ["--help"], capture_output=True, text=True, env=ENV)
    return r.stdout + r.stderr

def parse_children(txt):
    """Return list of (name, short) under Available Commands:."""
    out = []
    lines = txt.splitlines()
    try:
        i = next(i for i, l in enumerate(lines) if l.strip() in ("Available Commands:",))
    except StopIteration:
        return out
    for l in lines[i+1:]:
        if not l.strip():
            break
        m = re.match(r"^\s{2,}(\S+)\s*(.*)$", l)
        if m:
            out.append((m.group(1), m.group(2).strip()))
    return out

SKIP = {"help", "completion"}

leaves = []
groups = []

def walk(path, short):
    txt = help_of(path)
    kids = [(n, s) for n, s in parse_children(txt) if n not in SKIP]
    if kids:
        groups.append({"path": path, "short": short, "children": [k for k, _ in kids]})
        for n, s in kids:
            walk(path + [n], s)
    else:
        leaves.append({"path": path, "short": short, "help": txt})

for n, s in parse_children(help_of([])):
    if n in SKIP:
        continue
    walk([n], s)


# --- join with the routes each command CLAIMS -------------------------------
# `--help` never prints the `routes` annotation, so the second half of every row
# comes from cli/routes.json (regenerate it with `cd cli && make routes`). A
# command with no entry there is correct for the identity verbs, which make no
# HTTP call; routes_test.go is what stops it meaning "somebody forgot".
claims = {}
try:
    for r in json.load(open(ROUTES_JSON))["routes"]:
        claims.setdefault(r["command"], []).append(f'{r["method"]} {r["path"]}')
except FileNotFoundError:
    sys.stderr.write(f"warning: {ROUTES_JSON} not found — the Routes column will be empty\n")

def tier(path):
    """BARE = your account and this binary. Everything else names its app."""
    return "bare" if path[0] not in APPS else path[0]

APPS = {"issues", "sales", "scaffold"}
buckets = {}
for lf in leaves:
    buckets.setdefault(tier(lf["path"]), []).append(lf)

def table(rows):
    out = ["| Command | What it does | Routes it claims |", "|---|---|---|"]
    for lf in sorted(rows, key=lambda x: x["path"]):
        spelling = "bk " + " ".join(lf["path"])
        short = (lf["short"] or "").replace("|", "\\|").strip()
        rt = ", ".join(sorted(claims.get(spelling, []))) or "—"
        out.append(f"| `{spelling}` | {short} | {rt} |")
    return "\n".join(out)

print("### Tier 1 — BARE (your account and this binary)\n")
print(table(buckets.get("bare", [])))
for app in sorted(k for k in buckets if k != "bare"):
    print(f"\n### Tier 2 — `bk {app} …` (this app's data)\n")
    print(table(buckets[app]))
sys.stderr.write(f"leaves={len(leaves)} groups={len(groups)}\n")
