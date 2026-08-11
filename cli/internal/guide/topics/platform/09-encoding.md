# Text encoding (UTF-8)

**All text in and out is UTF-8.** `bk` reads bodies as raw bytes and passes them
through unchanged — it does not transcode. So corruption, when it happens, is
your environment's doing, not the CLI's or the database's.

## The failure: mojibake

Correct UTF-8 gets re-decoded as a legacy single-byte code page. Non-ASCII
characters turn to garbage; plain ASCII survives, which is what makes it easy to
miss.

| You typed | What gets stored | Cause |
|---|---|---|
| `présentation` | `prÃ©sentation` | `é` (UTF-8 `C3 A9`) read as Latin-1 |
| `stratégie — déploiement` | `stratÃ©gie ΓÇö dÃ©ploiement` | `—` (UTF-8 `E2 80 94`) read as CP437/CP850 |

The usual culprit is a **Windows console** whose active code page isn't UTF-8.
It hits hardest during a bulk import/export/move, where one bad run corrupts
many rows at once.

## How to avoid it

**Windows PowerShell / cmd** — before invoking `bk` in a pipeline:

```powershell
chcp 65001
[Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
```

For a Python wrapper, set `PYTHONUTF8=1`.

**macOS / Linux** — UTF-8 by default; just make sure `LANG` ends in `.UTF-8`.

**Everywhere — the real fix:** don't round-trip text through a terminal at all.

- Write bodies with `--description-file` / `--body-file`, not shell strings.
- Relocate items with `bk issues move` / `bk issues copy`, never by reading them out and
  re-creating them.
- Never re-feed a decoded string: reading with `--json`, mangling it in a
  non-UTF-8 shell, and writing it back is how corruption spreads.

## Repairing damage you already have

It is deterministic and reversible — re-encode the visible string to the wrong
code page's bytes and decode as UTF-8:

```python
s.encode("cp437").decode("utf-8")     # fall back to cp850, then latin1
```

Fix in place with `bk issues issue edit` / `bk issues project edit`, and only touch the rows
the bad run actually corrupted.

Related commands: `bk issues issue edit`, `bk issues project edit`, `bk issues move`, `bk issues copy`
