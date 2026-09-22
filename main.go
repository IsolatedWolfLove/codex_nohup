package main

import (
	"embed"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"log"
)

//go:embed all:out/renderer
var assets embed.FS

//go:embed resources/agent/nohop-agent-windows-amd64.exe
var windowsAgent []byte

func main() {
	app := newApp()
	err := wails.Run(&options.App{
		Title: "Nohop Codex", Width: 1180, Height: 760, MinWidth: 820, MinHeight: 560,
		BackgroundColour: &options.RGBA{R: 11, G: 15, B: 20, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnStartup:        app.startup, OnShutdown: app.shutdown, Bind: []interface{}{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
