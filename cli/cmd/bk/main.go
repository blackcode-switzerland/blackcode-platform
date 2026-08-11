package main

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/platform"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
)

// Exit codes are stable so LLMs / scripts can branch on outcome:
//
//	0  ok
//	1  generic / runtime error
//	2  bad usage (cobra arg/flag errors)
//	3  not authenticated (401, or no config)
//	4  permission denied (403)
//	5  not found (404)
//	6  validation error (400)
//	   NOTE 409 (conflict) exits 2, not 6 — see classify(). It is the same
//	   condition the binary's own --confirm pre-checks catch, and those exit 2.
//	7  user aborted (declined a confirm prompt)
//	8  client too old; upgrade required (below API min version)
//	9  update available (bk skill check / sync found a newer binary)
const (
	exitOK          = 0
	exitGeneric     = 1
	exitUsage       = 2
	exitAuth        = 3
	exitPermission  = 4
	exitNotFound    = 5
	exitValidation  = 6
	exitAborted     = 7
	exitOutdated    = 8
	exitUpdateAvail = 9
)

func main() {
	// ExecuteC, not Execute, for the second return value: the command cobra
	// actually resolved. An `unknown flag` error names no command anywhere in its
	// text, so hintFor() could only ever offer a placeholder — and the version
	// that shipped offered a LITERAL one, printing "run `bk <group> --help`" with
	// `<group>` never substituted. A recovery step the caller cannot execute is
	// the failure hintFor exists to prevent, so the path comes from cobra here
	// instead of being guessed from the message.
	resolved, err := commands.NewRoot().ExecuteC()
	commandPath := ""
	if resolved != nil {
		commandPath = resolved.CommandPath()
	}

	// Hard floor: the API reported we're below the minimum supported version.
	// Print the upgrade requirement and exit with a distinct code.
	var oe *client.OutdatedError
	if errors.As(err, &oe) {
		// Name the whole recovery, not just the upgrade: an agent blocked here
		// also has a stale skill, and refreshing it is what stops this recurring.
		fmt.Fprintf(os.Stderr,
			"This bk (%s) is no longer supported. Update and refresh your agent skill:\n"+
				"  npm install -g @blackcode_sa/bc-issues@latest\n"+
				"  bk skill install\n"+
				"  bk guide\n",
			oe.Current)
		os.Exit(exitOutdated)
	}

	// `bk skill check` / `bk skill sync` signal "a newer binary exists" with a
	// distinct exit code so an agent can branch on it without parsing stderr.
	var ue *platform.UpdateAvailableError
	if errors.As(err, &ue) {
		fmt.Fprintln(os.Stderr, ue.Error())
		os.Exit(exitUpdateAvail)
	}

	// On success or any other error, print the throttled soft update notice
	// before doing the normal error/exit handling.
	maybeNotifyUpdate()

	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		// A one-line breadcrumb, but only at the moments an agent is actually
		// stuck (auth, drift-smelling 4xx, a command/flag that no longer exists).
		// stderr only, so --json stdout stays clean.
		if h := hintFor(err, commandPath); h != "" {
			fmt.Fprintln(os.Stderr, "hint:", h)
		}
		os.Exit(classify(err))
	}
}

// hintFor returns a short recovery breadcrumb for the failure at hand, or "" when
// a hint would just be noise (e.g. a plain permission denial). The goal is a
// self-service loop: hit a wall -> follow the breadcrumb -> `bk changelog` /
// /agent-updator -> get current -> retry.
func hintFor(err error, commandPath string) string {
	if errors.Is(err, config.ErrNotConfigured) {
		return "run `bk login` to authenticate. New here? run `bk guide`"
	}
	// The registry has no address for the app this command must reach. The fix is
	// one command, and naming it is the difference between an agent recovering
	// inside this run and an agent stopping.
	var uae *cmdutil.UnknownAppError
	if errors.As(err, &uae) {
		return "run `bk meta` to learn each app's server from the platform, `bk app list` to see " +
			"what your config has now, or `bk login --server <url>` to point at a deployment directly"
	}

	// A known address that nothing answered at. The registry is learned, so the
	// entry itself may be what is wrong — and that is not something the caller can
	// guess from "connection refused". This has to come BEFORE the APIError branch
	// for the same reason it is its own type: it is not an answer from a server.
	// This host has no route there. Not a bug and not a bad request: an app
	// serving a SUBSET of the platform surface is a permanent, legitimate state
	// (D-36), so the recovery is a flag rather than a fix.
	//
	// Before NotServedError existed this arrived as thirty lines of HTML on
	// stderr — the framework's 404 page, pasted in as the error message. An agent
	// could not tell it from a crash, and there was nothing in it to act on.
	var nse *client.NotServedError
	if errors.As(err, &nse) {
		if nse.App == "" {
			return "another app's deployment may serve it — `bk app list` shows every app's " +
				"server, and `bk --app-server <slug> …` sends one command there"
		}
		// THE ALTERNATIVES COME FROM THE REGISTRY, NEVER FROM A HARDCODED PAIR.
		//
		// This used to read `other := "issues"; if nse.App == "issues" { other =
		// "sales" }` — the platform binary naming two apps, which is wrong twice
		// over. It breaks the moment app #3 exists, and it was ALREADY breaking:
		// agent 4 measured that `/api/meta`'s app block is grant-derived, so a
		// user who only has sales has no `issues` entry, and the suggested
		// recovery answers "no server known for app issues". A hint that names a
		// door the caller cannot open is worse than one that admits there is no
		// door — the agent burns a retry and learns nothing.
		//
		// So the suggestion is drawn from the apps this config actually knows,
		// and when there are none the hint says so and stops.
		others := otherKnownApps(nse.App)
		if len(others) == 0 {
			return fmt.Sprintf(
				"the %s deployment does not serve that route, and your account reaches no other "+
					"app that might — this capability is not available to you. `bk %s --help` "+
					"lists what this app does offer",
				nse.App, nse.App)
		}
		return fmt.Sprintf(
			"the %s deployment serves only part of the platform surface. Try "+
				"`bk --app-server %s …` for this one command, `bk app use <slug>` to move the "+
				"bare verbs for good, or `bk app list` to see every app's server",
			nse.App, strings.Join(others, "` or `bk --app-server "))
	}

	var ue *client.UnreachableError
	if errors.As(err, &ue) {
		if ue.App != "" {
			return fmt.Sprintf(
				"that address came from your app registry — run `bk meta` to refresh it, "+
					"`bk app list` to see every app's server, or `bk login --server <url>` if the %s app moved",
				ue.App)
		}
		return "check the server is up and the address is right — `bk app list` shows what your config has, " +
			"`bk meta` refreshes it, `bk login --server <url>` replaces it"
	}

	var ae *client.APIError
	if errors.As(err, &ae) {
		// The server can name the fix itself — lib/api's Errors carry an optional
		// `suggestion`. When it does, that beats any guess we could make here.
		if s := strings.TrimSpace(ae.Suggestion); s != "" {
			return s
		}
		switch ae.Status {
		case 401:
			return "not authenticated — run `bk login`. New here? run `bk guide`"
		case 400, 404, 422:
			// The strongest drift signals: a shape or resource that used to work.
			return "if this used to work, the surface may have changed — run `bk skill sync`, then `bk guide` for current usage"
		case 410:
			return "that interface has been retired — run `bk guide` for the current way to do this"
		}
		return ""
	}

	msg := err.Error()
	if strings.Contains(msg, "unknown flag") ||
		strings.Contains(msg, "unknown command") ||
		strings.Contains(msg, "unknown shorthand") {
		// A named rename/removal beats the generic advice: it tells the agent the
		// new spelling, so it can retry inside the same run.
		if note := commands.DeprecationHint(msg); note != "" {
			return note +
				"\n      Run `bk guide` for current usage, or `bk skill sync` to update your agent skill."
		}
		// NAME THE REAL GROUP. This used to print a literal `bk <group> --help`,
		// with `<group>` never substituted — a hint whose recovery step the caller
		// cannot execute, which is the thing hintFor() exists to avoid. Cobra's
		// message carries the path (`unknown command "x" for "bk sales prospect"`),
		// so the placeholder was never necessary. Falls back to the unsubstituted
		// wording only when the path is genuinely unknowable — an `unknown flag`
		// error names no command.
		// Two sources, most specific first. The error text carries the path for an
		// unknown COMMAND (`… for "bk sales prospect"`); cobra's resolved command
		// carries it for an unknown FLAG, where the message names nothing at all.
		group := groupFromUsageError(msg)
		if group == "" {
			group = commandPath
		}
		if group != "" && group != "bk" {
			return fmt.Sprintf(
				"that command or flag may have been renamed or removed — run `%s --help` to see the current ones, "+
					"`bk guide` for usage, or `bk skill sync` to update your agent skill", group)
		}
		return "that command or flag may have been renamed or removed — run `bk --help` to see the current ones, `bk guide` for usage, or `bk skill sync` to update your agent skill"
	}
	return ""
}

// usageGroupRe pulls the command path out of cobra's unknown-command error:
// `unknown command "view" for "bk sales prospect"` → `bk sales prospect`.
// It is the same shape deprecations.go's cmdRe reads; this one wants the second
// capture rather than the first, and tolerates the `(have: …)` list that
// rejectUnknownSubcommands appends after it.
var usageGroupRe = regexp.MustCompile(`unknown command "[^"]*" for "([^"]+)"`)

func groupFromUsageError(msg string) string {
	m := usageGroupRe.FindStringSubmatch(msg)
	if m == nil {
		return ""
	}
	// The bare root is not a useful thing to point at: `bk --help` is where the
	// caller already is, and the deprecation rows handle the tier mistakes that
	// actually produce it.
	if strings.TrimSpace(m[1]) == "bk" {
		return ""
	}
	return m[1]
}

// maybeNotifyUpdate prints a once-per-24h "update available" notice to STDERR
// when the running version is older than the latest version the API reported.
// It writes only to stderr so it never corrupts --json output on stdout.
func maybeNotifyUpdate() {
	if !version.Parsable(version.Version) || client.LatestSeen == "" {
		return
	}
	if !version.Less(version.Version, client.LatestSeen) {
		return
	}

	cfg, err := config.Load()
	if err != nil {
		return
	}
	now := time.Now().Unix()
	if now-cfg.LastUpdateCheck < 86400 {
		return
	}

	// Name the fix, not just the fact. `bk skill sync` is the single command an
	// agent is ever told to run: it reports the upgrade command when the binary
	// is behind, and refreshes the installed skill when it isn't.
	fmt.Fprintf(os.Stderr,
		"bk %s is behind %s — run: bk skill sync\n",
		version.Version, client.LatestSeen)

	cfg.LastUpdateCheck = now
	_ = config.Save(cfg) // best-effort; ignore save errors
}

func classify(err error) int {
	if err == nil {
		return exitOK
	}
	if errors.Is(err, config.ErrNotConfigured) {
		return exitAuth
	}
	// A route this deployment does not serve exits like any other 404. The
	// resource genuinely is not there — the hint is what distinguishes "not on
	// THIS host" from "not anywhere", and a separate exit code would make every
	// existing script that checks for 5 stop recognising it.
	var nse *client.NotServedError
	if errors.As(err, &nse) {
		if nse.Status == 404 {
			return exitNotFound
		}
		return exitGeneric
	}

	var ae *client.APIError
	if errors.As(err, &ae) {
		switch ae.Status {
		case 400, 422:
			return exitValidation
		case 401:
			return exitAuth
		case 403:
			return exitPermission
		case 404:
			return exitNotFound
		case 409:
			// ── ONE CONDITION MUST NOT HAVE TWO EXIT CODES ────────────────────
			// A 409 is the server refusing a well-formed request on content
			// grounds: `--confirm` naming the wrong record, a label name already
			// taken, an invitation already accepted. Until 2026-08-07 it had no
			// branch here and fell through to 1 (generic), which told an agent
			// nothing and — worse — disagreed with the binary itself.
			//
			// `bk sales prospect delete` pre-checks `--confirm` locally and
			// returns an error worded to contain "required", which the switch
			// below maps to 2. So the SAME user mistake exited 2 when the binary
			// caught it and 1 when the server did, depending only on a race the
			// caller cannot see. An agent branching on the exit code cannot write
			// one recovery for that.
			//
			// 2 rather than 6, because 2 is what every local guard for these
			// conditions already returns and changing those would break scripts
			// that check for it. The general rule this is an instance of: **a
			// pre-check in the binary must exit the same code the server would.**
			return exitUsage
		}
		return exitGeneric
	}
	msg := err.Error()
	switch {
	case strings.HasPrefix(msg, "aborted"):
		return exitAborted
	case strings.Contains(msg, "required") || strings.HasPrefix(msg, "invalid "),
		// `bk guide pitfalls` once two sections define it: the caller named a
		// real topic imprecisely, which is bad usage (2), not a runtime fault (1).
		strings.HasPrefix(msg, "ambiguous "),
		strings.Contains(msg, "unknown flag"),
		strings.Contains(msg, "unknown command"),
		strings.Contains(msg, "unknown shorthand"),
		// Cobra's arg-count errors: "accepts 1 arg(s), received 0",
		// "requires at least 1 arg(s)", "accepts between 1 and 2 arg(s)".
		// These are bad usage, and the documented table above promises 2 for
		// "cobra arg/flag errors" — they were returning 1.
		strings.Contains(msg, "arg(s)"):
		return exitUsage
	}
	return exitGeneric
}

// otherKnownApps returns the apps this config has a server for, excluding the
// one that just refused. Sorted, so the hint is stable between runs.
//
// Best-effort: an unreadable config yields no suggestions rather than an error,
// because this is running inside the error path already. Empty is a legitimate
// and INFORMATIVE answer — see the NotServedError branch in hintFor().
func otherKnownApps(exclude string) []string {
	cfg, err := config.Load()
	if err != nil {
		return nil
	}
	var out []string
	for slug := range cfg.AppServers {
		if slug != exclude {
			out = append(out, slug)
		}
	}
	sort.Strings(out)
	return out
}
