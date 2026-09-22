import type { ConnectInput, ConnectionInfo, CreateSessionInput, CredentialRequest, PersistentSession, SSHHost, TerminalEvent, TerminalOpened } from './contracts';

export interface DesktopApi {
  connect(input: ConnectInput): Promise<ConnectionInfo>;
  disconnect(): Promise<void>;
  listSessions(): Promise<PersistentSession[]>;
  openSession(input: CreateSessionInput): Promise<TerminalOpened>;
  killSession(name: string): Promise<void>;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  closeTerminal(id: string): Promise<void>;
  readyTerminal(id: string): Promise<void>;
  choosePrivateKey(): Promise<string | null>;
  confirmKill(name: string): Promise<boolean>;
  clipboardGetText(): Promise<string>;
  clipboardSetText(value: string): Promise<void>;
  getSSHConfig(): Promise<string>;
  saveSSHConfig(content: string): Promise<void>;
  listSSHHosts(): Promise<SSHHost[]>;
  submitCredential(id: string, value: string, cancelled: boolean): Promise<void>;
  onCredentialRequest(callback: (request: CredentialRequest) => void): () => void;
  onAuthUrl(callback: (url: string) => void): () => void;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
}
