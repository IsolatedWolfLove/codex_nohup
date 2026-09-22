package sshclient

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

const maxHistory = 2 * 1024 * 1024

type terminal struct {
	mu        sync.Mutex
	writeMu   sync.Mutex
	session   *ssh.Session
	stdin     io.WriteCloser
	name      string
	ready     bool
	ended     bool
	closed    bool
	buffer    []byte
	exitError string
	emit      func(TerminalEvent)
	id        string
}

func (t *terminal) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return len(p), nil
	}
	if t.ready {
		t.emit(TerminalEvent{Type: "data", TerminalID: t.id, Data: base64.StdEncoding.EncodeToString(p)})
	} else {
		t.buffer = append(t.buffer, p...)
		if len(t.buffer) > maxHistory {
			t.buffer = append([]byte(nil), t.buffer[len(t.buffer)-maxHistory:]...)
		}
	}
	return len(p), nil
}
func (t *terminal) finish(err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed || t.ended {
		return
	}
	t.ended = true
	var exit *ssh.ExitError
	if err != nil && (!errors.As(err, &exit) || exit.ExitStatus() != 0) {
		t.exitError = err.Error()
	}
	if t.ready {
		t.emitEnd()
	}
}
func (t *terminal) emitEnd() {
	if t.exitError != "" {
		t.emit(TerminalEvent{Type: "error", TerminalID: t.id, Message: t.exitError})
	}
	t.emit(TerminalEvent{Type: "exit", TerminalID: t.id})
}
func (t *terminal) markReady() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.ready || t.closed {
		return
	}
	// Replay and live data share this lock and the same event transport, preserving order.
	if len(t.buffer) > 0 {
		t.emit(TerminalEvent{Type: "data", TerminalID: t.id, Data: base64.StdEncoding.EncodeToString(t.buffer)})
		t.buffer = nil
	}
	t.ready = true
	if t.ended {
		t.emitEnd()
	}
}
func (t *terminal) close() {
	t.mu.Lock()
	t.closed = true
	t.buffer = nil
	t.mu.Unlock()
	_ = t.session.Close()
}

type connection struct {
	client    *ssh.Client
	info      ConnectionInfo
	agentPath string
	done      chan struct{}
}
type Client struct {
	op          sync.Mutex // Serializes connect/disconnect and remote control operations.
	mu          sync.Mutex
	urlMu       sync.Mutex
	conn        *connection
	terminals   map[string]*terminal
	emit        func(TerminalEvent)
	agentBinary []byte
	hostKey     ssh.HostKeyCallback
	credential  func(kind, prompt string, secret bool) (string, error)
	openURL     func(string)
	seenURLs    map[string]struct{}
}

func New(emit func(TerminalEvent), binary []byte, hostKey ssh.HostKeyCallback, credential func(string, string, bool) (string, error), openURL func(string)) *Client {
	if credential == nil {
		credential = func(string, string, bool) (string, error) { return "", errors.New("认证信息不可用") }
	}
	if openURL == nil {
		openURL = func(string) {}
	}
	return &Client{emit: emit, agentBinary: binary, hostKey: hostKey, credential: credential, openURL: openURL, terminals: map[string]*terminal{}, seenURLs: map[string]struct{}{}}
}
func (c *Client) Connect(input ConnectInput) (ConnectionInfo, error) {
	c.op.Lock()
	defer c.op.Unlock()
	c.disconnect()
	c.urlMu.Lock()
	c.seenURLs = map[string]struct{}{}
	c.urlMu.Unlock()
	if strings.TrimSpace(input.Host) == "" || strings.TrimSpace(input.Username) == "" {
		return ConnectionInfo{}, errors.New("请输入主机和用户名")
	}
	if input.Port == 0 {
		input.Port = 22
	}
	if input.Port < 1 || input.Port > 65535 {
		return ConnectionInfo{}, errors.New("端口必须在 1–65535 之间")
	}
	var auths []ssh.AuthMethod
	switch input.AuthMethod {
	case "password":
		if input.Password != "" {
			auths = append(auths, ssh.Password(input.Password))
		} else {
			auths = append(auths, ssh.PasswordCallback(func() (string, error) {
				return c.credential("password", fmt.Sprintf("请输入 %s@%s 的密码", input.Username, input.Host), true)
			}))
		}
	case "privateKey":
		data, err := os.ReadFile(input.PrivateKeyPath)
		if err != nil {
			return ConnectionInfo{}, err
		}
		var signer ssh.Signer
		if input.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(data, []byte(input.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(data)
		}
		if err != nil {
			return ConnectionInfo{}, err
		}
		auths = append(auths, ssh.PublicKeys(signer))
	case "agent":
		socket, err := dialAgent()
		if err != nil {
			return ConnectionInfo{}, err
		}
		defer socket.Close()
		_ = socket.SetDeadline(time.Now().Add(30 * time.Second))
		signers, err := agent.NewClient(socket).Signers()
		if err != nil {
			return ConnectionInfo{}, err
		}
		if len(signers) == 0 {
			return ConnectionInfo{}, errors.New("SSH Agent 中没有可用密钥")
		}
		auths = append(auths, ssh.PublicKeys(signers...))
	case "auto":
		if input.PrivateKeyPath != "" {
			data, err := os.ReadFile(input.PrivateKeyPath)
			if err != nil { return ConnectionInfo{}, err }
			signer, err := ssh.ParsePrivateKey(data)
			if _, ok := err.(*ssh.PassphraseMissingError); ok {
				pass, askErr := c.credential("passphrase", "请输入私钥口令："+input.PrivateKeyPath, true)
				if askErr != nil { return ConnectionInfo{}, askErr }
				signer, err = ssh.ParsePrivateKeyWithPassphrase(data, []byte(pass))
			}
			if err != nil { return ConnectionInfo{}, err }
			auths = append(auths, ssh.PublicKeys(signer))
		}
		if socket, err := dialAgent(); err == nil {
			defer socket.Close()
			if signers, signErr := agent.NewClient(socket).Signers(); signErr == nil && len(signers) > 0 {
				auths = append(auths, ssh.PublicKeys(signers...))
			}
		}
		auths = append(auths, ssh.PasswordCallback(func() (string, error) {
			return c.credential("password", fmt.Sprintf("请输入 %s@%s 的密码", input.Username, input.Host), true)
		}))
	default:
		return ConnectionInfo{}, errors.New("不支持的认证方式")
	}
	if c.hostKey == nil {
		return ConnectionInfo{}, errors.New("缺少主机密钥校验器")
	}
	address := net.JoinHostPort(input.Host, strconv.Itoa(input.Port))
	raw, err := net.DialTimeout("tcp", address, 20*time.Second)
	if err != nil {
		return ConnectionInfo{}, err
	}
	_ = raw.SetDeadline(time.Now().Add(2 * time.Minute)) // Allows time for the first-host confirmation dialog.
	keyboard := ssh.KeyboardInteractive(func(_ string, instruction string, questions []string, echoes []bool) ([]string, error) {
		c.openURLs(instruction)
		answers := make([]string, len(questions))
		for i, question := range questions {
			c.openURLs(question)
			answer, err := c.credential("interactive", strings.TrimSpace(instruction+"\n"+question), i >= len(echoes) || !echoes[i])
			if err != nil { return nil, err }
			answers[i] = answer
		}
		return answers, nil
	})
	auths = append(auths, keyboard)
	config := &ssh.ClientConfig{User: input.Username, Auth: auths, HostKeyCallback: c.hostKey, Timeout: 20 * time.Second, BannerCallback: func(message string) error { c.openURLs(message); return nil }}
	sc, ch, req, err := ssh.NewClientConn(raw, address, config)
	if err != nil {
		raw.Close()
		return ConnectionInfo{}, err
	}
	_ = raw.SetDeadline(time.Time{})
	client := ssh.NewClient(sc, ch, req)
	conn := &connection{client: client, done: make(chan struct{})}
	ok := false
	defer func() {
		if !ok {
			client.Close()
		}
	}()
	probe, err := execCommand(client, `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "[Console]::Out.Write('nohop-windows')"`)
	if err != nil {
		return ConnectionInfo{}, err
	}
	info := ConnectionInfo{Platform: "linux", Host: input.Host, Backend: "none"}
	if probe.code == 0 && strings.Contains(probe.stdout, "nohop-windows") {
		info.Platform = "windows"
		info.Backend = "conpty"
	} else {
		result, err := execCommand(client, supportProbe)
		if err != nil {
			return ConnectionInfo{}, err
		}
		info.Backend = parseBackend(result.stdout)
	}
	conn.info = info
	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
	ok = true
	go c.monitor(conn)
	go c.keepalive(conn)
	return info, nil
}

func (c *Client) openURLs(message string) {
	for _, field := range strings.Fields(message) {
		value := strings.TrimRight(field, ".,;)]}")
		if !strings.HasPrefix(value, "https://") && !strings.HasPrefix(value, "http://") {
			continue
		}
		c.urlMu.Lock()
		_, seen := c.seenURLs[value]
		if !seen {
			c.seenURLs[value] = struct{}{}
		}
		c.urlMu.Unlock()
		if !seen {
			c.openURL(value)
		}
	}
}
func (c *Client) monitor(conn *connection) {
	_ = conn.client.Wait()
	close(conn.done)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != conn {
		return
	}
	c.conn = nil
	for _, t := range c.terminals {
		t.finish(nil)
	}
}
func (c *Client) keepalive(conn *connection) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-conn.done:
			return
		case <-ticker.C:
			result := make(chan error, 1)
			go func() { _, _, err := conn.client.SendRequest("keepalive@openssh.com", true, nil); result <- err }()
			timer := time.NewTimer(30 * time.Second)
			select {
			case <-conn.done:
				timer.Stop()
				return
			case err := <-result:
				timer.Stop()
				if err != nil {
					conn.client.Close()
					return
				}
			case <-timer.C:
				conn.client.Close()
				return
			}
		}
	}
}
func (c *Client) disconnect() {
	c.mu.Lock()
	conn := c.conn
	c.conn = nil
	ts := c.terminals
	c.terminals = map[string]*terminal{}
	c.mu.Unlock()
	for _, t := range ts {
		t.finish(nil)
		t.close()
	}
	if conn != nil {
		_ = conn.client.Close()
	}
}
func (c *Client) Disconnect() { c.op.Lock(); defer c.op.Unlock(); c.disconnect() }
func (c *Client) current() (*connection, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return nil, errors.New("尚未连接服务器")
	}
	return c.conn, nil
}

type commandResult struct {
	stdout, stderr string
	code           int
}

func execCommand(client *ssh.Client, cmd string) (commandResult, error) {
	session, err := client.NewSession()
	if err != nil {
		return commandResult{}, err
	}
	defer session.Close()
	var out, stderr bytes.Buffer
	session.Stdout = &out
	session.Stderr = &stderr
	timer := time.AfterFunc(30*time.Second, func() { session.Close() })
	defer timer.Stop()
	err = session.Run(cmd)
	code := 0
	if err != nil {
		var exit *ssh.ExitError
		if !errors.As(err, &exit) {
			return commandResult{}, err
		}
		code = exit.ExitStatus()
	}
	return commandResult{out.String(), stderr.String(), code}, nil
}
func checked(result commandResult, err error) (commandResult, error) {
	if err != nil {
		return result, err
	}
	if result.code != 0 {
		return result, fmt.Errorf("远端命令失败（%d）：%s", result.code, strings.TrimSpace(result.stderr))
	}
	return result, nil
}
func (c *Client) ensureAgent(conn *connection) (string, error) {
	if conn.agentPath != "" {
		return conn.agentPath, nil
	}
	result, err := checked(execCommand(conn.client, psCommand(`$p=Join-Path $env:LOCALAPPDATA 'NohopCodex\nohop-agent.exe'; [Console]::Out.Write($p)`)))
	if err != nil {
		return "", err
	}
	remote := strings.TrimSpace(result.stdout)
	if remote == "" {
		return "", errors.New("无法确定 Windows 代理目录")
	}
	check, err := execCommand(conn.client, psCommand("if (Test-Path "+psQuote(remote)+") { exit 0 } else { exit 1 }"))
	if err != nil {
		return "", err
	}
	if check.code != 0 {
		if len(c.agentBinary) == 0 {
			return "", errors.New("缺少内嵌 Windows ConPTY 代理，请重新构建应用")
		}
		if _, err = checked(execCommand(conn.client, psCommand("New-Item -ItemType Directory -Force -Path (Split-Path "+psQuote(remote)+") | Out-Null"))); err != nil {
			return "", err
		}
		ftp, err := sftp.NewClient(conn.client)
		if err != nil {
			return "", err
		}
		defer ftp.Close()
		path := strings.ReplaceAll(remote, `\`, "/")
		file, err := ftp.Create(path + ".upload")
		if err != nil {
			return "", err
		}
		_, copyErr := io.Copy(file, bytes.NewReader(c.agentBinary))
		closeErr := file.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if err = ftp.Rename(path+".upload", path); err != nil {
			return "", err
		}
	}
	if _, err = checked(execCommand(conn.client, psCommand("& "+psQuote(remote)+" 'ensure'"))); err != nil {
		return "", err
	}
	conn.agentPath = remote
	return remote, nil
}
func (c *Client) agentCommand(conn *connection, args ...string) (commandResult, error) {
	path, err := c.ensureAgent(conn)
	if err != nil {
		return commandResult{}, err
	}
	for i := range args {
		args[i] = psQuote(args[i])
	}
	return checked(execCommand(conn.client, psCommand("& "+psQuote(path)+" "+strings.Join(args, " "))))
}
func (c *Client) ListSessions() ([]PersistentSession, error) {
	conn, err := c.current()
	if err != nil {
		return nil, err
	}
	if conn.info.Platform == "windows" {
		c.op.Lock()
		defer c.op.Unlock()
		conn, err = c.current()
		if err != nil {
			return nil, err
		}
		r, err := c.agentCommand(conn, "list")
		if err != nil {
			return nil, err
		}
		items := []PersistentSession{}
		if err = json.Unmarshal([]byte(r.stdout), &items); err != nil {
			return nil, err
		}
		if items == nil {
			items = []PersistentSession{}
		}
		for i := range items {
			items[i].Backend = "conpty"
		}
		return items, nil
	}
	cmd := listCommand(conn.info.Backend)
	if cmd == "" {
		return []PersistentSession{}, nil
	}
	r, err := checked(execCommand(conn.client, cmd))
	if err != nil {
		return nil, err
	}
	return parseSessions(conn.info.Backend, r.stdout), nil
}
func (c *Client) OpenSession(input CreateSessionInput) (TerminalOpened, error) {
	c.op.Lock()
	defer c.op.Unlock()
	conn, err := c.current()
	if err != nil {
		return TerminalOpened{}, err
	}
	name := normalizeName(input.Name)
	cols, rows := dimension(input.Cols, 120), dimension(input.Rows, 32)
	var cmd string
	if conn.info.Platform == "windows" {
		path, e := c.ensureAgent(conn)
		if e != nil {
			return TerminalOpened{}, e
		}
		args := []string{"attach", "--name", name, "--cols", strconv.Itoa(cols), "--rows", strconv.Itoa(rows)}
		if strings.TrimSpace(input.Cwd) != "" {
			args = append(args, "--cwd", strings.TrimSpace(input.Cwd))
		}
		for i := range args {
			args[i] = psQuote(args[i])
		}
		cmd = psCommand("& " + psQuote(path) + " " + strings.Join(args, " "))
	} else {
		cmd, err = attachCommand(conn.info.Backend, name, input.Cwd)
		if err != nil {
			return TerminalOpened{}, err
		}
	}
	session, err := conn.client.NewSession()
	if err != nil {
		return TerminalOpened{}, err
	}
	ok := false
	defer func() {
		if !ok {
			session.Close()
		}
	}()
	if err = session.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}); err != nil {
		return TerminalOpened{}, err
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		return TerminalOpened{}, err
	}
	var random [16]byte
	if _, err = rand.Read(random[:]); err != nil {
		return TerminalOpened{}, err
	}
	id := hex.EncodeToString(random[:])
	t := &terminal{id: id, name: name, session: session, stdin: stdin, emit: c.emit}
	session.Stdout = t
	session.Stderr = t
	started := make(chan error, 1)
	go func() { started <- session.Start(cmd) }()
	select {
	case err = <-started:
	case <-time.After(12 * time.Second):
		_ = session.Close()
		return TerminalOpened{}, errors.New("启动远端终端超时，请检查 tmux/screen 和 SSH 服务状态")
	}
	if err != nil {
		return TerminalOpened{}, err
	}
	c.mu.Lock()
	if c.conn != conn {
		c.mu.Unlock()
		return TerminalOpened{}, errors.New("连接已经断开")
	}
	c.terminals[id] = t
	c.mu.Unlock()
	ok = true
	go func() { t.finish(session.Wait()) }()
	return TerminalOpened{TerminalID: id, SessionName: name, Backend: conn.info.Backend}, nil
}
func (c *Client) getTerminal(id string) *terminal {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.terminals[id]
}
func (c *Client) WriteTerminal(id, data string) error {
	t := c.getTerminal(id)
	if t == nil {
		return errors.New("终端已经断开")
	}
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	_, err := io.WriteString(t.stdin, data)
	return err
}
func (c *Client) ReadyTerminal(id string) {
	if t := c.getTerminal(id); t != nil {
		t.markReady()
	}
}
func (c *Client) CloseTerminal(id string) {
	c.mu.Lock()
	t := c.terminals[id]
	delete(c.terminals, id)
	c.mu.Unlock()
	if t != nil {
		t.close()
	}
}
func (c *Client) ResizeTerminal(id string, cols, rows int) error {
	c.op.Lock()
	defer c.op.Unlock()
	t := c.getTerminal(id)
	if t == nil {
		return nil
	}
	cols = dimension(cols, 120)
	rows = dimension(rows, 32)
	if err := t.session.WindowChange(rows, cols); err != nil {
		return err
	}
	conn, err := c.current()
	if err != nil {
		return err
	}
	if conn.info.Platform == "windows" {
		_, err = c.agentCommand(conn, "resize", "--name", t.name, "--cols", strconv.Itoa(cols), "--rows", strconv.Itoa(rows))
		return err
	}
	return nil
}
func (c *Client) KillSession(name string) error {
	c.op.Lock()
	defer c.op.Unlock()
	conn, err := c.current()
	if err != nil {
		return err
	}
	if conn.info.Platform == "windows" {
		_, err = c.agentCommand(conn, "kill", "--name", name)
		return err
	}
	cmd, err := killCommand(conn.info.Backend, name)
	if err != nil {
		return err
	}
	_, err = checked(execCommand(conn.client, cmd))
	return err
}
