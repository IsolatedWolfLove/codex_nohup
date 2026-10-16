package main

import (
	"nohop-codex/internal/sshclient"
	"testing"
)

func TestTerminalConnectionRouting(t *testing.T) {
	first, second := &sshclient.Client{}, &sshclient.Client{}
	a := &App{clients: map[string]*sshclient.Client{"a": first, "b": second}}
	for _, test := range []struct {
		id       string
		client   *sshclient.Client
		terminal string
	}{{"a:same", first, "same"}, {"b:same", second, "same"}} {
		c, terminal, err := a.terminalClient(test.id)
		if err != nil || c != test.client || terminal != test.terminal {
			t.Fatalf("wrong route for %s: %v", test.id, err)
		}
	}
	for _, id := range []string{"missing:same", "unscoped"} {
		if _, _, err := a.terminalClient(id); err == nil {
			t.Fatalf("accepted %s", id)
		}
	}
}
