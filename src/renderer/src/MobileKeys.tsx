import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, X } from 'lucide-react';
import { defaultShortcuts, readShortcuts, shortcutData, shortcutKeys, shortcutStorageKey, type MobileShortcut } from './mobile-shortcuts';

const newShortcut = (): MobileShortcut => ({ id: crypto.randomUUID(), label: '', kind: 'key', key: 'Esc', text: '', ctrl: false, alt: false, shift: false, enter: false });

export function MobileKeys({ send, paste, copy }: { send: (data: string) => void; paste: () => void; copy: () => void }) {
  const [keys, setKeys] = useState(readShortcuts);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MobileShortcut[]>([]);
  const [item, setItem] = useState<MobileShortcut>(newShortcut);
  const [error, setError] = useState('');
  useEffect(() => {
    const update = () => setKeys(readShortcuts());
    window.addEventListener('nohop:shortcuts', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('nohop:shortcuts', update); window.removeEventListener('storage', update); };
  }, []);
  const open = () => { setDraft(keys.map(key => ({ ...key }))); setItem(newShortcut()); setError(''); setEditing(true); };
  function add() {
    try {
      if (!item.label.trim()) throw new Error('请输入按钮名称');
      if (item.kind === 'text' && !item.text) throw new Error('请输入要发送的文本');
      shortcutData(item);
      const exists = draft.some(key => key.id === item.id);
      if (draft.length >= 40 && !exists) throw new Error('最多添加 40 个快捷键');
      const updated = { ...item, label: item.label.trim() };
      setDraft(exists ? draft.map(key => key.id === item.id ? updated : key) : [...draft, updated]); setItem(newShortcut()); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  function save() {
    try {
      localStorage.setItem(shortcutStorageKey, JSON.stringify(draft));
      setKeys(draft); window.dispatchEvent(new Event('nohop:shortcuts')); setEditing(false);
    } catch { setError('无法保存快捷键，请检查本机存储空间'); }
  }
  function move(index: number, delta: number) {
    const next = [...draft]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setDraft(next);
  }
  return <>
    <div className="mobile-keys" aria-label="终端快捷键">
      {keys.map(key => <button key={key.id} onPointerDown={event => event.preventDefault()} onClick={() => send(shortcutData(key))}>{key.label}</button>)}
      <button onPointerDown={event => event.preventDefault()} onClick={paste}>粘贴</button>
      <button onPointerDown={event => event.preventDefault()} onClick={copy}>复制选区</button>
      <button aria-label="自定义快捷键" onClick={open}><Settings2 size={16} />设置</button>
    </div>
    {editing && createPortal(<div className="modal-backdrop"><section className="shortcuts-modal" role="dialog" aria-modal="true" aria-label="自定义手机快捷键">
      <header><h2>手机快捷键</h2><button aria-label="关闭快捷键设置" onClick={() => setEditing(false)}><X size={19} /></button></header>
      <p>按键、组合键或常用文本，保存在当前设备。</p>
      <div className="shortcut-list">{draft.map((key, index) => <div key={key.id}><strong>{key.label}</strong><small>{key.kind === 'text' ? '文本' : `${key.ctrl ? 'Ctrl+' : ''}${key.alt ? 'Alt+' : ''}${key.shift ? 'Shift+' : ''}${key.key}`}</small><button aria-label={`上移 ${key.label}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button aria-label={`下移 ${key.label}`} disabled={index === draft.length - 1} onClick={() => move(index, 1)}>↓</button><button onClick={() => { setItem({ ...key }); }}>编辑</button><button aria-label={`移除 ${key.label}`} onClick={() => setDraft(draft.filter(k => k.id !== key.id))}>移除</button></div>)}</div>
      <form onSubmit={event => { event.preventDefault(); add(); }}>
        <label>按钮名称<input maxLength={16} value={item.label} onChange={event => setItem({ ...item, label: event.target.value })} placeholder="例如 Ctrl+L" /></label>
        <label>类型<select value={item.kind} onChange={event => setItem({ ...item, kind: event.target.value as 'key' | 'text' })}><option value="key">按键 / 组合键</option><option value="text">常用文本</option></select></label>
        {item.kind === 'key' ? <><label>按键<input list="mobile-shortcut-keys" value={item.key} onChange={event => setItem({ ...item, key: event.target.value })} placeholder="选择特殊键，或输入一个字符" /><datalist id="mobile-shortcut-keys">{shortcutKeys.map(key => <option key={key} value={key} />)}</datalist></label><div className="shortcut-modifiers">{(['ctrl', 'alt', 'shift'] as const).map(modifier => <label key={modifier}><input type="checkbox" checked={item[modifier]} onChange={event => setItem({ ...item, [modifier]: event.target.checked })} />{modifier === 'ctrl' ? 'Ctrl' : modifier === 'alt' ? 'Alt' : 'Shift'}</label>)}</div></> : <><label>发送的文本<textarea maxLength={4096} rows={3} value={item.text} onChange={event => setItem({ ...item, text: event.target.value })} /></label><label className="shortcut-enter"><input type="checkbox" checked={item.enter} onChange={event => setItem({ ...item, enter: event.target.checked })} />发送后回车</label></>}
        <button type="submit">{draft.some(key => key.id === item.id) ? '更新快捷键' : '添加到快捷栏'}</button>
      </form>
      {error && <p className="message" role="alert">{error}</p>}
      <footer><button onClick={() => setDraft(defaultShortcuts.map(key => ({ ...key })))}>恢复默认</button><button onClick={() => setEditing(false)}>取消</button><button className="primary" onClick={save}>保存</button></footer>
    </section></div>, document.body)}
  </>;
}
