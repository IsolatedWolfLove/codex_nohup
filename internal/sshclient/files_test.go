package sshclient

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type failedDownloadWriter struct{}

func (failedDownloadWriter) Write(p []byte) (int, error) { return 0, errors.New("disk full") }

func TestSFTPBrowseAndDownload(t *testing.T) {
	c, dir := testSFTPClient(t)
	folder := filepath.Join(dir, "子目录")
	if err := os.Mkdir(folder, 0700); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(dir, "下载 ' \\ test.bin")
	content := bytes.Repeat([]byte{0, 1, 255, 42}, 128*1024)
	if err := os.WriteFile(filename, content, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "folder-link")
	if err := os.Symlink(folder, link); err != nil {
		t.Fatal(err)
	}
	listing, err := c.ListFiles(dir)
	if err != nil {
		t.Fatal(err)
	}
	if listing.Path != dir || listing.Parent != filepath.Dir(dir) || len(listing.Entries) != 3 {
		t.Fatalf("bad listing: %+v", listing)
	}
	if !listing.Entries[0].IsDir || !listing.Entries[1].IsDir || listing.Entries[2].IsDir || listing.Entries[2].Size != int64(len(content)) {
		t.Fatalf("bad metadata/order: %+v", listing.Entries)
	}
	empty, err := c.ListFiles(link)
	if err != nil || len(empty.Entries) != 0 || empty.Entries == nil {
		t.Fatalf("empty directory: %+v, %v", empty, err)
	}
	var output bytes.Buffer
	if err := c.DownloadFile(filename, &output); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(output.Bytes(), content) {
		t.Fatal("binary download mismatch")
	}
	for _, invalid := range []string{folder, filepath.Join(dir, "missing")} {
		output.Reset()
		if err := c.DownloadFile(invalid, &output); err == nil || output.Len() != 0 {
			t.Fatalf("accepted invalid file %s", invalid)
		}
	}
	if err := c.DownloadFile(filename, failedDownloadWriter{}); err == nil {
		t.Fatal("ignored local write failure")
	}
	if _, err := c.ListFiles(filename); err == nil {
		t.Fatal("accepted file as directory")
	}
	if _, err := c.ListFiles(""); err != nil {
		t.Fatalf("default directory: %v", err)
	}
	c.Disconnect()
	if _, err := c.ListFiles(dir); err == nil {
		t.Fatal("browse while disconnected")
	}
	if err := c.DownloadFile(filename, &output); err == nil {
		t.Fatal("download while disconnected")
	}
}
