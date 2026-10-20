package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDownloadStaging(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "download-old")
	if err := os.Mkdir(old, 0700); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(old, past, past); err != nil {
		t.Fatal(err)
	}
	dest, err := stageDownload(root, "报告.pdf", func(w io.Writer) error { _, err := w.Write([]byte{0, 255, 42}); return err })
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(dest)
	if err != nil || string(content) != string([]byte{0, 255, 42}) {
		t.Fatal("staging content", err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("stale staging was not removed")
	}
	if _, err := stageDownload(root, "partial", func(w io.Writer) error { w.Write([]byte("partial")); return errors.New("disconnected") }); err == nil {
		t.Fatal("accepted failed transfer")
	}
	files, err := os.ReadDir(root)
	if err != nil || len(files) != 1 {
		t.Fatal("partial download left behind", err)
	}
	for _, name := range []string{"", ".", "..", "../escape", `dir\escape`} {
		if _, err := stageDownload(root, name, func(io.Writer) error { t.Fatal("invalid name reached transfer"); return nil }); err == nil {
			t.Fatal("accepted", name)
		}
	}
}
