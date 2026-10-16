package sshclient

import (
	"bytes"
	"encoding/base64"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestDecodeImage(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nexample")
	decoded, extension, err := decodeImage(base64.StdEncoding.EncodeToString(png))
	if err != nil || extension != ".png" || !bytes.Equal(decoded, png) {
		t.Fatal(extension, err)
	}
	for _, data := range []string{"!invalid!", base64.StdEncoding.EncodeToString([]byte("plain text")), base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{'a'}, maxImageBytes+1))} {
		if _, _, err := decodeImage(data); err == nil {
			t.Fatal("invalid or oversized image accepted")
		}
	}
}

func TestIndependentConnectionsAndUnexpectedDisconnect(t *testing.T) {
	f := startSSH(t, nil)
	events := make(chan TerminalEvent, 32)
	first := New(func(e TerminalEvent) { events <- e }, nil, ssh.InsecureIgnoreHostKey(), nil, nil)
	second := New(func(TerminalEvent) {}, nil, ssh.InsecureIgnoreHostKey(), nil, nil)
	defer first.Disconnect()
	defer second.Disconnect()
	for _, c := range []*Client{first, second} {
		if _, err := c.Connect(inputFor(f)); err != nil {
			t.Fatal(err)
		}
	}
	conn, err := first.current()
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.client.Close()
	select {
	case event := <-events:
		if event.Type != "disconnected" {
			t.Fatal(event)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("missing disconnect notification")
	}
	if _, err := second.ListSessions(); err != nil {
		t.Fatal("second connection was affected", err)
	}
	if _, err := first.Connect(inputFor(f)); err != nil {
		t.Fatal(err)
	}
	if _, err := first.ListSessions(); err != nil {
		t.Fatal("reconnected client unusable", err)
	}
	first.Disconnect()
	select {
	case event := <-events:
		t.Fatal("intentional disconnect triggered recovery", event)
	case <-time.After(50 * time.Millisecond):
	}
}
