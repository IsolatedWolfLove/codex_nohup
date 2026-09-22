//go:build windows

package sshclient

import (
	"github.com/Microsoft/go-winio"
	"net"
	"os"
	"time"
)

func dialAgent() (net.Conn, error) {
	socket := os.Getenv("SSH_AUTH_SOCK")
	if socket == "" {
		socket = `\\.\pipe\openssh-ssh-agent`
	}
	timeout := 5 * time.Second
	return winio.DialPipe(socket, &timeout)
}
