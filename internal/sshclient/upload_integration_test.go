package sshclient

import (
	"encoding/base64"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

func testSFTPClient(t *testing.T) (*Client, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("checks POSIX remote paths and permissions")
	}
	dir := t.TempDir()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer(t))
	done := make(chan struct{})
	go func() {
		defer close(done)
		raw, err := listener.Accept()
		if err != nil {
			return
		}
		conn, channels, reqs, err := ssh.NewServerConn(raw, config)
		if err != nil {
			raw.Close()
			return
		}
		defer conn.Close()
		go ssh.DiscardRequests(reqs)
		for incoming := range channels {
			channel, requests, err := incoming.Accept()
			if err != nil {
				continue
			}
			go func() {
				defer channel.Close()
				for req := range requests {
					switch req.Type {
					case "exec":
						req.Reply(true, nil)
						io.WriteString(channel, dir)
						channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
						return
					case "subsystem":
						req.Reply(true, nil)
						server, err := sftp.NewServer(channel)
						if err != nil {
							return
						}
						defer server.Close()
						_ = server.Serve()
						return
					}
				}
			}()
		}
	}()
	sshConn, err := ssh.Dial("tcp", listener.Addr().String(), &ssh.ClientConfig{User: "test", HostKeyCallback: ssh.InsecureIgnoreHostKey()})
	if err != nil {
		t.Fatal(err)
	}
	c := New(func(TerminalEvent) {}, nil, nil, nil, nil)
	c.conn = &connection{client: sshConn, info: ConnectionInfo{Platform: "linux"}}
	t.Cleanup(func() { c.Disconnect(); <-done })
	return c, dir
}

func TestUploadImageOverSFTP(t *testing.T) {
	c, dir := testSFTPClient(t)
	png := []byte("\x89PNG\r\n\x1a\nexample")
	path, err := c.UploadImage(base64.StdEncoding.EncodeToString(png))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != dir || !strings.HasSuffix(path, ".png") {
		t.Fatal(path)
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != string(png) {
		t.Fatal("upload contents", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 1 {
		t.Fatal("unexpected leftover upload files")
	}
}
