package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestSSHKeyStoreDisabledOnDesktop(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	app := &App{}
	keys, err := app.ListSSHKeys()
	if err != nil || len(keys) != 0 {
		t.Fatalf("expected empty list on desktop, got %+v, %v", keys, err)
	}
	if _, err := app.GenerateSSHKey("id_ed25519", "", ""); err == nil {
		t.Fatal("desktop should refuse generating key")
	}
	if _, err := app.ImportSSHKey("work", "dummy", ""); err == nil {
		t.Fatal("desktop should refuse importing key")
	}
	if err := app.DeleteSSHKey("id_ed25519"); err == nil {
		t.Fatal("desktop should refuse deleting key")
	}
	if _, err := os.Stat(filepath.Join(home, ".ssh")); !os.IsNotExist(err) {
		t.Fatal("desktop key store touched ~/.ssh directory")
	}
}

func TestSSHKeyStoreLifecycle(t *testing.T) {
	prev := isAndroidKeyStoreEnabled
	isAndroidKeyStoreEnabled = func() bool { return true }
	t.Cleanup(func() { isAndroidKeyStoreEnabled = prev })

	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	app := &App{}

	empty, err := app.ListSSHKeys()
	if err != nil || len(empty) != 0 {
		t.Fatalf("expected empty list, got %+v, %v", empty, err)
	}

	// Default Ed25519 key generation.
	def, err := app.GenerateSSHKey("", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if def.Name != "id_ed25519" || def.Path != "~/.ssh/id_ed25519" || !def.IsDefault || def.Encrypted || def.Algorithm != "ED25519" || !strings.HasPrefix(def.PublicKey, "ssh-ed25519 ") {
		t.Fatalf("unexpected generated key: %+v", def)
	}
	// Duplicate name must be refused without overwriting.
	if _, err := app.GenerateSSHKey("id_ed25519", "", ""); err == nil {
		t.Fatal("expected duplicate key error")
	}

	// Encrypted key generation preserves extractable public key and fingerprint.
	enc, err := app.GenerateSSHKey("work_phone", "secret-pass", "phone@test")
	if err != nil {
		t.Fatal(err)
	}
	if !enc.Encrypted || enc.IsDefault || !strings.HasSuffix(enc.PublicKey, " phone@test") {
		t.Fatalf("unexpected encrypted key: %+v", enc)
	}

	// Import pasted private key.
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "imported")
	if err != nil {
		t.Fatal(err)
	}
	imp, err := app.ImportSSHKey("backup_key", string(pem.EncodeToMemory(block)), "")
	if err != nil {
		t.Fatal(err)
	}
	if imp.Name != "backup_key" || imp.PublicKey == "" || imp.Fingerprint == "" {
		t.Fatalf("unexpected imported key: %+v", imp)
	}

	// Invalid names and config files must be rejected.
	for _, bad := range []string{"", "../evil", "config", "known_hosts", "a.pub", ".hidden", "a/b"} {
		if _, err := app.GenerateSSHKey(bad, "", ""); err == nil {
			t.Errorf("accepted invalid name %q", bad)
		}
		if err := app.DeleteSSHKey(bad); err == nil {
			t.Errorf("deleted invalid name %q", bad)
		}
	}

	// Unrelated files in ~/.ssh must not appear or be deletable.
	_ = os.WriteFile(filepath.Join(home, ".ssh", "config"), []byte("Host x\n"), 0600)
	list, err := app.ListSSHKeys()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 || list[0].Name != "id_ed25519" {
		t.Fatalf("expected 3 sorted keys with default first, got %+v", list)
	}

	if err := app.DeleteSSHKey("backup_key"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".ssh", "backup_key")); !os.IsNotExist(err) {
		t.Fatal("private key file still exists")
	}
	if _, err := os.Stat(filepath.Join(home, ".ssh", "backup_key.pub")); !os.IsNotExist(err) {
		t.Fatal("public key file still exists")
	}
}
