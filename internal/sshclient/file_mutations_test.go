package sshclient

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

type brokenUpload struct{}

func (brokenUpload) Read([]byte) (int, error) { return 0, errors.New("source failed") }

func TestSFTPUploadFile(t *testing.T) {
	c, dir := testSFTPClient(t)
	content := bytes.Repeat([]byte{0, 255, 42}, 128*1024)
	name := "上传 ' 文件.bin"
	var counts []int64
	remote, err := c.UploadFile(context.Background(), dir, name, bytes.NewReader(content), int64(len(content)), func(done, total int64, speed float64) {
		if total != int64(len(content)) || speed < 0 {
			t.Errorf("invalid progress %d/%d %f", done, total, speed)
		}
		counts = append(counts, done)
	})
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(remote)
	if err != nil || !bytes.Equal(actual, content) {
		t.Fatal("upload mismatch", err)
	}
	if len(counts) < 2 || counts[0] != 0 || counts[len(counts)-1] != int64(len(content)) {
		t.Fatalf("bad progress: %v", counts)
	}
	if _, err := c.UploadFile(context.Background(), dir, name, bytes.NewBufferString("replace"), 7, nil); err == nil {
		t.Fatal("overwrote existing file")
	}
	actual, _ = os.ReadFile(remote)
	if !bytes.Equal(actual, content) {
		t.Fatal("existing file changed")
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(remote, link); err != nil {
		t.Fatal(err)
	}
	if _, err := c.UploadFile(context.Background(), dir, "link", bytes.NewBufferString("bad"), 3, nil); err == nil {
		t.Fatal("overwrote symlink")
	}
	for _, name := range []string{"", ".", "..", "../escape", `dir\escape`, "a\x00b"} {
		if _, err := c.UploadFile(context.Background(), dir, name, bytes.NewReader(nil), 0, nil); err == nil {
			t.Fatalf("accepted name %q", name)
		}
	}
	for _, tc := range []struct {
		name   string
		source io.Reader
		size   int64
	}{{"failed", brokenUpload{}, 10}, {"changed", bytes.NewBufferString("short"), 10}, {"empty", bytes.NewReader(nil), 0}} {
		_, err := c.UploadFile(context.Background(), dir, tc.name, tc.source, tc.size, nil)
		if tc.name == "empty" {
			if err != nil {
				t.Fatal(err)
			}
			continue
		}
		if err == nil {
			t.Fatal("accepted failed source")
		}
		if _, err := os.Stat(filepath.Join(dir, tc.name)); !os.IsNotExist(err) {
			t.Fatal("partial upload left behind", err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.UploadFile(ctx, dir, "cancelled", bytes.NewReader(content), int64(len(content)), nil); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	ctx, cancel = context.WithCancel(context.Background())
	if _, err := c.UploadFile(ctx, dir, "cancel-midway", bytes.NewReader(content), int64(len(content)), func(done, total int64, speed float64) { cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "cancel-midway")); !os.IsNotExist(err) {
		t.Fatal("cancelled upload left behind", err)
	}
}

func TestSFTPDeleteFileAndDirectory(t *testing.T) {
	c, dir := testSFTPClient(t)
	outside := filepath.Join(dir, "keep")
	if err := os.Mkdir(outside, 0700); err != nil {
		t.Fatal(err)
	}
	keep := filepath.Join(outside, "keep.txt")
	if err := os.WriteFile(keep, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(dir, "删除 ' 文件夹")
	if err := os.MkdirAll(filepath.Join(root, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "file"), []byte("delete"), 0600); err != nil {
		t.Fatal(err)
	}
	for name, target := range map[string]string{"outside-link": outside, "cycle": root, "broken": filepath.Join(dir, "missing")} {
		if err := os.Symlink(target, filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := c.DeleteFile(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("directory still exists", err)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("followed directory symlink", err)
	}
	link := filepath.Join(dir, "top-link")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if err := c.DeleteFile(context.Background(), link); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("followed top-level symlink", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := c.DeleteFile(ctx, keep); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal(err)
	}
	if err := c.DeleteFile(context.Background(), keep); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"", "/", ".", "..", "/tmp/..", keep} {
		if err := c.DeleteFile(context.Background(), invalid); err == nil {
			t.Fatalf("accepted deletion %q", invalid)
		}
	}
	c.Disconnect()
	if err := c.DeleteFile(context.Background(), outside); err == nil {
		t.Fatal("deleted while disconnected")
	}
	if _, err := c.UploadFile(context.Background(), dir, "offline", bytes.NewReader(nil), 0, nil); err == nil {
		t.Fatal("uploaded while disconnected")
	}
}
