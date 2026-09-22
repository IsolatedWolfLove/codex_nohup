export type AuthMethod = 'password' | 'privateKey' | 'agent';

export interface ConnectInput {
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export type RemotePlatform = 'linux' | 'windows';
export type SessionBackend = 'tmux' | 'screen' | 'conpty' | 'none';

export interface ConnectionInfo {
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

export type TerminalEvent =
  | { type: 'data'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string }
  | { type: 'error'; terminalId: string; message: string };
