package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"os/exec"
	"runtime"
	"time"
)

type limitedClipboard struct {
	bytes.Buffer
	tooLarge bool
}

func (b *limitedClipboard) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 28*1024*1024 {
		b.tooLarge = true
		return 0, fmt.Errorf("截图不能超过 20 MiB")
	}
	return b.Buffer.Write(p)
}

// ClipboardGetImage returns empty when the clipboard has no PNG image.
func (a *App) ClipboardGetImage() (string, error) {
	var commands [][]string
	if runtime.GOOS == "windows" {
		commands = [][]string{{"powershell.exe", "-NoProfile", "-STA", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.Windows.Forms; $i=[Windows.Forms.Clipboard]::GetImage(); if ($null -ne $i) { $s=New-Object IO.MemoryStream; $i.Save($s,[Drawing.Imaging.ImageFormat]::Png); [Console]::Out.Write([Convert]::ToBase64String($s.ToArray())); $s.Dispose(); $i.Dispose() }`}}
	} else {
		commands = [][]string{{"wl-paste", "--no-newline", "--type", "image/png"}, {"xclip", "-selection", "clipboard", "-t", "image/png", "-o"}}
	}
	for _, args := range commands {
		ctx, cancel := context.WithTimeout(a.ctx, 4*time.Second)
		cmd := exec.CommandContext(ctx, args[0], args[1:]...)
		var output limitedClipboard
		cmd.Stdout = &output
		err := cmd.Run()
		cancel()
		if output.tooLarge {
			return "", fmt.Errorf("截图不能超过 20 MiB")
		}
		if err != nil || output.Len() == 0 {
			continue
		}
		if runtime.GOOS == "windows" {
			return output.String(), nil
		}
		return base64.StdEncoding.EncodeToString(output.Bytes()), nil
	}
	return "", nil
}
