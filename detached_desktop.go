//go:build !android

package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

var detachedWindows = struct {
	sync.Mutex
	windows     map[string]*application.WebviewWindow
	terminalIDs map[string]string
}{windows: make(map[string]*application.WebviewWindow), terminalIDs: make(map[string]string)}

// A detached view shares the original terminal and SSH client, never attaches again.
func (a *App) DetachTerminal(payload string) error {
	var tab struct {
		Key  string `json:"key"`
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(payload), &tab); err != nil {
		return err
	}
	if tab.Key == "" || tab.ID == "" {
		return fmt.Errorf("会话尚未连接")
	}
	if _, _, err := a.terminalClient(tab.ID); err != nil {
		return err
	}
	detachedWindows.Lock()
	defer detachedWindows.Unlock()
	if w := detachedWindows.windows[tab.Key]; w != nil {
		w.Show()
		w.Focus()
		return nil
	}
	if c, id, err := a.terminalClient(tab.ID); err == nil {
		c.SuspendTerminalView(id)
	}
	w := application.Get().Window.NewWithOptions(application.WebviewWindowOptions{
		Linux: application.LinuxWindow{Icon: appIcon},
		Name:  "terminal-" + tab.Key, Title: tab.Name + " · Nohop Codex",
		Width: 960, Height: 640, MinWidth: 420, MinHeight: 280, Frameless: true,
		BackgroundColour: application.NewRGB(11, 15, 20), URL: "/?terminal=" + url.QueryEscape(payload),
	})
	detachedWindows.windows[tab.Key] = w
	detachedWindows.terminalIDs[tab.Key] = tab.ID
	w.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		detachedWindows.Lock()
		terminalID := detachedWindows.terminalIDs[tab.Key]
		delete(detachedWindows.terminalIDs, tab.Key)
		delete(detachedWindows.windows, tab.Key)
		detachedWindows.Unlock()
		if c, id, err := a.terminalClient(terminalID); err == nil {
			c.SuspendTerminalView(id)
		}
		a.emit("terminal:docked", tab.Key)
	})
	return nil
}

// Updates an existing window after reconnect without opening another attachment.
func (a *App) SyncDetached(payload string) {
	var tab struct {
		Key string
		ID  string
	}
	if json.Unmarshal([]byte(payload), &tab) != nil {
		return
	}
	detachedWindows.Lock()
	if detachedWindows.windows[tab.Key] != nil && tab.ID != "" {
		detachedWindows.terminalIDs[tab.Key] = tab.ID
	}
	detachedWindows.Unlock()
	a.emit("terminal:updated", payload)
}
