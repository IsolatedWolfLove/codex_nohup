package sshclient

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// A native terminal has the same resize/close surface as an SSH session.
type terminalSession interface {
	Close() error
	WindowChange(rows, cols int) error
}

type localProcess interface {
	terminalSession
	io.ReadWriteCloser
	Wait() error
}

func localCommand(ctx context.Context, command string) *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.CommandContext(ctx, "cmd.exe", "/d", "/s", "/c", command)
	}
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", command)
	cmd.Env = localEnvironment()
	return cmd
}

func localEnvironment() []string {
	env := []string{}
	for _, value := range os.Environ() {
		// A GUI launched from inside tmux must create an independent tmux client.
		if strings.HasPrefix(value, "TMUX=") || strings.HasPrefix(value, "TMUX_PANE=") {
			continue
		}
		if strings.HasPrefix(value, "TERM=") {
			continue
		}
		env = append(env, value)
	}
	return append(env, "TERM=xterm-256color")
}

func execConnectionCommand(conn *connection, command string) (commandResult, error) {
	if !conn.local {
		return execCommand(conn.client, command)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := localCommand(ctx, command)
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	err := cmd.Run()
	code := 0
	if err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) {
			return commandResult{}, err
		}
		code = exit.ExitCode()
	}
	return commandResult{out.String(), stderr.String(), code}, nil
}

func (c *Client) connectLocal() (ConnectionInfo, error) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		return ConnectionInfo{}, errors.New("当前平台暂不支持本机终端")
	}
	conn := &connection{local: true, done: make(chan struct{}), info: ConnectionInfo{Platform: runtime.GOOS, Host: "本机", Backend: "local"}}
	if runtime.GOOS == "linux" {
		result, err := execConnectionCommand(conn, supportProbe)
		if err != nil {
			return ConnectionInfo{}, err
		}
		conn.info.Backend = parseBackend(result.stdout)
	}
	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
	return conn.info, nil
}

func (c *Client) openLocalSession(conn *connection, input CreateSessionInput) (TerminalOpened, error) {
	name := normalizeName(input.Name)
	if conn.info.Backend == "local" {
		// Native Windows consoles survive closing a tab while this app stays open.
		c.mu.Lock()
		for id, t := range c.terminals {
			t.mu.Lock()
			alive := t.name == name && !t.ended && !t.closed
			t.mu.Unlock()
			if alive {
				c.mu.Unlock()
				return TerminalOpened{TerminalID: id, SessionName: name, Backend: "local"}, nil
			}
		}
		c.mu.Unlock()
	}
	process, err := startLocalProcess(conn.info.Backend, name, input.Cwd, dimension(input.Cols, 120), dimension(input.Rows, 32))
	if err != nil {
		return TerminalOpened{}, err
	}
	id := uuid.NewString()
	t := &terminal{id: id, name: name, session: process, stdin: process, emit: c.emit, retainHistory: conn.info.Backend == "local"}
	c.mu.Lock()
	c.terminals[id] = t
	c.mu.Unlock()
	go func() {
		copied := make(chan struct{})
		go func() { _, _ = io.Copy(t, process); close(copied) }()
		err := process.Wait()
		// ConPTY owns extra pipe handles; release them after the child exits.
		if runtime.GOOS == "windows" {
			_ = process.Close()
		}
		<-copied
		t.finish(err)
		_ = process.Close()
	}()
	return TerminalOpened{TerminalID: id, SessionName: name, Backend: conn.info.Backend}, nil
}

func (c *Client) localConsoleSessions() []PersistentSession {
	c.mu.Lock()
	defer c.mu.Unlock()
	result := []PersistentSession{}
	for _, t := range c.terminals {
		t.mu.Lock()
		if !t.ended && !t.closed {
			result = append(result, PersistentSession{Name: t.name, Attached: t.ready, Backend: "local"})
		}
		t.mu.Unlock()
	}
	return result
}

func saveLocalImage(data string) (string, error) {
	content, ext, err := decodeImage(data)
	if err != nil {
		return "", err
	}
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "NohopCodex", "images")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, uuid.NewString()+ext)
	if err := os.WriteFile(path, content, 0600); err != nil {
		return "", fmt.Errorf("保存本机截图失败：%w", err)
	}
	return path, nil
}

// Native handles can be closed concurrently by the reader and by disconnect.
type closeOnce struct {
	once sync.Once
	err  error
}
