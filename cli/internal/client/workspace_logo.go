package client

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// WorkspaceLogo is what POST/DELETE /api/workspaces/{ws}/logo answer with.
type WorkspaceLogo struct {
	ID      int     `json:"id" yaml:"id"`
	Name    string  `json:"name" yaml:"name"`
	Slug    string  `json:"slug" yaml:"slug"`
	LogoURL *string `json:"logo_url" yaml:"logo_url"`
}

// SetWorkspaceLogo uploads an image as the workspace's logo — the narrow,
// logo-only route every app serves (`workspaceLogoRoute`), not /api/upload.
// The server decides what it accepts (type and size are served by `bk meta`);
// the content type sent here is only a hint read from the extension.
func (c *Client) SetWorkspaceLogo(slugOrID, filePath string) (*WorkspaceLogo, error) {
	var out WorkspaceLogo
	if err := c.postImage("/api/workspaces/"+url.PathEscape(slugOrID)+"/logo", filePath, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// postImage sends one file as the multipart "file" field. The content type is
// a hint from the extension; the server decides what it accepts.
func (c *Client) postImage(path, filePath string, out any) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	base := filepath.Base(filePath)
	ctype := mime.TypeByExtension(strings.ToLower(filepath.Ext(base)))
	if ctype == "" {
		ctype = "application/octet-stream"
	}

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, base))
	h.Set("Content-Type", ctype)
	part, err := w.CreatePart(h)
	if err != nil {
		return err
	}
	if _, err := io.Copy(part, f); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, c.BaseURL+path, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	return c.do(req, out)
}

// SetAvatar uploads an image as your profile photo — `POST /api/me/avatar`,
// the narrow route every app serves (`meAvatarRoute`), not /api/upload.
func (c *Client) SetAvatar(filePath string) (*AvatarResult, error) {
	var out AvatarResult
	if err := c.postImage("/api/me/avatar", filePath, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RemoveAvatar clears your photo; you get your initials again.
func (c *Client) RemoveAvatar() (*AvatarResult, error) {
	var out AvatarResult
	if err := c.deleteJSON("/api/me/avatar", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// AvatarResult is what POST/DELETE /api/me/avatar answer with.
type AvatarResult struct {
	ID        int     `json:"id" yaml:"id"`
	Email     string  `json:"email" yaml:"email"`
	Name      *string `json:"name" yaml:"name"`
	AvatarURL *string `json:"avatar_url" yaml:"avatar_url"`
}

// RemoveWorkspaceLogo clears the logo; the workspace keeps its coloured initial.
func (c *Client) RemoveWorkspaceLogo(slugOrID string) (*WorkspaceLogo, error) {
	var out WorkspaceLogo
	if err := c.deleteJSON("/api/workspaces/"+url.PathEscape(slugOrID)+"/logo", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
