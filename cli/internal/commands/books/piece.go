// The pièces pipeline: `bk books piece list|ingest|match`.
//
// `piece ingest` is what the Drive worker calls in production — this command
// exists so a human, a test, or a cron wrapper can be the worker. The payload
// travels to the server AS-IS: the CLI does not pre-validate, because the
// server's recomputed verdict is the only one that counts, and a CLI that
// filtered first would hide exactly the documents a human must see.
package books

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

func newPieceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "piece",
		Short: "Pièces justificatives — the receipts inbox and the robot door",
		Long: "A pièce is the proof behind an entry.\n\n" +
			"THIS APP NEVER HOLDS THE FILE. The bytes live in Drive; b/books stores the\n" +
			"extracted record, a link and a hash. There is no upload route and no\n" +
			"`bk books upload` — `ingest` takes an ExtractionResult JSON produced by\n" +
			"something outside that downloaded the file, hashed it, archived it and read it.\n" +
			"Keeping the original for the ten years art. 958f requires is the caller's job,\n" +
			"and a hash proves nothing once the thing it hashed is gone.\n\n" +
			"A pièce and an entry are separate until `match` joins them, and matching\n" +
			"deliberately does NOT change the entry's evidence tier: whether a document makes\n" +
			"the input-tax claim safe is a judgment, and judgments are yours.",
	}
	cmd.AddCommand(newPieceListCmd(), newPieceIngestCmd(), newPieceMatchCmd())
	return cmd
}

func newPieceListCmd() *cobra.Command {
	var entity, status string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/pieces"},
		Short:       "The inbox: what the worker delivered, and what the server thinks of it",
		Long: "The receipts inbox: every ExtractionResult the robot door has taken, with the\n" +
			"server's own verdict on each.\n\n" +
			"THE FLAGS COLUMN IS WHY THIS LIST EXISTS. `review` means the server re-ran the\n" +
			"arithmetic and it did not add up — the document landed anyway, deliberately,\n" +
			"because a wrong total is exactly the one a human must see and bouncing it would\n" +
			"hide it in the worker's retry queue. `dup-of #n` means the content matches an\n" +
			"earlier capture; it is flagged and never dropped, because a refund and a\n" +
			"re-scan look identical and only a person can tell them apart.\n\n" +
			"STATUS is the match state, not the validation state: `staged` is a document\n" +
			"attached to nothing. Attach it with `bk books piece match <n> --entry <entry>`;\n" +
			"until then it is evidence for nothing and sits on the worklist.\n\n" +
			"Without --entity this is the whole workspace's inbox, including documents the\n" +
			"worker could not attribute to a book.",
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
			rows, err := c.ListBooksPieces(ws, entity, status)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tRECEIVED\tTYPE\tMERCHANT\tTOTAL\tDATE\tSTATUS\tFLAGS")
				for _, p := range rows {
					flags := ""
					if p.NeedsReview {
						flags += "review "
					}
					if p.DuplicateOf != nil {
						flags += fmt.Sprintf("dup-of #%d ", *p.DuplicateOf)
					}
					if p.MatchedEntry != nil {
						flags += fmt.Sprintf("-> %s#%d", riPrefix(p.MatchedJournal), *p.MatchedEntry)
					}
					if flags == "" {
						flags = "—"
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
						p.Number, p.Received, p.DocumentType,
						cmdutil.Truncate(strOr(p.Merchant, "?"), 28),
						strOr(p.Total, "—"), strOr(p.Date, "—"), p.Status, flags)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(inbox empty)")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "Book slug (default: the whole inbox)")
	cmd.Flags().StringVar(&status, "status", "", "staged | matched | dismissed")
	return cmd
}

func newPieceIngestCmd() *cobra.Command {
	var file, entity string
	cmd := &cobra.Command{
		Use:         "ingest --file <extraction.json>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/pieces/ingest"},
		Short:       "Post an ExtractionResult through the robot door",
		Long: "Post one ExtractionResult (the Drive worker's output contract) to the ingest\n" +
			"route. `--file -` reads stdin, which is how a worker pipes.\n\n" +
			"The document ALWAYS lands staged. The server re-validates the arithmetic and\n" +
			"ignores the payload's own validation block; a failed check flags the piece for\n" +
			"review rather than refusing it, because a bad sum is exactly the document a\n" +
			"human must see. Re-posting the same file converges on the existing row.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			var raw []byte
			if file == "-" {
				raw, err = io.ReadAll(os.Stdin)
			} else {
				raw, err = os.ReadFile(file)
			}
			if err != nil {
				return fmt.Errorf("reading the payload: %w", err)
			}
			// Attach entity attribution without touching the rest of the payload.
			if entity != "" {
				var m map[string]json.RawMessage
				if err := json.Unmarshal(raw, &m); err != nil {
					return fmt.Errorf("the payload is not JSON: %w", err)
				}
				m["entity"], _ = json.Marshal(entity)
				raw, _ = json.Marshal(m)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.IngestBooksPiece(ws, raw)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				verb := "ingested"
				if !r.Created {
					verb = "already known — converged on"
				}
				if _, err := fmt.Fprintf(w, "%s piece #%d (validation passed: %t)\n", verb, r.Number, r.Validation.Passed); err != nil {
					return err
				}
				for _, p := range r.Validation.Problems {
					fmt.Fprintf(w, "  ! %s\n", p)
				}
				if r.NeedsReview {
					fmt.Fprintln(w, "flagged for review — it is on the worklist")
				}
				if r.DuplicateOf != nil {
					fmt.Fprintf(w, "same content as piece #%d — flagged, not dropped (a refund looks identical)\n", *r.DuplicateOf)
				}
				// An ingested pièce proves NOTHING until it is attached to the
				// money it documents. Until then it sits on the worklist as
				// evidence for no entry, which is not a visible failure.
				// The ingest result carries no match, because the door never
				// makes one: a pièce arrives attached to nothing.
				also(w, "it documents nothing yet — the worklist suggests candidates by amount and date:")
				nextStep(w, "bk books worklist%s", entityFlag(entity))
				also(w, "  then: bk books piece match %d --entry <entry-number>", r.Number)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "Path to the ExtractionResult JSON, or - for stdin (required)")
	cmd.Flags().StringVar(&entity, "entity", "", "Book slug to attribute the document to")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}

func newPieceMatchCmd() *cobra.Command {
	var entry int
	cmd := &cobra.Command{
		Use:         "match <piece-number> --entry <entry-number>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/pieces/{number}/match"},
		Short:       "Say what this document proves",
		Long: "Attach a piece to the entry it documents. The entry gains the Drive reference,\n" +
			"the checksum and the capture date; its evidence TIER is deliberately untouched,\n" +
			"because whether a receipt turns `partial` into `full` is a sufficiency judgment\n" +
			"and judgments are yours. The worklist suggests candidates (same amount to the\n" +
			"rappen, three days either side).",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not a piece number", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.MatchBooksPiece(ws, n, entry)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				if _, err := fmt.Fprintf(w, "matched piece #%d -> %s#%d\n", p.Number, riPrefix(p.MatchedJournal), *p.MatchedEntry); err != nil {
					return err
				}
				// The match writes the Drive reference and DELIBERATELY leaves
				// the evidence tier alone — whether a receipt makes the claim
				// safe is a sufficiency judgment, and judgments are the
				// caller's. So the next step is the one that acts on it, and
				// without it the input tax stays unclaimable (art. 28 LTVA).
				also(w, "the entry's evidence TIER is untouched — that judgment is yours:")
				nextStep(w, "bk books resolve %d --evidence-tier full --explanation <what this money was>", *p.MatchedEntry)
				also(w, "  add --tva-input-claimed on the same call to claim the input tax (art. 28 LTVA).")
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&entry, "entry", 0, "The entry #number this document proves (required)")
	_ = cmd.MarkFlagRequired("entry")
	return cmd
}

// riPrefix labels a matched entry number with its journal: an RI book's
// numbers live in the recettes-dépenses journal, not the grand livre.
func riPrefix(journal *string) string {
	if journal != nil && *journal == "recettes_depenses" {
		return "RI entry "
	}
	return "entry "
}
