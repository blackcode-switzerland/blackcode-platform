package platform

import (
	"strings"
	"testing"
)

// A piped token must survive a shell that re-encodes the pipeline.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PROVES, AND WHAT IT DOES NOT
// ═══════════════════════════════════════════════════════════════════════════
// It proves that the byte sequences PowerShell's `$OutputEncoding` can put in
// front of, or through, a piped token are decoded back to the token. It does
// NOT prove PowerShell produces those sequences — nobody here has a Windows
// machine to observe it on, and the phase report says so rather than pretending
// otherwise. The bytes are constructed here from the encodings themselves.
//
// That split is the reason the implementation is shaped the way it is: every
// transformation asserted below is one that cannot damage a correct token on
// any platform, because a NUL byte and a U+FEFF cannot occur inside one.
//
// The negative case at the bottom is the important half. A sanitizer that
// mangles the ordinary macOS/Linux input while "fixing" Windows would be a far
// worse bug than the one it replaces, and "it returned something" is satisfied
// by every wrong answer.
// ═══════════════════════════════════════════════════════════════════════════

const tok = "bk_live_abcdef0123456789"

func utf16le(s string, bom bool) string {
	var b []byte
	if bom {
		b = append(b, 0xFF, 0xFE)
	}
	for _, r := range s {
		b = append(b, byte(r), 0x00)
	}
	return string(b)
}

func utf16be(s string, bom bool) string {
	var b []byte
	if bom {
		b = append(b, 0xFE, 0xFF)
	}
	for _, r := range s {
		b = append(b, 0x00, byte(r))
	}
	return string(b)
}

func TestSanitizeTokenLeavesOrdinaryInputAlone(t *testing.T) {
	cases := map[string]string{
		"bare":                 tok,
		"trailing newline":     tok + "\n",
		"CRLF":                 tok + "\r\n",
		"surrounding spaces":   "  " + tok + "  \n",
		"tabs a CI job leaves": "\t" + tok + "\t\n",
	}
	for name, in := range cases {
		got, reshaped := sanitizeToken(in)
		if got != tok {
			t.Errorf("%s: sanitizeToken(%q) = %q, want %q", name, in, got, tok)
		}
		// Nothing was undone, so nothing may be claimed. The error message this
		// feeds says "the token arrived …", and saying that about a clean pipe
		// would send the reader after a cause that is not there.
		if reshaped != "" {
			t.Errorf("%s: reported %q for input that needed nothing", name, reshaped)
		}
	}
}

func TestSanitizeTokenStripsAUTF8BOM(t *testing.T) {
	got, reshaped := sanitizeToken("\ufeff" + tok + "\n")
	if got != tok {
		t.Fatalf("got %q, want %q", got, tok)
	}
	if !strings.Contains(reshaped, "UTF-8 byte-order mark") {
		t.Fatalf("reshaped = %q, want it to name the UTF-8 BOM", reshaped)
	}
}

func TestSanitizeTokenDecodesUTF16(t *testing.T) {
	cases := map[string]string{
		"LE with BOM":    utf16le(tok+"\n", true),
		"BE with BOM":    utf16be(tok+"\n", true),
		"LE without BOM": utf16le(tok+"\n", false),
		"BE without BOM": utf16be(tok+"\n", false),
	}
	for name, in := range cases {
		got, reshaped := sanitizeToken(in)
		if got != tok {
			t.Errorf("%s: got %q, want %q", name, got, tok)
		}
		if !strings.Contains(reshaped, "UTF-16") {
			t.Errorf("%s: reshaped = %q, want it to name UTF-16", name, reshaped)
		}
	}
}

// THE TRUNCATION CASE, and the reason this is not an even-length check.
//
// The caller reads with bufio.ReadString('\n'), which stops ON the 0x0A byte.
// In UTF-16LE the newline is `0A 00`, so the trailing NUL is still in the pipe
// and the buffer that reaches sanitizeToken has ODD length. A decoder that
// required an even number of bytes would refuse exactly the input this whole
// function exists for.
func TestSanitizeTokenSurvivesAUTF16BufferCutAtTheNewline(t *testing.T) {
	full := utf16le(tok+"\n", false)
	cut := full[:len(full)-1] // drop the newline's high byte, as ReadString does
	if len(cut)%2 == 0 {
		t.Fatalf("the truncated buffer is meant to have odd length, got %d", len(cut))
	}
	got, _ := sanitizeToken(cut)
	if got != tok {
		t.Fatalf("got %q, want %q", got, tok)
	}
}

func TestSanitizeTokenStripsEmbeddedInvisibles(t *testing.T) {
	got, reshaped := sanitizeToken(tok[:8] + "\ufeff" + tok[8:] + "\n")
	if got != tok {
		t.Errorf("BOM inside: got %q, want %q", got, tok)
	}
	if reshaped == "" {
		t.Error("BOM inside: reported nothing")
	}

	got, reshaped = sanitizeToken(tok[:8] + "\x01" + tok[8:] + "\n")
	if got != tok {
		t.Errorf("control char: got %q, want %q", got, tok)
	}
	if reshaped == "" {
		t.Error("control char: reported nothing")
	}
}

// An input that is nothing but an encoding artefact must come back empty, so the
// caller reaches errNoTokenOnStdin — the message that names the working
// invocation — rather than sending a BOM to the server as a bearer token.
func TestSanitizeTokenReturnsEmptyForAnArtefactOnlyInput(t *testing.T) {
	for _, in := range []string{"\ufeff\n", "\xff\xfe\n\x00", "\n", "  \r\n"} {
		if got, _ := sanitizeToken(in); got != "" {
			t.Errorf("sanitizeToken(%q) = %q, want empty", in, got)
		}
	}
}
