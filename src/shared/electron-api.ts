import type { ConnectInput, ConnectionInfo, CreateSessionInput, PersistentSession, TerminalEvent, TerminalOpened } from './contracts';

export interface ElectronApi {
  connect(input: ConnectInput): Promise<ConnectionInfo>;
  disconnect(): Promise<void>;
  listSessions(): Promise<PersistentSession[]>;
  openSession(input: CreateSessionInput): Promise<TerminalOpened>;
  killSession(name: string): Promise<void>;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  closeTerminal(id: string): Promise<void>;
  readyTerminal(id: string): Promise<string>;
  choosePrivateKey(): Promise<string | null>;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
}
