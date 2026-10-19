package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:out/renderer
var assets embed.FS

//go:embed resources/agent/nohop-agent-windows-amd64.exe
var windowsAgent []byte

func init() { application.RegisterAndroidMain(main) }

func main() {
	// The JNI bridge is ready before the registered main function runs.
	base := application.Android.StoragePath()
	if base == "" {
		log.Print("Android private storage is unavailable")
		return
	}
	// Existing SSH config/key discovery uses the standard Go directory helpers.
	for key, value := range map[string]string{"HOME": base, "XDG_CONFIG_HOME": filepath.Join(base, "config")} {
		if err := os.Setenv(key, value); err != nil {
			log.Print(err)
			return
		}
	}
	backend := newApp()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	backend.startup(ctx)
	app := application.New(application.Options{
		Name: "Nohop Codex", Description: "Persistent SSH terminal",
		Services: []application.Service{application.NewService(backend)},
		Assets:   application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
	})
	app.OnShutdown(func() { cancel(); backend.shutdown(ctx) })
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "Nohop Codex", URL: "/", BackgroundColour: application.NewRGB(8, 11, 16),
	})
	if err := app.Run(); err != nil {
		log.Print(fmt.Errorf("Android startup: %w", err))
	}
}
