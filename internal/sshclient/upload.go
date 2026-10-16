package sshclient

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/pkg/sftp"
)

const maxImageBytes = 20 * 1024 * 1024

func decodeImage(data string) ([]byte, string, error) {
	if len(data) > base64.StdEncoding.EncodedLen(maxImageBytes) {
		return nil, "", errors.New("截图不能超过 20 MiB")
	}
	content, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return nil, "", errors.New("图片编码无效")
	}
	if len(content) > maxImageBytes {
		return nil, "", errors.New("截图不能超过 20 MiB")
	}
	extension := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}[http.DetectContentType(content)]
	if extension == "" {
		return nil, "", errors.New("仅支持 PNG、JPEG、GIF 和 WebP 图片")
	}
	return content, extension, nil
}

// UploadImage stores screenshots on the selected host without executing pasted text.
func (c *Client) UploadImage(data string) (string, error) {
	content, ext, err := decodeImage(data)
	if err != nil {
		return "", err
	}
	c.op.Lock()
	defer c.op.Unlock()
	conn, err := c.current()
	if err != nil {
		return "", err
	}
	var dir string
	if conn.info.Platform == "windows" {
		result, e := checked(execCommand(conn.client, psCommand("$p=Join-Path $env:LOCALAPPDATA 'NohopCodex\\images'; New-Item -ItemType Directory -Force -Path $p | Out-Null; [Console]::Out.Write($p)")))
		if e != nil {
			return "", e
		}
		dir = strings.TrimSpace(result.stdout)
	} else {
		result, e := checked(execCommand(conn.client, `umask 077; mkdir -p "$HOME/.local/share/nohop-codex/images" && printf '%s' "$HOME/.local/share/nohop-codex/images"`))
		if e != nil {
			return "", e
		}
		dir = strings.TrimSpace(result.stdout)
	}
	if dir == "" || strings.ContainsAny(dir, "\r\n") {
		return "", errors.New("无法确定截图目录")
	}
	path := strings.TrimRight(strings.ReplaceAll(dir, `\`, "/"), "/") + "/" + uuid.NewString() + ext
	ftp, err := sftp.NewClient(conn.client)
	if err != nil {
		return "", err
	}
	defer ftp.Close()
	file, err := ftp.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return "", err
	}
	cleanup := func(e error) (string, error) { file.Close(); _ = ftp.Remove(path); return "", e }
	if conn.info.Platform != "windows" {
		if err = file.Chmod(0600); err != nil {
			return cleanup(err)
		}
	}
	if _, err = io.Copy(file, bytes.NewReader(content)); err != nil {
		return cleanup(err)
	}
	if err = file.Close(); err != nil {
		_ = ftp.Remove(path)
		return "", fmt.Errorf("保存截图失败：%w", err)
	}
	return path, nil
}
