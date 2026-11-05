package sshclient

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type cancelDownloadWriter struct {
	bytes.Buffer
	cancel context.CancelFunc
}

func (w *cancelDownloadWriter) Write(p []byte) (int, error) {
	n, err := w.Buffer.Write(p)
	w.cancel()
	return n, err
}

func TestSFTPDownloadCancelAndResume(t *testing.T) {
	c, dir := testSFTPClient(t)
	file := filepath.Join(dir, "large.bin")
	content := bytes.Repeat([]byte("resume\x00\xff"), 1024*1024)
	if err := os.WriteFile(file, content, 0600); err != nil {
		t.Fatal(err)
	}
	info, err := c.FileMetadata(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	partial := &cancelDownloadWriter{cancel: cancel}
	if err := c.DownloadFileRange(ctx, file, partial, 0, &info, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel did not interrupt transfer: %v", err)
	}
	offset := int64(partial.Len())
	if offset <= 0 || offset >= int64(len(content)) {
		t.Fatalf("invalid partial length %d", offset)
	}
	var remaining bytes.Buffer
	var first int64 = -1
	if err := c.DownloadFileRange(context.Background(), file, &remaining, offset, &info, func(done, total int64, speed float64) {
		if first < 0 {
			first = done
		}
		if done > total || speed < 0 {
			t.Errorf("bad progress %d/%d", done, total)
		}
	}); err != nil {
		t.Fatal(err)
	}
	if first != offset || !bytes.Equal(append(partial.Bytes(), remaining.Bytes()...), content) {
		t.Fatal("resumed bytes/progress mismatch")
	}
	if _, err := c.ListFiles(dir); err != nil {
		t.Fatalf("cancel closed the whole SSH connection: %v", err)
	}
	if err := os.WriteFile(file, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	remaining.Reset()
	if err := c.DownloadFileRange(context.Background(), file, &remaining, 1, &info, nil); err == nil || remaining.Len() != 0 {
		t.Fatal("resumed a different remote file version")
	}
}

func TestSFTPFolderArchiveAndPreviews(t *testing.T) {
	c, dir := testSFTPClient(t)
	root := filepath.Join(dir, "项目 ' folder")
	if err := os.MkdirAll(filepath.Join(root, "空目录"), 0700); err != nil {
		t.Fatal(err)
	}
	md := []byte("# 标题\n\n- 项目\n<script>alert(1)</script>\n")
	if err := os.WriteFile(filepath.Join(root, "readme.md"), md, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(dir, filepath.Join(root, "outside")); err != nil {
		t.Fatal(err)
	}
	var data bytes.Buffer
	if err := c.DownloadDirectory(context.Background(), root, &data, nil); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(data.Bytes()), int64(data.Len()))
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string]string{}
	for _, file := range archive.File {
		if strings.Contains(file.Name, "outside") || strings.Contains(file.Name, "..") || strings.HasPrefix(file.Name, "/") {
			t.Fatalf("unsafe zip path %s", file.Name)
		}
		in, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(in)
		in.Close()
		if err != nil {
			t.Fatal(err)
		}
		entries[file.Name] = string(b)
	}
	base := filepath.Base(root) + "/"
	if len(entries) != 3 || entries[base+"readme.md"] != string(md) {
		t.Fatalf("zip contents: %v", entries)
	}
	if _, ok := entries[base+"空目录/"]; !ok {
		t.Fatal("empty directory lost")
	}
	preview, err := c.PreviewFile(context.Background(), filepath.Join(root, "readme.md"))
	if err != nil || preview.Kind != "markdown" || preview.Data != string(md) {
		t.Fatal(preview, err)
	}
	png := []byte("\x89PNG\r\n\x1a\n")
	if err := os.WriteFile(filepath.Join(root, "image.png"), png, 0600); err != nil {
		t.Fatal(err)
	}
	preview, err = c.PreviewFile(context.Background(), filepath.Join(root, "image.png"))
	if err != nil || preview.Data != base64.StdEncoding.EncodeToString(png) || preview.MIME != "image/png" {
		t.Fatal(preview, err)
	}
	if err := os.WriteFile(filepath.Join(root, "large.txt"), bytes.Repeat([]byte("text"), 300000), 0600); err != nil {
		t.Fatal(err)
	}
	preview, err = c.PreviewFile(context.Background(), filepath.Join(root, "large.txt"))
	if err != nil || !preview.Truncated || len(preview.Data) != 1024*1024 {
		t.Fatalf("text limit: %d %v", len(preview.Data), err)
	}
	if _, err := c.PreviewFile(context.Background(), root); err == nil {
		t.Fatal("preview accepted directory")
	}
	if _, err := c.PreviewFile(context.Background(), filepath.Join(root, "unsafe.html")); err == nil {
		t.Fatal("preview accepted active HTML")
	}
	large, err := os.Create(filepath.Join(root, "large.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	if err := large.Truncate(21 * 1024 * 1024); err != nil {
		t.Fatal(err)
	}
	large.Close()
	if _, err := c.PreviewFile(context.Background(), large.Name()); err == nil {
		t.Fatal("preview accepted oversized binary")
	}
}
