package sales

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk sales prospect` — the core noun. A prospect IS the deal (D-5): the
// company, its pipeline stage, its value, its owner and what we owe it next, in
// one addressable row.
//
// ---------------------------------------------------------------------------
// WHAT THESE COMMANDS DELIBERATELY DO NOT DO
// ---------------------------------------------------------------------------
// They never name a stage, a next-action type or a limit in their help text.
// Those are DYNAMIC values served by `bk meta`: they change without a release of
// this binary, and a help string that listed them would be confidently wrong the
// first time one changed, with nothing to say so. Every message that needs one
// points at `bk meta` instead — which is the same rule the embedded guide lives
// under, applied to `--help`.

func newProspectCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "prospect",
		Short: "Prospects — a company and its deal, in one record",
	}
	cmd.AddCommand(
		newProspectListCmd(),
		newProspectShowCmd(),
		newProspectCreateCmd(),
		newProspectEditCmd(),
		newProspectAssignCmd(),
		newProspectStageCmd(),
		newProspectNextCmd(),
		newProspectNoteCmd(),
		newProspectDeleteCmd(),
	)
	return cmd
}

func newProspectListCmd() *cobra.Command {
	var (
		stages         []string
		owner          string
		label          string
		query          string
		limit          int
		cursor         int
		includeDeleted bool
	)
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects"},
		Short:       "List prospects in the active workspace",
		Long: `List prospects, most recently touched first.

--q is a SUBSTRING match on the COMPANY NAME — a filter on this listing, not a
search. Finding a phrase INSIDE a record is a different thing: "bk sales search"
reads the text columns and returns the snippet that matched.

--owner takes an email, or the literal "me".
--stage may be repeated or comma-separated; run "bk meta" for the current values.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			page, err := c.ListProspects(ws, client.ListProspectsOpts{
				Stages:         splitAll(stages),
				Owner:          owner,
				Label:          label,
				Query:          query,
				Limit:          limit,
				Cursor:         cursor,
				IncludeDeleted: includeDeleted,
			})
			if err != nil {
				return err
			}
			return output.Render(format, page, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tCOMPANY\tSTAGE\tVALUE\tOWNER\tNEXT\tUPDATED")
				for _, p := range page.Data {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",
						p.Number,
						cmdutil.Truncate(p.Name, 28),
						p.Stage,
						money(p.Value, p.Currency),
						ownerName(p.Owner),
						nextActionCell(p.NextAction),
						dateOnly(p.UpdatedAt),
					)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(page.Data) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no prospects)")
				}
				if page.NextCursor != nil {
					fmt.Fprintf(cmd.ErrOrStderr(),
						"more results: --cursor %d\n", *page.NextCursor)
				}
				return nil
			})
		},
	}
	cmd.Flags().StringSliceVar(&stages, "stage", nil, "Filter by pipeline stage — "+vocab("stages", "repeatable"))
	cmd.Flags().StringVar(&owner, "owner", "", "Filter by deal owner: an email, or \"me\"")
	cmd.Flags().StringVar(&label, "label", "", "Filter by label name")
	cmd.Flags().StringVar(&query, "q", "", "Substring match on the company name")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max prospects to return (bk meta for the cap)")
	cmd.Flags().IntVar(&cursor, "cursor", 0, "Continue from the cursor printed by the previous page")
	cmd.Flags().BoolVar(&includeDeleted, "include-deleted", false, "Include prospects that are in the recycle bin")
	return cmd
}

func newProspectShowCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "show <n>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}"},
		Short:       "Show one prospect, its deal journey and its URN",
		Long: `Show one prospect by #number.

The output includes the DEAL JOURNEY — one row per stage, including the steps
not reached yet — and the prospect's URN, which is how you refer to it from
another app: paste it into the other record's own text. There is no cross-app
link table and no command that records one; see "bk guide sales/cross-app".`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := prospectNumber(args[0])
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.GetProspect(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				return renderProspect(w, p)
			})
		},
	}
	return cmd
}

func newProspectCreateCmd() *cobra.Command {
	var req client.CreateProspectRequest
	cmd := &cobra.Command{
		Use:         "create --name <company>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/prospects"},
		Short:       "Create a prospect",
		Long: `Create a prospect — a company and its deal in one record.

--stage defaults to the first stage of the pipeline; run "bk meta" for the
current values. --value is a plain amount ("24000"), never a formatted one, and
--currency is separate. --owner is an email or "me"; it is a real person, because
an agent can log a call and write history but cannot own a deal.

The opening journey step is written for you, attributed to whoever ran this.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.CreateProspect(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "created prospect #%d: %s\n%s\n", p.Number, p.Name, p.URN)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Name, "name", "", "Company name (required)")
	cmd.Flags().StringVar(&req.City, "city", "", "City")
	cmd.Flags().StringVar(&req.Sector, "sector", "", "Sector, free text (\"SaaS · staffing\")")
	cmd.Flags().StringVar(&req.Website, "website", "", "The COMPANY's site, full url including https://")
	cmd.Flags().StringVar(&req.Address, "address", "", "Postal address, one line")
	cmd.Flags().IntVar(&req.Strategy, "strategy", 0, "The segment strategy's #number (bk sales strategy list)")
	cmd.Flags().StringVar(&req.GamePlan, "game-plan", "", "The PRE-meeting angle for this prospect: talking points, upsell, objections to expect")
	cmd.Flags().StringVar(&req.Stage, "stage", "", "Pipeline stage — "+vocab("stages", "default: the first"))
	cmd.Flags().StringVar(&req.Value, "value", "", "Deal value, a plain amount (\"24000\")")
	cmd.Flags().StringVar(&req.Currency, "currency", "", "ISO currency code (default CHF)")
	cmd.Flags().StringVar(&req.Owner, "owner", "", "Deal owner: an email, or \"me\"")
	cmd.Flags().StringVar(&req.Source, "source", "", "How we found them (\"referral\", \"word of mouth\")")
	cmd.Flags().StringVar(&req.Summary, "summary", "", "Where this deal stands, in prose")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newProspectEditCmd() *cobra.Command {
	var name, city, sector, website, address, value, currency, owner, source, summary string
	var strategy, gamePlan string
	cmd := &cobra.Command{
		Use:         "edit <n>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/prospects/{n}"},
		Short:       "Edit a prospect's details, or reassign it",
		Long: `Edit a prospect. Only the flags you pass are changed.

PASSING AN EMPTY VALUE CLEARS THE FIELD: --city "" removes the city, and
--owner "" unassigns the deal. Not passing the flag leaves it alone. The three
states are distinct on the wire, so "did nothing" and "cleared it" cannot be
confused.

--stage is NOT here. Moving a deal writes a journey entry and may close it, so it
is its own command: "bk sales prospect stage <n> <stage>".`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := prospectNumber(args[0])
			if err != nil {
				return err
			}
			// `Changed` is what makes "cleared" expressible: cobra reports a flag
			// that was passed as "" as changed, and only that path sends a JSON
			// null. Reading the value alone would make "" indistinguishable from
			// "not passed".
			req := client.UpdateProspectRequest{
				Name:     patched(cmd, "name", name),
				City:     patched(cmd, "city", city),
				Sector:   patched(cmd, "sector", sector),
				Website:  patched(cmd, "website", website),
				Address:  patched(cmd, "address", address),
				Strategy: patched(cmd, "strategy", strategy),
				GamePlan: patched(cmd, "game-plan", gamePlan),
				Value:    patched(cmd, "value", value),
				Currency: patched(cmd, "currency", currency),
				Owner:    patched(cmd, "owner", owner),
				Source:   patched(cmd, "source", source),
				Summary:  patched(cmd, "summary", summary),
			}
			if isEmptyPatch(req) {
				return fmt.Errorf("nothing to change — pass at least one flag (bk sales prospect edit --help)")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.UpdateProspect(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "updated prospect #%d: %s\n", p.Number, p.Name)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Company name")
	cmd.Flags().StringVar(&city, "city", "", "City (\"\" clears)")
	cmd.Flags().StringVar(&sector, "sector", "", "Sector (\"\" clears)")
	cmd.Flags().StringVar(&website, "website", "", "The COMPANY's site, full url including https:// (\"\" clears)")
	cmd.Flags().StringVar(&address, "address", "", "Postal address, one line (\"\" clears)")
	cmd.Flags().StringVar(&strategy, "strategy", "", "The segment strategy's #number (\"\" unlinks)")
	cmd.Flags().StringVar(&gamePlan, "game-plan", "", "The PRE-meeting angle for this prospect (\"\" clears)")
	cmd.Flags().StringVar(&value, "value", "", "Deal value, a plain amount (\"\" clears)")
	cmd.Flags().StringVar(&currency, "currency", "", "ISO currency code")
	cmd.Flags().StringVar(&owner, "owner", "", "Deal owner: an email, \"me\", or \"\" to unassign")
	cmd.Flags().StringVar(&source, "source", "", "How we found them (\"\" clears)")
	cmd.Flags().StringVar(&summary, "summary", "", "Where this deal stands (\"\" clears)")
	return cmd
}

// `bk sales prospect assign` — sugar over `edit --owner`, on the same route.
//
// It exists because §6.1's command table lists it, and an agent reading that
// table will type it. A command that is in the table and not in the binary is
// exactly the dead end this project removes — and the cost of the sugar is
// twenty lines that cannot drift, because both spellings send the same PATCH.
//
// Not a second route, so parity is indifferent: `bk __routes` dedupes by
// app+method+path.
func newProspectAssignCmd() *cobra.Command {
	var owner string
	cmd := &cobra.Command{
		Use:         "assign <n> --owner <email>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/prospects/{n}"},
		Short:       "Set (or clear) a prospect's deal owner",
		Long: `Set the deal owner.

--owner takes an email or the literal "me"; "" unassigns.

The owner is always a REAL PERSON. An agent can log a call and write history —
that is what the actor label on every journey step is for — but it cannot own a
deal, and this is the one field in the app where that distinction is enforced by
the schema rather than by convention.

The same thing is spelled "bk sales prospect edit <n> --owner <email>"; this
form exists because it is the one you reach for when reassigning is the whole
intent.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := prospectNumber(args[0])
			if err != nil {
				return err
			}
			if !cmd.Flags().Changed("owner") {
				return fmt.Errorf("--owner is required — an email, \"me\", or \"\" to unassign")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.UpdateProspect(ws, n, client.UpdateProspectRequest{Owner: client.Set(owner)})
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				if p.Owner == nil {
					_, err := fmt.Fprintf(w, "prospect #%d (%s) is now unassigned\n", p.Number, p.Name)
					return err
				}
				_, err := fmt.Fprintf(w, "prospect #%d (%s) is now owned by %s\n",
					p.Number, p.Name, p.Owner.Email)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&owner, "owner", "", "Deal owner: an email, \"me\", or \"\" to unassign")
	return cmd
}

func newProspectStageCmd() *cobra.Command {
	var note, reason string
	var prospect int
	cmd := &cobra.Command{
		Use:         "stage <n> <stage>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/prospects/{n}/stage"},
		Short:       "Move a deal to another stage and record the journey step",
		Long: `Move a prospect to another pipeline stage.

This is not a field edit. It writes a step in the deal journey, attributed to
whoever ran it, and on a closing stage it also sets the close date — which is why
"bk sales prospect edit" refuses --stage.

--note is the journey step's note ("they asked for a revised quote").
--reason is the close reason, and is only read for a closing stage.

Run "bk meta" for the current stage values.

The prospect may be given as the first argument or as --prospect <n>; the stage
is positional either way.`,
		Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, tail, err := resolveProspect(cmd, args, prospect, 1)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.SetProspectStage(ws, n, client.SetProspectStageRequest{
				Stage:  strings.TrimSpace(tail[0]),
				Note:   note,
				Reason: reason,
			})
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "prospect #%d (%s) is now at stage %s\n",
					p.Number, p.Name, p.Stage)
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&note, "note", "", "What happened, recorded on the journey step")
	cmd.Flags().StringVar(&reason, "reason", "", "Close reason (only read for a closing stage)")
	return cmd
}

// newProspectNextCmd sets what we owe this prospect next.
//
// ---------------------------------------------------------------------------
// THE DATE AND THE WORDS ARE BOTH STORED
// ---------------------------------------------------------------------------
// `--due` is a RESOLVED date, because a date is what sorts, what filters, and
// what `bk sales today` reads. `--due-label` keeps the phrase you actually
// wrote, because resolving "this week" to a guessed Friday and then discarding
// the words loses the difference between "due Friday" and "sometime this week,
// Friday is my guess" — which is exactly the difference a human needs when the
// follow-up is late.
//
// Its own command rather than four flags on `edit`, because they are one
// intention: a type with no due date is half a commitment, and half of one is
// what a caller ends up with when the four are set separately.
func newProspectNextCmd() *cobra.Command {
	var actionType, due, dueLabel, note, owner string
	var clear bool
	var prospect int
	cmd := &cobra.Command{
		Use:         "next <n> --type <type> --due <YYYY-MM-DD>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/prospects/{n}/next-action"},
		Short:       "Set (or clear) what this prospect is owed next",
		Long: `Record the next action on a prospect.

--due is a REAL DATE (YYYY-MM-DD). Resolve "next Thursday" yourself before
sending it: the date is what sorts and what "bk sales today" reads.
--due-label keeps the phrase you wrote, verbatim, and is displayed in preference
to the date. It is never parsed.

--owner may be an email, "me", or any label — and unlike the DEAL owner it can be
an agent, because writing the next action is not the same as owning the deal.

--clear removes the next action entirely.

Run "bk meta" for the current next-action types.

The prospect may be given as the first argument or as --prospect <n>.`,
		Args: cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, _, err := resolveProspect(cmd, args, prospect, 0)
			if err != nil {
				return err
			}
			req := client.SetNextActionRequest{}
			if clear {
				// Clearing the type clears the rest server-side: a due date on a
				// prospect with no action is a row `today` would surface with
				// nothing to say about it.
				req.Type = client.Clear()
			} else {
				req.Type = patched(cmd, "type", actionType)
				req.Due = patched(cmd, "due", due)
				req.DueLabel = patched(cmd, "due-label", dueLabel)
				req.Note = patched(cmd, "note", note)
				req.Owner = patched(cmd, "owner", owner)
				if req.Type == nil && req.Due == nil && req.DueLabel == nil &&
					req.Note == nil && req.Owner == nil {
					return fmt.Errorf("nothing to set — pass --type/--due/--note/--owner, or --clear")
				}
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.SetNextAction(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				if p.NextAction.Type == "" {
					_, err := fmt.Fprintf(w, "prospect #%d (%s) has no next action\n", p.Number, p.Name)
					return err
				}
				_, err := fmt.Fprintf(w, "prospect #%d (%s) next: %s\n",
					p.Number, p.Name, nextActionCell(p.NextAction))
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&actionType, "type", "", "What is owed — "+vocab("next_action_types"))
	cmd.Flags().StringVar(&due, "due", "", "When, as a real date YYYY-MM-DD")
	cmd.Flags().StringVar(&dueLabel, "due-label", "", "The phrase you wrote (\"this week\") — kept verbatim")
	cmd.Flags().StringVar(&note, "note", "", "What exactly is owed")
	cmd.Flags().StringVar(&owner, "owner", "", "Who owes it: an email, \"me\", or any label")
	cmd.Flags().BoolVar(&clear, "clear", false, "Remove the next action entirely")
	return cmd
}

// newProspectDeleteCmd bins a prospect.
//
// ---------------------------------------------------------------------------
// `--confirm` IS THE GUARD, AND `Confirm()` IS NOT
// ---------------------------------------------------------------------------
// cmdutil.Confirm() auto-approves under BK_NO_PROMPT=1 and on a non-TTY, which
// is exactly how an agent runs. So the real guard is repeating the target back —
// and here the target is the COMPANY NAME, not the #number the caller already
// typed. That is deliberate: `bk workspace delete <slug> --confirm <slug>` can
// only catch a mis-scoped loop, while requiring a name for a number also catches
// the wrong number, which is the mistake an agent actually makes.
//
// The check runs in TWO places and both are needed. Here, so the failure costs
// no round trip and can name the row. On the SERVER, so the guard is not
// something a caller can skip by shelling out to curl or by running a stale
// binary — see the route's header.
//
// The prospect is FETCHED FIRST so that what is destroyed can be reported before
// it is destroyed: type, #number and name. A count alone is the difference
// between a wrong delete caught in a minute and one found in a month.
func newProspectDeleteCmd() *cobra.Command {
	var confirm string
	var yes bool
	cmd := &cobra.Command{
		Use:         "delete <n> --confirm <company>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n},DELETE /api/workspaces/{ws}/prospects/{n}"},
		Short:       "Move a prospect to the recycle bin (requires the company name)",
		Long: `Move a prospect, and everything logged against it, to the recycle bin.

--confirm must be the COMPANY NAME of the prospect at that #number — not the
number again. It is required even with --yes and even under BK_NO_PROMPT=1,
because a prompt an agent auto-approves is not a guard.

  bk sales prospect delete 12 --confirm StaffUp

If the name does not match, nothing is deleted and the error names the company
that IS at that number.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := prospectNumber(args[0])
			if err != nil {
				return err
			}
			// Trimmed ONCE, here, and the trimmed value is what both the local
			// check and the request use. Validating one string and sending
			// another is how a guard becomes decorative: `--confirm " Roches "`
			// passed the check below and put the untrimmed value on the wire, so
			// the server was deciding on input the CLI had never looked at.
			// Found by feeding this exact value to a stand-in server that
			// compares strictly.
			confirm = strings.TrimSpace(confirm)
			if confirm == "" {
				return fmt.Errorf(
					"--confirm is required and must be the company name of prospect #%d "+
						"— run `bk sales prospect show %d` to see it", n, n)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			// Before the delete, not after: this is what gets reported.
			target, err := c.GetProspect(ws, n)
			if err != nil {
				return err
			}
			if confirm != target.Name {
				// Worded to contain "required" on purpose. cmd/bk/main.go's
				// classify() maps that substring to exit 2 (bad usage), which is
				// what `bk workspace delete`'s guard already exits with — and
				// two spellings of the same irreversible-command guard returning
				// different exit codes is exactly the inconsistency an agent
				// branching on the code would trip over.
				return fmt.Errorf(
					"--confirm is required to match prospect #%d, which is %q — got %q; nothing was deleted",
					n, target.Name, confirm)
			}
			if !cmdutil.Confirm(fmt.Sprintf(
				"Move prospect #%d (%s) and everything logged against it to the recycle bin?",
				target.Number, target.Name), yes) {
				return fmt.Errorf("aborted")
			}
			deleted, err := c.DeleteProspect(ws, n, confirm)
			if err != nil {
				return err
			}
			return output.Render(format, deleted, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "binned %s #%d: %s\n",
					deleted.Type, deleted.Number, deleted.Name)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&confirm, "confirm", "",
		"Repeat the COMPANY NAME to authorise the delete (required, even with --yes)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// clientAndWorkspace is the two questions every sales command answers first:
// which server (the group's pin, D-1) and which workspace (--ws, then active).
func clientAndWorkspace() (*client.Client, string, error) {
	c, cfg, err := cmdutil.NewClientAndConfig()
	if err != nil {
		return nil, "", err
	}
	ws, err := cmdutil.RequireActiveWorkspace(cfg)
	if err != nil {
		return nil, "", err
	}
	return c, ws, nil
}

// entityNumber parses a `<n>` argument — a workspace #number, never a row id.
//
// One helper for every addressable noun in this app, because the failure it
// prevents is the same everywhere: a caller that pasted a row id from somewhere
// gets a clear refusal rather than a request that acts on a different record.
func entityNumber(raw, noun string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("invalid %s #number %q — run `bk sales %s list` to see them", noun, raw, noun)
	}
	return n, nil
}

// prospectNumber is entityNumber for the noun everything else hangs off.
func prospectNumber(raw string) (int, error) { return entityNumber(raw, "prospect") }

// patched turns a flag into a PATCH field: nil when it was not passed, an
// explicit clear when it was passed empty, the value otherwise.
func patched(cmd *cobra.Command, flag, value string) *client.NullString {
	if !cmd.Flags().Changed(flag) {
		return nil
	}
	return client.Set(value)
}

func isEmptyPatch(r client.UpdateProspectRequest) bool {
	return r.Name == nil && r.City == nil && r.Sector == nil && r.Value == nil &&
		r.Currency == nil && r.Owner == nil && r.Source == nil && r.Summary == nil &&
		r.Website == nil && r.Address == nil && r.Strategy == nil && r.GamePlan == nil
}

// splitAll accepts both `--stage a --stage b` and `--stage a,b`. StringSliceVar
// already splits on commas, but a value containing a space around one does not,
// and an agent writing "meeting, negotiation" should not get a silent no-match.
func splitAll(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		for _, part := range strings.Split(s, ",") {
			if p := strings.TrimSpace(part); p != "" {
				out = append(out, p)
			}
		}
	}
	return out
}

// money renders an amount for a table cell. The amount arrives as a decimal
// STRING and is printed as one: a CRM must not round a deal value on the way to
// a terminal, and nothing here does arithmetic on it.
func money(value, currency string) string {
	if strings.TrimSpace(value) == "" {
		return "—"
	}
	// Trim a trailing ".00" — every value in this app is a whole number of francs
	// in practice, and two zero decimals in every row of a table is noise.
	v := strings.TrimSuffix(value, ".00")
	if currency == "" {
		return v
	}
	return currency + " " + v
}

func ownerName(o *client.SalesOwner) string {
	if o == nil {
		return "—"
	}
	if strings.TrimSpace(o.Name) != "" {
		return cmdutil.Truncate(o.Name, 18)
	}
	return cmdutil.Truncate(o.Email, 18)
}

// nextActionCell prefers the LABEL the agent wrote over the resolved date. The
// difference between "due Friday" and "sometime this week, Friday is my guess"
// is what a human needs when the follow-up is late, and only the label carries
// it.
func nextActionCell(a client.SalesNextAction) string {
	if strings.TrimSpace(a.Type) == "" {
		return "—"
	}
	when := strings.TrimSpace(a.DueLabel)
	if when == "" {
		when = dateOnly(a.Due)
	}
	if when == "—" || when == "" {
		return a.Type
	}
	return a.Type + " · " + when
}

// dateOnly keeps the date half of an ISO timestamp. A listing is scanned, not
// audited; the full instant is in --json.
func dateOnly(ts string) string {
	if strings.TrimSpace(ts) == "" {
		return "—"
	}
	if i := strings.IndexByte(ts, 'T'); i > 0 {
		return ts[:i]
	}
	return ts
}

func renderProspect(w io.Writer, p *client.Prospect) error {
	fmt.Fprintf(w, "#%d  %s\n", p.Number, p.Name)
	if p.URN != "" {
		fmt.Fprintf(w, "%s\n", p.URN)
	}
	fmt.Fprintln(w)

	tw := output.Tabwriter(w)
	fmt.Fprintf(tw, "stage\t%s\n", p.Stage)
	fmt.Fprintf(tw, "value\t%s\n", money(p.Value, p.Currency))
	fmt.Fprintf(tw, "owner\t%s\n", ownerName(p.Owner))
	if p.City != "" || p.Sector != "" {
		fmt.Fprintf(tw, "where\t%s\n", strings.TrimSpace(strings.Trim(p.City+" · "+p.Sector, " ·")))
	}
	if p.Address != "" {
		fmt.Fprintf(tw, "address\t%s\n", p.Address)
	}
	if p.Website != "" {
		fmt.Fprintf(tw, "website\t%s\n", p.Website)
	}
	if p.Source != "" {
		fmt.Fprintf(tw, "source\t%s\n", p.Source)
	}
	if p.Strategy > 0 {
		fmt.Fprintf(tw, "strategy\t#%d (bk sales strategy show %d)\n", p.Strategy, p.Strategy)
	}
	fmt.Fprintf(tw, "next\t%s\n", nextActionCell(p.NextAction))
	if p.ClosedAt != "" {
		fmt.Fprintf(tw, "closed\t%s%s\n", dateOnly(p.ClosedAt), suffix(p.ClosedReason))
	}
	if p.DeletedAt != "" {
		fmt.Fprintf(tw, "binned\t%s\n", dateOnly(p.DeletedAt))
	}
	if len(p.Labels) > 0 {
		names := make([]string, 0, len(p.Labels))
		for _, l := range p.Labels {
			names = append(names, l.Name)
		}
		fmt.Fprintf(tw, "labels\t%s\n", strings.Join(names, ", "))
	}
	if err := tw.Flush(); err != nil {
		return err
	}

	if p.Summary != "" {
		fmt.Fprintf(w, "\n%s\n", p.Summary)
	}
	// The plan comes BEFORE the ledgers on purpose: this is what somebody reads
	// on the way into a meeting, and the history is what they read afterwards.
	if p.GamePlan != "" {
		fmt.Fprintf(w, "\nGAME PLAN\n%s\n", p.GamePlan)
	}
	if p.NextAction.Note != "" {
		fmt.Fprintf(w, "\nnext action: %s\n", p.NextAction.Note)
	}

	if len(p.Contacts) > 0 {
		fmt.Fprintln(w, "\nCONTACTS")
		ct := output.Tabwriter(w)
		for _, con := range p.Contacts {
			name := con.Name
			if con.IsPrimary {
				name = "★ " + name
			}
			fmt.Fprintf(ct, "  %d\t%s\t%s\t%s\t%s\t%s\n",
				con.ID, cmdutil.Truncate(name, 24), cmdutil.Truncate(con.Role, 22),
				dashIf(con.DecisionPower), dashIf(con.Email), dashIf(con.Phone))
		}
		if err := ct.Flush(); err != nil {
			return err
		}
		fmt.Fprintf(w, "  (bk sales contact edit %d <id> — phone, email, linkedin, decision power)\n", p.Number)
	}

	if len(p.Journey) > 0 {
		fmt.Fprintln(w, "\nJOURNEY")
		jt := output.Tabwriter(w)
		for _, s := range p.Journey {
			fmt.Fprintf(jt, "  %s\t%s\t%s\t%s\n",
				s.Stage, s.Status, dateOnly(s.OccurredAt), actorOf(s))
		}
		if err := jt.Flush(); err != nil {
			return err
		}
	}

	// A `LINKED` section used to print here, over `p.Links` — the cross-app
	// relations D-18 asked to be VISIBLE rather than merely storable. The route
	// stopped serving `links` on 2026-08-10 (this app no longer reads
	// `platform.links`), so from that day it rendered nothing while claiming in
	// --help that it did. Removed 2026-08-12. D-18's requirement is met by the
	// URN above: it is printed, it is absolute within the platform, and it is
	// what you paste into the other app's record.
	return nil
}

func actorOf(s client.SalesJourneyStep) string {
	who := strings.TrimSpace(s.Actor)
	if who == "" {
		return ""
	}
	out := "by " + who
	if n := strings.TrimSpace(s.Note); n != "" {
		out += " — " + cmdutil.Truncate(n, 60)
	}
	return out
}

func suffix(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	return " — " + s
}
