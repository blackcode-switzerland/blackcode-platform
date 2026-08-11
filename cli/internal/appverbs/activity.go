package appverbs

// `bk activity` reads platform.events, so it stays a bare platform verb — and
// Phase 6 is what made it a genuinely cross-app feed. Every event now carries the
// app that produced it and, when its subject is an addressable entity, that
// entity's URN. The analytics half of this file moved to
// commands/issues/analytics.go in Phase 5: it slices by issue status, priority,
// label and assignee, which is one app's vocabulary.
//
// `--app` filters to one app and `--subject` to one URN. With a single app
// installed the first is a no-op filter — shipped now anyway, because the flag is
// the part agents learn, and a flag that changes meaning the day a second app
// appears is worse than one that starts out uninteresting.

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newActivityCmd(acfg Config) *cobra.Command {
	var (
		limit, cursor int
		since         string
		subject       string
	)
	cmd := &cobra.Command{
		Use:         "activity",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/activity"},
		// "(all apps)" until 2026-08-11. Each app has kept its OWN event feed
		// since 2026-08-10 — `deprecations.go`'s `activity` row says so in the
		// same binary — so the one-line summary contradicted the hint.
		Short:       fmt.Sprintf("Show %s's workspace activity feed", acfg.App),
		// Every example is built from acfg.App rather than typed. They read
		// `bk activity …` until 2026-08-11 — a spelling removed on 2026-08-10,
		// when the verb moved behind the app name — so all three exited 2 for
		// anyone who copied one. A literal example in a SHARED app-verb cannot
		// be right for both apps anyway; interpolating is what makes it stay
		// right for the next app too.
		Long: fmt.Sprintf(`Show the workspace activity feed.

This app's own timeline, newest first.

  bk %[1]s activity --since 24h
  bk %[1]s activity --ws kali-sa --since 7d --json
  bk %[1]s activity --subject bc:issues:kali-sa/issue/482

--since takes a relative window: 30m, 24h, 7d. Use --ws to read another
workspace without switching the active one.`, acfg.App),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			var cur *int
			if cmd.Flags().Changed("cursor") {
				cur = &cursor
			}
			// No app filter — see search.go. This feed is one app's `events` table.
			items, nextCursor, err := c.Activity(limit, cur, since, "", subject)
			if err != nil {
				return err
			}

			data := any(items)
			if format != output.FormatTable && nextCursor != nil {
				data = map[string]any{"data": items, "next_cursor": nextCursor}
			}

			return output.Render(format, data, func(w io.Writer) error {
				if len(items) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no activity)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "WHEN\tWHO\tAPP\tACTION\tENTITY\tID")
				for _, a := range items {
					entID := "—"
					if a.EntityID != nil {
						// issue/task/project ids are the workspace #number
						switch a.EntityType {
						case "issue", "task", "project":
							entID = fmt.Sprintf("#%d", *a.EntityID)
						default:
							entID = fmt.Sprintf("%d", *a.EntityID)
						}
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\n",
						cmdutil.DerefOr(a.OccurredAt, ""), cmdutil.DerefOr(a.ActorName, "—"),
						cmdutil.DerefOr(a.App, "—"), a.Action, a.EntityType, entID)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if nextCursor != nil {
					fmt.Fprintf(cmd.ErrOrStderr(), "next page: --cursor=%d\n", *nextCursor)
				}
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&limit, "limit", 50, "Max items to return")
	cmd.Flags().IntVar(&cursor, "cursor", 0, "Cursor (last event id seen) for pagination")
	cmd.Flags().StringVar(&since, "since", "", "Only events in the last window: 30m, 24h, 7d")
	cmd.Flags().StringVar(&subject, "subject", "", "Only events about this URN")
	return cmd
}
