package sshclient

import (
	"errors"
	"fmt"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
	"net"
	"os"
	"path/filepath"
	"sync"
)

var hostKeyMu sync.Mutex

// HostKeyCallback trusts known keys and asks before persisting a new server key.
// A changed key is always rejected; the user must resolve it outside the app.
func HostKeyCallback(path string, confirm func(string, string) bool) ssh.HostKeyCallback {
	return func(host string, remote net.Addr, key ssh.PublicKey) error {
		hostKeyMu.Lock()
		defer hostKeyMu.Unlock()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		f.Close()
		check, err := knownhosts.New(path)
		if err != nil {
			return err
		}
		err = check(host, remote, key)
		if err == nil {
			return nil
		}
		var mismatch *knownhosts.KeyError
		if !errors.As(err, &mismatch) || len(mismatch.Want) > 0 {
			return fmt.Errorf("服务器主机密钥校验失败：%w", err)
		}
		if confirm == nil || !confirm(host, ssh.FingerprintSHA256(key)) {
			return errors.New("未信任服务器主机密钥")
		}
		f, err = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = fmt.Fprintln(f, knownhosts.Line([]string{knownhosts.Normalize(host)}, key))
		return err
	}
}
