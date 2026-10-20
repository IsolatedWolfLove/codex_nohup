package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"nohop-codex/internal/sshclient"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

type App struct {
	ctx          context.Context
	clientsMu    sync.Mutex
	clients      map[string]*sshclient.Client
	credentialMu sync.Mutex
	credentials  map[string]chan credentialResponse
}
type credentialResponse struct {
	value     string
	cancelled bool
}
type credentialRequest struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Prompt string `json:"prompt"`
	Secret bool   `json:"secret"`
}

func newApp() *App { return &App{} }
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.credentials = map[string]chan credentialResponse{}
	a.clients = map[string]*sshclient.Client{}
}
func (a *App) newClient(id string) *sshclient.Client {
	return sshclient.New(func(event sshclient.TerminalEvent) {
		event.ConnectionID = id
		if event.TerminalID != "" {
			event.TerminalID = id + ":" + event.TerminalID
		}
		a.emit("terminal:event", event)
	}, windowsAgent,
		func(host string, remoteAddr net.Addr, key ssh.PublicKey) error {
			base, err := os.UserConfigDir()
			if err != nil {
				return err
			}
			return sshclient.HostKeyCallback(filepath.Join(base, "NohopCodex", "known_hosts"), func(host, fingerprint string) bool {
				_, err := a.requestCredential("hostkey", fmt.Sprintf("服务器：%s\n主机密钥指纹：%s\n\n确认信任此服务器并保存密钥？", host, fingerprint), false)
				return err == nil
			})(host, remoteAddr, key)
		}, a.requestCredential, func(url string) { a.openURL(url); a.emit("auth:url", url) })
}
func (a *App) requestCredential(kind, prompt string, secret bool) (string, error) {
	id := uuid.NewString()
	ch := make(chan credentialResponse, 1)
	a.credentialMu.Lock()
	a.credentials[id] = ch
	a.credentialMu.Unlock()
	a.emit("credential:request", credentialRequest{ID: id, Kind: kind, Prompt: prompt, Secret: secret})
	var response credentialResponse
	select {
	case response = <-ch:
	case <-a.ctx.Done():
		a.credentialMu.Lock()
		delete(a.credentials, id)
		a.credentialMu.Unlock()
		return "", a.ctx.Err()
	}
	a.credentialMu.Lock()
	delete(a.credentials, id)
	a.credentialMu.Unlock()
	if response.cancelled {
		return "", errors.New("已取消认证")
	}
	return response.value, nil
}
func (a *App) SubmitCredential(id, value string, cancelled bool) {
	a.credentialMu.Lock()
	ch := a.credentials[id]
	a.credentialMu.Unlock()
	if ch != nil {
		select {
		case ch <- credentialResponse{value, cancelled}:
		default:
		}
	}
}
func (a *App) shutdown(context.Context) {
	a.clientsMu.Lock()
	clients := a.clients
	a.clients = map[string]*sshclient.Client{}
	a.clientsMu.Unlock()
	for _, c := range clients {
		c.Disconnect()
	}
}
func (a *App) Connect(input sshclient.ConnectInput) (sshclient.ConnectionInfo, error) {
	if input.Alias != "" {
		content, err := a.GetSSHConfig()
		if err != nil {
			return sshclient.ConnectionInfo{}, err
		}
		host := resolveSSHHost(content, input.Alias)
		input.Host, input.Port, input.Username = host.Host, host.Port, host.User
		input.PrivateKeyPath, input.AuthMethod = host.Identity, "auto"
		input.PrivateKeyPaths = host.Identities
		if jumpName := strings.TrimSpace(strings.Split(host.ProxyJump, ",")[0]); jumpName != "" && strings.ToLower(jumpName) != "none" {
			jumpAlias, jumpUser, jumpPort := parseProxyJump(jumpName)
			jump := resolveSSHHost(content, jumpAlias)
			if jumpUser != "" {
				jump.User = jumpUser
			}
			if jumpPort != 0 {
				jump.Port = jumpPort
			}
			input.ProxyJumpHost, input.ProxyJumpPort = jump.Host, jump.Port
			input.ProxyJumpUser, input.ProxyJumpKey = jump.User, jump.Identity
			input.ProxyJumpKeys = jump.Identities
		}
	}
	id := input.ConnectionID
	if id == "" || strings.Contains(id, ":") {
		return sshclient.ConnectionInfo{}, errors.New("无效连接 ID")
	}
	a.clientsMu.Lock()
	c := a.clients[id]
	if c == nil {
		c = a.newClient(id)
		a.clients[id] = c
	}
	a.clientsMu.Unlock()
	info, err := c.Connect(input)
	info.ConnectionID = id
	return info, err
}
func (a *App) client(id string) (*sshclient.Client, error) {
	a.clientsMu.Lock()
	defer a.clientsMu.Unlock()
	c := a.clients[id]
	if c == nil {
		return nil, errors.New("连接不存在")
	}
	return c, nil
}
func (a *App) terminalClient(id string) (*sshclient.Client, string, error) {
	connectionID, terminalID, ok := strings.Cut(id, ":")
	if !ok {
		return nil, "", errors.New("无效终端 ID")
	}
	c, err := a.client(connectionID)
	return c, terminalID, err
}
func (a *App) Disconnect(id string) {
	if c, err := a.client(id); err == nil {
		c.Disconnect()
	}
}
func (a *App) ListSessions(id string) ([]sshclient.PersistentSession, error) {
	c, err := a.client(id)
	if err != nil {
		return nil, err
	}
	return c.ListSessions()
}
func (a *App) OpenSession(input sshclient.CreateSessionInput) (sshclient.TerminalOpened, error) {
	c, err := a.client(input.ConnectionID)
	if err != nil {
		return sshclient.TerminalOpened{}, err
	}
	opened, err := c.OpenSession(input)
	if err == nil {
		opened.TerminalID = input.ConnectionID + ":" + opened.TerminalID
	}
	return opened, err
}
func (a *App) KillSession(connectionID, name string) error {
	c, err := a.client(connectionID)
	if err != nil {
		return err
	}
	return c.KillSession(name)
}
func (a *App) WriteTerminal(id, data string) error {
	c, tid, err := a.terminalClient(id)
	if err != nil {
		return err
	}
	return c.WriteTerminal(tid, data)
}
func (a *App) ReadyTerminal(id string) {
	if c, tid, err := a.terminalClient(id); err == nil {
		c.ReadyTerminal(tid)
	}
}
func (a *App) ResizeTerminal(id string, cols, rows int) error {
	c, tid, err := a.terminalClient(id)
	if err != nil {
		return err
	}
	return c.ResizeTerminal(tid, cols, rows)
}
func (a *App) CloseTerminal(id string) {
	if c, tid, err := a.terminalClient(id); err == nil {
		c.CloseTerminal(tid)
	}
}
func (a *App) GetTerminalScrollState(id string) (sshclient.TerminalScrollState, error) {
	c, tid, err := a.terminalClient(id)
	if err != nil {
		return sshclient.TerminalScrollState{}, err
	}
	return c.GetTerminalScrollState(tid)
}
func (a *App) ScrollTerminal(id string, value int, relative bool) (sshclient.TerminalScrollState, error) {
	c, tid, err := a.terminalClient(id)
	if err != nil {
		return sshclient.TerminalScrollState{}, err
	}
	return c.ScrollTerminal(tid, value, relative)
}
func (a *App) UploadImage(id, data string) (string, error) {
	c, _, err := a.terminalClient(id)
	if err != nil {
		return "", err
	}
	return c.UploadImage(data)
}

func (a *App) ListFiles(id, dir string) (sshclient.RemoteDirectory, error) {
	c, err := a.client(id)
	if err != nil {
		return sshclient.RemoteDirectory{}, err
	}
	return c.ListFiles(dir)
}

func (a *App) DownloadFile(id, remote, requestID string) (string, error) {
	c, err := a.client(id)
	if err != nil {
		return "", err
	}
	name := path.Base(strings.ReplaceAll(remote, `\`, "/"))
	if name == "." || name == "/" || name == "" {
		return "", errors.New("请选择文件下载")
	}
	if requestID == "" {
		return "", errors.New("无效下载请求 ID")
	}
	return a.saveDownload(name, func(dest io.Writer) error {
		return c.DownloadFileWithProgress(remote, dest, func(transferred, total int64, speed float64) {
			a.emit("download:progress", map[string]any{"requestId": requestID, "stage": "downloading", "transferred": transferred, "total": total, "bytesPerSecond": speed})
		})
	})
}
