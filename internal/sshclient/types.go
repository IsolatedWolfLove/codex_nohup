package sshclient

type ConnectInput struct {
	Host           string `json:"host"`
	Port           int    `json:"port"`
	Username       string `json:"username"`
	AuthMethod     string `json:"authMethod"`
	Password       string `json:"password"`
	PrivateKeyPath string `json:"privateKeyPath"`
	Passphrase     string `json:"passphrase"`
}
type ConnectionInfo struct {
	Platform string `json:"platform"`
	Backend  string `json:"backend"`
	Host     string `json:"host"`
}
type PersistentSession struct {
	Name      string `json:"name"`
	Attached  bool   `json:"attached"`
	CreatedAt int64  `json:"createdAt,omitempty"`
	Windows   int    `json:"windows,omitempty"`
	Backend   string `json:"backend"`
}
type CreateSessionInput struct {
	Name string `json:"name"`
	Cwd  string `json:"cwd"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}
type TerminalOpened struct {
	TerminalID  string `json:"terminalId"`
	SessionName string `json:"sessionName"`
	Backend     string `json:"backend"`
}

// Data is base64 encoded so byte boundaries never corrupt UTF-8 terminal output.
type TerminalEvent struct {
	Type       string `json:"type"`
	TerminalID string `json:"terminalId"`
	Data       string `json:"data,omitempty"`
	Message    string `json:"message,omitempty"`
}
