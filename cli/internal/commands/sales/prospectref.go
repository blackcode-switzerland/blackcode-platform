package sales

import (
	"fmt"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/spf13/cobra"
)

// "Which prospect?" — accepted in BOTH shapes, everywhere.
//
// ---------------------------------------------------------------------------
// WHY, AND WHAT IS NOT CHANGING
// ---------------------------------------------------------------------------
// This app grew two conventions for naming the prospect a command acts on:
//
//	positional   bk sales contact add 8 --name …      bk sales objection counter 8 3 …
//	flag         bk sales comm log --prospect 8 …     bk sales meeting schedule --prospect 8 …
//
// Both are reasonable and neither is wrong; what is wrong is that a caller who
// learned one family gets a dead end in the next. An agent that had just logged
// a communication typed `bk sales objection counter 1 --prospect 8` and paid a
// round trip to be told `--prospect` is not a flag there.
//
// So both shapes now resolve, and NOTHING IS RENAMED: every spelling that
// worked before still works, and the canonical one — the one in `Use` and
// therefore in `--help` — is unchanged. This is the reasoning behind the verb
// aliases in 9d568c1: a wrong guess should resolve, not dead-end.
//
// WHERE THEY DISAGREE, IT IS AN ERROR. `bk sales objection counter 8 3 --prospect 9`
// names two different prospects, and there is no reading of it that is
// obviously right — silently preferring one would act on a record the caller
// did not name, which is the failure this whole file exists to avoid.

// addProspectFlag registers the alternative spelling on a command whose
// canonical shape is positional. One helper, so the twelve commands that accept
// it describe it identically.
func addProspectFlag(cmd *cobra.Command, target *int) {
	cmd.Flags().IntVar(target, "prospect", 0,
		"The prospect's #number (an alternative to giving it as the first argument)")
}

// resolveProspect answers "which prospect?" and returns the remaining
// arguments.
//
// `tailCount` is how many arguments the command takes AFTER the prospect — 0
// for `contact add <prospect>`, 1 for `objection counter <prospect> <id>` and
// for `prospect stage <prospect> <stage>`. It is what makes the leading
// positional optional without the two shapes becoming ambiguous: with N+1
// arguments the first is the prospect, with N it must come from `--prospect`.
//
// Callers pair it with `Args: cobra.RangeArgs(tailCount, tailCount+1)`, so a
// wrong COUNT is refused by cobra before this runs and the errors below are
// only about which prospect was named.
func resolveProspect(cmd *cobra.Command, args []string, flagValue, tailCount int) (int, []string, error) {
	fromFlag := cmd.Flags().Changed("prospect")

	positional := ""
	tail := args
	switch len(args) {
	case tailCount + 1:
		positional, tail = args[0], args[1:]
	case tailCount:
		// The prospect has to come from the flag.
	default:
		// Unreachable behind RangeArgs, kept so a caller that forgets the
		// validator fails loudly instead of indexing past the slice.
		return 0, nil, cmdutil.Usagef("wrong number of arguments — %s", cmd.UseLine())
	}

	if positional == "" && !fromFlag {
		return 0, nil, cmdutil.Usagef(
			"which prospect? give its #number first (%s), or pass --prospect <n>", cmd.UseLine())
	}

	if positional == "" {
		if flagValue <= 0 {
			return 0, nil, cmdutil.Usagef(
				"invalid prospect #number %d for --prospect — run `bk sales prospect list` to see them", flagValue)
		}
		return flagValue, tail, nil
	}

	n, err := prospectNumber(positional)
	if err != nil {
		return 0, nil, err
	}
	if fromFlag && flagValue != n {
		// Both values named, so both are in the message: an agent that built one
		// of them from a variable needs to know WHICH one it got wrong.
		// Exit 2, like every other "you typed this wrong": an agent branching on
		// the code must not see a usage mistake as a runtime fault.
		return 0, nil, cmdutil.Usagef(
			"two different prospects: the argument says #%d and --prospect says #%d "+
				"— pass one, not both; nothing was changed", n, flagValue)
	}
	return n, tail, nil
}

// prospectLabel names a prospect for a confirmation line: `#8 (Roches SA)`.
//
// ---------------------------------------------------------------------------
// WHY A SECOND REQUEST IS WORTH IT, AND WHY IT CANNOT FAIL THE COMMAND
// ---------------------------------------------------------------------------
// `added contact 1 to prospect #2` is the whole of what these commands echo, and
// a caller working through ten prospects loses which id was which company inside
// a minute. The write has ALREADY SUCCEEDED by the time this runs, so a failure
// to look the name up must not turn a successful write into an error — it falls
// back to the bare `#n`, which is what the line said before.
//
// It is called from inside the human renderer, so `--json` pays nothing for it
// and its payload is unchanged.
func prospectLabel(c *client.Client, ws string, n int) string {
	p, err := c.GetProspect(ws, n)
	if err != nil || p == nil || strings.TrimSpace(p.Name) == "" {
		return fmt.Sprintf("#%d", n)
	}
	return fmt.Sprintf("#%d (%s)", n, p.Name)
}
