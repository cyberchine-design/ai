import React, { useState, useEffect, useCallback, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ShortcutDef {
  id: string;
  label: string;
  description: string;
  category: string;
  defaultKey: string;
  defaultModifiers: ShortcutModifiers;
}

export interface ShortcutModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface ShortcutBinding {
  key: string;
  modifiers: ShortcutModifiers;
}

export type ShortcutMap = Record<string, ShortcutBinding>;

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // Navigation
  {
    id: 'pan',
    label: 'Canvas bewegen (Pan)',
    description: 'Halte diese Taste + Mausklick zum Scrollen',
    category: 'Navigation',
    defaultKey: ' ',
    defaultModifiers: {},
  },
  {
    id: 'zoomIn',
    label: 'Reinzoomen',
    description: 'Zoom in das Canvas',
    category: 'Navigation',
    defaultKey: '+',
    defaultModifiers: { ctrl: true },
  },
  {
    id: 'zoomOut',
    label: 'Rauszoomen',
    description: 'Zoom aus dem Canvas',
    category: 'Navigation',
    defaultKey: '-',
    defaultModifiers: { ctrl: true },
  },

  // Selektion
  {
    id: 'selectAll',
    label: 'Alles auswählen',
    description: 'Wählt alle Nodes und Verbindungen aus',
    category: 'Auswahl',
    defaultKey: 'a',
    defaultModifiers: { ctrl: true },
  },
  {
    id: 'selectionBox',
    label: 'Auswahlrahmen ziehen',
    description: 'Halte und ziehe zum Mehrfachauswählen',
    category: 'Auswahl',
    defaultKey: 'Alt',
    defaultModifiers: {},
  },
  {
    id: 'deselect',
    label: 'Auswahl aufheben / Schließen',
    description: 'Auswahl aufheben oder Sub-Canvas verlassen',
    category: 'Auswahl',
    defaultKey: 'Escape',
    defaultModifiers: {},
  },

  // Erstellen
  {
    id: 'drawBox',
    label: 'Box zeichnen',
    description: 'Halte + Ziehen zum Erstellen einer neuen Box',
    category: 'Erstellen',
    defaultKey: 'Control',
    defaultModifiers: {},
  },
  {
    id: 'drawCircle',
    label: 'Kreis zeichnen',
    description: 'Halte + Ziehen zum Erstellen eines Kreises',
    category: 'Erstellen',
    defaultKey: 'Control',
    defaultModifiers: { shift: true },
  },
  {
    id: 'connectNodes',
    label: 'Nodes verbinden',
    description: 'Klicke auf zwei Nodes zum Verbinden',
    category: 'Erstellen',
    defaultKey: 'Control',
    defaultModifiers: {},
  },

  // Bearbeiten
  {
    id: 'undo',
    label: 'Rückgängig',
    description: 'Letzten Schritt rückgängig machen',
    category: 'Bearbeiten',
    defaultKey: 'z',
    defaultModifiers: { ctrl: true },
  },
  {
    id: 'delete',
    label: 'Löschen',
    description: 'Ausgewählte Objekte löschen',
    category: 'Bearbeiten',
    defaultKey: 'Delete',
    defaultModifiers: {},
  },
  {
    id: 'altDelete',
    label: 'Alt-Löschen (Einzelklick)',
    description: 'Einzelnes Objekt per Klick löschen',
    category: 'Bearbeiten',
    defaultKey: 'Control',
    defaultModifiers: { shift: true },
  },
  {
    id: 'loeschen',
    label: 'Auswahl löschen (Löschen)',
    description: 'Löscht ausgewählte Objekte',
    category: 'Bearbeiten',
    defaultKey: 'Backspace',
    defaultModifiers: {},
  },

  // Border Radius
  {
    id: 'cornerRadiusAll',
    label: 'Alle Ecken gleichzeitig',
    description: 'Shift beim Ecken-Handle ziehen = alle Ecken',
    category: 'Eckenradius',
    defaultKey: 'Shift',
    defaultModifiers: {},
  },
  {
    id: 'cornerRadiusMulti',
    label: 'Mehrere Ecken auswählen',
    description: 'Ctrl beim Ecken-Handle = Mehrfachauswahl',
    category: 'Eckenradius',
    defaultKey: 'Control',
    defaultModifiers: {},
  },
  {
    id: 'cornerRadiusScroll',
    label: 'Eckenradius per Scroll',
    description: 'Nach Erstellen: Shift+Scroll zum Anpassen',
    category: 'Eckenradius',
    defaultKey: 'Shift',
    defaultModifiers: {},
  },

  // Sub-Canvas
  {
    id: 'enterSubCanvas',
    label: 'Sub-Canvas öffnen',
    description: 'Doppelklick auf verschachtelte Box',
    category: 'Sub-Canvas',
    defaultKey: 'dblclick',
    defaultModifiers: {},
  },
  {
    id: 'exitSubCanvas',
    label: 'Sub-Canvas verlassen',
    description: 'Eine Ebene nach oben',
    category: 'Sub-Canvas',
    defaultKey: 'Escape',
    defaultModifiers: {},
  },

  // Linien-Routing
  {
    id: 'toggleRouting',
    label: 'Linien-Routing umschalten',
    description: 'Doppelklick auf Linie: Bezier ↔ Straßen-Führung',
    category: 'Verbindungen',
    defaultKey: 'dblclick',
    defaultModifiers: {},
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE KEY
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'miuniverse_canvas_shortcuts';

export function loadShortcuts(): ShortcutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Build defaults
  const map: ShortcutMap = {};
  for (const s of DEFAULT_SHORTCUTS) {
    map[s.id] = { key: s.defaultKey, modifiers: { ...s.defaultModifiers } };
  }
  return map;
}

export function saveShortcuts(map: ShortcutMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

// ─────────────────────────────────────────────────────────────────────────────
// KEY DISPLAY HELPER
// ─────────────────────────────────────────────────────────────────────────────

function modLabel(mods: ShortcutModifiers): string[] {
  const parts: string[] = [];
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.shift) parts.push('Shift');
  if (mods.alt) parts.push('Alt');
  if (mods.meta) parts.push('⌘');
  return parts;
}

function keyDisplayName(key: string): string {
  const map: Record<string, string> = {
    ' ': 'Space',
    'Escape': 'Esc',
    'Delete': 'Del',
    'Backspace': '⌫',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'dblclick': '2× Klick',
    'Control': 'Ctrl',
    'Alt': 'Alt',
    'Shift': 'Shift',
    'Meta': '⌘',
    'Enter': '↵',
    'left click': 'L-Klick',
    'middle click': 'M-Klick',
    'right click': 'R-Klick',
    'back button': 'Maus-Zurück',
    'forward button': 'Maus-Vorwärts',
  };
  return map[key.toLowerCase()] ?? map[key] ?? key.toUpperCase();
}

function ShortcutBadge({ binding }: { binding: ShortcutBinding }) {
  const mods = modLabel(binding.modifiers);
  const keyName = keyDisplayName(binding.key);
  return (
    <span className="shortcut-badge-group">
      {mods.map((m, i) => <kbd key={i} className="shortcut-key">{m}</kbd>)}
      {!['Control', 'Shift', 'Alt', 'Meta'].includes(binding.key) && (
        <kbd className="shortcut-key">{keyName}</kbd>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KEY CAPTURE INPUT
// ─────────────────────────────────────────────────────────────────────────────

interface KeyCaptureProps {
  value: ShortcutBinding;
  onChange: (b: ShortcutBinding) => void;
  onCancel: () => void;
}

function KeyCapture({ value, onChange, onCancel }: KeyCaptureProps) {
  const [captured, setCaptured] = useState<ShortcutBinding>(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const mods: ShortcutModifiers = {
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
    };

    if (e.key === 'Escape') {
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      onChange(captured);
      return;
    }

    // Ignore pure modifier keys as the final key
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      setCaptured({ key: e.key, modifiers: mods });
      return;
    }

    const b: ShortcutBinding = { key: e.key, modifiers: mods };
    setCaptured(b);
  }, [captured, onChange, onCancel]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.key-capture-ok') || target.closest('.key-capture-cancel')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const mods: ShortcutModifiers = {
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
    };

    let keyName = 'Mausklick';
    if (e.button === 0) keyName = 'Left Click';
    else if (e.button === 1) keyName = 'Middle Click';
    else if (e.button === 2) keyName = 'Right Click';
    else if (e.button === 3) keyName = 'Back Button';
    else if (e.button === 4) keyName = 'Forward Button';

    setCaptured({ key: keyName, modifiers: mods });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const mods = modLabel(captured.modifiers);
  const keyName = !['Control', 'Shift', 'Alt', 'Meta'].includes(captured.key)
    ? keyDisplayName(captured.key)
    : null;

  return (
    <div
      ref={ref}
      className="key-capture-box"
      tabIndex={0}
      onKeyDown={handleKey}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      <span className="key-capture-listening">Taste oder Maus…</span>
      <span className="key-capture-preview">
        {mods.map((m, i) => <kbd key={i} className="shortcut-key recording">{m}</kbd>)}
        {keyName && <kbd className="shortcut-key recording">{keyName}</kbd>}
      </span>
      <div className="key-capture-actions">
        <button className="key-capture-ok" onClick={() => onChange(captured)}>OK</button>
        <button className="key-capture-cancel" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PANEL COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface CanvasShortcutsPanelProps {
  shortcuts: ShortcutMap;
  onSave: (map: ShortcutMap) => void;
}

export const CanvasShortcutsPanel: React.FC<CanvasShortcutsPanelProps> = ({
  shortcuts,
  onSave,
}) => {
  const [local, setLocal] = useState<ShortcutMap>(() => ({ ...shortcuts }));
  const [recording, setRecording] = useState<string | null>(null); // shortcut id being recorded
  const [searchQ, setSearchQ] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Group shortcuts by category
  const categories = Array.from(new Set(DEFAULT_SHORTCUTS.map(s => s.category)));

  const filtered = searchQ.trim()
    ? DEFAULT_SHORTCUTS.filter(s =>
        s.label.toLowerCase().includes(searchQ.toLowerCase()) ||
        s.description.toLowerCase().includes(searchQ.toLowerCase()) ||
        s.category.toLowerCase().includes(searchQ.toLowerCase())
      )
    : DEFAULT_SHORTCUTS;

  const handleChange = (id: string, b: ShortcutBinding) => {
    setLocal(prev => ({ ...prev, [id]: b }));
    setDirty(true);
    setRecording(null);
  };

  const handleReset = (id: string) => {
    const def = DEFAULT_SHORTCUTS.find(s => s.id === id);
    if (!def) return;
    setLocal(prev => ({ ...prev, [id]: { key: def.defaultKey, modifiers: { ...def.defaultModifiers } } }));
    setDirty(true);
  };

  const handleResetAll = () => {
    const map: ShortcutMap = {};
    for (const s of DEFAULT_SHORTCUTS) {
      map[s.id] = { key: s.defaultKey, modifiers: { ...s.defaultModifiers } };
    }
    setLocal(map);
    setDirty(true);
  };

  const handleSave = () => {
    saveShortcuts(local);
    onSave(local);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const getBinding = (id: string): ShortcutBinding => {
    return local[id] ?? { key: DEFAULT_SHORTCUTS.find(s => s.id === id)!.defaultKey, modifiers: {} };
  };

  const isDefault = (id: string): boolean => {
    const def = DEFAULT_SHORTCUTS.find(s => s.id === id);
    if (!def) return true;
    const b = getBinding(id);
    return b.key === def.defaultKey &&
      !!b.modifiers.ctrl === !!def.defaultModifiers.ctrl &&
      !!b.modifiers.shift === !!def.defaultModifiers.shift &&
      !!b.modifiers.alt === !!def.defaultModifiers.alt;
  };

  const renderByCategory = (cat: string) => {
    const items = filtered.filter(s => s.category === cat);
    if (items.length === 0) return null;
    return (
      <div key={cat} className="shortcut-category-block">
        <div className="shortcut-category-header">{cat}</div>
        {items.map(def => {
          const binding = getBinding(def.id);
          const isRec = recording === def.id;
          const isDef = isDefault(def.id);
          return (
            <div key={def.id} className={`shortcut-row ${isRec ? 'recording' : ''}`}>
              <div className="shortcut-info">
                <span className="shortcut-label">{def.label}</span>
                <span className="shortcut-desc">{def.description}</span>
              </div>
              <div className="shortcut-control">
                {isRec ? (
                  <KeyCapture
                    value={binding}
                    onChange={(b) => handleChange(def.id, b)}
                    onCancel={() => setRecording(null)}
                  />
                ) : (
                  <button
                    className="shortcut-badge-btn"
                    onClick={() => setRecording(def.id)}
                    title="Klicken zum Ändern"
                  >
                    <ShortcutBadge binding={binding} />
                    <span className="shortcut-edit-icon">✏️</span>
                  </button>
                )}
                {!isDef && !isRec && (
                  <button
                    className="shortcut-reset-single"
                    onClick={() => handleReset(def.id)}
                    title="Auf Standard zurücksetzen"
                  >↺</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="canvas-shortcuts-panel settings-section">
      <h3>⌨️ Canvas Shortcuts</h3>
      <p className="settings-section-desc">
        Alle Tastenkürzel für den Miuniverse-Canvas. Klicke auf einen Shortcut um ihn neu zu belegen.
      </p>

      {/* Search + actions */}
      <div className="shortcuts-toolbar">
        <div className="shortcuts-search-wrap">
          <span className="shortcuts-search-icon">🔍</span>
          <input
            className="shortcuts-search-input"
            placeholder="Shortcut suchen…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
          {searchQ && (
            <button className="shortcuts-search-clear" onClick={() => setSearchQ('')}>✕</button>
          )}
        </div>
        <button className="shortcut-reset-all-btn" onClick={handleResetAll} title="Alle zurücksetzen">
          ↺ Alle zurücksetzen
        </button>
      </div>

      {/* Shortcut list */}
      <div className="shortcuts-list-container">
        {searchQ.trim()
          ? (
            <div className="shortcut-category-block">
              <div className="shortcut-category-header">Suchergebnisse</div>
              {filtered.length === 0
                ? <div className="shortcuts-empty">Keine Shortcuts gefunden.</div>
                : filtered.map(def => {
                    const binding = getBinding(def.id);
                    const isRec = recording === def.id;
                    const isDef = isDefault(def.id);
                    return (
                      <div key={def.id} className={`shortcut-row ${isRec ? 'recording' : ''}`}>
                        <div className="shortcut-info">
                          <span className="shortcut-label">{def.label}</span>
                          <span className="shortcut-cat-tag">{def.category}</span>
                          <span className="shortcut-desc">{def.description}</span>
                        </div>
                        <div className="shortcut-control">
                          {isRec ? (
                            <KeyCapture
                              value={binding}
                              onChange={(b) => handleChange(def.id, b)}
                              onCancel={() => setRecording(null)}
                            />
                          ) : (
                            <button className="shortcut-badge-btn" onClick={() => setRecording(def.id)} title="Klicken zum Ändern">
                              <ShortcutBadge binding={binding} />
                              <span className="shortcut-edit-icon">✏️</span>
                            </button>
                          )}
                          {!isDef && !isRec && (
                            <button className="shortcut-reset-single" onClick={() => handleReset(def.id)} title="Zurücksetzen">↺</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </div>
          )
          : categories.map(cat => renderByCategory(cat))
        }
      </div>

      {/* Save bar */}
      <div className="shortcuts-save-bar">
        {dirty && (
          <span className="shortcuts-unsaved-hint">● Ungespeicherte Änderungen</span>
        )}
        <button
          className={`save-btn-settings ${saved ? 'saved' : ''}`}
          onClick={handleSave}
          disabled={!dirty}
        >
          {saved ? '✓ Gespeichert!' : 'Shortcuts Speichern'}
        </button>
      </div>
    </div>
  );
};
