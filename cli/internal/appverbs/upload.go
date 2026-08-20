package appverbs

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk <app> upload` — the clearest case in the app-owned tier.
//
// The server records `platform.uploads.app` from the deployment that received
// the file, and new blobs land under `<app>/<workspace>/<file>`. So the app
// segment is not decoration: it decides where the file is filed and who owns it.
// Uploading a sales contract through the issues host records it as an issues
// file, and nothing downstream can tell that was a mistake.
func newUploadCmd(cfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "upload <file> [<file> ...]",
		Annotations: map[string]string{"routes": "GET /api/upload,POST /api/upload,POST /api/upload/blob"},
		Short:       "Upload file(s) and print the public URL(s)",
		Long: fmt.Sprintf(`Upload one or more files and print the resulting public URL.

The file is stored against the %s app: that is what the app segment in
"bk %s upload" decides, and it is why there is no bare "bk upload". Run
"bk guide platform/apps" for the three verb tiers, and "bk meta" for the current
size cap and blocked media types.

Use a URL in any description or comment to embed the file inline:
  ![name](url)   for images (inline preview)
  [name](url)    for any other file (video/audio player, or download card)

This does NOT create a sidebar attachment record — it stores the file and
returns its URL. Tip: you can also reference a LOCAL file path directly in any
description or comment you write (e.g. ![](./shot.png)) and the CLI will upload
and embed it for you.`, cfg.App, cfg.App),
		Args: cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			results := make([]*client.UploadResponse, 0, len(args))
			for _, f := range args {
				up, err := c.UploadFile(f)
				if err != nil {
					return fmt.Errorf("upload %s: %w", f, err)
				}
				results = append(results, up)
			}
			return output.Render(format, results, func(w io.Writer) error {
				for _, up := range results {
					fmt.Fprintln(w, up.URL)
				}
				return nil
			})
		},
	}
}
