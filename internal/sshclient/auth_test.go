package sshclient

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"
)

func authTestHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("SSH_AUTH_SOCK", filepath.Join(home, "missing-agent"))
	if err := os.MkdirAll(filepath.Join(home, ".ssh"), 0700); err != nil {
		t.Fatal(err)
	}
	return home
}

func writeAuthKey(t *testing.T, path, pass string) ssh.Signer {
	t.Helper()
	var private any
	var err error
	switch filepath.Base(path) {
	case "id_rsa":
		private, err = rsa.GenerateKey(rand.Reader, 2048)
	case "id_ecdsa":
		private, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	default:
		_, private, err = ed25519.GenerateKey(rand.Reader)
	}
	if err != nil {
		t.Fatal(err)
	}
	var block *pem.Block
	if pass == "" {
		block, err = ssh.MarshalPrivateKey(private, "test")
	} else {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(private, "test", []byte(pass))
	}
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0600); err != nil {
		t.Fatal(err)
	}
	key, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestAutoAuthDefaultIdentities(t *testing.T) {
	for _, name := range []string{"id_ed25519", "id_rsa", "id_ecdsa"} {
		t.Run(name, func(t *testing.T) {
			home := authTestHome(t)
			key := writeAuthKey(t, filepath.Join(home, ".ssh", name), "")
			server := startSSH(t, key.PublicKey())
			client := New(func(TerminalEvent) {}, nil, ssh.InsecureIgnoreHostKey(), func(kind, prompt string, secret bool) (string, error) {
				return "", fmt.Errorf("unexpected %s prompt", kind)
			}, nil)
			defer client.Disconnect()
			input := inputFor(server)
			input.AuthMethod = "auto"
			if _, err := client.Connect(input); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAutoAuthTriesAllKeysAndUnlocksOnlyAcceptedKey(t *testing.T) {
	home := authTestHome(t)
	unrelated := filepath.Join(home, ".ssh", "id_rsa")
	accepted := filepath.Join(home, ".ssh", "id_ed25519")
	writeAuthKey(t, unrelated, "unused")
	key := writeAuthKey(t, accepted, "phrase")
	server := startSSH(t, key.PublicKey())
	asks := 0
	client := New(func(TerminalEvent) {}, nil, ssh.InsecureIgnoreHostKey(), func(kind, prompt string, secret bool) (string, error) {
		if kind != "passphrase" || prompt != "请输入私钥口令："+accepted {
			return "", fmt.Errorf("unexpected prompt: %s %s", kind, prompt)
		}
		asks++
		return "phrase", nil
	}, nil)
	defer client.Disconnect()
	input := inputFor(server)
	input.AuthMethod = "auto"
	if _, err := client.Connect(input); err != nil {
		t.Fatal(err)
	}
	if asks != 1 {
		t.Fatalf("expected one key unlock, got %d", asks)
	}
}

func TestAutoAuthMultipleConfiguredIdentities(t *testing.T) {
	home := authTestHome(t)
	first, second := filepath.Join(home, "first"), filepath.Join(home, "second")
	writeAuthKey(t, first, "")
	key := writeAuthKey(t, second, "")
	server := startSSH(t, key.PublicKey())
	client := New(func(TerminalEvent) {}, nil, ssh.InsecureIgnoreHostKey(), nil, nil)
	defer client.Disconnect()
	input := inputFor(server)
	input.AuthMethod = "auto"
	input.PrivateKeyPaths = []string{filepath.Join(home, "missing"), first, second}
	input.PrivateKeyPath = first
	if _, err := client.Connect(input); err != nil {
		t.Fatal(err)
	}
}

func TestAutoAuthPasswordFallback(t *testing.T) {
	home := authTestHome(t)
	if err := os.WriteFile(filepath.Join(home, ".ssh", "id_rsa"), []byte("invalid key"), 0600); err != nil {
		t.Fatal(err)
	}
	server := startSSH(t, nil)
	client := New(func(TerminalEvent) {}, nil, ssh.InsecureIgnoreHostKey(), func(kind, prompt string, secret bool) (string, error) {
		if kind != "password" {
			return "", fmt.Errorf("unexpected %s prompt", kind)
		}
		return "secret", nil
	}, nil)
	defer client.Disconnect()
	input := inputFor(server)
	input.AuthMethod = "auto"
	if _, err := client.Connect(input); err != nil {
		t.Fatal(err)
	}
}
