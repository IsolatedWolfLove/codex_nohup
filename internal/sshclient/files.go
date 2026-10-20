package sshclient

import (
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"

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
	n, err := io.Copy(dest, file)
	if err != nil {
		return fmt.Errorf("下载失败：%w", err)
	}
	if n != info.Size() {
		return fmt.Errorf("下载期间文件大小发生变化，请重试")
	}
	return nil
}
