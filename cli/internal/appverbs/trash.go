package appverbs

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

// `bk <app> trash` — the recycle bin: list / restore / purge / empty the
// soft-deleted entities in the active workspace.
//
// App-owned because the bin holds one app's entities. `bk issues trash empty`
// and `bk sales trash empty` are two different destructive actions, and a bare
// `bk trash empty` that picked one by default is exactly the shape of accident
// the tier boundary exists to prevent.
func newTrashCmd(cfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "trash",
		Aliases: []string{"recycle", "bin"},
		Short:   "Manage the recycle bin",
		Long: fmt.Sprintf(`The %s app's recycle bin: list, restore, purge, empty.

Deletes are soft — an item moves here instead of being destroyed. This bin holds
THIS app's entities only; another app's deleted items are in its own bin, which
is why the app is part of the command. "purge" and "empty" are the only
irreversible actions in the product, and both echo what they destroyed.

Refs are <type>:<#number>, exactly as printed in the REF column of "list".`, cfg.App),
	}
	cmd.AddCommand(
		newTrashListCmd(cfg),
		newTrashRestoreCmd(cfg),
		newTrashPurgeCmd(cfg),
		newTrashEmptyCmd(cfg),
	)
	return cmd
}

// parseRefs turns "issue:42 project:3" style args into entity refs.
//
// The number is the workspace #NUMBER, as printed in `trash list`'s REF column
// and as used by every other command.
//
// The type vocabulary comes from cfg, never from a list in this file: it is one
// app's nouns, and a shared file that enumerated them would be a second copy of
// a vocabulary the server owns — the recurring silent-drift bug in this codebase
// (docs/sales-app-plan.md D-27 §2). An app that declares none gets no local
// check and the server's answer instead.
func parseRefs(cfg Config, args []string) ([]client.TrashEntityRef, error) {
	refs := make([]client.TrashEntityRef, 0, len(args))
	for _, a := range args {
		parts := strings.SplitN(a, ":", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid ref %q — use <type>:<#number>, e.g. %s:42", a, cfg.exampleType())
		}
		typ := strings.ToLower(strings.TrimSpace(parts[0]))
		if err := cfg.checkTrashType(typ); err != nil {
			return nil, err
		}
		n, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			return nil, fmt.Errorf("invalid #number in %q: %w", a, err)
		}
		if n < 1 {
			return nil, fmt.Errorf("invalid #number in %q: must be 1 or greater", a)
		}
		refs = append(refs, client.TrashEntityRef{Type: typ, Number: n})
	}
	return refs, nil
}

// checkTrashType validates a ref's type against the app's own vocabulary, and
// says nothing when the app declared none.
func (c Config) checkTrashType(typ string) error {
	if len(c.TrashTypes) == 0 {
		return nil
	}
	for _, t := range c.TrashTypes {
		if typ == t {
			return nil
		}
	}
	return fmt.Errorf("invalid type %q for the %s app — must be %s",
		typ, c.App, strings.Join(c.TrashTypes, ", "))
}

// exampleType is the noun used in "e.g. issue:42" style help. Falls back to a
// placeholder for an app that declared no vocabulary.
func (c Config) exampleType() string {
	if len(c.TrashTypes) == 0 {
		return "<type>"
	}
	return c.TrashTypes[0]
}

func newTrashListCmd(cfg Config) *cobra.Command {
	var typ string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/trash"},
		Short:       "List items in the recycle bin",
		RunE: func(cmd *cobra.Command, args []string) error {
			if typ != "" {
				if err := cfg.checkTrashType(typ); err != nil {
					return fmt.Errorf("--type: %w", err)
				}
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfgFile, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfgFile)
			if err != nil {
				return err
			}
			items, err := c.ListTrash(ws, typ)
			if err != nil {
				return err
			}
			return output.Render(format, items, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "REF\tTITLE\tDELETED\tBY\tBATCH")
				unaddressable := 0
				for _, it := range items {
					// The REF column is what a user pastes straight back into
					// `restore`/`purge`, so it must be the #number the server now
					// expects. A row with no #number cannot be addressed at all —
					// say so rather than printing the row id, which would be read
					// as a #number and act on a different row.
					ref := "—"
					if it.Seq != nil {
						ref = fmt.Sprintf("%s:%d", it.Type, *it.Seq)
					} else {
						unaddressable++
					}
					by := "—"
					if it.DeletedByName != nil {
						by = *it.DeletedByName
					}
					batch := "—"
					if it.BatchID != nil {
						batch = strconv.Itoa(*it.BatchID)
						if it.BatchMode != nil {
							batch += " (" + *it.BatchMode + ")"
						}
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", ref, truncateTitle(it.Title), it.DeletedAt, by, batch)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(items) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(trash is empty)")
				}
				if unaddressable > 0 {
					fmt.Fprintf(cmd.ErrOrStderr(),
						"warning: %d item(s) have no #number and cannot be restored or purged by ref; use --batch\n",
						unaddressable)
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&typ, "type", "", "Filter by entity type (run bk meta for this app's types)")
	return cmd
}

func newTrashRestoreCmd(cfg Config) *cobra.Command {
	var batch int
	var restoreParents, standalone bool
	cmd := &cobra.Command{
		Use:         "restore [<type:#number>...]",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/trash/restore"},
		Short:       "Restore items (or a whole batch) from the recycle bin",
		Long: "Restore deleted items back to the workspace.\n\n" +
			"Pass refs like `" + cfg.exampleType() + ":42` (the #number, as printed in the REF\n" +
			"column), or restore a whole delete group with\n" +
			"--batch <id> (see the BATCH column in `trash list`).\n\n" +
			"If a restored item's parent is also in the Trash, by default it comes back\n" +
			"as a group when they were deleted together, otherwise standalone.\n" +
			"Force the choice with --restore-parents or --standalone.",
		RunE: func(cmd *cobra.Command, args []string) error {
			if restoreParents && standalone {
				return fmt.Errorf("--restore-parents and --standalone are mutually exclusive")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfgFile, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfgFile)
			if err != nil {
				return err
			}

			req := client.RestoreTrashRequest{}
			if cmd.Flags().Changed("batch") {
				req.BatchID = &batch
			} else {
				refs, err := parseRefs(cfg, args)
				if err != nil {
					return err
				}
				if len(refs) == 0 {
					return fmt.Errorf("provide one or more <type:#number> refs, or --batch <id>")
				}
				req.Items = refs
				if restoreParents || standalone {
					res := "restore_parent"
					if standalone {
						res = "standalone"
					}
					req.Resolutions = map[string]string{}
					for _, r := range refs {
						req.Resolutions[fmt.Sprintf("%s:%d", r.Type, r.Number)] = res
					}
				}
			}

			resp, err := c.RestoreTrash(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, resp, func(w io.Writer) error {
				fmt.Fprintf(w, "restored %d item(s)\n", resp.Count)
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&batch, "batch", 0, "Restore an entire delete batch by id")
	cmd.Flags().BoolVar(&restoreParents, "restore-parents", false, "Also restore deleted parent items")
	cmd.Flags().BoolVar(&standalone, "standalone", false, "Restore items standalone, clearing dangling parent links")
	return cmd
}

func newTrashPurgeCmd(cfg Config) *cobra.Command {
	var batch int
	var yes bool
	cmd := &cobra.Command{
		Use:         "purge [<type:#number>...]",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/trash/purge"},
		Short:       "Permanently delete items from the recycle bin (owner only)",
		Long: "Permanently delete binned items. This cannot be undone and requires the\n" +
			"workspace owner role. Pass refs like `" + cfg.exampleType() + ":42` (the #number, as\n" +
			"printed in the REF column), or --batch <id>.\n\n" +
			"Any files embedded in the deleted items are automatically removed from\n" +
			"storage once nothing else in the workspace references them (same safety\n" +
			"check the Storage page uses).",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfgFile, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfgFile)
			if err != nil {
				return err
			}

			req := client.PurgeTrashRequest{}
			target := ""
			if cmd.Flags().Changed("batch") {
				req.BatchID = &batch
				target = fmt.Sprintf("batch #%d", batch)
			} else {
				refs, err := parseRefs(cfg, args)
				if err != nil {
					return err
				}
				if len(refs) == 0 {
					return fmt.Errorf("provide one or more <type:#number> refs, or --batch <id>")
				}
				req.Items = refs
				target = fmt.Sprintf("%d item(s)", len(refs))
			}

			if !cmdutil.Confirm(fmt.Sprintf("Permanently delete %s from the %s recycle bin? This cannot be undone.", target, cfg.App), yes) {
				return fmt.Errorf("aborted")
			}
			res, err := c.PurgeTrash(ws, req)
			if err != nil {
				return err
			}
			printPurged(cmd.OutOrStdout(), res)
			return nil
		},
	}
	cmd.Flags().IntVar(&batch, "batch", 0, "Purge an entire delete batch by id")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func newTrashEmptyCmd(cfg Config) *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:         "empty",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/trash/empty"},
		Short:       "Permanently delete everything in the recycle bin (owner only)",
		Long: "Permanently delete everything in the workspace recycle bin. Owner only.\n\n" +
			"Any files embedded in the deleted items are automatically removed from\n" +
			"storage once nothing else in the workspace references them (same safety\n" +
			"check the Storage page uses).",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfgFile, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfgFile)
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf("Permanently delete everything in the %s Trash? This cannot be undone.", cfg.App), yes) {
				return fmt.Errorf("aborted")
			}
			res, err := c.EmptyTrash(ws)
			if err != nil {
				return err
			}
			printPurged(cmd.OutOrStdout(), res)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func truncateTitle(s string) string {
	const max = 48
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}

// printPurged echoes WHAT a purge destroyed, one line per item, then the count.
//
// Purge is the only irreversible action in the product. A count alone ("deleted
// 3 item(s)") is the difference between a wrong purge someone catches
// immediately and one nobody notices for a month — especially now that refs are
// #numbers, where a ref pasted from a pre-1.12.0 run could name a real but
// different item. The title is the thing a human recognises as wrong.
//
// stdout, deliberately: this is the command's result, not a diagnostic.
func printPurged(w io.Writer, res *client.PurgeTrashResult) {
	for _, it := range res.Items {
		ref := it.Type
		if it.Number != nil {
			ref = fmt.Sprintf("%s:%d", it.Type, *it.Number)
		}
		fmt.Fprintf(w, "destroyed %s  %s\n", ref, truncateTitle(it.Title))
	}
	if res.ItemsTruncated > 0 {
		fmt.Fprintf(w, "…and %d more not listed\n", res.ItemsTruncated)
	}
	fmt.Fprintf(w, "permanently deleted %d item(s)\n", res.Purged)
}
