package sshclient

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestShellCommands(t *testing.T) {
	if normalizeName(" train/run'; reboot ") != "train-run-reboot" {
		t.Fatal("unsafe name")
	}
	cmd, err := attachCommand("tmux", "bad'; touch /tmp/x", "/data/a'b")
	if err != nil || strings.Contains(cmd, "'; touch /tmp/x") || !strings.Contains(cmd, `-c '/data/a'\''b'`) {
		t.Fatal(cmd, err)
	}
	if parseBackend("noise\nscreen\n") != "screen" || parseBackend("") != "none" {
		t.Fatal("backend")
	}
	items := parseSessions("tmux", "work|2|0|123\n")
	if len(items) != 1 || items[0].Windows != 2 || items[0].Attached || items[0].CreatedAt != 123 {
		t.Fatal(items)
	}
	items = parseSessions("screen", "\t123.work\t(Attached)\n")
	if len(items) != 1 || !items[0].Attached {
		t.Fatal(items)
	}
	if _, err := attachCommand("none", "x", ""); err == nil {
		t.Fatal("unsupported backend accepted")
	}
}
func TestTerminalReplay(t *testing.T) {
	events := []TerminalEvent{}
	term := &terminal{id: "t", emit: func(e TerminalEvent) { events = append(events, e) }}
	data := []byte("终端🙂")
	term.Write(data[:2])
	term.Write(data[2:])
	term.finish(nil)
	if len(events) != 0 {
		t.Fatal("events before ready")
	}
	term.markReady()
	term.markReady()
	if len(events) != 2 || events[1].Type != "exit" {
		t.Fatal(events)
	}
	raw, _ := base64.StdEncoding.DecodeString(events[0].Data)
	if !bytes.Equal(raw, data) {
		t.Fatal("corrupted data")
	}
}
func TestTerminalHistoryBound(t *testing.T) {
	term := &terminal{emit: func(TerminalEvent) {}}
	term.Write(bytes.Repeat([]byte{'a'}, maxHistory))
	term.Write([]byte("tail"))
	if len(term.buffer) != maxHistory || string(term.buffer[len(term.buffer)-4:]) != "tail" {
		t.Fatal("unbounded history")
	}
}
func signer(t *testing.T) ssh.Signer {
	t.Helper()
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	s, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func TestHostKeyTrust(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	asked := 0
	callback := HostKeyCallback(path, func(host, fingerprint string) bool { asked++; return true })
	address := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 2222}
	key := signer(t).PublicKey()
	for i := 0; i < 2; i++ {
		if err := callback("127.0.0.1:2222", address, key); err != nil {
			t.Fatal(err)
		}
	}
	if asked != 1 {
		t.Fatal("trusted host prompted twice")
	}
	if err := callback("127.0.0.1:2222", address, signer(t).PublicKey()); err == nil {
		t.Fatal("changed key accepted")
	}
	if asked != 1 {
		t.Fatal("changed key prompted instead of rejected")
	}
	declined := HostKeyCallback(filepath.Join(t.TempDir(), "known_hosts"), func(string, string) bool { return false })
	if err := declined("127.0.0.1:2222", address, key); err == nil {
		t.Fatal("declined key accepted")
	}
}

type fakeServer struct {
	listener    net.Listener
	mu          sync.Mutex
	commands    []string
	connections []*ssh.ServerConn
}

func startSSH(t *testing.T, public ssh.PublicKey) *fakeServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeServer{listener: listener}
	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			if string(password) == "secret" {
				return nil, nil
			}
			return nil, fmt.Errorf("bad password")
		},
		PublicKeyCallback: func(c ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if public != nil && bytes.Equal(key.Marshal(), public.Marshal()) {
				return nil, nil
			}
			return nil, fmt.Errorf("bad key")
		},
	}
	cfg.AddHostKey(signer(t))
	go func() {
		for {
			raw, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				conn, channels, reqs, err := ssh.NewServerConn(raw, cfg)
				if err != nil {
					raw.Close()
					return
				}
				f.mu.Lock()
				f.connections = append(f.connections, conn)
				f.mu.Unlock()
				go ssh.DiscardRequests(reqs)
				for incoming := range channels {
					channel, requests, err := incoming.Accept()
					if err != nil {
						continue
					}
					go f.handle(channel, requests)
				}
			}()
		}
	}()
	t.Cleanup(func() {
		listener.Close()
		f.mu.Lock()
		defer f.mu.Unlock()
		for _, conn := range f.connections {
			conn.Close()
		}
	})
	return f
}
func (f *fakeServer) handle(channel ssh.Channel, requests <-chan *ssh.Request) {
	defer channel.Close()
	for req := range requests {
		switch req.Type {
		case "pty-req", "window-change":
			req.Reply(true, nil)
		case "exec":
			var payload struct{ Command string }
			_ = ssh.Unmarshal(req.Payload, &payload)
			cmd := payload.Command
			f.mu.Lock()
			f.commands = append(f.commands, cmd)
			f.mu.Unlock()
			req.Reply(true, nil)
			status := uint32(0)
			switch {
			case strings.HasPrefix(cmd, "powershell.exe"):
				status = 127
			case cmd == supportProbe:
				io.WriteString(channel, "tmux\n")
			case strings.Contains(cmd, "list-sessions"):
				io.WriteString(channel, "work|1|0|123\n")
			case strings.Contains(cmd, "attach-session"):
				io.WriteString(channel, "初始🙂")
				go func() {
					for r := range requests {
						r.Reply(true, nil)
					}
				}()
				_, _ = io.Copy(channel, channel)
				return
			}
			channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{status}))
			return
		}
	}
}
func inputFor(f *fakeServer) ConnectInput {
	return ConnectInput{Host: "127.0.0.1", Port: f.listener.Addr().(*net.TCPAddr).Port, Username: "test", AuthMethod: "password", Password: "secret"}
}
func TestSSHSessionLifecycle(t *testing.T) {
	f := startSSH(t, nil)
	events := make(chan TerminalEvent, 64)
	c := New(func(e TerminalEvent) { events <- e }, nil, ssh.InsecureIgnoreHostKey(), nil, nil)
	defer c.Disconnect()
	info, err := c.Connect(inputFor(f))
	if err != nil || info.Backend != "tmux" {
		t.Fatal(info, err)
	}
	sessions, err := c.ListSessions()
	if err != nil || len(sessions) != 1 {
		t.Fatal(sessions, err)
	}
	opened, err := c.OpenSession(CreateSessionInput{Name: "work"})
	if err != nil {
		t.Fatal(err)
	}
	c.ReadyTerminal(opened.TerminalID)
	if err = c.WriteTerminal(opened.TerminalID, "echo-input"); err != nil {
		t.Fatal(err)
	}
	var output []byte
	timeout := time.After(5 * time.Second)
	for !strings.Contains(string(output), "echo-input") {
		select {
		case event := <-events:
			if event.Type == "data" {
				raw, e := base64.StdEncoding.DecodeString(event.Data)
				if e != nil {
					t.Fatal(e)
				}
				output = append(output, raw...)
			}
		case <-timeout:
			t.Fatal("terminal timed out", string(output))
		}
	}
	if !strings.HasPrefix(string(output), "初始🙂") {
		t.Fatal("replay lost", string(output))
	}
	if err = c.ResizeTerminal(opened.TerminalID, 100, 40); err != nil {
		t.Fatal(err)
	}
	c.CloseTerminal(opened.TerminalID)
	if err = c.WriteTerminal(opened.TerminalID, "x"); err == nil {
		t.Fatal("closed terminal accepted input")
	}
	// Reconnect while the old monitor is finishing; it must not clear the new connection.
	if _, err = c.Connect(inputFor(f)); err != nil {
		t.Fatal(err)
	}
	if _, err = c.ListSessions(); err != nil {
		t.Fatal(err)
	}
	c.Disconnect()
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, cmd := range f.commands {
		if strings.Contains(cmd, "kill-session") {
			t.Fatal("detach killed remote session")
		}
	}
}
func TestSSHPrivateKeyAndAuthFailure(t *testing.T) {
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key, _ := ssh.NewSignerFromKey(private)
	f := startSSH(t, key.PublicKey())
	block, err := ssh.MarshalPrivateKeyWithPassphrase(private, "test", []byte("phrase"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "key")
	if err = os.WriteFile(path, pem.EncodeToMemory(block), 0600); err != nil {
		t.Fatal(err)
	}
	c := New(func(TerminalEvent) {}, nil, ssh.InsecureIgnoreHostKey(), nil, nil)
	defer c.Disconnect()
	input := inputFor(f)
	input.Password = "wrong"
	if _, err = c.Connect(input); err == nil {
		t.Fatal("bad password accepted")
	}
	input.AuthMethod = "privateKey"
	input.PrivateKeyPath = path
	input.Passphrase = "phrase"
	if _, err = c.Connect(input); err != nil {
		t.Fatal(err)
	}
}

func TestAuthURLIsOpenedOncePerConnection(t *testing.T) {
	var opened []string
	c := New(func(TerminalEvent) {}, nil, ssh.InsecureIgnoreHostKey(), nil, func(value string) {
		opened = append(opened, value)
	})
	c.openURLs("Authenticate at https://login.tailscale.com/a/test")
	c.openURLs("Again: https://login.tailscale.com/a/test")
	if len(opened) != 1 {
		t.Fatalf("authentication URL opened %d times", len(opened))
	}
}
