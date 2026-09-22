package main

import "testing"

func TestResolveSSHHost(t *testing.T) {
	config := `
Host work
  HostName 100.64.0.8
  User ubuntu
  Port 2222
  IdentityFile ~/.ssh/work_key

Host *
  Port 22
  User fallback
`
	host := resolveSSHHost(config, "work")
	if host.Host != "100.64.0.8" || host.User != "ubuntu" || host.Port != 2222 {
		t.Fatalf("unexpected host: %#v", host)
	}
	if host.Identity == "" || host.Identity == "~/.ssh/work_key" {
		t.Fatalf("identity was not expanded: %q", host.Identity)
	}
}

func TestParseSSHConfigAliases(t *testing.T) {
	_, aliases := parseSSHConfig("Host one two *.internal !blocked\n  User root\nHost one\n  Port 2200\n")
	if len(aliases) != 2 || aliases[0] != "one" || aliases[1] != "two" {
		t.Fatalf("unexpected aliases: %#v", aliases)
	}
}

