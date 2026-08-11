package commands

import (
	"sort"

	"github.com/spf13/cobra"
)

// ---------------------------------------------------------------------------
// WHY: THIS BINARY HAS NEVER HAD ONE VERB VOCABULARY, AND A GUESS DEAD-ENDED
// ---------------------------------------------------------------------------
// `bk issues issue view` and `bk sales prospect show` are the same operation.
// So are `bk issues project delete` and `bk sales doc rm`, and `bk issues task
// create` and `bk sales contact add`. Report 1 (2026-08-11) framed this as a
// split BETWEEN the two apps, and that is the visible half. Walking the built
// tree shows the sharper version: each app disagrees with ITSELF, and so does
// the shared layer both of them mount.
//
//	issues   issue view      task view      project view   …but workspace show, storage rm
//	sales    prospect show   product show   doc show       …but label view, prospect create
//	appverbs label view      workspace show invite show    — three verbs, two spellings
//
// So there is no app whose vocabulary a caller could learn and then apply. This
// is feedback item 2 in `Todo/issues-app-feedback.md`: an agent tried `get`,
// then `show`, before `view`, and paid a round trip for each.
//
// ---------------------------------------------------------------------------
// WHY ALIASES AND NOT A RENAME
// ---------------------------------------------------------------------------
// Unifying the spellings is the tidier answer and it is NOT taken here, for two
// reasons. It renames roughly forty live commands across two deployed apps,
// which is a deprecations.go row each and a guide/doc sweep — a product
// decision with a real migration cost, not a cleanup. And it does not actually
// solve the reported problem: whichever set won, an agent that learned the
// other would still dead-end, which is what a caller is doing when they type
// `get`. A rename moves the confusion; a landing pad removes it.
//
// This is NOT the `aliases.go` deleted on 2026-08-11. That file built a SECOND
// COMMAND TREE at the root, letting `bk issue …` bypass the app tier — the
// tier accident 2.0.0 exists to remove, which is why `alias_removal_test.go`
// asserts those spellings stay dead. These are cobra `Aliases` on the leaf
// itself: one command, extra spellings, and the tier is still mandatory.
// `bk issue view` remains an error with a deprecation hint. Only
// `bk issues issue show` starts working.
//
// ---------------------------------------------------------------------------
// CANONICAL SPELLING IS UNCHANGED, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------
// Cobra lists a command in its group's help under its NAME, never its aliases,
// so `bk sales prospect --help` still teaches exactly one spelling and the docs
// and guide stay true. An alias is a landing pad for a guess, not a second
// documented way to do the job. `bk <app> <group> <verb> --help` shows the
// aliases on their own line for anyone who wants them.
//
// Applied by walking the tree, like rejectUnknownSubcommands above it, so a
// command added later is covered without anyone opting in.

// verbSynonyms maps a leaf verb to the spellings that mean the same operation.
//
// Every entry is a spelling that EXISTS somewhere in this binary as the real
// name of that operation (`show`/`view`, `create`/`add`, `delete`/`rm`,
// `remove`), plus the three an agent demonstrably reaches for first: `get`,
// `update` and `ls`. It is deliberately small. A synonym table that tries to
// cover every English verb starts resolving things the caller did not mean,
// and a WRONG resolution is far worse than an unknown-command error — the
// error is recoverable in-run, a wrong write is not.
//
// Nothing destructive is reachable by a guess that was not already a delete:
// `rm`, `delete` and `remove` alias only each other.
var verbSynonyms = map[string][]string{
	"view":   {"show", "get"},
	"show":   {"view", "get"},
	"list":   {"ls"},
	"create": {"add", "new"},
	"add":    {"create", "new"},
	"delete": {"rm", "remove"},
	"rm":     {"delete", "remove"},
	"remove": {"delete", "rm"},
	"edit":   {"update"},
}

// attachVerbSynonyms walks the tree and gives every leaf the alternative
// spellings of its own verb, skipping any that would collide.
//
// COLLISION IS THE WHOLE RISK, and it is resolved in favour of the command that
// OWNS the name. Within one group, a name already taken by a sibling — as a
// name or as an alias assigned earlier in this walk — is never reassigned.
// `bk sales meeting` has both `rm` and `show`, so `rm` keeps meaning `rm`;
// `bk issues workspace` has `show` and `create`, and `show` never becomes an
// alias of something else. Without this, an alias could shadow a real command
// and silently run the wrong one, which is the failure mode that makes this
// whole file more dangerous than the problem it solves.
//
// Siblings are visited in a sorted, deterministic order so the resolution of
// any remaining contest is stable across builds rather than dependent on
// registration order.
func attachVerbSynonyms(cmd *cobra.Command) {
	subs := cmd.Commands()
	if len(subs) > 0 {
		// taken: every name and alias already spoken for in THIS group.
		taken := map[string]bool{}
		for _, sub := range subs {
			taken[sub.Name()] = true
			for _, a := range sub.Aliases {
				taken[a] = true
			}
		}

		ordered := append([]*cobra.Command(nil), subs...)
		sort.Slice(ordered, func(i, j int) bool { return ordered[i].Name() < ordered[j].Name() })

		for _, sub := range ordered {
			for _, alias := range verbSynonyms[sub.Name()] {
				if taken[alias] {
					continue
				}
				taken[alias] = true
				sub.Aliases = append(sub.Aliases, alias)
			}
		}
	}

	for _, sub := range subs {
		attachVerbSynonyms(sub)
	}
}
