package sshclient

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestParsePaneScrollState(t *testing.T) {
	state, err := parsePaneScrollState("%3|100||24|0\n")
	if err != nil || state.Position != 100 || state.Lines != 100 || state.Rows != 24 {
		t.Fatal(state, err)
	}
	state, err = parsePaneScrollState("%3|100|20|24|1\n")
	if err != nil || state.Position != 80 || !state.mode {
		t.Fatal(state, err)
	}
	for _, invalid := range []string{"", "||||", "%1|bad|0|24|0", "%1|-1|0|24|0"} {
		if _, err := parsePaneScrollState(invalid); err == nil {
			t.Fatalf("accepted %q", invalid)
		}
	}
}

func TestTmuxHistoryScrollbar(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux is not installed")
	}
	socket := filepath.Join(t.TempDir(), "tmux.sock")
	tmux := func(args ...string) string {
		t.Helper()
		output, err := exec.Command("tmux", append([]string{"-S", socket}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("tmux %v: %s: %v", args, output, err)
		}
		return string(output)
	}
	tmux("-f", "/dev/null", "new-session", "-d", "-s", "work", "-x", "80", "-y", "24", "sh")
	t.Cleanup(func() { _ = exec.Command("tmux", "-S", socket, "kill-server").Run() })
	tmux("send-keys", "-t", "work:", "seq 1 300", "Enter")
	for i := 0; i < 100; i++ {
		if strings.TrimSpace(tmux("display-message", "-p", "-t", "work:", "#{history_size}")) != "0" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	server := startSSH(t, nil)
	server.mu.Lock()
	server.runCommand = func(cmd string) (string, error) {
		cmd = strings.ReplaceAll(cmd, "tmux ", "tmux -S "+quoteSh(socket)+" ")
		output, err := exec.Command("sh", "-c", cmd).CombinedOutput()
		return string(output), err
	}
	server.mu.Unlock()
	client := New(func(TerminalEvent) {}, nil, ssh.InsecureIgnoreHostKey(), nil, nil)
	defer client.Disconnect()
	if _, err := client.Connect(inputFor(server)); err != nil {
		t.Fatal(err)
	}
	opened, err := client.OpenSession(CreateSessionInput{Name: "work"})
	if err != nil {
		t.Fatal(err)
	}
	state, err := client.GetTerminalScrollState(opened.TerminalID)
	if err != nil || state.Lines < 200 || state.Position != state.Lines {
		t.Fatal(state, err)
	}
	start := state.Lines
	state, err = client.ScrollTerminal(opened.TerminalID, -10, true)
	if err != nil || state.Position != start-10 {
		t.Fatal("wheel up", state, err)
	}
	state, err = client.ScrollTerminal(opened.TerminalID, 20, false)
	if err != nil || state.Position != 20 {
		t.Fatal("drag", state, err)
	}
	state, err = client.ScrollTerminal(opened.TerminalID, 8, true)
	if err != nil || state.Position != 28 {
		t.Fatal("wheel down", state, err)
	}
	state, err = client.ScrollTerminal(opened.TerminalID, start, false)
	if err != nil || state.Position != start {
		t.Fatal("return live", state, err)
	}
	if strings.TrimSpace(tmux("display-message", "-p", "-t", "work:", "#{pane_in_mode}")) != "0" {
		t.Fatal("copy mode remains active")
	}
	if _, err := client.ScrollTerminal(opened.TerminalID, -20, true); err != nil {
		t.Fatal(err)
	}
	if err := client.WriteTerminal(opened.TerminalID, "typed"); err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(tmux("display-message", "-p", "-t", "work:", "#{pane_in_mode}")) != "0" {
		t.Fatal("typing did not leave history mode")
	}
	if _, err := client.ScrollTerminal(opened.TerminalID, -20, true); err != nil {
		t.Fatal(err)
	}
	tmux("send-keys", "-X", "-t", "work:", "cancel")
	if err := client.WriteTerminal(opened.TerminalID, "after-escape"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.ScrollTerminal(opened.TerminalID, -20, true); err != nil {
		t.Fatal(err)
	}
	client.CloseTerminal(opened.TerminalID)
	if strings.TrimSpace(tmux("display-message", "-p", "-t", "work:", "#{pane_in_mode}")) != "0" {
		t.Fatal("closing left history mode active")
	}
}
