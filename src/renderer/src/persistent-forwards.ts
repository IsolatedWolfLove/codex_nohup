import type { PortForward, PortForwardInput } from '../../shared/contracts';
import type { DesktopApi } from '../../shared/desktop-api';

type ForwardApi = Pick<DesktopApi, 'listPortForwards' | 'startPortForward' | 'stopPortForward'>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export interface SavedForward extends PortForward { running: boolean }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const storageKey = (connectionId: string) => `nohop.forwards.v1.${connectionId}`;

function rule(value: PortForwardInput): PortForwardInput {
  return { direction: value.direction, listenHost: value.listenHost.trim() || '127.0.0.1', listenPort: value.listenPort,
    targetHost: value.targetHost.trim(), targetPort: value.targetPort };
}
export const forwardKey = (value: PortForwardInput) => JSON.stringify(rule(value));
function valid(value: any): value is PortForwardInput {
  return value && ['local', 'remote'].includes(value.direction) && typeof value.listenHost === 'string'
    && typeof value.targetHost === 'string' && value.targetHost.trim() !== ''
    && Number.isInteger(value.listenPort) && value.listenPort > 0 && value.listenPort <= 65535
    && Number.isInteger(value.targetPort) && value.targetPort > 0 && value.targetPort <= 65535;
}

// Serialize page actions and background restoration for each server. Runtime IDs
// belong to one SSH connection; only endpoint rules are persisted across restarts.
export class PersistentForwards {
  private queues = new Map<string, Promise<unknown>>();
  private errors = new Map<string, Map<string, string>>();
  constructor(private api: ForwardApi, private storage: () => Storage) {}

  private exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.queues.set(id, next);
    void next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id); }).catch(() => {});
    return next;
  }
  private read(id: string): PortForwardInput[] {
    const raw = this.storage().getItem(storageKey(id));
    if (!raw) return [];
    let values: unknown;
    try { values = JSON.parse(raw); } catch { throw new Error('转发规则记录损坏，无法自动恢复'); }
    if (!Array.isArray(values)) throw new Error('转发规则记录格式无效');
    return [...new Map(values.filter(valid).map(value => [forwardKey(value), rule(value)])).values()];
  }
  private save(id: string, rules: PortForwardInput[]) {
    try { this.storage().setItem(storageKey(id), JSON.stringify(rules)); }
    catch { throw new Error('无法保存端口转发规则，请检查本机存储空间'); }
  }
  private rememberRunning(id: string, saved: PortForwardInput[], running: PortForward[]) {
    const merged = new Map(saved.map(value => [forwardKey(value), value]));
    for (const value of running) merged.set(forwardKey(value), rule(value));
    const result = [...merged.values()];
    if (result.length !== saved.length) this.save(id, result);
    return result;
  }
  private failure(id: string, key: string, text: string) {
    if (!this.errors.has(id)) this.errors.set(id, new Map());
    this.errors.get(id)!.set(key, text);
  }
  list(id: string): Promise<SavedForward[]> {
    return this.exclusive(id, async () => {
      let saved = this.read(id);
      let running: PortForward[] = [];
      let unavailable = '';
      try { running = await this.api.listPortForwards(id); }
      catch (error) { if (!saved.length) throw error; unavailable = errorText(error); }
      saved = this.rememberRunning(id, saved, running);
      return saved.map(value => {
        const key = forwardKey(value);
        const live = running.find(item => forwardKey(item) === key);
        return { ...value, id: key, running: !!live,
          lastError: live?.lastError || (live ? '' : unavailable || this.errors.get(id)?.get(key) || '') };
      });
    });
  }
  start(id: string, input: PortForwardInput): Promise<void> {
    return this.exclusive(id, async () => {
      if (!valid(input)) throw new Error('请输入有效的转发地址和端口');
      const saved = this.read(id);
      const key = forwardKey(input);
      // Save before creating a listener: storage failures must not leave an
      // untracked tunnel, and failed starts remain available for retry/stop.
      if (!saved.some(value => forwardKey(value) === key)) this.save(id, [...saved, rule(input)]);
      try {
        const running = await this.api.listPortForwards(id);
        if (!running.some(value => forwardKey(value) === key)) await this.api.startPortForward(id, rule(input));
        this.errors.get(id)?.delete(key);
      } catch (error) { this.failure(id, key, errorText(error)); throw error; }
    });
  }
  stop(id: string, key: string): Promise<void> {
    return this.exclusive(id, async () => {
      const saved = this.read(id);
      const running = await this.api.listPortForwards(id);
      // Persist removal first; if stopping fails, restore the saved rule so the
      // UI still exposes the active listener and can retry the stop.
      this.save(id, saved.filter(value => forwardKey(value) !== key));
      try {
        for (const item of running.filter(value => forwardKey(value) === key)) await this.api.stopPortForward(id, item.id);
      } catch (error) { this.save(id, saved); throw error; }
      this.errors.get(id)?.delete(key);
    });
  }
  restore(id: string, cancelled: () => boolean = () => false): Promise<void> {
    return this.exclusive(id, async () => {
      if (cancelled()) return;
      const running = await this.api.listPortForwards(id);
      const saved = this.rememberRunning(id, this.read(id), running);
      for (const input of saved) {
        if (cancelled()) return;
        const key = forwardKey(input);
        if (running.some(value => forwardKey(value) === key)) continue;
        try {
          const started = await this.api.startPortForward(id, input);
          // A disconnect/removal may have happened while the bridge was busy.
          if (cancelled()) { await this.api.stopPortForward(id, started.id); return; }
          running.push(started); this.errors.get(id)?.delete(key);
        } catch (error) { this.failure(id, key, errorText(error)); }
      }
    });
  }
}
