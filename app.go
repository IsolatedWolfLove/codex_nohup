package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"

	"nohop-codex/internal/sshclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
)

type App struct {
	ctx context.Context
	ssh *sshclient.Client
}

func newApp() *App { return &App{} }
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.ssh = sshclient.New(func(event sshclient.TerminalEvent) { runtime.EventsEmit(ctx, "terminal:event", event) }, windowsAgent,
		func(host string, remoteAddr net.Addr, key ssh.PublicKey) error {
			base, err := os.UserConfigDir()
			if err != nil {
				return err
			}
			return sshclient.HostKeyCallback(filepath.Join(base, "NohopCodex", "known_hosts"), func(host, fingerprint string) bool {
				choice, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{Type: runtime.QuestionDialog, Title: "首次连接服务器", Message: fmt.Sprintf("服务器：%s\n主机密钥指纹：%s\n\n确认信任此服务器并保存密钥？", host, fingerprint), Buttons: []string{"信任并连接", "取消"}, DefaultButton: "取消", CancelButton: "取消"})
				return err == nil && choice == "信任并连接"
			})(host, remoteAddr, key)
		})
}
func (a *App) shutdown(context.Context) {
	if a.ssh != nil {
		a.ssh.Disconnect()
	}
}
func (a *App) Connect(input sshclient.ConnectInput) (sshclient.ConnectionInfo, error) {
	return a.ssh.Connect(input)
}
func (a *App) Disconnect()                                          { a.ssh.Disconnect() }
func (a *App) ListSessions() ([]sshclient.PersistentSession, error) { return a.ssh.ListSessions() }
func (a *App) OpenSession(input sshclient.CreateSessionInput) (sshclient.TerminalOpened, error) {
	return a.ssh.OpenSession(input)
}
func (a *App) KillSession(name string) error       { return a.ssh.KillSession(name) }
func (a *App) WriteTerminal(id, data string) error { return a.ssh.WriteTerminal(id, data) }
func (a *App) ReadyTerminal(id string)             { a.ssh.ReadyTerminal(id) }
func (a *App) ResizeTerminal(id string, cols, rows int) error {
	return a.ssh.ResizeTerminal(id, cols, rows)
}
func (a *App) CloseTerminal(id string) { a.ssh.CloseTerminal(id) }
func (a *App) ChoosePrivateKey() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择 SSH 私钥"})
}
func (a *App) ConfirmKill(name string) (bool, error) {
	choice, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{Type: runtime.QuestionDialog, Title: "结束远端会话", Message: fmt.Sprintf("结束远端会话“%s”？其中运行的进程也会结束。", name), Buttons: []string{"结束会话", "取消"}, DefaultButton: "取消", CancelButton: "取消"})
	return choice == "结束会话", err
}
