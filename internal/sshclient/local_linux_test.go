//go:build linux && !android

package sshclient

import (
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNativeLocalTmux(t *testing.T) {
	tmux, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux is not installed")
	}
	socket := "nohop-test-" + uuid.NewString()
	bin := t.TempDir()
	wrapper := "#!/bin/sh\nexec " + quoteSh(tmux) + " -L " + quoteSh(socket) + " -f /dev/null \"$@\"\n"
	if err := os.WriteFile(filepath.Join(bin, "tmux"), []byte(wrapper), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("SHELL", "/bin/sh")
	t.Cleanup(func() { exec.Command(tmux, "-L", socket, "kill-server").Run() })
	var mu sync.Mutex
	var output strings.Builder
	c := New(func(event TerminalEvent) {
		if event.Type == "data" {
			data, _ := base64.StdEncoding.DecodeString(event.Data)
			mu.Lock()
			output.Write(data)
			mu.Unlock()
		}
	}, nil, nil, nil, nil)
	t.Cleanup(c.Disconnect)
	// No hostname, user, credentials or SSH server are required.
	info, err := c.Connect(ConnectInput{Local: true})
	if err != nil || info.Backend != "tmux" {
		t.Fatal(info, err)
	}
	cwd := filepath.Join(t.TempDir(), "work' folder")
	if err := os.Mkdir(cwd, 0700); err != nil {
		t.Fatal(err)
	}
	opened, err := c.OpenSession(CreateSessionInput{Name: "native-work", Cwd: cwd, Cols: 100, Rows: 30})
	if err != nil {
		t.Fatal(err)
	}
	c.ReadyTerminal(opened.TerminalID)
	wait := func(text string) {
		t.Helper()
		deadline := time.Now().Add(4 * time.Second)
		for time.Now().Before(deadline) {
			mu.Lock()
			found := strings.Contains(output.String(), text)
			mu.Unlock()
			if found {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		mu.Lock()
		defer mu.Unlock()
		t.Fatalf("did not receive %q; got %q", text, output.String())
	}
	if err := c.WriteTerminal(opened.TerminalID, "printf 'NATIVE_%s\\n' 'OK'; pwd\r"); err != nil {
		t.Fatal(err)
	}
	wait("NATIVE_OK")
	wait(cwd)
	if err := c.ResizeTerminal(opened.TerminalID, 101, 37); err != nil {
		t.Fatal(err)
	}
	// Resizing a tmux client is asynchronous; query its actual pane size.
	deadline := time.Now().Add(3 * time.Second)
	for {
		result, err := exec.Command(tmux, "-L", socket, "display-message", "-p", "-t", "native-work", "#{pane_width} #{pane_height}").Output()
		if err == nil && strings.HasPrefix(string(result), "101 ") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("resize not applied: %s %v", result, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := c.GetTerminalScrollState(opened.TerminalID); err != nil {
		t.Fatal(err)
	}
	c.CloseTerminal(opened.TerminalID)
	sessions, err := c.ListSessions()
	if err != nil || len(sessions) != 1 || sessions[0].Name != "native-work" {
		t.Fatal("closing tab lost session", sessions, err)
	}
	c.Disconnect()
	if _, err := c.Connect(ConnectInput{Local: true}); err != nil {
		t.Fatal(err)
	}
	reopened, err := c.OpenSession(CreateSessionInput{Name: "native-work"})
	if err != nil {
		t.Fatal(err)
	}
	c.ReadyTerminal(reopened.TerminalID)
	if err := c.WriteTerminal(reopened.TerminalID, "printf 'REATTACH_%s\\n' 'OK'\r"); err != nil {
		t.Fatal(err)
	}
	wait("REATTACH_OK")
	if err := c.KillSession("native-work"); err != nil {
		t.Fatal(err)
	}
	sessions, err = c.ListSessions()
	if err != nil || len(sessions) != 0 {
		t.Fatal("kill failed", sessions, err)
	}
	if _, err := c.ListFiles(""); err == nil {
		t.Fatal("SFTP accepted local connection")
	}
	if _, err := c.StartPortForward(PortForwardInput{Direction: "local", ListenPort: 8080, TargetHost: "localhost", TargetPort: 80}); err == nil {
		t.Fatal("SSH forwarding accepted local connection")
	}
}
