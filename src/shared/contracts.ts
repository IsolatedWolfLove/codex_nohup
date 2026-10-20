export type AuthMethod = 'auto' | 'password' | 'privateKey' | 'agent';

export interface ConnectInput {
  connectionId: string;
  alias?: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  proxyJumpHost?: string;
  proxyJumpPort?: number;
  proxyJumpUser?: string;
  proxyJumpKey?: string;
}
export interface SSHHost { alias: string; host: string; user?: string; port: number; identity?: string }
export interface CredentialRequest { id: string; kind: string; prompt: string; secret: boolean }

export type RemotePlatform = 'linux' | 'windows';
export type SessionBackend = 'tmux' | 'screen' | 'conpty' | 'none';

export interface ConnectionInfo {
  connectionId: string;
  platform: RemotePlatform;
  backend: SessionBackend;
  host: string;
}

export interface PersistentSession {
  name: string;
  attached: boolean;
  createdAt?: number;
  windows?: number;
  backend: SessionBackend;
}

export interface CreateSessionInput {
  connectionId: string;
  name: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalOpened {
  terminalId: string;
  sessionName: string;
  backend: SessionBackend;
}

export interface TerminalScrollState { lines: number; position: number; rows: number }

export type TerminalEvent =
  | { type: 'disconnected'; connectionId: string; terminalId: string }
  | { type: 'data'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string }
  | { type: 'error'; terminalId: string; message: string };

export interface RemoteFile {
 name: string;
 path: string;
 isDir: boolean;
 size: number;
 modified: number;
}
export interface RemoteDirectory {
 path: string;
 parent: string;
 entries: RemoteFile[];
}
