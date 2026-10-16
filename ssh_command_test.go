package main

import (
	"strings"
	"testing"
)

func TestAddSSHCommand(t *testing.T) {
	original := "# existing config\nUser fallback\nHost old\n HostName old.example\nHost *\n Port 22\n"
	cases := []struct {
		name, command, host, user, key, jump string
		port                                 int
	}{
		{"password", "ssh alice@example.com", "example.com", "alice", "", "", 22},
		{"key", `ssh -p2222 -i "/tmp/work  key" alice@example.com`, "example.com", "alice", "/tmp/work  key", "", 2222},
		{"options", "ssh example.com -l alice -o Port=2200 -J gateway", "example.com", "alice", "", "gateway", 2200},
		{"ipv6", "ssh alice@[::1] -p 2222", "::1", "alice", "", "", 2222},
		{"alias", "ssh old", "old.example", "fallback", "", "", 22},
		{"windows", `ssh -i "C:\Users\me\work key" alice@example.com`, "example.com", "alice", `C:\Users\me\work key`, "", 22},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := addSSHCommand(original, "工作服务器", tc.command)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasSuffix(result, original) {
				t.Fatal("original config changed")
			}
			host := resolveSSHHost(result, "工作服务器")
			if host.Host != tc.host || host.User != tc.user || host.Port != tc.port || host.Identity != tc.key || host.ProxyJump != tc.jump {
				t.Fatalf("unexpected host: %#v", host)
			}
			before, after := resolveSSHHost(original, "old"), resolveSSHHost(result, "old")
			if before.Host != after.Host || before.User != after.User || before.Port != after.Port {
				t.Fatal("existing host changed")
			}
		})
	}
}

func TestAddSSHCommandRejectsInvalidInput(t *testing.T) {
	for _, command := range []string{
		"ssh", "sh alice@example.com", "ssh -p", "ssh -p0 host", "ssh -p65536 host",
		"ssh host remote-command", "ssh host; touch /tmp/file", "ssh -o ProxyCommand=evil host",
		"ssh -i \"unfinished host", "ssh host\nHost injected", "ssh -J one,two host",
		"ssh user@host:2222", "ssh -F custom host", "ssh -i '' host",
	} {
		if _, err := addSSHCommand("", "work", command); err == nil {
			t.Errorf("accepted %q", command)
		}
	}
	for _, alias := range []string{"", "*", "!work", "two words", "a\nHost bad", "-bad"} {
		if _, err := addSSHCommand("", alias, "ssh user@host"); err == nil {
			t.Errorf("accepted alias %q", alias)
		}
	}
	if _, err := addSSHCommand("Host WORK\n HostName old\n", "work", "ssh user@host"); err == nil {
		t.Fatal("duplicate accepted")
	}
}

func TestAddSSHHostPersistsConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	app := &App{}
	if err := app.SaveSSHConfig("Host old\n HostName old.example\n"); err != nil {
		t.Fatal(err)
	}
	if err := app.AddSSHHost("work", "ssh alice@example.com -i /tmp/key"); err != nil {
		t.Fatal(err)
	}
	hosts, err := app.ListSSHHosts()
	if err != nil {
		t.Fatal(err)
	}
	if len(hosts) != 2 || hosts[0].Alias != "work" || hosts[0].Identity != "/tmp/key" {
		t.Fatalf("unexpected saved hosts: %#v", hosts)
	}
	before, _ := app.GetSSHConfig()
	if err := app.AddSSHHost("work", "ssh another"); err == nil {
		t.Fatal("duplicate accepted")
	}
	after, _ := app.GetSSHConfig()
	if before != after {
		t.Fatal("failed add modified config")
	}
}
