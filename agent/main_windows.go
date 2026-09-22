//go:build windows

package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/UserExistsError/conpty"
)

const maxHistory = 2 * 1024 * 1024

type request struct {
	Token string `json:"token"`
	Op    string `json:"op"`
	Name  string `json:"name,omitempty"`
	Cwd   string `json:"cwd,omitempty"`
	Cols  int    `json:"cols,omitempty"`
	Rows  int    `json:"rows,omitempty"`
}

type summary struct {
	Name      string `json:"name"`
	Attached  bool   `json:"attached"`
	CreatedAt int64  `json:"createdAt"`
}

type session struct {
	name      string
	createdAt int64
	pty       *conpty.ConPty
	mu        sync.Mutex
	history   []byte
	attached  net.Conn
}

type daemon struct {
	token    string
	mu       sync.Mutex
	sessions map[string]*session
}

func stateDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "NohopCodex")
}

func tokenPath() string { return filepath.Join(stateDir(), "agent.token") }

func agentAddress() string {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(strings.ToLower(os.Getenv("USERNAME") + "|" + os.Getenv("USERPROFILE"))))
	return fmt.Sprintf("127.0.0.1:%d", 50000+hash.Sum32()%10000)
}

func loadToken() (string, error) {
	data, err := os.ReadFile(tokenPath())
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func createToken() (string, error) {
	if err := os.MkdirAll(stateDir(), 0700); err != nil {
		return "", err
	}
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	token := hex.EncodeToString(value)
	return token, os.WriteFile(tokenPath(), []byte(token), 0600)
}

func send(req request) (net.Conn, error) {
	token, err := loadToken()
	if err != nil {
		return nil, err
	}
	req.Token = token
	conn, err := net.DialTimeout("tcp", agentAddress(), 2*time.Second)
	if err != nil {
		return nil, err
	}
	if err := json.NewEncoder(conn).Encode(req); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

func ping() bool {
	conn, err := send(request{Op: "ping"})
	if err != nil {
		return false
	}
	defer conn.Close()
	var ok map[string]bool
	return json.NewDecoder(conn).Decode(&ok) == nil && ok["ok"]
}

func ensureDaemon() error {
	if ping() {
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "daemon")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000008 | 0x00000200}
	if err := cmd.Start(); err != nil {
		return err
	}
	_ = cmd.Process.Release()
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		if ping() {
			return nil
		}
	}
	return errors.New("daemon did not start")
}

func (d *daemon) serve() error {
	listener, err := net.Listen("tcp", agentAddress())
	if err != nil {
		return err
	}
	for {
		conn, err := listener.Accept()
		if err != nil {
			return err
		}
		go d.handle(conn)
	}
}

func (d *daemon) handle(conn net.Conn) {
	reader := bufio.NewReader(conn)
	line, err := reader.ReadBytes('\n')
	if err != nil {
		conn.Close()
		return
	}
	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		conn.Close()
		return
	}
	if req.Token != d.token {
		conn.Close()
		return
	}
	switch req.Op {
	case "ping":
		_ = json.NewEncoder(conn).Encode(map[string]bool{"ok": true})
		conn.Close()
	case "list":
		d.mu.Lock()
		items := make([]summary, 0, len(d.sessions))
		for _, item := range d.sessions {
			item.mu.Lock()
			items = append(items, summary{Name: item.name, Attached: item.attached != nil, CreatedAt: item.createdAt})
			item.mu.Unlock()
		}
		d.mu.Unlock()
		_ = json.NewEncoder(conn).Encode(items)
		conn.Close()
	case "attach":
		d.attach(conn, reader, req)
	case "resize":
		d.mu.Lock()
		item := d.sessions[req.Name]
		d.mu.Unlock()
		if item != nil {
			_ = item.pty.Resize(valid(req.Cols, 120), valid(req.Rows, 32))
		}
		_ = json.NewEncoder(conn).Encode(map[string]bool{"ok": item != nil})
		conn.Close()
	case "kill":
		d.mu.Lock()
		item := d.sessions[req.Name]
		delete(d.sessions, req.Name)
		d.mu.Unlock()
		if item != nil {
			_ = item.pty.Close()
		}
		_ = json.NewEncoder(conn).Encode(map[string]bool{"ok": item != nil})
		conn.Close()
	default:
		conn.Close()
	}
}

func valid(value, fallback int) int {
	if value < 1 || value > 500 {
		return fallback
	}
	return value
}

func (d *daemon) attach(conn net.Conn, reader *bufio.Reader, req request) {
	d.mu.Lock()
	item := d.sessions[req.Name]
	if item == nil {
		options := []conpty.ConPtyOption{conpty.ConPtyDimensions(valid(req.Cols, 120), valid(req.Rows, 32))}
		if req.Cwd != "" {
			options = append(options, conpty.ConPtyWorkDir(req.Cwd))
		}
		pty, err := conpty.Start("powershell.exe -NoLogo", options...)
		if err != nil {
			d.mu.Unlock()
			_, _ = fmt.Fprintf(conn, "\x1b[31mNohop agent: %v\x1b[0m\r\n", err)
			conn.Close()
			return
		}
		item = &session{name: req.Name, createdAt: time.Now().Unix(), pty: pty}
		d.sessions[req.Name] = item
		go d.capture(item)
	}
	d.mu.Unlock()
	item.mu.Lock()
	if item.attached != nil {
		_ = item.attached.Close()
	}
	item.attached = conn
	history := append([]byte(nil), item.history...)
	item.mu.Unlock()
	if len(history) > 0 {
		_, _ = conn.Write(history)
	}
	_, _ = io.Copy(item.pty, reader)
	item.mu.Lock()
	if item.attached == conn {
		item.attached = nil
	}
	item.mu.Unlock()
	_ = conn.Close()
}

func (d *daemon) capture(item *session) {
	buffer := make([]byte, 32*1024)
	for {
		n, err := item.pty.Read(buffer)
		if n > 0 {
			chunk := append([]byte(nil), buffer[:n]...)
			item.mu.Lock()
			item.history = append(item.history, chunk...)
			if len(item.history) > maxHistory {
				item.history = append([]byte(nil), item.history[len(item.history)-maxHistory:]...)
			}
			attached := item.attached
			if attached != nil {
				if _, writeErr := attached.Write(chunk); writeErr != nil {
					_ = attached.Close()
					if item.attached == attached {
						item.attached = nil
					}
				}
			}
			item.mu.Unlock()
		}
		if err != nil {
			item.mu.Lock()
			if item.attached != nil {
				_ = item.attached.Close()
				item.attached = nil
			}
			item.mu.Unlock()
			d.mu.Lock()
			if d.sessions[item.name] == item {
				delete(d.sessions, item.name)
			}
			d.mu.Unlock()
			_ = item.pty.Close()
			return
		}
	}
}

func argValue(args []string, name, fallback string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == name {
			return args[i+1]
		}
	}
	return fallback
}

func intArg(args []string, name string, fallback int) int {
	value, err := strconv.Atoi(argValue(args, name, ""))
	if err != nil {
		return fallback
	}
	return value
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: nohop-agent <ensure|list|attach|resize|kill|daemon>")
		os.Exit(2)
	}
	op := os.Args[1]
	if op == "daemon" {
		token, err := loadToken()
		if err != nil {
			token, err = createToken()
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		d := &daemon{token: token, sessions: make(map[string]*session)}
		if err := d.serve(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if err := ensureDaemon(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if op == "ensure" {
		return
	}
	req := request{Op: op, Name: argValue(os.Args[2:], "--name", ""), Cwd: argValue(os.Args[2:], "--cwd", ""), Cols: intArg(os.Args[2:], "--cols", 120), Rows: intArg(os.Args[2:], "--rows", 32)}
	conn, err := send(req)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer conn.Close()
	if op == "attach" {
		go func() { _, _ = io.Copy(conn, os.Stdin) }()
		_, _ = io.Copy(os.Stdout, conn)
		return
	}
	_, _ = io.Copy(os.Stdout, conn)
	if op == "kill" || op == "resize" {
		return
	}
}
