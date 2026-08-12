package platform

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/browser"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func newLoginCmd() *cobra.Command {
	var server string
	var pasteToken bool
	cmd := &cobra.Command{
		Use:         "login",
		Annotations: map[string]string{"routes": "GET /api/me"},
		Short:       "Authenticate against any Blackcode app's server",
		Long: `By default, opens a browser to /cli/authorize on the server, captures
the minted token via a loopback HTTP server, and saves credentials to
~/.config/bk/config.json (mode 0600).

ONE LOGIN COVERS EVERY APP. --server names whichever app's URL you have; the
token it mints is valid against all of them, and `+"`bk login`"+` also learns the
address book, so `+"`bk <app> …`"+` routes without anyone typing a second URL.
It does NOT grant anything: whether you have a workspace in an app is that app's
own question, and `+"`bk <app> workspace list`"+` asks it.

Use --token for headless/CI, where there is no browser. It is a SWITCH, not a
value: the token is read from STDIN, so it never lands in your shell history,
your process list, or a CI log of the command line.

  echo <token> | bk login --token

--token=<token> and --token <token> are therefore both errors, and both say
this.`,
		// WHY THIS IS NOT cobra.NoArgs.
		//
		// `bk login --token bk_live_…` is the natural guess for a flag that
		// sounds like it takes a value, and it was reported from a real first
		// run (Todo/issues-app-feedback.md item 5). Cobra does not attach the
		// value to a boolean flag, so the token arrives here as a stray
		// positional and the command went on to read an empty stdin and fail
		// with `read token: EOF` — an error about the wrong thing entirely.
		//
		// cobra.NoArgs would fix the silence but not the confusion: its message
		// names the extra argument without saying what to do instead. This one
		// names the working invocation, and takes care never to echo the token
		// back — printing it would defeat the reason it goes on stdin.
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return nil
			}
			if pasteToken || strings.HasPrefix(args[0], "bk_live_") {
				return cmdutil.Usagef(
					"--token takes no value — it reads the token from stdin, so it stays out of your "+
						"shell history and process list.\n      Run: echo <token> | bk login --server %s --token",
					serverOrDefault(server))
			}
			return cmdutil.Usagef("unexpected argument %q — `bk login` takes flags only", args[0])
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			server = serverOrDefault(server)

			if pasteToken {
				return runPasteLogin(server)
			}
			return runBrowserLogin(server)
		},
	}
	cmd.Flags().StringVar(&server, "server", "", "Server base URL of any Blackcode app (default: "+config.DefaultServer+")")
	cmd.Flags().BoolVar(&pasteToken, "token", false, "Read a pre-existing token from STDIN instead of opening a browser. A "+
			"switch, not a value: echo <token> | bk login --token")
	return cmd
}

func serverOrDefault(server string) string {
	if server == "" {
		return config.DefaultServer
	}
	return server
}

// errNoTokenOnStdin is the one message for "--token, but no token arrived".
// Every route into it is the same user mistake, so they get the same runnable
// line back rather than three descriptions of three internal causes.
func errNoTokenOnStdin(server string) error {
	return cmdutil.Usagef(
		"no token on stdin — --token reads it from there, it does not take a value.\n"+
			"      Run: echo <token> | bk login --server %s --token\n"+
			"      No token yet? run `bk login` with no flags to mint one in a browser",
		serverOrDefault(server))
}

func runPasteLogin(server string) error {
	fmt.Fprintf(os.Stderr, "Server: %s\n", server)
	fd := int(os.Stdin.Fd())
	var raw string
	if term.IsTerminal(fd) {
		fmt.Fprint(os.Stderr, "Token (paste, input hidden): ")
		b, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return fmt.Errorf("read token: %w", err)
		}
		raw = string(b)
	} else {
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			// Nothing on stdin. In practice this is not an I/O fault, it is
			// `bk login --token` typed with no pipe — including the two
			// spellings that look like they pass a value. `read token: EOF`
			// described the plumbing and left the caller nowhere to go.
			return errNoTokenOnStdin(server)
		}
		raw = line
	}
	token := strings.TrimSpace(raw)
	if token == "" {
		return errNoTokenOnStdin(server)
	}
	return finishLogin(server, token)
}

func runBrowserLogin(server string) error {
	state, err := randomHex(32)
	if err != nil {
		return fmt.Errorf("generate state: %w", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("loopback listen: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	callback := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	hostname, _ := os.Hostname()
	tokenName := fmt.Sprintf("cli-%s", hostname)
	if hostname == "" {
		tokenName = "cli"
	}

	authorizeURL := fmt.Sprintf(
		"%s/cli/authorize?callback=%s&state=%s&name=%s",
		strings.TrimRight(server, "/"),
		url.QueryEscape(callback),
		url.QueryEscape(state),
		url.QueryEscape(tokenName),
	)

	type result struct {
		token string
		err   error
	}
	ch := make(chan result, 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		gotState := q.Get("state")
		gotToken := q.Get("token")
		if gotState != state {
			http.Error(w, "state mismatch — close this tab and try again", http.StatusBadRequest)
			ch <- result{err: errors.New("state mismatch")}
			return
		}
		if gotToken == "" {
			http.Error(w, "missing token", http.StatusBadRequest)
			ch <- result{err: errors.New("missing token in callback")}
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintln(w, `<!doctype html><html><head><meta charset="utf-8"><title>bk CLI</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b10;color:#e7e7ee;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}.box{max-width:420px;padding:32px;
background:#15151d;border:1px solid #25252e;border-radius:16px}h1{margin:0 0 8px;font-size:18px}
p{margin:0;color:#a1a1aa;font-size:14px}</style></head><body><div class="box">
<h1>✓ bk CLI authorized</h1><p>You can close this tab and return to your terminal.</p>
</div></body></html>`)
		ch <- result{token: gotToken}
	})

	server2 := &http.Server{Handler: mux}
	go func() { _ = server2.Serve(listener) }()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server2.Shutdown(ctx)
	}()

	fmt.Fprintf(os.Stderr, "Opening browser to authorize:\n  %s\n", authorizeURL)
	if err := browser.Open(authorizeURL); err != nil {
		fmt.Fprintf(os.Stderr,
			"\nCouldn't open browser automatically. Open this URL manually:\n  %s\n\n",
			authorizeURL,
		)
	}
	fmt.Fprintln(os.Stderr, "Waiting for approval (5 minutes timeout)…")

	select {
	case res := <-ch:
		if res.err != nil {
			return fmt.Errorf("authorization failed: %w", res.err)
		}
		return finishLogin(server, res.token)
	case <-time.After(5 * time.Minute):
		return errors.New("timed out waiting for browser authorization")
	}
}

func finishLogin(server, token string) error {
	server = strings.TrimRight(server, "/")
	c := client.New(server, token, "")
	me, err := c.Whoami()
	if err != nil {
		return fmt.Errorf("token validation failed: %w", err)
	}
	cfg := &config.Config{
		Server:     server,
		HomeServer: server,
		Token:      token,
		UserID:     me.ID,
		Email:      me.Email,
	}

	// Learn the app address book (D-1) from the server we just authenticated
	// against. --server may name ANY app (D-21), so this is also what decides
	// which app is home: whichever one this deployment says it is.
	//
	// A failure here does NOT fail the login. The token is valid and saved; the
	// registry is refreshable with one command, and losing a working login over
	// a missing address book would be the worse trade. It is reported, never
	// swallowed: an empty registry is what makes `bk <app> …` fail later, and
	// nobody should have to guess why.
	var mismatch *registryMismatch
	if meta, mErr := c.Meta(""); mErr == nil {
		mismatch = applyAppRegistry(cfg, meta, server)
	} else {
		fmt.Fprintf(os.Stderr,
			"warning: logged in, but could not read the app registry from %s: %v\n"+
				"         run `bk meta` once before using `bk <app> …`\n", server, mErr)
	}

	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("save config: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Logged in as %s (id=%d, role=%s)\n", me.Email, me.ID, me.Role)
	if cfg.HomeApp != "" {
		fmt.Fprintf(os.Stderr, "Home app: %s (%s)\n", cfg.HomeApp, cfg.HomeServer)
	}
	for _, pair := range registryPairs(cfg) {
		fmt.Fprintf(os.Stderr, "  %s\n", pair)
	}
	// Last, so it is the line still on screen. A login at a non-canonical host
	// succeeds and must — but every link built from this session carries that
	// host, and the moment to say so is while the user is still looking.
	reportMismatch(os.Stderr, mismatch)
	return nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func newLogoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "logout",
		Annotations: map[string]string{"routes": "none"},
		Short:       "Remove stored credentials",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := config.Delete(); err != nil {
				return err
			}
			fmt.Fprintln(os.Stderr, "Logged out.")
			return nil
		},
	}
}

func newWhoamiCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "whoami",
		Annotations: map[string]string{"routes": "GET /api/me"},
		Short:       "Print the authenticated user",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			c, err := cmdutil.ClientForApp(cfg, "")
			if err != nil {
				return err
			}
			me, err := c.Whoami()
			if err != nil {
				return err
			}
			name := ""
			if me.Name != nil {
				name = *me.Name
			}
			fmt.Printf("id:    %d\nemail: %s\nname:  %s\nrole:  %s\nvia:   %s\n",
				me.ID, me.Email, name, me.Role, me.Via)
			if me.IsSuperAdmin {
				fmt.Printf("super: yes (platform-wide admin — `bk super-admin --help`)\n")
			}
			return nil
		},
	}
}
