package sshclient

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/pkg/sftp"
)

type RemoteFile struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"`
}
type RemoteDirectory struct {
	Path    string       `json:"path"`
	Parent  string       `json:"parent"`
	Entries []RemoteFile `json:"entries"`
}

// Use an independent SFTP channel so transfers don't block terminal controls or disconnect.
func (c *Client) fileClient() (*sftp.Client, bool, error) {
	conn, err := c.current()
	if err != nil {
		return nil, false, err
	}
	if conn.local {
		return nil, false, errors.New("SFTP 文件浏览需要选择 SSH 服务器")
	}
	ftp, err := sftp.NewClient(conn.client)
	return ftp, conn.info.Platform == "windows", err
}

func (c *Client) ListFiles(dir string) (RemoteDirectory, error) {
	result := RemoteDirectory{Entries: []RemoteFile{}}
	ftp, windows, err := c.fileClient()
	if err != nil {
		return result, err
	}
	defer ftp.Close()
	if dir == "" {
		dir = "."
	}
	if windows {
		dir = strings.ReplaceAll(dir, `\`, "/")
	}
	resolved, err := ftp.RealPath(dir)
	if err != nil {
		return result, fmt.Errorf("无法定位目录：%w", err)
	}
	entries, err := ftp.ReadDir(resolved)
	if err != nil {
		return result, fmt.Errorf("无法读取目录：%w", err)
	}
	result.Path, result.Parent = resolved, path.Dir(resolved)
	for _, entry := range entries {
		isDir := entry.IsDir()
		// Follow symlinks for navigation, without hiding broken links.
		if entry.Mode()&os.ModeSymlink != 0 {
			if target, err := ftp.Stat(path.Join(resolved, entry.Name())); err == nil {
				isDir = target.IsDir()
			}
		}
		result.Entries = append(result.Entries, RemoteFile{entry.Name(), path.Join(resolved, entry.Name()), isDir, entry.Size(), entry.ModTime().Unix()})
	}
	sort.Slice(result.Entries, func(i, j int) bool {
		a, b := result.Entries[i], result.Entries[j]
		if a.IsDir != b.IsDir {
			return a.IsDir
		}
		return a.Name < b.Name
	})
	return result, nil
}

func (c *Client) DownloadFile(remote string, dest io.Writer) error {
	return c.DownloadFileWithProgress(remote, dest, nil)
}

func (c *Client) DownloadFileWithProgress(remote string, dest io.Writer, progress func(int64, int64, float64)) error {
	ftp, windows, err := c.fileClient()
	if err != nil {
		return err
	}
	defer ftp.Close()
	if windows {
		remote = strings.ReplaceAll(remote, `\`, "/")
	}
	// Reject special files before opening: opening a FIFO can block indefinitely.
	info, err := ftp.Stat(remote)
	if err != nil {
		return fmt.Errorf("无法读取远端文件：%w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("请选择普通文件下载")
	}
	file, err := ftp.Open(remote)
	if err != nil {
		return fmt.Errorf("无法打开远端文件：%w", err)
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("请选择普通文件下载")
	}
	writer := &downloadWriter{dest: dest, total: info.Size(), started: time.Now(), progress: progress}
	writer.report(true)
	// SFTP pipelines reads but serializes writes, preserving throughput and accurate progress.
	n, err := file.WriteTo(writer)
	if err != nil {
		return fmt.Errorf("下载失败：%w", err)
	}
	if n != info.Size() {
		return fmt.Errorf("下载期间文件大小发生变化，请重试")
	}
	writer.report(true)
	return nil
}

// Throttle events to keep large transfers from flooding the WebView bridge.
type downloadWriter struct {
	dest               io.Writer
	total, transferred int64
	started, last      time.Time
	progress           func(int64, int64, float64)
}

func (w *downloadWriter) Write(p []byte) (int, error) {
	n, err := w.dest.Write(p)
	w.transferred += int64(n)
	w.report(false)
	return n, err
}
func (w *downloadWriter) report(force bool) {
	if w.progress == nil {
		return
	}
	now := time.Now()
	if !force && now.Sub(w.last) < 200*time.Millisecond {
		return
	}
	w.last = now
	elapsed := now.Sub(w.started).Seconds()
	speed := float64(0)
	if elapsed > 0 {
		speed = float64(w.transferred) / elapsed
	}
	w.progress(w.transferred, w.total, speed)
}
