package platform

import (
	"fmt"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
	"github.com/spf13/cobra"
)

// The rendering itself lives in internal/version.Describe(), because
// `bk --version` prints it too and two copies of one fact drift.
func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "version",
		Annotations: map[string]string{"routes": "none"},
		Short:       "Print the bk CLI version (`bk --version` is the same output)",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprint(cmd.OutOrStdout(), version.Describe())
			return nil
		},
	}
}
