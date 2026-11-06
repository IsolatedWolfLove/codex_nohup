import { useEffect, useId, useRef, useState } from 'react';
import { File, Folder } from 'lucide-react';
import type { RemoteDirectory, RemoteFile } from '../../shared/contracts';
import { desktop } from './desktop-api';
import { completedPath, completionTarget, matchingPaths } from './path-completion';

export function RemotePathInput({ connectionId, directory, value, onChange, directoriesOnly = false, label, placeholder, name, disabled, required, home }: {
  connectionId: string; directory: RemoteDirectory | null; value: string; onChange: (value: string) => void;
  home?: string; directoriesOnly?: boolean; label: string; placeholder: string; name?: string; disabled?: boolean; required?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const selectedOption = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RemoteFile[]>([]);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const target = completionTarget(value, directory?.path ?? '', home);
  const suggestions = matchingPaths(entries, target.prefix, directoriesOnly);
  const visible = open && !disabled;

  useEffect(() => {
    if (visible) selectedOption.current?.scrollIntoView({ block: 'nearest' });
  }, [active, visible]);

  useEffect(() => {
    setEntries([]); setActive(0); setFailed(false);
    if (!visible || !directory) { setPending(false); return; }
    // Filter the current listing locally; debounce requests for other directories.
    if (target.parent.replace(/\/$/, '') === directory.path.replace(/\/$/, '')) {
      setEntries(directory.entries); setPending(false); return;
    }
    let stale = false;
    setPending(true);
    const timer = window.setTimeout(() => {
      void desktop.listFiles(connectionId, target.parent).then(result => {
        if (!stale) { setEntries(result.entries); setPending(false); }
      }).catch(() => { if (!stale) { setFailed(true); setPending(false); } });
    }, 180);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [connectionId, directory, target.parent, visible]);

  function choose(entry: RemoteFile) {
    onChange(completedPath(entry)); setActive(0); setOpen(entry.isDir);
    input.current?.focus();
  }

  return <div className="remote-path-input" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <input ref={input} name={name} aria-label={label} placeholder={placeholder} value={value} disabled={disabled} required={required}
      role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={`${id}-options`}
      aria-activedescendant={visible && suggestions[active] ? `${id}-option-${active}` : undefined} autoComplete="off" spellCheck={false}
      onFocus={() => setOpen(true)}
      onChange={event => { onChange(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { if (visible) event.preventDefault(); setOpen(false); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          if (suggestions.length) setActive(index => !visible ? (event.key === 'ArrowDown' ? 0 : suggestions.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        } else if (visible && suggestions[active] && (event.key === 'Enter' || event.key === 'Tab')) {
          event.preventDefault(); choose(suggestions[active]);
        }
      }} />
    {visible && <div className="path-completions" id={`${id}-options`} role="listbox" aria-label={`${label}候选项`} aria-busy={pending}>
      {suggestions.map((entry, index) => <div key={entry.path} id={`${id}-option-${index}`} role="option" aria-selected={active === index}
        ref={active === index ? selectedOption : undefined} className={`path-completion ${active === index ? 'selected' : ''}`} onMouseDown={event => event.preventDefault()}
        onClick={() => choose(entry)} onMouseEnter={() => setActive(index)}>
        {entry.isDir ? <Folder size={16} /> : <File size={16} />}<span>{entry.name}{entry.isDir ? '/' : ''}</span>
      </div>)}
      {!suggestions.length && <div className="path-completion-status" role="status">{pending ? '正在读取候选路径…' : failed ? '无法读取此目录，可继续手动输入' : '没有匹配的路径'}</div>}
    </div>}
  </div>;
}
