//go:build !android

package main

import (
	"context"
	"embed"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"log"
)

//go:embed all:out/renderer
var assets embed.FS

//go:embed resources/agent/nohop-agent-windows-amd64.exe
var windowsAgent []byte

func main() {
	backend := newApp()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	backend.startup(ctx)
	app := application.New(application.Options{
		Name:     "Nohop Codex",
		Services: []application.Service{application.NewService(backend)},
		Assets:   application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
	})
	app.OnShutdown(func() { cancel(); backend.shutdown(ctx) })
	mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "workspace", Title: "Nohop Codex", Width: 1180, Height: 760,
		MinWidth: 820, MinHeight: 560, Frameless: true,
		BackgroundColour: application.NewRGB(11, 15, 20), URL: "/",
	})
	mainWindow.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) { app.Quit() })
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
