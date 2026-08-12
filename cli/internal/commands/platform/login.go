package platform

import (
	"bufio"
	"bytes"
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
	"unicode/utf16"

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
` + config.DisplayPath() + ` (mode 0600).

ONE LOGIN COVERS EVERY APP. --server names whichever app's URL you have; the
token it mints is valid against all of them, and ` + "`bk login`" + ` also learns the
address book, so ` + "`bk <app> …`" + ` routes without anyone typing a second URL.
It does NOT grant anything: whether you have a workspace in an app is that app's
own question, and ` + "`bk <app> workspace list`" + ` asks it.

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
	token, reshaped := sanitizeToken(raw)
	if token == "" {
		return errNoTokenOnStdin(server)
	}
	err := finishLogin(server, token)
	if err == nil {
		return nil
	}
	// A REFUSED TOKEN THAT WENT THROUGH A PIPE HAS A SECOND SUSPECT.
	//
	// `token validation failed: 401` describes the answer, not the cause, and on
	// Windows the cause is frequently the pipeline rather than the token: see
	// sanitizeToken's header. Name what we found, and name the one route that
	// has no encoding in it at all.
	//
	// ONLY when the server actually REFUSED the token. A dead host, a DNS
	// failure or a wrong --server produce the same `err` here, and blaming the
	// encoding for those is a hint that sends the reader somewhere the fix is
	// not — the exact defect every other message in this file was written to
	// remove.
	if !tokenWasRefused(err) {
		return err
	}
	if reshaped != "" {
		return fmt.Errorf("%w\n      the token arrived %s and was decoded before use — "+
			"if it is definitely correct, run `bk login --token` with NO pipe and paste it at the prompt",
			err, reshaped)
	}
	if !term.IsTerminal(fd) {
		return fmt.Errorf("%w\n      if that token is definitely correct, the pipeline may have re-encoded it "+
			"(PowerShell's $OutputEncoding does) — run `bk login --token` with NO pipe and paste it at the prompt", err)
	}
	return err
}

// tokenWasRefused distinguishes "the server said no" from "there was no
// server". Only the first says anything about the token.
func tokenWasRefused(err error) bool {
	var ae *client.APIError
	if !errors.As(err, &ae) {
		return false
	}
	return ae.Status == http.StatusUnauthorized || ae.Status == http.StatusForbidden
}

// sanitizeToken makes a piped token survive a shell that re-encodes the
// pipeline, and reports what it had to undo.
//
// ---------------------------------------------------------------------------
// WHY, AND WHAT IS ACTUALLY VERIFIED HERE
// ---------------------------------------------------------------------------
// `echo <token> | bk login --token` is what this CLI tells everyone to run, and
// it was written and tested on macOS. In PowerShell `echo` is `Write-Output`,
// and the pipeline to a native binary is encoded with `$OutputEncoding` — which
// in Windows PowerShell 5.1 is not UTF-8, and which several common
// configurations make UTF-16 or BOM-prefixed. `strings.TrimSpace` does not strip
// a byte-order mark, so a correct token could arrive with three invisible bytes
// on the front and be refused as invalid with nothing on screen explaining it.
//
// **This was reasoned about, not observed** — nobody on this project has a
// Windows machine, and the phase report says so rather than claiming otherwise.
// That is precisely why the fix is one that cannot be wrong anywhere: a NUL byte
// and a U+FEFF are both impossible inside a real token on every platform, so
// removing them changes nothing that was working and rescues something that was
// not.
//
// Deliberately NOT done: guessing at code pages. Mojibake of a non-ASCII string
// is a different failure with a different fix (`bk guide platform/encoding`),
// tokens are ASCII, and a decoder that guesses is a decoder that corrupts.
//
// The second return value is a fragment for an error message ("with a UTF-8
// byte-order mark"), empty when the input needed nothing.
func sanitizeToken(raw string) (token, reshaped string) {
	b := []byte(raw)
	notes := []string{}

	switch {
	case len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF:
		b = b[3:]
		notes = append(notes, "with a UTF-8 byte-order mark")
	case len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE:
		b = decodeUTF16(b[2:], true)
		notes = append(notes, "UTF-16 encoded (little-endian, with a byte-order mark)")
	case len(b) >= 2 && b[0] == 0xFE && b[1] == 0xFF:
		b = decodeUTF16(b[2:], false)
		notes = append(notes, "UTF-16 encoded (big-endian, with a byte-order mark)")
	case bytes.IndexByte(b, 0x00) >= 0:
		// BOM-LESS UTF-16, which is what a `$OutputEncoding` set to
		// `[Text.Encoding]::Unicode` produces. A NUL byte cannot occur in a real
		// token on any platform, so its presence is the whole detection: no
		// heuristic threshold, nothing to tune. Endianness is decided by which
		// side of each pair the NULs are on.
		//
		// The truncation case matters: the caller reads with ReadString('\n'),
		// which stops ON the 0x0A byte and leaves its trailing 0x00 in the pipe,
		// so the buffer here has ODD length. decodeUTF16 drops the stray byte
		// rather than refusing, which is why this is not an even-length check.
		b = decodeUTF16(b, zerosAreOnOddIndices(b))
		notes = append(notes, "UTF-16 encoded (no byte-order mark)")
	}

	s := string(b)
	// A U+FEFF anywhere else — a BOM that survived a decode, or one pasted in.
	if strings.Contains(s, "\ufeff") {
		s = strings.ReplaceAll(s, "\ufeff", "")
		if len(notes) == 0 {
			notes = append(notes, "with a byte-order mark inside it")
		}
	}
	// Control characters. TrimSpace handles the edges; this catches an embedded
	// one, which no token has and which is invisible on screen.
	if strings.ContainsFunc(s, isControl) {
		s = strings.Map(func(r rune) rune {
			if isControl(r) {
				return -1
			}
			return r
		}, s)
		if len(notes) == 0 {
			notes = append(notes, "with invisible control characters in it")
		}
	}
	return strings.TrimSpace(s), strings.Join(notes, " and ")
}

func isControl(r rune) bool {
	// Not unicode.IsControl: that is true for \n, \r and \t, which are the
	// ordinary end of a piped line and are TrimSpace's job.
	if r == '\n' || r == '\r' || r == '\t' {
		return false
	}
	return r < 0x20 || r == 0x7F
}

// zerosAreOnOddIndices reports whether a BOM-less UTF-16 buffer is
// little-endian, by counting which side of each 2-byte pair the NULs sit on.
// Counting rather than sampling: a buffer truncated mid-pair, or one that
// happens to start with a non-ASCII character, breaks a single-byte test.
func zerosAreOnOddIndices(b []byte) bool {
	odd, even := 0, 0
	for i, c := range b {
		if c != 0x00 {
			continue
		}
		if i%2 == 1 {
			odd++
		} else {
			even++
		}
	}
	return odd >= even
}

// decodeUTF16 reads 2-byte code units and returns UTF-8. A trailing odd byte is
// dropped — see the truncation note in sanitizeToken.
func decodeUTF16(b []byte, littleEndian bool) []byte {
	units := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		if littleEndian {
			units = append(units, uint16(b[i])|uint16(b[i+1])<<8)
		} else {
			units = append(units, uint16(b[i])<<8|uint16(b[i+1]))
		}
	}
	return []byte(string(utf16.Decode(units)))
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
