package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"nohop-codex/internal/sshclient"
)

func TestDownloadCacheResumeAndSourceValidation(t *testing.T) {
	root := t.TempDir()
	source := downloadSource{ConnectionID: "server", File: sshclient.RemoteFile{Name: "data.bin", Path: "/work/data.bin", Size: 6, Modified: 100}}
	first := func(w io.Writer, offset int64) error {
		if offset != 0 {
			t.Fatal(offset)
		}
		_, err := w.Write([]byte("abc"))
		if err != nil {
			return err
		}
		return errors.New("disconnected")
	}
	if _, err := prepareDownload(context.Background(), root, "task", source, first); err == nil {
		t.Fatal("accepted partial transfer")
	}
	changed := source
	changed.File.Modified++
	if _, err := prepareDownload(context.Background(), root, "task", changed, func(io.Writer, int64) error { t.Fatal("mixed changed source"); return nil }); err == nil {
		t.Fatal("accepted changed file")
	}
	finished, err := prepareDownload(context.Background(), root, "task", source, func(w io.Writer, offset int64) error {
		if offset != 3 {
			t.Fatal("lost resume offset", offset)
		}
		_, err := io.WriteString(w, "def")
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(finished)
	if err != nil || string(data) != "abcdef" {
		t.Fatal(string(data), err)
	}
	// Failed/cancelled native save retries reuse the completed file.
	again, err := prepareDownload(context.Background(), root, "task", source, func(io.Writer, int64) error { t.Fatal("redownloaded completed file"); return nil })
	if err != nil || again != finished {
		t.Fatal(again, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := prepareDownload(ctx, root, "task", source, first); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestArchiveRetryStartsFreshAndExportCancellation(t *testing.T) {
	root := t.TempDir()
	source := downloadSource{ConnectionID: "server", Folder: true, File: sshclient.RemoteFile{Name: "folder", Path: "/work/folder", IsDir: true}}
	if _, err := prepareDownload(context.Background(), root, "zip", source, func(w io.Writer, _ int64) error { io.WriteString(w, "partial"); return errors.New("cancel") }); err == nil {
		t.Fatal("accepted partial zip")
	}
	finished, err := prepareDownload(context.Background(), root, "zip", source, func(w io.Writer, offset int64) error {
		if offset != 0 {
			t.Fatal("appended to incomplete zip")
		}
		_, err := io.WriteString(w, "valid-zip")
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "existing.zip")
	if err := os.WriteFile(destination, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := copyDownload(ctx, finished, destination, func(int64, int64, float64) {}); err == nil {
		t.Fatal("ignored cancellation")
	}
	data, _ := os.ReadFile(destination)
	if !bytes.Equal(data, []byte("original")) {
		t.Fatal("cancelled export overwrote destination")
	}
	app := newApp()
	ctx, finish, err := app.beginFileOperation("running")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := app.beginFileOperation("running"); err == nil {
		t.Fatal("duplicate operation accepted")
	}
	app.CancelDownload("running")
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal("cancel lost")
	}
	finish()
	_, finish, err = app.beginFileOperation("running")
	if err != nil {
		t.Fatal(err)
	}
	finish()
}
