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
    """Return list of (name, short) under Available Commands:.

    THE HEADING CARRIES A COUNT SINCE 2026-08-12 — `Available Commands (17):` —
    and this matched the bare string, so it found nothing under every group and
    the script emitted two empty tables while exiting 0. Regenerating
    docs/cli-inventory.md, which is what its own header tells you to do, would
    have replaced a 206-command inventory with nothing.

    CLAUDE.md finding #10's mechanism: adding the count was correct, and it
    silently retargeted a reader nothing held to it. The `leaves == 0` check at
    the bottom of this file is the guard that makes the next one loud.
    """
    out = []
    lines = txt.splitlines()
    try:
        i = next(i for i, l in enumerate(lines)
                 if re.match(r"^Available Commands(\s*\(\d+\))?:$", l.strip()))
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
        # `command` is a comma-separated LIST since 2026-08-12: several commands
        # legitimately claim one route (`issue view` and `issue attachments` both
        # read the attachments route), and keeping only one meant the others
        # showed "—" here, i.e. "makes no HTTP call", which is a different and
        # false statement. Split it, or this column under-reports again.
        for cmd in (c.strip() for c in r["command"].split(",")):
            if cmd:
                claims.setdefault(cmd, []).append(f'{r["method"]} {r["path"]}')
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

# ASSERT THE INPUT, BEFORE WRITING ANYTHING.
#
# This script's output is redirected straight over docs/cli-inventory.md by the
# command in that file's own header. A walk that found nothing produced two
# empty tables and exited 0, so the redirect destroyed the artefact and reported
# success — the failure mode CLAUDE.md findings #7 and #15 are about, in a doc
# generator. There is no threshold to tune here: zero leaves is never a real
# answer for a binary with a command tree.
if not leaves:
    sys.exit(
        f"cli-inventory: walked {len(groups)} group(s) and found NO leaf commands.\n"
        f"  The binary at {BIN} either has no commands, or `parse_children` no longer\n"
        f"  matches its `--help` output (the 'Available Commands:' heading changed once\n"
        f"  already, on 2026-08-12, and this exit exists because of it).\n"
        f"  Nothing was written — do NOT redirect this over docs/cli-inventory.md."
    )

print("### Tier 1 — BARE (your account and this binary)\n")
print(table(buckets.get("bare", [])))
for app in sorted(k for k in buckets if k != "bare"):
    print(f"\n### Tier 2 — `bk {app} …` (this app's data)\n")
    print(table(buckets[app]))
sys.stderr.write(f"leaves={len(leaves)} groups={len(groups)}\n")
