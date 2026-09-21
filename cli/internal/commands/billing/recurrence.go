// `bk billing recurrence …` — finite recurring series (phase 4).
//
// ---------------------------------------------------------------------------
// NOTHING SCHEDULES ANYTHING. THIS GROUP IS HOW AN AGENT DOES.
// ---------------------------------------------------------------------------
// The server stores a series as data and never fires on it. "list --due" is the
// whole discovery mechanism and "generate" the whole action, and generate
// REQUIRES the period: it is never inferred, because an inferred period is how a
// retry bills next quarter early. A second generate for a period is refused by
// name, so retrying is always safe.
package billing

import (
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newRecurrenceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "recurrence",
		Short: "Finite recurring series — bill the same thing N times, then stop",
		Long: `A series bills the same invoice on a schedule, a FIXED number of times, then
stops. There is no open-ended series: "recurrence create" requires the number
of occurrences and has no default for it, because "bill this monthly" is an
instruction nobody ever revisits.

NOTHING FIRES ON ITS OWN. The app stores the rule and schedules nothing. You —
or an agent — ask what is due and generate it:

  bk billing recurrence list --due
  bk billing recurrence generate <#> --period <the next period it shows>

An occurrence is an ordinary DRAFT with the next number in its company's
sequence. Generating is not sending: send it like any other invoice.

GENERATING TWICE IS SAFE. A second generate for a period that already has a live
invoice is refused, naming it — so a retry after a timeout cannot double-bill.
A VOIDED occurrence frees its period: generate that period again to replace it,
and the counter does not move a second time.

Frequencies and statuses: "bk meta --app-server billing". The workflow:
"bk guide billing/recurrence".`,
	}
	cmd.AddCommand(
		newRecurrenceListCmd(), newRecurrenceShowCmd(), newRecurrenceCreateCmd(), newRecurrenceEditCmd(),
		newRecurrencePauseCmd(), newRecurrenceResumeCmd(), newRecurrenceGenerateCmd(),
	)
	return cmd
}

func seriesArg(arg string) (int, error) {
	n, err := strconv.Atoi(strings.TrimPrefix(arg, "#"))
	if err != nil || n < 1 {
		return 0, cmdutil.Usagef("%q is not a series #number — \"bk billing recurrence list\" shows them", arg)
	}
	return n, nil
}

func deref0(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func seriesLabel(r *client.BillingRecurrence) string {
	if r.Label.En != nil {
		return *r.Label.En
	}
	if r.Label.Fr != nil {
		return *r.Label.Fr
	}
	return "(no label)"
}

// progress is done/total: "2/8".
func progress(r *client.BillingRecurrence) string {
	return fmt.Sprintf("%d/%d", r.OccurrencesDone, r.OccurrencesTotal)
}

func newRecurrenceListCmd() *cobra.Command {
	var o client.ListBillingRecurrencesOptions
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/recurrences"},
		Short:       "Series, newest first — or --due, the ones to generate now",
		Long: `Recurring series in the active workspace.

--due lists only the ACTIVE series whose next date has arrived (today in Zurich),
oldest date first — the list an agent works through. Each row names the period
to pass to "generate".`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			page, err := c.ListBillingRecurrences(ws, o)
			if err != nil {
				return err
			}
			if o.Due {
				// The server pages by #number; the order to WORK in is by date.
				sort.SliceStable(page.Data, func(i, j int) bool {
					return deref0(page.Data[i].NextDate) < deref0(page.Data[j].NextDate)
				})
			}
			return output.Render(format, page, func(w io.Writer) error {
				if len(page.Data) == 0 {
					if o.Due {
						fmt.Fprintln(w, "Nothing is due.")
						return nil
					}
					fmt.Fprintln(w, "No series.")
					nextStep(w, "bk billing recurrence create --template <invoice ref> --frequency monthly --start <YYYY-MM-DD> --occurrences 12")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tCOMPANY\tLABEL\tFREQUENCY\tDONE\tSTATUS\tNEXT\tPERIOD\tTEMPLATE")
				for i := range page.Data {
					r := &page.Data[i]
					status := r.Status
					if r.Due {
						status += " (due)"
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
						r.Number, r.Company, cmdutil.Truncate(seriesLabel(r), 32), r.Frequency, progress(r), status,
						orDash(deref0(r.NextDate)), orDash(deref0(r.NextPeriod)), orDash(deref0(r.TemplateNumber)))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if page.NextCursor != nil {
					fmt.Fprintf(w, "\nmore: --cursor %d\n", *page.NextCursor)
				}
				if o.Due {
					first := &page.Data[0]
					nextStep(w, "bk billing recurrence generate %d --period %s", first.Number, deref0(first.NextPeriod))
				}
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.BoolVar(&o.Due, "due", false, "Only active series whose next date has arrived")
	f.StringVar(&o.Company, "company", "", "Only this company's series")
	f.StringVar(&o.Status, "status", "", "Only this status (bk meta for the values)")
	f.IntVar(&o.Limit, "limit", 0, "How many (bk meta for the ceiling)")
	f.IntVar(&o.Cursor, "cursor", 0, "Continue from the cursor the last page returned")
	return cmd
}

func renderSeries(w io.Writer, r *client.BillingRecurrence) error {
	fmt.Fprintf(w, "Series #%d  %s\n", r.Number, seriesLabel(r))
	tw := output.Tabwriter(w)
	fmt.Fprintf(tw, "Company:\t%s\n", r.Company)
	fmt.Fprintf(tw, "Status:\t%s\n", r.Status)
	fmt.Fprintf(tw, "Frequency:\t%s, from %s\n", r.Frequency, r.StartDate)
	fmt.Fprintf(tw, "Issued:\t%s\tstops after %d occurrence(s)\n", progress(r), r.OccurrencesTotal)
	switch {
	case r.NextDate == nil:
		fmt.Fprintf(tw, "Next:\t—\tthe series is complete\n")
	case r.Due:
		fmt.Fprintf(tw, "Next:\t%s\tperiod %s — DUE\n", *r.NextDate, deref0(r.NextPeriod))
	default:
		fmt.Fprintf(tw, "Next:\t%s\tperiod %s\n", *r.NextDate, deref0(r.NextPeriod))
	}
	if r.TemplateNumber != nil {
		fmt.Fprintf(tw, "Template:\t%s\t(#%d) — every occurrence copies it\n", *r.TemplateNumber, *r.Template)
	} else if r.Status == "completed" {
		fmt.Fprintf(tw, "Template:\t—\tpredates this app\n")
	} else {
		fmt.Fprintf(tw, "Template:\t—\tpredates this app; set one (recurrence edit --template) before generating\n")
	}
	if r.ExternalRef != nil {
		fmt.Fprintf(tw, "External ref:\t%s\n", *r.ExternalRef)
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	if len(r.Invoices) > 0 {
		fmt.Fprintln(w)
		it := output.Tabwriter(w)
		fmt.Fprintln(it, "  #\tNUMBER\tPERIOD\tISSUED\tSTATUS\tTOTAL")
		for _, i := range r.Invoices {
			period := deref0(i.OccurrencePeriod)
			if period == "" {
				period = "(template)"
			}
			fmt.Fprintf(it, "  %d\t%s\t%s\t%s\t%s\t%s %s\n", i.Number, i.Ref, period, i.IssueDate, i.Status, i.Currency, i.Total)
		}
		return it.Flush()
	}
	return nil
}

func newRecurrenceShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "show <#>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/recurrences/{seq}"},
		Args:        cobra.ExactArgs(1),
		Short:       "One series: where it stands, its next period, every invoice it produced",
		Long: `One series by its #number, with every invoice carrying it — the template, each
occurrence with its period, and voided ones, which stay part of their series.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			seq, err := seriesArg(args[0])
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.GetBillingRecurrence(ws, seq)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error { return renderSeries(w, r) })
		},
	}
}

func newRecurrenceCreateCmd() *cobra.Command {
	var req client.CreateBillingRecurrenceRequest
	var idempotencyKey string
	cmd := &cobra.Command{
		Use:         "create",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/recurrences"},
		Short:       "A finite series copied from an existing invoice",
		Long: `Create a series that bills the same thing as an existing invoice, on a schedule,
a fixed number of times.

  bk billing recurrence create --template BC-2026-0034 --frequency quarterly \
    --start 2026-01-05 --occurrences 8 --label-en "Fleet-portal maintenance"

--occurrences IS REQUIRED and has no default: it is where the series ends.

--start's day of the month is the day every occurrence falls on; in a shorter
month, the last day. A series from the 31st bills on 28 February and the 31st
again in March.

IF THE TEMPLATE WAS ISSUED IN --start's OWN PERIOD, IT IS THE FIRST OCCURRENCE:
it takes that period, the count starts at 1, and the next date is one step on.
So making this month's invoice recurring does not lead to a second bill for this
month. Otherwise nothing is counted yet and the first generation is for --start.

The template is a MODEL: generation copies its client, lines, currency, language,
reference type, VAT and payment message — never its number, reference, external
ref or metadata. Change the template, and later occurrences change with it.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			if !cmd.Flags().Changed("occurrences") {
				return cmdutil.Usagef("--occurrences is required: a series is finite, and this is where it ends")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.CreateBillingRecurrence(ws, req, idempotencyKey)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "created series #%d — %s, %s from %s, %s\n", r.Number, seriesLabel(r), r.Frequency, r.StartDate, progress(r))
				if r.OccurrencesDone > 0 && r.TemplateNumber != nil {
					// The period as the SERVER assigned it: a quarterly series'
					// is 2026-Q1, not the month, and this binary does not re-derive it.
					for _, i := range r.Invoices {
						if i.Ref == *r.TemplateNumber && i.OccurrencePeriod != nil {
							fmt.Fprintf(w, "%s counts as its first occurrence (%s)\n", *r.TemplateNumber, *i.OccurrencePeriod)
						}
					}
				}
				if r.NextDate == nil {
					fmt.Fprintln(w, "that was the only occurrence, so the series is already complete")
					nextStep(w, "bk billing recurrence show %d", r.Number)
					return nil
				}
				if r.Due {
					nextStep(w, "bk billing recurrence generate %d --period %s", r.Number, deref0(r.NextPeriod))
					return nil
				}
				nextStep(w, "bk billing recurrence list --due   (on or after %s; then generate --period %s)", *r.NextDate, deref0(r.NextPeriod))
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.StringVar(&req.Template, "template", "", "The invoice every occurrence copies: #number or printed number (required)")
	f.StringVar(&req.Frequency, "frequency", "", "How often (bk meta for the values; required)")
	f.StringVar(&req.StartDate, "start", "", "First date, YYYY-MM-DD; its day of the month anchors the series (required)")
	f.IntVar(&req.OccurrencesTotal, "occurrences", 0, "How many times in all, then stop (required; no default)")
	f.StringVar(&req.LabelEn, "label-en", "", "The series' name in English")
	f.StringVar(&req.LabelFr, "label-fr", "", "The series' name in French")
	f.StringVar(&req.ExternalRef, "external-ref", "", "Your own id for it, such as a subscription id")
	f.StringVar(&idempotencyKey, "idempotency-key", "", "A rerun with the same key replays instead of creating a second series")
	_ = cmd.MarkFlagRequired("template")
	_ = cmd.MarkFlagRequired("frequency")
	_ = cmd.MarkFlagRequired("start")
	return cmd
}

func newRecurrenceEditCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "edit <#>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/recurrences/{seq}"},
		Args:        cobra.ExactArgs(1),
		Short:       "Relabel, re-template, or change how many occurrences",
		Long: `Change what may change about a series.

  --label-en / --label-fr   its name
  --template <ref>          the invoice later occurrences copy (same company)
  --occurrences N           the total. It cannot go below what is done, and
                            setting it TO what is done ends the series now —
                            the record of a cancelled contract
  --external-ref            your own id

The frequency and the start date do not change: every past occurrence was billed
on them. End the series and create a new one instead. To pause, "recurrence
pause"; a completed series is final.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			seq, err := seriesArg(args[0])
			if err != nil {
				return err
			}
			patch := map[string]any{}
			flags := map[string]string{"label-en": "label_en", "label-fr": "label_fr", "template": "template", "external-ref": "external_ref"}
			for flag, field := range flags {
				if cmd.Flags().Changed(flag) {
					v, _ := cmd.Flags().GetString(flag)
					patch[field] = v
				}
			}
			if cmd.Flags().Changed("occurrences") {
				n, _ := cmd.Flags().GetInt("occurrences")
				patch["occurrences_total"] = n
			}
			if len(patch) == 0 {
				return cmdutil.Usagef("nothing to change: pass at least one of --label-en, --label-fr, --template, --occurrences, --external-ref")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.EditBillingRecurrence(ws, seq, patch)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "updated series #%d — %s, %s\n", r.Number, r.Status, progress(r))
				if r.Status == "completed" {
					fmt.Fprintln(w, "it is now complete: nothing more will be generated")
				}
				nextStep(w, "bk billing recurrence show %d", r.Number)
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.String("label-en", "", "Name in English")
	f.String("label-fr", "", "Name in French")
	f.String("template", "", "The invoice later occurrences copy")
	f.Int("occurrences", 0, "The total; equal to what is done ends the series")
	f.String("external-ref", "", "Your own id for it")
	return cmd
}

func statusCmd(use, status, short, long, done string) *cobra.Command {
	return &cobra.Command{
		Use:         use + " <#>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/recurrences/{seq}"},
		Args:        cobra.ExactArgs(1),
		Short:       short,
		Long:        long,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			seq, err := seriesArg(args[0])
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.EditBillingRecurrence(ws, seq, map[string]any{"status": status})
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "series #%d %s — %s\n", r.Number, done, progress(r))
				if status == "active" && r.Due {
					nextStep(w, "bk billing recurrence generate %d --period %s", r.Number, deref0(r.NextPeriod))
					return nil
				}
				nextStep(w, "bk billing recurrence show %d", r.Number)
				return nil
			})
		},
	}
}

func newRecurrencePauseCmd() *cobra.Command {
	return statusCmd("pause", "paused", "Stop a series generating until it is resumed",
		`Pause a series: "generate" refuses until "recurrence resume". Needs no reason.
Its next date does not move while paused, so on resume it is due at once if that
date has passed — nothing is skipped silently.`, "paused")
}

func newRecurrenceResumeCmd() *cobra.Command {
	return statusCmd("resume", "active", "Let a paused series generate again",
		`Resume a paused series. If its next date passed while it was paused it is due
at once; generate it, or end it with "recurrence edit --occurrences".`, "resumed")
}

func newRecurrenceGenerateCmd() *cobra.Command {
	var req client.GenerateBillingOccurrenceRequest
	var message, idempotencyKey string
	cmd := &cobra.Command{
		Use:         "generate <#>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/recurrences/{seq}/generate"},
		Args:        cobra.ExactArgs(1),
		Short:       "Create the next occurrence as a draft, for the period you name",
		Long: `Create one occurrence of a series as a DRAFT invoice.

  bk billing recurrence generate 3 --period 2026-Q4

--period IS REQUIRED and is never inferred. It must be the series' next period
("recurrence show" or "list --due" prints it) — or the period of a VOIDED
occurrence you are replacing. Anything else is refused, not corrected: a typo'd
period would be a real bill for a period nobody asked for.

SAFE TO RETRY. If the period already has a live invoice, this is refused naming
it (exit 2), and nothing is created. With --idempotency-key, a rerun of the same
call returns the same invoice instead.

A REPLACEMENT — generating a period whose occurrence was voided — creates the new
draft and does NOT advance the count: a void and its replacement are one
occurrence.

The draft copies the template (see "recurrence create"), takes the next number
in its company's sequence, and is dated today unless --issue-date says
otherwise. It is not sent: "bk billing invoice send" it like any other.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			seq, err := seriesArg(args[0])
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("message") {
				req.Message = &message
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			res, err := c.GenerateBillingOccurrence(ws, seq, req, idempotencyKey)
			if err != nil {
				return err
			}
			return output.Render(format, res, func(w io.Writer) error {
				inv, r := &res.Invoice, &res.Recurrence
				fmt.Fprintf(w, "created %s (#%d) — %s %s, draft, for %s\n", inv.Ref, inv.Number, inv.Currency, inv.Totals.Total, req.Period)
				if res.Replacement {
					fmt.Fprintf(w, "a REPLACEMENT for a voided occurrence: the series stays at %s\n", progress(r))
				} else if r.NextDate == nil {
					fmt.Fprintf(w, "series #%d is now complete (%s)\n", r.Number, progress(r))
				} else {
					fmt.Fprintf(w, "series #%d at %s; next %s (period %s)\n", r.Number, progress(r), *r.NextDate, deref0(r.NextPeriod))
				}
				if n := len(inv.Derived.Problems); n > 0 {
					fmt.Fprintf(w, "it cannot be sent yet: %s\n", inv.Derived.Problems[0].Message)
					nextStep(w, "bk billing invoice show %d   lists each problem with its fix", inv.Number)
					return nil
				}
				nextStep(w, "bk billing invoice pdf %d   then: bk billing invoice send %d --to <client email>", inv.Number, inv.Number)
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.StringVar(&req.Period, "period", "", "The period this bills: 2026-10, 2026-Q4 or 2026 (required)")
	f.StringVar(&req.IssueDate, "issue-date", "", "YYYY-MM-DD; default today")
	f.StringVar(&message, "message", "", "The payment message; default the template's")
	f.StringVar(&idempotencyKey, "idempotency-key", "", "A rerun with the same key returns the same invoice")
	_ = cmd.MarkFlagRequired("period")
	return cmd
}
