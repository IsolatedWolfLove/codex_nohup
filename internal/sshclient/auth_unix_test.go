//go:build !windows

package sshclient

import (
	"net"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

func TestAutoAuthAgentAndFileKeysShareMethod(t *testing.T) {
	for _, acceptAgent := range []bool{true, false} {
		name := "file-after-agent"
		if acceptAgent {
			name = "agent-after-file"
		}
		t.Run(name, func(t *testing.T) {
			home := authTestHome(t)
			filePath, agentPath := filepath.Join(home, "file"), filepath.Join(home, "agent")
			fileKey := writeAuthKey(t, filePath, "")
			agentKey := writeAuthKey(t, agentPath, "")
			data, err := os.ReadFile(agentPath)
			if err != nil {
				t.Fatal(err)
			}
			private, err := ssh.ParseRawPrivateKey(data)
			if err != nil {
				t.Fatal(err)
			}
			keyring := agent.NewKeyring()
			if err := keyring.Add(agent.AddedKey{PrivateKey: private}); err != nil {
				t.Fatal(err)
			}
			socket := filepath.Join(home, "sock")
			listener, err := net.Listen("unix", socket)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { listener.Close() })
			go func() {
				for {
					conn, err := listener.Accept()
					if err != nil {
						return
					}
					go func() { defer conn.Close(); _ = agent.ServeAgent(keyring, conn) }()
				}
			}()
			t.Setenv("SSH_AUTH_SOCK", socket)
			accepted := fileKey.PublicKey()
			if acceptAgent {
				accepted = agentKey.PublicKey()
			}
			server := startSSH(t, accepted)
			client := New(func(TerminalEvent) {}, nil, ssh.InsecureIgnoreHostKey(), nil, nil)
			defer client.Disconnect()
			input := inputFor(server)
			input.AuthMethod = "auto"
			input.PrivateKeyPath = filePath
			if _, err := client.Connect(input); err != nil {
				t.Fatal(err)
			}
		})
	}
}
