import type { DownloadProgress, RemoteDirectory, PortForward, PortForwardInput, ConnectInput, ConnectionInfo, CreateSessionInput, CredentialRequest, PersistentSession, SSHHost, TerminalEvent, TerminalOpened, TerminalScrollState } from './contracts';

export interface DesktopApi {
  connect(input: ConnectInput): Promise<ConnectionInfo>;
  disconnect(connectionId: string): Promise<void>;
  listSessions(connectionId: string): Promise<PersistentSession[]>;
  openSession(input: CreateSessionInput): Promise<TerminalOpened>;
  killSession(connectionId: string, name: string): Promise<void>;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  closeTerminal(id: string): Promise<void>;
  readyTerminal(id: string): Promise<void>;
  getTerminalScrollState(id: string): Promise<TerminalScrollState>;
  scrollTerminal(id: string, value: number, relative: boolean): Promise<TerminalScrollState>;
  listPortForwards(connectionId: string): Promise<PortForward[]>;
  startPortForward(connectionId: string, input: PortForwardInput): Promise<PortForward>;
  stopPortForward(connectionId: string, id: string): Promise<void>;
  listFiles(connectionId: string, path: string): Promise<RemoteDirectory>;
  downloadFile(connectionId: string, path: string, requestId: string): Promise<string>;
  uploadImage(id: string, data: string): Promise<string>;
  choosePrivateKey(): Promise<string | null>;
  confirmKill(name: string): Promise<boolean>;
  clipboardGetImage(): Promise<string>;
  clipboardGetText(): Promise<string>;
  clipboardSetText(value: string): Promise<void>;
  addSSHHost(alias: string, command: string): Promise<void>;
  getSSHConfig(): Promise<string>;
  saveSSHConfig(content: string): Promise<void>;
  listSSHHosts(): Promise<SSHHost[]>;
  submitCredential(id: string, value: string, cancelled: boolean): Promise<void>;
  onCredentialRequest(callback: (request: CredentialRequest) => void): () => void;
  onAuthUrl(callback: (url: string) => void): () => void;
  onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
}
