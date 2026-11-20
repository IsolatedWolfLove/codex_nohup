package sshclient

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

// All identities must share one publickey method: x/crypto/ssh only tries
// the first AuthMethod for each protocol name.
func (c *Client) autoAuthMethods(input ConnectInput) ([]ssh.AuthMethod, []func(), error) {
	var signers []ssh.Signer
	var cleanups []func()
	if socket, err := dialAgent(); err == nil {
		_ = socket.SetDeadline(time.Now().Add(30 * time.Second))
		if keys, err := agent.NewClient(socket).Signers(); err == nil && len(keys) > 0 {
			_ = socket.SetDeadline(time.Time{}) // Host-key confirmation may take longer than key enumeration.
			signers = append(signers, keys...)
			cleanups = append(cleanups, func() { _ = socket.Close() })
		} else {
			_ = socket.Close()
		}
	}
	paths := append([]string(nil), input.PrivateKeyPaths...)
	if input.PrivateKeyPath != "" {
		paths = append(paths, input.PrivateKeyPath)
	}
	if len(paths) == 0 {
		if home, err := os.UserHomeDir(); err == nil {
			sshDir := filepath.Join(home, ".ssh")
			for _, name := range []string{"id_rsa", "id_ecdsa", "id_ed25519", "id_dsa"} {
				paths = append(paths, filepath.Join(sshDir, name))
			}
			// Android stores app-managed keys inside its private sandbox ~/.ssh directory,
			// so automatically try custom-named keys saved there when no -i path is given.
			if runtime.GOOS == "android" {
				paths = appendExtraStoredKeys(paths, sshDir, 4)
			}
		}
	}
	seen := map[string]bool{}
	for _, path := range paths {
		path = expandUserPath(path)
		if strings.EqualFold(path, "none") || seen[path] {
			continue
		}
		seen[path] = true
		// Missing identities do not disable Agent/password fallback.
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		key, err := ssh.ParsePrivateKey(data)
		var encrypted *ssh.PassphraseMissingError
		if errors.As(err, &encrypted) {
			public := encrypted.PublicKey
			if public == nil {
				if encoded, err := os.ReadFile(path + ".pub"); err == nil {
					public, _, _, _, _ = ssh.ParseAuthorizedKey(encoded)
				}
			}
			unlock := func() (ssh.Signer, error) {
				pass := input.Passphrase
				if pass == "" {
					var err error
					pass, err = c.credential("passphrase", "请输入私钥口令："+path, true)
					if err != nil {
						return nil, err
					}
				}
				return ssh.ParsePrivateKeyWithPassphrase(data, []byte(pass))
			}
			if public != nil {
				key = &lockedSigner{public: public, unlock: unlock}
			} else {
				key, err = unlock()
				if err != nil {
					return nil, cleanups, err
				}
			}
		} else if err != nil {
			continue
		}
		duplicate := false
		for _, existing := range signers {
			if string(existing.PublicKey().Marshal()) == string(key.PublicKey().Marshal()) {
				duplicate = true
				break
			}
		}
		if !duplicate {
			signers = append(signers, key)
		}
	}
	var auths []ssh.AuthMethod
	if len(signers) > 0 {
		auths = append(auths, ssh.PublicKeys(signers...))
	}
	auths = append(auths, ssh.PasswordCallback(func() (string, error) {
		return c.credential("password", fmt.Sprintf("请输入 %s@%s 的密码", input.Username, input.Host), true)
	}))
	return auths, cleanups, nil
}

func expandUserPath(value string) string {
	if strings.HasPrefix(value, "~/") || strings.HasPrefix(value, "~"+string(filepath.Separator)) {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			return filepath.Join(home, value[2:])
		}
	}
	return value
}

func appendExtraStoredKeys(paths []string, sshDir string, limit int) []string {
	entries, err := os.ReadDir(sshDir)
	if err != nil {
		return paths
	}
	added := 0
	for _, entry := range entries {
		if added >= limit || entry.IsDir() {
			continue
		}
		name := entry.Name()
		lower := strings.ToLower(name)
		if strings.HasSuffix(lower, ".pub") || lower == "config" || strings.HasPrefix(lower, "known_hosts") || lower == "authorized_keys" {
			continue
		}
		full := filepath.Join(sshDir, name)
		info, err := os.Stat(full)
		if err != nil || info.IsDir() || info.Size() > 1024*1024 {
			continue
		}
		if data, err := os.ReadFile(full); err == nil && bytes.Contains(data, []byte("PRIVATE KEY-----")) {
			paths = append(paths, full)
			added++
		}
	}
	return paths
}

// Offer an encrypted key's public part first, prompting only if the server
// accepts it. An unrelated locked key must not block another identity.
type lockedSigner struct {
	public ssh.PublicKey
	unlock func() (ssh.Signer, error)
	signer ssh.Signer
}

func (s *lockedSigner) PublicKey() ssh.PublicKey { return s.public }
func (s *lockedSigner) Sign(random io.Reader, data []byte) (*ssh.Signature, error) {
	return s.SignWithAlgorithm(random, data, "")
}
func (s *lockedSigner) SignWithAlgorithm(random io.Reader, data []byte, algorithm string) (*ssh.Signature, error) {
	if s.signer == nil {
		key, err := s.unlock()
		if err != nil {
			return nil, err
		}
		s.signer = key
	}
	if key, ok := s.signer.(ssh.AlgorithmSigner); ok {
		return key.SignWithAlgorithm(random, data, algorithm)
	}
	return s.signer.Sign(random, data)
}
