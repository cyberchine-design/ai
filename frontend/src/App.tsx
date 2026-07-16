import { useState, useEffect, useRef } from 'react';
import { VideoAvatar } from './components/Avatar/VideoAvatar';
import { MessageBubble } from './components/Chat/MessageBubble';
import { MiuniverseCanvas } from './components/MiuniverseCanvas';
import type { CanvasNode, CanvasConnection, WorkMode } from './components/MiuniverseCanvas';
import { CanvasShortcutsPanel, loadShortcuts } from './components/CanvasShortcutsPanel';
import type { ShortcutMap } from './components/CanvasShortcutsPanel';
import './App.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Session {
  id: string;
  title: string;
  createdAt: string;
  messages?: {
    createdAt: string;
  }[];
}

const countWordOccurrences = (word: string): number => {
  if (!word) return 0;
  const trimmedWord = word.trim();
  if (!trimmedWord) return 0;
  
  const escaped = trimmedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let text = "";
  const root = document.getElementById("root");
  if (root) {
    const clone = root.cloneNode(true) as HTMLElement;
    const popupInClone = clone.querySelector(".explain-popup");
    if (popupInClone) {
      popupInClone.remove();
    }
    text = clone.innerText || "";
  } else {
    text = document.body.innerText || "";
  }

  try {
    const regex = new RegExp(`(?<![\\p{L}\\p{N}])` + escaped + `(?![\\p{L}\\p{N}])`, 'gui');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  } catch (e) {
    const regex = new RegExp(escaped, 'gi');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }
};

function App() {
  // Redirect /ai to /ai/ for proper relative path resolution in production
  if (window.location.pathname === '/ai') {
    window.location.replace('/ai/');
  }

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem('userEmail'));
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(() => localStorage.getItem('chat_input_backup') || '');
  const [isLoading, setIsLoading] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [miumiverseSkillActive, setMiumiverseSkillActive] = useState(
    localStorage.getItem('miumiverseSkillActive') === 'true'
  );
  
  // Canvas State-Management
  const lastLoadedSessionId = useRef<string | null>(null);

  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([]);
  const [canvasConnections, setCanvasConnections] = useState<CanvasConnection[]>([]);
  const [canvasWorkMode, setCanvasWorkMode] = useState<WorkMode>(() => {
    return (localStorage.getItem('miuniverse_canvas_workmode') as WorkMode) || 'default';
  });
  const [shortcutMap, setShortcutMap] = useState<ShortcutMap>(() => loadShortcuts());

  // Load canvas when session changes
  useEffect(() => {
    if (!currentSessionId) return;
    
    lastLoadedSessionId.current = currentSessionId;

    const savedNodes = localStorage.getItem(`miuniverse_nodes_${currentSessionId}`);
    if (savedNodes) {
      setCanvasNodes(JSON.parse(savedNodes));
    } else {
      // Fallback: see if there's global/old data, otherwise default node
      const legacyNodes = localStorage.getItem('miuniverse_nodes_Miumiverse');
      if (legacyNodes) {
        setCanvasNodes(JSON.parse(legacyNodes));
      } else {
        setCanvasNodes([
          { id: 'node_default_1', type: 'note', x: 100, y: 100, title: 'Willkommen bei Miuniverse!', content: 'Hier ist dein Miumiverse Game-Planner. Nutze Rechtsklick zum Zeichnen!', color: '#8B5CF6' }
        ]);
      }
    }

    const savedConns = localStorage.getItem(`miuniverse_connections_${currentSessionId}`);
    if (savedConns) {
      setCanvasConnections(JSON.parse(savedConns));
    } else {
      const legacyConns = localStorage.getItem('miuniverse_connections_Miumiverse');
      setCanvasConnections(legacyConns ? JSON.parse(legacyConns) : []);
    }
  }, [currentSessionId]);

  // Auto-Save in localStorage (session-specific and legacy fallback)
  useEffect(() => {
    if (!currentSessionId || lastLoadedSessionId.current !== currentSessionId) return;
    localStorage.setItem(`miuniverse_nodes_${currentSessionId}`, JSON.stringify(canvasNodes));
    localStorage.setItem('miuniverse_nodes_Miumiverse', JSON.stringify(canvasNodes));
  }, [canvasNodes, currentSessionId]);

  useEffect(() => {
    if (!currentSessionId || lastLoadedSessionId.current !== currentSessionId) return;
    localStorage.setItem(`miuniverse_connections_${currentSessionId}`, JSON.stringify(canvasConnections));
    localStorage.setItem('miuniverse_connections_Miumiverse', JSON.stringify(canvasConnections));
  }, [canvasConnections, currentSessionId]);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [authError, setAuthError] = useState('');
  
  const [systemPrompt] = useState(localStorage.getItem('systemPrompt') || 'Du bist ein kompetenter KI-Architekt.');
  const [tempSystemPrompt, setTempSystemPrompt] = useState(localStorage.getItem('systemPrompt') || 'Du bist ein kompetenter KI-Architekt.');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'profile' | 'token' | 'skills' | 'system' | 'admin' | 'canvas' | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState('');

  // Admin Board states
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminSearch, setAdminSearch] = useState('');
  const [promptsConfig, setPromptsConfig] = useState<{ global: string; users: Record<string, string> }>({ global: 'Du bist ein kompetenter KI-Architekt.', users: {} });
  const [selectedPromptTarget, setSelectedPromptTarget] = useState('global');
  const [iframeSessionId, setIframeSessionId] = useState<string | null>(null);
  const [showRequestPopup, setShowRequestPopup] = useState<any>(null);
  const [seenRequestIds] = useState<Set<string>>(() => new Set());
  const [liveRequests, setLiveRequests] = useState<any[]>([]);

  // Token grant (admin) states
  const [tokenGrantSearch, setTokenGrantSearch] = useState('');
  const [tokenGrantDropdownOpen, setTokenGrantDropdownOpen] = useState(false);
  const [tokenGrantSelectedEmail, setTokenGrantSelectedEmail] = useState('');
  const [tokenGrantSelectedUsername, setTokenGrantSelectedUsername] = useState('');
  const [tokenGrantAmount, setTokenGrantAmount] = useState<string>('1000');
  const [tokenGrantNote, setTokenGrantNote] = useState<string>('');
  const [tokenGrantSending, setTokenGrantSending] = useState(false);
  const [tokenGrantResult, setTokenGrantResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Notifications inbox (user-facing) states
  const [userNotifications, setUserNotifications] = useState<any[]>([]);
  const [showNotificationsPopup, setShowNotificationsPopup] = useState<any | null>(null);
  const [seenNotifIds] = useState<Set<string>>(() => new Set());

  // Custom key override & balance states
  const [customMinimaxKey, setCustomMinimaxKey] = useState(localStorage.getItem('customMinimaxKey') || '');
  const [minimaxBalanceData, setMinimaxBalanceData] = useState<any>(null);
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // Multi-model states (Agnes, DeepSeek, BytePlus, Gemini)
  const [mainModel, setMainModel] = useState<string>(() => localStorage.getItem('mainModel') || 'MiniMax-M3');
  const [agnesApiKey, setAgnesApiKey] = useState<string>(() => localStorage.getItem('agnesApiKey') || '');
  const [enabledModels, setEnabledModels] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('enabledModels') || '["MiniMax-M3","Gemini","DeepSeek","Agnes"]'); } catch { return ['MiniMax-M3','Gemini','DeepSeek','Agnes']; }
  });
  const [modelConfigLoaded, setModelConfigLoaded] = useState<any>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelSaveMsg, setModelSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Theme state
  const [theme, setTheme] = useState<'dark' | 'light' | 'gray'>(
    (localStorage.getItem('colorTheme') as 'dark' | 'light' | 'gray') || 'dark'
  );

  // Hidden Gemini models state (reveal on 2s long press)
  const [showGemini, setShowGemini] = useState(localStorage.getItem('showGemini') === 'true');
  const longPressTimeoutRef = useRef<any>(null);
  const isLongPressActive = useRef(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [systemAlert, setSystemAlert] = useState<{ message: string; isError?: boolean } | null>(null);

  const triggerSystemAlert = (message: string, isError = true) => {
    navigator.clipboard.writeText(message).catch(err => {
      console.warn('Failed to auto-copy alert message to clipboard:', err);
    });
    setSystemAlert({ message, isError });
  };

  const startLongPress = () => {
    isLongPressActive.current = false;
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = setTimeout(() => {
      isLongPressActive.current = true;
      setShowGemini(prev => {
        const next = !prev;
        localStorage.setItem('showGemini', next ? 'true' : 'false');
        if (navigator.vibrate) {
          try { navigator.vibrate(200); } catch(e) {}
        }
        triggerSystemAlert(next ? "Gemini Modelle freigeschaltet! ✨" : "Gemini Modelle ausgeblendet. 🔒", false);
        return next;
      });
    }, 2000);
  };

  const endLongPress = (e: any) => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    if (isLongPressActive.current) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => {
        isLongPressActive.current = false;
      }, 50);
    }
  };

  // Mini-Chat / Word Explainer state
  const [explainWordPopup, setExplainWordPopup] = useState<{
    word: string;
    x: number;
    y: number;
    messages: { role: 'user' | 'assistant'; content: string }[];
    loading: boolean;
    visible: boolean;
    inputValue: string;
    status?: string;
    error?: string;
    translations?: Record<string, string>;
    mode?: 'normal' | 'detailed' | 'simplified' | 'buy' | 'translate-only';
    fastContent?: string;
    detailedContent?: string;
    detailedLoading?: boolean;
  } | null>(null);

  const [autoExplain, setAutoExplain] = useState<boolean>(() => {
    return localStorage.getItem('explainWordAutoExplain') !== 'false';
  });

  const [explainLanguages, setExplainLanguages] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('explainWordLanguages') || '["EN"]');
    } catch (e) {
      return ["EN"];
    }
  });

  const [newLangInput, setNewLangInput] = useState<string>('');
  
  const [explainWordPopupSettingsOpen, setExplainWordPopupSettingsOpen] = useState<boolean>(false);
  const [buyLocation, setBuyLocation] = useState<string>(() => {
    return localStorage.getItem('explainWordBuyLocation') || 'Germany';
  });

  useEffect(() => {
    localStorage.setItem('explainWordBuyLocation', buyLocation);
  }, [buyLocation]);

  const explainPopupRef = useRef<HTMLDivElement | null>(null);


  // Local dictionaries state
  const [localDictionaries, setLocalDictionaries] = useState<{
    EN: Record<string, string>;
    TH: Record<string, string>;
  }>({ EN: {}, TH: {} });

  useEffect(() => {
    const loadDictionaries = async () => {
      try {
        console.log('[Local Dict] Starting to fetch local dictionaries...');
        // Use relative path so it works both at /ai/ and at root
        const dictBase = window.location.pathname.includes('/ai/') ? './dictionaries/' : '/dictionaries/';
        const [enRes, thRes] = await Promise.all([
          fetch(dictBase + 'de-en.json').then(r => {
            if (!r.ok) console.warn('[Local Dict] EN fetch failed status:', r.status);
            return r.ok ? r.json() : {};
          }),
          fetch(dictBase + 'de-th.json').then(r => {
            if (!r.ok) console.warn('[Local Dict] TH fetch failed status:', r.status);
            return r.ok ? r.json() : {};
          })
        ]);
        console.log('[Local Dict] Loaded EN words count:', Object.keys(enRes).length);
        console.log('[Local Dict] Loaded TH words count:', Object.keys(thRes).length);
        setLocalDictionaries({
          EN: enRes,
          TH: thRes
        });
      } catch (e) {
        console.warn('Failed to load local dictionaries:', e);
      }
    };
    loadDictionaries();
  }, []);

  useEffect(() => {
    localStorage.setItem('explainWordAutoExplain', autoExplain.toString());
  }, [autoExplain]);

  useEffect(() => {
    localStorage.setItem('explainWordLanguages', JSON.stringify(explainLanguages));
  }, [explainLanguages]);




  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const popupEl = document.querySelector('.explain-popup');
      if (popupEl && !popupEl.contains(e.target as Node)) {
        const selection = window.getSelection();
        if (!selection || selection.toString().trim() === '') {
          setExplainWordPopup(null);
        }
      }
    };
    document.addEventListener('mousedown', handleGlobalClick);
    return () => document.removeEventListener('mousedown', handleGlobalClick);
  }, []);

  useEffect(() => {
    if (!explainWordPopup) {
      window.getSelection()?.removeAllRanges();
    }
  }, [explainWordPopup]);

  const handleExplainWordStart = async (wordToUse?: string, modeToUse: 'normal' | 'detailed' | 'simplified' | 'buy' | 'translate-only' = 'normal') => {
    const targetWord = wordToUse || explainWordPopup?.word;
    if (!targetWord) return;

    // Clean word for local lookup
    const cleanWord = targetWord.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
    let localTranslations: Record<string, string> = {};
    let allFoundLocally = true;

    console.log('[Local Dict Check] Target Word:', targetWord, 'Cleaned:', cleanWord, 'Active Langs:', explainLanguages);

    for (const lang of explainLanguages) {
      const langUpper = lang.toUpperCase();
      const dict = (localDictionaries as any)[langUpper];
      console.log('[Local Dict Check] Checking dict for', langUpper, 'has word:', dict ? !!dict[cleanWord] : false, 'val:', dict ? dict[cleanWord] : 'no dict');
      if (dict && dict[cleanWord]) {
        localTranslations[langUpper] = dict[cleanWord];
      } else {
        allFoundLocally = false;
      }
    }

    console.log('[Local Dict Check] allFoundLocally:', allFoundLocally, 'translations:', localTranslations, 'modeToUse:', modeToUse);

    if (modeToUse === 'translate-only' && allFoundLocally) {
      console.log('[Local Dict Check] Hit! Applying local translations instantly.');
      // Instantly show translations, bypass API call
      setExplainWordPopup(prev => prev ? {
        ...prev,
        loading: false,
        translations: localTranslations,
        status: undefined,
        mode: 'translate-only'
      } : {
        word: targetWord,
        x: window.innerWidth / 2,
        y: window.scrollY + 100,
        messages: [],
        loading: false,
        visible: true,
        inputValue: '',
        translations: localTranslations,
        mode: 'translate-only'
      });
      return;
    }
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    setExplainWordPopup(prev => {
      const base = prev || {
        word: targetWord,
        x: window.innerWidth / 2,
        y: window.scrollY + 100,
        messages: [],
        loading: true,
        visible: true,
        inputValue: '',
        status: 'Anfrage wird gesendet...'
      };
      return { 
        ...base, 
        loading: true, 
        messages: [], 
        status: 'Anfrage wird gesendet...', 
        mode: modeToUse,
        fastContent: '',
        detailedContent: '',
        detailedLoading: true
      };
    });
    
    let contentPrompt = `definiere das wort : ${targetWord}`;
    if (modeToUse === 'simplified') {
      contentPrompt = `Erkläre das Wort vereinfacht: ${targetWord}`;
    } else if (modeToUse === 'detailed') {
      contentPrompt = `Erkläre das Wort detailliert wissenschaftlich: ${targetWord}`;
    } else if (modeToUse === 'buy') {
      contentPrompt = `kaufen: ${targetWord}`;
    }
    
    const initialMessages = [{ role: 'user' as const, content: contentPrompt }];
    
    try {
      const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      const baseUrl = isProd ? '/ai/sk.php?route=' : 'http://localhost:5000/api';
      const explainUrl = isProd ? `${baseUrl}${encodeURIComponent('/chat/explain-word')}` : `http://localhost:5000/api/chat/explain-word`;

      const response = await fetch(explainUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          messages: initialMessages,
          model: 'MiniMax-M3',
          mode: modeToUse,
          languages: explainLanguages,
          buyLocation: buyLocation
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error('Streaming request failed');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const cleanLine = line.trim();
            if (cleanLine.startsWith('data: ')) {
              try {
                const data = JSON.parse(cleanLine.substring(6));
                if (data.status) {
                  setExplainWordPopup(prev => prev ? { ...prev, status: data.status } : null);
                } else if (data.translations !== undefined) {
                  setExplainWordPopup(prev => prev ? { ...prev, translations: data.translations } : null);
                } else if (data.fastContent !== undefined || data.content !== undefined || data.webContent !== undefined) {
                  setExplainWordPopup(prev => {
                    if (!prev) return null;
                    let fastContent = prev.fastContent;
                    let detailedContent = prev.detailedContent;
                    let detailedLoading = prev.detailedLoading;

                    if (data.fastContent !== undefined) {
                      fastContent = data.fastContent;
                      detailedLoading = true;
                    }

                    if (data.content !== undefined) {
                      detailedContent = data.content;
                      detailedLoading = data.hasOwnProperty('webContent') ? false : true;
                    }

                    if (data.webContent !== undefined) {
                      if (data.webContent) {
                        detailedContent = data.webContent;
                      }
                      detailedLoading = false;
                    }

                    return {
                      ...prev,
                      fastContent,
                      detailedContent,
                      detailedLoading,
                      loading: !!detailedLoading
                    };
                  });
                } else if (data.error) {
                  throw new Error(data.error);
                }
              } catch (e) {}
            }
          }
        }
      }
      
      setExplainWordPopup(prev => prev ? { ...prev, loading: false, detailedLoading: false } : null);
      
      try {
        const profileData = await apiFetch('/chat/profile');
        if (profileData && typeof profileData.tokenBalance === 'number') {
          setTokenBalance(profileData.tokenBalance);
        }
      } catch(e) {}
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      navigator.clipboard.writeText(err.message).catch(() => {});
      setExplainWordPopup(prev => prev ? { ...prev, loading: false, detailedLoading: false, error: err.message } : null);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleMouseDownText = (e: React.MouseEvent) => {
    if (e.detail >= 2) {
      e.preventDefault(); // Complete block of browser-native selection on double-click
    }
  };

  const handleDoubleClickText = (e: React.MouseEvent) => {
    e.preventDefault(); // Stop default selection behavior (prevents browser context toolbar)
    
    let range: Range | null = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if ((document as any).caretPositionFromPoint) {
      const position = (document as any).caretPositionFromPoint(e.clientX, e.clientY);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.setEnd(position.offsetNode, position.offset);
      }
    }
    
    if (range) {
      const textNode = range.startContainer;
      const offset = range.startOffset;
      if (textNode.nodeType === Node.TEXT_NODE) {
        const text = textNode.textContent || '';
        
        // Match word characters (letters, numbers, underscores, hyphens, and umlauts)
        const isWordChar = (char: string) => /[\p{L}\p{N}_\-]/u.test(char);
        
        let start = offset;
        while (start > 0 && isWordChar(text[start - 1])) {
          start--;
        }
        let end = offset;
        while (end < text.length && isWordChar(text[end])) {
          end++;
        }
        
        const word = text.substring(start, end).trim();
        if (word && word.length > 0 && word.length < 60) {
          try {
            // Copy to clipboard automatically
            navigator.clipboard.writeText(word).catch(() => {});

            const wordRange = document.createRange();
            wordRange.setStart(textNode, start);
            wordRange.setEnd(textNode, end);
            const rect = wordRange.getBoundingClientRect();
            
            setExplainWordPopup({
              word: word,
              x: rect.left + rect.width / 2,
              y: rect.top + window.scrollY,
              messages: [],
              loading: true,
              visible: true,
              inputValue: '',
              mode: autoExplain ? 'normal' : 'translate-only'
            });
            
            // Clear any native browser selection
            window.getSelection()?.removeAllRanges();
            
            // Trigger translation/definition automatically
            handleExplainWordStart(word, autoExplain ? 'normal' : 'translate-only');
          } catch (err) {}
        }
      }
    }
  };

  const handleMouseUpTextSelection = () => {
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection) return;
      const text = selection.toString().trim();
      
      // Filter out empty selection or very long texts (keep only words/short phrases)
      if (text && text.length > 0 && text.length < 60) {
        try {
          // Copy to clipboard automatically
          navigator.clipboard.writeText(text).catch(() => {});

          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          
          setExplainWordPopup({
            word: text,
            x: rect.left + rect.width / 2,
            y: rect.top + window.scrollY,
            messages: [],
            loading: true,
            visible: true,
            inputValue: '',
            mode: autoExplain ? 'normal' : 'translate-only'
          });
          
          // Deselect text to dismiss the native copy/paste context overlay
          selection.removeAllRanges();
          
          // Trigger translation/definition automatically
          handleExplainWordStart(text, autoExplain ? 'normal' : 'translate-only');
        } catch (err) {}
      }
    }, 10);
  };

  const handleExplainWordFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!explainWordPopup || !explainWordPopup.inputValue.trim() || explainWordPopup.loading) return;
    
    const nextUserMsg = { role: 'user' as const, content: explainWordPopup.inputValue };
    const nextMessages = [...explainWordPopup.messages, nextUserMsg];
    
    setExplainWordPopup(prev => prev ? {
      ...prev,
      loading: true,
      messages: nextMessages,
      inputValue: '',
      status: 'Anfrage wird gesendet...'
    } : null);
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      const baseUrl = isProd ? '/ai/sk.php?route=' : 'http://localhost:5000/api';
      const explainUrl = isProd ? `${baseUrl}${encodeURIComponent('/chat/explain-word')}` : `http://localhost:5000/api/chat/explain-word`;

      const response = await fetch(explainUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          messages: nextMessages,
          model: 'MiniMax-M3',
          languages: explainLanguages,
          buyLocation: buyLocation
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error('Streaming request failed');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const cleanLine = line.trim();
            if (cleanLine.startsWith('data: ')) {
              try {
                const data = JSON.parse(cleanLine.substring(6));
                if (data.status) {
                  setExplainWordPopup(prev => prev ? { ...prev, status: data.status } : null);
                } else if (data.translations !== undefined) {
                  setExplainWordPopup(prev => prev ? { ...prev, translations: data.translations } : null);
                } else if (data.content !== undefined || data.webContent !== undefined) {
                  setExplainWordPopup(prev => {
                    if (!prev) return null;
                    let newMessages = [...prev.messages];

                    if (data.content !== undefined) {
                      const lastMsg = prev.messages[prev.messages.length - 1];
                      if (lastMsg && lastMsg.role === 'assistant') {
                        newMessages[newMessages.length - 1] = { role: 'assistant' as const, content: data.content };
                      } else {
                        newMessages.push({ role: 'assistant' as const, content: data.content });
                      }
                    }

                    if (data.webContent !== undefined) {
                      if (data.webContent) {
                        const hasWebContent = prev.messages.some((m, idx) => idx >= nextMessages.length && m.content === data.webContent);
                        if (!hasWebContent) {
                          newMessages.push({ role: 'assistant' as const, content: data.webContent });
                        }
                      }
                      return {
                        ...prev,
                        loading: false,
                        messages: newMessages
                      };
                    }

                    return {
                      ...prev,
                      loading: data.hasOwnProperty('webContent') ? false : true,
                      messages: newMessages
                    };
                  });
                } else if (data.error) {
                  throw new Error(data.error);
                }
              } catch (e) {}
            }
          }
        }
      }
      
      try {
        const profileData = await apiFetch('/chat/profile');
        if (profileData && typeof profileData.tokenBalance === 'number') {
          setTokenBalance(profileData.tokenBalance);
        }
      } catch(e) {}
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      navigator.clipboard.writeText(err.message).catch(() => {});
      setExplainWordPopup(prev => prev ? { ...prev, loading: false, error: err.message } : null);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  useEffect(() => {
    document.body.className = `theme-${theme}`;
    localStorage.setItem('colorTheme', theme);
  }, [theme]);

  const fetchMinimaxBalance = async (keyOverride?: string) => {
    setIsFetchingBalance(true);
    setBalanceError(null);
    try {
      const keyToUse = keyOverride !== undefined ? keyOverride : customMinimaxKey;
      const url = keyToUse 
        ? `/chat/minimax-balance?key=${encodeURIComponent(keyToUse)}`
        : '/chat/minimax-balance';
      const data = await apiFetch(url);
      setMinimaxBalanceData(data);
    } catch (err: any) {
      setBalanceError(err.message || 'Fehler beim Laden der Balance-Daten.');
      setMinimaxBalanceData(null);
    } finally {
      setIsFetchingBalance(false);
    }
  };

  useEffect(() => {
    if (activeSettingsTab === 'token' && token) {
      fetchMinimaxBalance();
    }
  }, [activeSettingsTab, token]);

  // Load model config when admin tab opens
  useEffect(() => {
    if (activeSettingsTab === 'admin' && isAdmin && token) {
      apiFetch('/admin/model-config')
        .then(data => setModelConfigLoaded(data))
        .catch(() => {});
    }
  }, [activeSettingsTab, isAdmin, token]);

  // Save model config to backend
  const handleSaveModelConfig = async () => {
    setModelSaving(true);
    setModelSaveMsg(null);
    try {
      await apiFetch('/admin/model-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          global: { mainModel, agnesKey: agnesApiKey, enabledModels },
          users: {}
        })
      });
      localStorage.setItem('mainModel', mainModel);
      localStorage.setItem('agnesApiKey', agnesApiKey);
      localStorage.setItem('enabledModels', JSON.stringify(enabledModels));
      setModelSaveMsg({ ok: true, text: '✅ Model-Konfiguration gespeichert!' });
      setTimeout(() => setModelSaveMsg(null), 3000);
    } catch (err: any) {
      setModelSaveMsg({ ok: false, text: '❌ Fehler: ' + err.message });
    } finally {
      setModelSaving(false);
    }
  };

  // Toggle model on/off
  const toggleModel = (modelName: string) => {
    setEnabledModels(prev => prev.includes(modelName) ? prev.filter(m => m !== modelName) : [...prev, modelName]);
  };

  const [sidebarOpen, setSidebarOpen] = useState(false); // Open by default for sidebar accessibility

  const [inputExpanded, setInputExpanded] = useState(false);
  const [inputHeight, setInputHeight] = useState<number | null>(null);
  const [inputFontSize, setInputFontSize] = useState(16);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; name: string; type: string; url: string; file?: File }[]>([]);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);

  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(48);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartHeight.current = textareaRef.current ? textareaRef.current.offsetHeight : 96;
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  };

  const handleDragMove = (e: MouseEvent) => {
    const deltaY = dragStartY.current - e.clientY;
    const newHeight = Math.max(96, Math.min(window.innerHeight - 150, dragStartHeight.current + deltaY));
    setInputHeight(newHeight);
    if (!inputExpanded) {
      setInputExpanded(true);
    }
  };

  const handleDragEnd = () => {
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(event.target as Node)) {
        setIsAttachmentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handlePasteImage = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          const url = URL.createObjectURL(file);
          setAttachments(prev => [...prev, {
            id: 'attach_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: file.name || 'Pasted Image',
            type: 'image',
            url,
            file
          }]);
          e.preventDefault();
        }
      }
    }
  };

  const triggerFileSelect = (acceptType: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = acceptType;
      fileInputRef.current.click();
    }
    setIsAttachmentMenuOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        const url = URL.createObjectURL(file);
        let type = 'file';
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('video/')) type = 'video';
        
        setAttachments(prev => [...prev, {
          id: 'attach_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          name: file.name,
          type,
          url,
          file
        }]);
      });
    }
  };

  useEffect(() => {
    if (explainWordPopup && explainWordPopup.visible && explainPopupRef.current) {
      const rect = explainPopupRef.current.getBoundingClientRect();
      
      // Determine the bottom of the header dynamically to avoid overlapping it
      const headerEl = document.querySelector('.app-header');
      const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 0;
      
      // Calculate the minimum allowed top position in viewport coordinates (headerBottom + 10px, or 10px if no header)
      const minViewportTop = Math.max(10, headerBottom + 10);
      
      // Default top position of the popup in viewport coordinates (word position minus spacing and popup height)
      const defaultViewportTop = (explainWordPopup.y - window.scrollY) - 8 - rect.height;
      
      if (defaultViewportTop < minViewportTop) {
        // Force the popup to stay within the visible screen area
        explainPopupRef.current.style.top = `${window.scrollY + minViewportTop}px`;
        explainPopupRef.current.style.transform = 'none';
      } else {
        // Position normally above the selected word
        explainPopupRef.current.style.top = `${explainWordPopup.y - 8}px`;
        explainPopupRef.current.style.transform = 'translateY(-100%)';
      }
    }
  }, [explainWordPopup, explainWordPopup?.y, explainWordPopup?.x, explainWordPopup?.visible, explainWordPopup?.loading, explainWordPopup?.messages.length, sidebarOpen]);

  const [avatarOpen, setAvatarOpen] = useState(false); // Avatar hidden by default on mobile, visible on desktop

  // Admin privilege check: supports both admin@miuniverse.de and thaimachine
  const isAdmin = !!(userEmail && (userEmail === 'admin@miuniverse.de' || userEmail.toLowerCase().includes('thaimachine')));

  // API online status
  const [apiOnline, setApiOnline] = useState(false);
  // Track consecutive failed health checks to distinguish "restarting" (brief) from "down" (long)
  const [apiDownSince, setApiDownSince] = useState<number | null>(null);
  const [showRestartBanner, setShowRestartBanner] = useState(false);

  // Version check for live updates
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [versionBuildTime, setVersionBuildTime] = useState<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  // Health check polling
  useEffect(() => {
    if (!token) return;
    const checkHealth = async () => {
      try {
        const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
        const healthUrl = isProd ? '/ai/sk.php?route=' + encodeURIComponent('/health') : 'http://localhost:5000/api/health';
        const res = await fetch(healthUrl, { method: 'GET', headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
        if (res.ok) {
          setApiOnline(true);
          setApiDownSince(null);
          setShowRestartBanner(false);
        } else {
          setApiOnline(false);
          // Track when it went down
          setApiDownSince(prev => prev ?? Date.now());
        }
      } catch {
        setApiOnline(false);
        setApiDownSince(prev => prev ?? Date.now());
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [token]);

  // Show "Server wird neu gestartet..." banner after 2 consecutive failed checks (~1 min)
  useEffect(() => {
    if (!apiDownSince) {
      setShowRestartBanner(false);
      return;
    }
    // After 30s of being down, show the banner
    const timer = setTimeout(() => {
      setShowRestartBanner(true);
    }, 30000);
    return () => clearTimeout(timer);
  }, [apiDownSince]);

  // Version check logic
  const checkForUpdate = async () => {
    try {
      const res = await fetch('./version.json?t=' + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      if (currentVersion && data.version !== currentVersion) {
        console.log('[Update] New version detected, reloading...');
        window.location.reload();
      } else if (!currentVersion) {
        setCurrentVersion(data.version);
        if (data.buildTime) setVersionBuildTime(data.buildTime);
      }
    } catch {
      // version.json may not exist yet in dev
    }
  };

  // Format a numeric version (e.g. "1782438161830") into a short readable form (e.g. "1.55.220")
  const formatVersionShort = (v: string | null): string => {
    if (!v) return '?.?.?';
    // Treat as timestamp string (ms since epoch) — derive a deterministic short code
    const num = parseInt(v, 10);
    if (!isNaN(num) && num > 1000000000000) {
      // milliseconds → split into "1.X.Y" where X = month-derived, Y = day-derived
      const d = new Date(num);
      const major = d.getFullYear() - 2025; // 1, 2, ...
      const minor = d.getMonth() + 1;
      const patch = d.getDate();
      return `${major}.${minor.toString().padStart(2, '0')}.${patch.toString().padStart(2, '0')}`;
    }
    // Otherwise just show last 4 chars of the hash for a stable short id
    return v.length > 6 ? v.slice(-4) : v;
  };

  // Format ISO build time as "DD.MM.YY HH:mm"
  const formatBuildDate = (iso: string): string => {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const day = d.getDate().toString().padStart(2, '0');
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const year = d.getFullYear().toString().slice(-2);
      const hh = d.getHours().toString().padStart(2, '0');
      const mm = d.getMinutes().toString().padStart(2, '0');
      return `${day}.${month}.${year} ${hh}:${mm}`;
    } catch {
      return '';
    }
  };

  // Load version on mount
  useEffect(() => {
    checkForUpdate();
  }, []);

  // Inactivity timer: check for updates after 10 min idle
  useEffect(() => {
    const resetActivity = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('keydown', resetActivity);
    window.addEventListener('mousemove', resetActivity);
    window.addEventListener('scroll', resetActivity);
    window.addEventListener('touchstart', resetActivity);

    const interval = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle > 600000 && !isLoading) { // 10 minutes
        checkForUpdate();
      }
    }, 60000);

    return () => {
      window.removeEventListener('keydown', resetActivity);
      window.removeEventListener('mousemove', resetActivity);
      window.removeEventListener('scroll', resetActivity);
      window.removeEventListener('touchstart', resetActivity);
      clearInterval(interval);
    };
  }, [currentVersion, isLoading]);

  // Intercept Ctrl+R / F5 for version check
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'r') || e.key === 'F5' || (e.metaKey && e.key === 'r')) {
        e.preventDefault();
        checkForUpdate().then(() => window.location.reload());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentVersion]);

  // Hard reload: clear caches (Cache API + localStorage cache) and force a fresh fetch
  const handleHardReload = async () => {
    try {
      // 1) Unregister service workers (PWA cache)
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
      }
      // 2) Delete Cache API entries
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      // 3) Force a no-cache reload with cache-bust query string
      const url = new URL(window.location.href);
      url.searchParams.set('reload', String(Date.now()));
      window.location.replace(url.toString());
    } catch (e) {
      // Fallback: simple no-cache reload via meta headers trick + cache-bust
      const url = new URL(window.location.href);
      url.searchParams.set('reload', String(Date.now()));
      window.location.replace(url.toString());
    }
  };

  // Input backup to localStorage
  useEffect(() => {
    if (input) {
      localStorage.setItem('chat_input_backup', input);
    } else {
      localStorage.removeItem('chat_input_backup');
    }
  }, [input]);

  // Mobile panel mutual exclusivity
  const isMobile = () => window.innerWidth <= 768;
  const [enterToSend, setEnterToSend] = useState(localStorage.getItem('enterToSend') !== 'false'); // Default to true
  const [youtubeSkillActive, setYoutubeSkillActive] = useState(localStorage.getItem('youtubeSkillActive') !== 'false'); // Default to true
  const [webSearchSkillActive, setWebSearchSkillActive] = useState(localStorage.getItem('webSearchSkillActive') !== 'false'); // Default to true
  
  // Profile settings states
  const [profileUsername, setProfileUsername] = useState('');
  const [tempUsername, setTempUsername] = useState('');
  const [profileWohnort, setProfileWohnort] = useState('');
  const [profileAdresse, setProfileAdresse] = useState('');
  const [profileTelefon, setProfileTelefon] = useState('');
  const [profileBeruf, setProfileBeruf] = useState('');
  const [profileMindset, setProfileMindset] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [profileMemory, setProfileMemory] = useState('');
  
  // Auto / Live location states
  const [profileAutoLive, setProfileAutoLive] = useState(false);
  const [profileLatitude, setProfileLatitude] = useState<number | null>(null);
  const [profileLongitude, setProfileLongitude] = useState<number | null>(null);
  const [profileLastLocationUpdate, setProfileLastLocationUpdate] = useState<string | null>(null);
  
  // Splitscreen active panel content states
  const [activePanelUrl, setActivePanelUrl] = useState<string | null>(null);
  const [avatarWide, setAvatarWide] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  // PWA Install states
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // Model selector states
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('selectedModel') || 'MiniMax-M3');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  
  // Media Overlay state
  const [overlayItems, setOverlayItems] = useState<any[]>([]);
  
  const timerRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Listen to PWA installation prompts
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install: ${outcome}`);
    setDeferredPrompt(null);
  };

  // Capture clicks on links to open them in the splitscreen
  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor && anchor.href) {
      // If the link is inside the avatar-panel, let it open in a new tab normally
      if (target.closest('.avatar-panel')) {
        return;
      }
      const url = anchor.href;
      // Intercept external links/embeds to show inside splitscreen panel
      e.preventDefault();
      setActivePanelUrl(url);
      setAvatarOpen(true); // Auto-open avatar capsule if closed
      if (isMobile()) setSidebarOpen(false);
    }
  };

  const handleSummarizeUrl = async (url: string) => {
    if (!currentSessionId) return;
    setIsSummarizing(true);
    setIsLoading(true);
    
    // Add user message optimistic update
    const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
    const label = isYoutube ? 'Zusammenfassung des YouTube-Videos anfordern' : 'Zusammenfassung der Webseite anfordern';
    setMessages(prev => [...prev, { id: 'temp-user', role: 'user', content: `${label}: ${url}` }]);

    try {
      const res = await apiFetch('/chat/summarize', {
        method: 'POST',
        body: JSON.stringify({
          url,
          sessionId: currentSessionId
        })
      });

      // Reload messages to get final model response with ids
      await loadMessages(currentSessionId);

      if (res.tokenBalance !== undefined) {
        setTokenBalance(res.tokenBalance);
        localStorage.setItem('tokenBalance', String(res.tokenBalance));
      }

      if (res.audio) {
        playAudio(res.audio);
      }
    } catch (err: any) {
      triggerSystemAlert(`Fehler bei der Zusammenfassung: ${err.message}`);
    } finally {
      setIsSummarizing(false);
      setIsLoading(false);
    }
  };

  const loadProfileData = async () => {
    try {
      const data = await apiFetch('/chat/profile');
      setProfileUsername(data.username || '');
      setTempUsername(data.username || '');
      setProfileWohnort(data.wohnort || '');
      setProfileAdresse(data.adresse || '');
      setProfileTelefon(data.telefon || '');
      setProfileBeruf(data.beruf || '');
      setProfileMindset(data.mindset || '');
      setProfileBio(data.bio || '');
      setProfileMemory(data.profileMemory || '');
      setProfileAutoLive(data.autoLive || false);
      setProfileLatitude(data.latitude || null);
      setProfileLongitude(data.longitude || null);
      setProfileLastLocationUpdate(data.lastLocationUpdate || null);
    } catch (err) {
      console.error('Failed to load profile data:', err);
    }
  };

  const handleSaveProfileData = async () => {
    try {
      await apiFetch('/chat/profile', {
        method: 'POST',
        body: JSON.stringify({
          username: profileUsername,
          wohnort: profileWohnort,
          adresse: profileAdresse,
          telefon: profileTelefon,
          beruf: profileBeruf,
          mindset: profileMindset,
          bio: profileBio,
          profileMemory,
          autoLive: profileAutoLive,
          latitude: profileLatitude,
          longitude: profileLongitude,
          lastLocationUpdate: profileLastLocationUpdate
        })
      });
      triggerSystemAlert('Profil erfolgreich gespeichert!', false);
    } catch (err: any) {
      triggerSystemAlert(`Fehler beim Speichern des Profils: ${err.message}`);
    }
  };

  const handleToggleAutoLive = async () => {
    const nextVal = !profileAutoLive;
    setProfileAutoLive(nextVal);
    
    if (nextVal) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const timeStr = new Date().toLocaleString();
            setProfileLatitude(lat);
            setProfileLongitude(lon);
            setProfileLastLocationUpdate(timeStr);
            
            let resolvedCity = profileWohnort;
            try {
              const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`);
              if (geoRes.ok) {
                const geoData = await geoRes.json();
                resolvedCity = geoData.address.city || geoData.address.town || geoData.address.village || geoData.address.suburb || profileWohnort;
                setProfileWohnort(resolvedCity);
              }
            } catch (e) {
              console.warn("Nominatim geocoding failed, keeping original city", e);
            }
            
            await apiSaveLocation(nextVal, lat, lon, timeStr, resolvedCity);
          },
          async (error) => {
            console.warn("GPS tracking denied or failed, falling back to IP geolocation:", error.message);
            await handleIPGeolocationFallback(nextVal);
          }
        );
      } else {
        await handleIPGeolocationFallback(nextVal);
      }
    } else {
      await apiSaveLocation(false, null, null, null, profileWohnort);
    }
  };

  const handleIPGeolocationFallback = async (active: boolean) => {
    try {
      const ipRes = await fetch('https://ipapi.co/json/');
      if (ipRes.ok) {
        const ipData = await ipRes.json();
        const lat = ipData.latitude;
        const lon = ipData.longitude;
        const city = ipData.city || profileWohnort;
        const timeStr = new Date().toLocaleString();
        
        setProfileLatitude(lat);
        setProfileLongitude(lon);
        setProfileLastLocationUpdate(timeStr);
        setProfileWohnort(city);
        
        await apiSaveLocation(active, lat, lon, timeStr, city);
      } else {
        await apiSaveLocation(active, null, null, null, profileWohnort);
      }
    } catch (e) {
      console.error("IP geolocation fallback failed:", e);
      await apiSaveLocation(active, null, null, null, profileWohnort);
    }
  };

  const apiSaveLocation = async (active: boolean, lat: number | null, lon: number | null, time: string | null, city: string) => {
    try {
      await apiFetch('/chat/profile', {
        method: 'POST',
        body: JSON.stringify({
          username: profileUsername,
          wohnort: city,
          adresse: profileAdresse,
          telefon: profileTelefon,
          beruf: profileBeruf,
          mindset: profileMindset,
          bio: profileBio,
          profileMemory,
          autoLive: active,
          latitude: lat,
          longitude: lon,
          lastLocationUpdate: time
        })
      });
    } catch (err) {
      console.error("Failed to save location updates to backend:", err);
    }
  };

  const handleSaveUsername = async () => {
    if (!tempUsername.trim()) return;
    try {
      await apiFetch('/chat/profile', {
        method: 'POST',
        body: JSON.stringify({
          username: tempUsername.trim(),
          wohnort: profileWohnort,
          adresse: profileAdresse,
          telefon: profileTelefon,
          beruf: profileBeruf,
          mindset: profileMindset,
          bio: profileBio,
          profileMemory,
          autoLive: profileAutoLive,
          latitude: profileLatitude,
          longitude: profileLongitude,
          lastLocationUpdate: profileLastLocationUpdate
        })
      });
      setProfileUsername(tempUsername.trim());
    } catch (err: any) {
      triggerSystemAlert(`Fehler beim Speichern des Benutzernamens: ${err.message}`);
    }
  };

  const startProfilingSession = async () => {
    try {
      const session = await apiFetch('/chat/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: '👤 Profiling & Analyse' })
      });
      setSessions(prev => [session, ...prev]);
      setCurrentSessionId(session.id);
      setMessages([]);
      setSettingsOpen(false);
      setSidebarOpen(false);
      setIsLoading(true);

      const initialContent = "Hallo! Ich bin bereit für das Profiling-Interview. Bitte stelle mir deine Fragen.";
      setMessages([{ id: 'temp-user', role: 'user', content: initialContent }]);

      const res = await apiFetch('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: session.id,
          content: initialContent,
          systemPrompt: `Du bist ein professioneller Profiler. Deine Aufgabe ist es, den Benutzer zu interviewen, um ein tiefgehendes Profil über seine Person zu erstellen (Wohnort, Adresse, Telefonnummer, Beruf, Hobbys, Mindset, Lebensziele, Charakter).
Stelle dem Benutzer nacheinander ca. 20 gezielte, freundliche Fragen (jeweils 1-2 Fragen pro Nachricht), um ein vollständiges Profil aufzubauen.
Frag ihn zuerst nach seinem Namen und Alter.
Sobald du alle nötigen Informationen gesammelt hast oder der Benutzer das Interview beendet, erstelle eine präzise, strukturierte Zusammenfassung (in der Ich-Perspektive des Benutzers, z.B. 'Ich bin Markus, 46 Jahre alt...').
Schreibe diese finale Zusammenfassung UNBEDINGT in einen Block, der mit [PROFILE_SUMMARY_START] beginnt und mit [PROFILE_SUMMARY_END] endet.`,
          model: selectedModel
        })
      });

      await loadMessages(session.id);
      await loadProfileData();

      if (res.tokenBalance !== undefined) {
        setTokenBalance(res.tokenBalance);
        localStorage.setItem('tokenBalance', String(res.tokenBalance));
      }
    } catch (err: any) {
      triggerSystemAlert(`Fehler beim Starten des Profilings: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle session press events (long click to rename)
  const sessionPressTimerRef = useRef<any>(null);
  const isLongPressRef = useRef(false);

  const handleSessionPressStart = (sessionId: string, currentTitle: string) => {
    isLongPressRef.current = false;
    sessionPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setEditingSessionId(sessionId);
      setEditingSessionTitle(currentTitle);
    }, 700);
  };

  const handleSessionPressEnd = () => {
    if (sessionPressTimerRef.current) {
      clearTimeout(sessionPressTimerRef.current);
    }
  };

  const handleSessionClick = (sessionId: string) => {
    if (isLongPressRef.current) return;
    setCurrentSessionId(sessionId);
    setSidebarOpen(false);
  };

  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      await apiFetch(`/chat/sessions/${sessionId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle })
      });
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
      setEditingSessionId(null);
    } catch (err: any) {
      triggerSystemAlert(`Fehler beim Umbenennen: ${err.message}`);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await apiFetch(`/chat/sessions/${sessionId}`, {
        method: 'DELETE'
      });
      
      localStorage.removeItem(`miuniverse_nodes_${sessionId}`);
      localStorage.removeItem(`miuniverse_connections_${sessionId}`);

      const remaining = sessions.filter(s => s.id !== sessionId);
      setSessions(remaining);

      if (currentSessionId === sessionId) {
        if (remaining.length > 0) {
          setCurrentSessionId(remaining[0].id);
        } else {
          setCurrentSessionId(null);
          setMessages([]);
        }
      }
    } catch (err: any) {
      triggerSystemAlert(`Fehler beim Löschen des Chats: ${err.message}`);
    }
  };

  const getSessionTooltip = (s: Session) => {
    const formatDate = (dateStr: string) => {
      const d = new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = String(d.getFullYear()).slice(-2);
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${day}.${month}.${year} ${hours}:${minutes}`;
    };

    const beginStr = formatDate(s.createdAt);
    const lastMsgDate = s.messages && s.messages.length > 0 ? s.messages[0].createdAt : s.createdAt;
    const endStr = formatDate(lastMsgDate);

    return `Beginn ${beginStr} - Endet ${endStr}`;
  };

  // Handle long press on logo to toggle settings overlay & sidebar
  const handleMouseDown = () => {
    timerRef.current = setTimeout(() => {
      setSidebarOpen(true);
      setSettingsOpen(true);
      setActiveSettingsTab('admin');
    }, 800);
  };

  const handleMouseUp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const loadAdminData = async () => {
    try {
      const usersRes = await apiFetch('/admin/users');
      setAdminUsers(usersRes);

      const promptsRes = await apiFetch('/admin/system-prompts');
      setPromptsConfig(promptsRes);
      
      if (selectedPromptTarget === 'global') {
        setTempSystemPrompt(promptsRes.global);
      } else {
        setTempSystemPrompt(promptsRes.users[selectedPromptTarget] || '');
      }
    } catch (e: any) {
      console.error('Error fetching admin data:', e);
    }
  };

  const handleSavePrompt = async () => {
    const updatedConfig = { ...promptsConfig };
    if (selectedPromptTarget === 'global') {
      updatedConfig.global = tempSystemPrompt;
    } else {
      updatedConfig.users[selectedPromptTarget] = tempSystemPrompt;
    }
    
    try {
      const res = await apiFetch('/admin/system-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig)
      });
      if (res.success) {
        setPromptsConfig(res.data);
        triggerSystemAlert('System Prompt erfolgreich aktualisiert!', false);
      }
    } catch (err: any) {
      triggerSystemAlert(`Fehler beim Speichern des Prompts: ${err.message}`, true);
    }
  };

  const handleInspectUser = async (targetEmail: string) => {
    try {
      const res = await apiFetch('/admin/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail })
      });
      
      if (res.token) {
        const currentToken = localStorage.getItem('token');
        if (currentToken) {
          localStorage.setItem('adminToken', currentToken);
        }
        
        localStorage.setItem('token', res.token);
        localStorage.setItem('email', res.email);
        localStorage.setItem('profileUsername', res.username);
        
        triggerSystemAlert(`Inspector-Modus gestartet: Angemeldet als ${res.username}`, false);
        setSettingsOpen(false);
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      }
    } catch (err: any) {
      triggerSystemAlert(`Inspektionsfehler: ${err.message}`, true);
    }
  };

  const handleExitInspectMode = () => {
    const adminToken = localStorage.getItem('adminToken');
    if (adminToken) {
      localStorage.setItem('token', adminToken);
      localStorage.removeItem('adminToken');
      localStorage.setItem('email', 'admin@miuniverse.de');
      localStorage.setItem('profileUsername', 'thaimachine');
      
      triggerSystemAlert('Zurück zum Admin-Modus...', false);
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  };

  // Admin: Grant tokens to a chosen user
  const handleGrantTokens = async () => {
    if (!tokenGrantSelectedEmail) {
      setTokenGrantResult({ ok: false, message: 'Bitte zuerst einen Benutzer auswählen.' });
      return;
    }
    const amount = parseInt(tokenGrantAmount, 10);
    if (!amount || isNaN(amount) || amount <= 0) {
      setTokenGrantResult({ ok: false, message: 'Bitte eine gültige Token-Menge > 0 angeben.' });
      return;
    }
    setTokenGrantSending(true);
    setTokenGrantResult(null);
    try {
      const res = await apiFetch('/admin/grant-tokens', {
        method: 'POST',
        body: JSON.stringify({
          targetEmail: tokenGrantSelectedEmail,
          amount,
          note: tokenGrantNote.trim() || undefined
        })
      });
      setTokenGrantResult({
        ok: true,
        message: `✅ ${amount.toLocaleString('de-DE')} Tokens an ${tokenGrantSelectedUsername} (${tokenGrantSelectedEmail}) gesendet. Neuer Stand: ${res.newBalance.toLocaleString('de-DE')}.`
      });
      // Refresh user list
      try {
        const usersRes = await apiFetch('/admin/users');
        setAdminUsers(usersRes);
      } catch (e) {}
      // Reset fields
      setTokenGrantAmount('1000');
      setTokenGrantNote('');
    } catch (err: any) {
      setTokenGrantResult({ ok: false, message: `❌ Fehler: ${err.message}` });
    } finally {
      setTokenGrantSending(false);
    }
  };

  // Admin: Reset ALL users' token balance to a fixed value
  const [resetAllSending, setResetAllSending] = useState(false);
  const [resetAllResult, setResetAllResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [resetAllBalance, setResetAllBalance] = useState<string>('1000000');

  const handleResetAllTokens = async () => {
    const balance = parseInt(resetAllBalance, 10);
    if (!balance || isNaN(balance) || balance < 0) {
      setResetAllResult({ ok: false, message: 'Bitte eine gültige Balance ≥ 0 eingeben.' });
      return;
    }
    if (!window.confirm(`⚠️ Wirklich ALLE User auf ${balance.toLocaleString('de-DE')} Tokens zurücksetzen? Dies betrifft JEDEN Account!`)) {
      return;
    }
    setResetAllSending(true);
    setResetAllResult(null);
    try {
      const res = await apiFetch('/admin/reset-all-tokens', {
        method: 'POST',
        body: JSON.stringify({ balance })
      });
      setResetAllResult({
        ok: true,
        message: `✅ ${res.usersUpdated} User auf je ${res.newBalance.toLocaleString('de-DE')} Tokens zurückgesetzt.`
      });
      // Refresh user list
      try {
        const usersRes = await apiFetch('/admin/users');
        setAdminUsers(usersRes);
      } catch (e) {}
    } catch (err: any) {
      setResetAllResult({ ok: false, message: `❌ Fehler: ${err.message}` });
    } finally {
      setResetAllSending(false);
    }
  };

  // User inbox: load notifications for the current logged-in user
  const fetchUserNotifications = async () => {
    if (!token || !userEmail) return;
    try {
      const list = await apiFetch('/admin/notifications');
      if (Array.isArray(list) && list.length > 0) {
        // Show the newest unread token-grant notification as a popup
        const newestUnread = list.find((n: any) => !n.read && n.type === 'token_grant');
        if (newestUnread && !seenNotifIds.has(newestUnread.id)) {
          seenNotifIds.add(newestUnread.id);
          setShowNotificationsPopup(newestUnread);
          setTimeout(() => {
            setShowNotificationsPopup((curr: any) => (curr && curr.id === newestUnread.id ? null : curr));
          }, 12000);
        }
        setUserNotifications(list);
      } else {
        setUserNotifications([]);
      }
    } catch (e) {
      // Silently fail - endpoint may not yet exist for this user
      setUserNotifications([]);
    }
  };

  const handleMarkNotificationsRead = async () => {
    try {
      await apiFetch('/admin/notifications/mark-read', { method: 'POST', body: JSON.stringify({}) });
      setUserNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) {}
  };

  // Load admin data when tab is active
  useEffect(() => {
    if (activeSettingsTab === 'admin' && isAdmin) {
      loadAdminData();
    }
  }, [activeSettingsTab]);

  // Sync temp editor when target changes
  useEffect(() => {
    if (selectedPromptTarget === 'global') {
      setTempSystemPrompt(promptsConfig.global);
    } else {
      setTempSystemPrompt(promptsConfig.users[selectedPromptTarget] || '');
    }
  }, [selectedPromptTarget, promptsConfig]);

  // Polling loop for request notifications
  useEffect(() => {
    if (!isAdmin) return;
    
    const fetchRequests = async () => {
      try {
        const list = await apiFetch('/admin/live-requests');
        if (Array.isArray(list) && list.length > 0) {
          const latestReq = list[0];
          const timeDiff = Date.now() - new Date(latestReq.timestamp).getTime();
          if (!seenRequestIds.has(latestReq.id) && timeDiff < 15000) {
            seenRequestIds.add(latestReq.id);
            if (latestReq.email !== 'admin@miuniverse.de') {
              setShowRequestPopup(latestReq);
              setTimeout(() => {
                setShowRequestPopup((current: any) => {
                  if (current && current.id === latestReq.id) return null;
                  return current;
                });
              }, 8000);
            }
          }
          setLiveRequests(list);
        }
      } catch (e) {}
    };

    fetchRequests();
    const interval = setInterval(fetchRequests, 3000);
    return () => clearInterval(interval);
  }, [email]);

  // Close token-grant dropdown on outside click
  useEffect(() => {
    if (!tokenGrantDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.admin-token-grant-dropdown')) {
        setTokenGrantDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [tokenGrantDropdownOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (enterToSend) {
        e.preventDefault();
        handleSendMessage(e as any);
      }
    }
  };

  // Auto-scroll messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load configuration and sessions if authenticated
  useEffect(() => {
    if (token) {
      loadSessions();
      loadProfileData();
      // Use local storage balance or default
      const savedBalance = localStorage.getItem('tokenBalance');
      if (savedBalance) setTokenBalance(parseInt(savedBalance));
    }
  }, [token]);

  // Poll user inbox for new admin notifications (token grants, etc.)
  useEffect(() => {
    if (!token || !userEmail) return;
    fetchUserNotifications();
    const interval = setInterval(fetchUserNotifications, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, userEmail]);

  // Load messages when current session changes
  useEffect(() => {
    if (currentSessionId && token) {
      loadMessages(currentSessionId);
      loadProfileData();
    }
  }, [currentSessionId]);

  // Background weather tracking loop (Auto / Live)
  useEffect(() => {
    if (!profileAutoLive || !profileLatitude || !profileLongitude) return;

    let lastCheckTime = Date.now();
    let lastHourlyTime = Date.now();

    const checkWeather = async (forceHourly: boolean) => {
      try {
        const timeNow = Date.now();
        const isHourly = forceHourly || (timeNow - lastHourlyTime >= 60 * 60 * 1000);
        
        const res = await apiFetch('/chat/weather-report', {
          method: 'POST',
          body: JSON.stringify({
            latitude: profileLatitude,
            longitude: profileLongitude,
            isChangeCheck: !isHourly
          })
        });

        if (res.speak && res.audio) {
          playAudio(res.audio);
          
          if (currentSessionId && res.text) {
            setMessages(prev => [
              ...prev,
              {
                id: `weather-${Date.now()}`,
                role: 'assistant',
                content: `🌤️ **Live-Wetter-Update:** ${res.text}`
              }
            ]);
          }
        }

        lastCheckTime = timeNow;
        if (isHourly) {
          lastHourlyTime = timeNow;
        }
      } catch (err) {
        console.error("Failed to run Live Weather check:", err);
      }
    };

    // Run first check immediately after a small delay
    const initialTimeout = setTimeout(() => {
      checkWeather(true); // Force full report on startup
    }, 4000);

    const interval = setInterval(() => {
      const timeNow = Date.now();
      const needsHourly = timeNow - lastHourlyTime >= 60 * 60 * 1000;
      const needsChangeCheck = timeNow - lastCheckTime >= 15 * 60 * 1000;

      if (needsHourly) {
        checkWeather(true);
      } else if (needsChangeCheck) {
        checkWeather(false);
      }
    }, 60 * 1000); // Check criteria every minute

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [profileAutoLive, profileLatitude, profileLongitude, currentSessionId]);

  const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const baseUrl = isProd ? '/ai/sk.php?route=' : 'http://localhost:5000/api';
    const url = isProd ? `${baseUrl}${encodeURIComponent(endpoint)}` : `http://localhost:5000/api${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
      }
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Request failed');
    }
    return response.json();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    
    try {
      const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      const loginUrl = isProd 
        ? `/ai/sk.php?route=${encodeURIComponent('/auth/mock-login')}` 
        : 'http://localhost:5000/api/auth/mock-login';
      const res = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        throw new Error('Access Denied');
      }

      const data = await res.json();
      localStorage.setItem('token', data.token);
      localStorage.setItem('userEmail', data.user.email);
      localStorage.setItem('tokenBalance', String(data.user.tokenBalance));
      
      setToken(data.token);
      setUserEmail(data.user.email);
      setTokenBalance(data.user.tokenBalance);
    } catch (err: any) {
      const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      if (isProd) {
        setAuthError('Zugriff verweigert: Falsches Passwort oder Benutzername.');
        console.error('Auth failed:', err.message);
      } else {
        console.warn('[Auth] Server login failed. Using local fallback...', err.message);
        const fallbackToken = 'fallback-token-' + Date.now();
        localStorage.setItem('token', fallbackToken);
        localStorage.setItem('userEmail', email.trim() || 'admin@miuniverse.de');
        localStorage.setItem('tokenBalance', '999999');
        
        setToken(fallbackToken);
        setUserEmail(email.trim() || 'admin@miuniverse.de');
        setTokenBalance(999999);
      }
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    setToken(null);
    setUserEmail(null);
    setSessions([]);
    setCurrentSessionId(null);
    setMessages([]);
  };

  const loadSessions = async () => {
    try {
      const data = await apiFetch('/chat/sessions');
      setSessions(data);
      if (data.length > 0 && !currentSessionId) {
        setCurrentSessionId(data[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const extractMediaItems = (messagesList: any[]) => {
    const lastAssistantMessage = [...messagesList].reverse().find(m => m.role === 'assistant');
    if (!lastAssistantMessage) {
      setOverlayItems([]);
      return;
    }

    const mdLinkRegex = /\[(.*?)\]\((.*?)\)/g;
    const items = [];
    let match;
    let count = 1;

    while ((match = mdLinkRegex.exec(lastAssistantMessage.content)) !== null) {
      const title = match[1];
      const url = match[2];
      
      let type: 'youtube' | 'link' | 'image' = 'link';
      if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('youtube-nocookie.com')) {
        type = 'youtube';
      } else if (url.match(/\.(jpeg|jpg|gif|png|webp)/i)) {
        type = 'image';
      }

      items.push({
        number: count++,
        title,
        url,
        type
      });
    }

    setOverlayItems(items);
  };

  const loadMessages = async (sid: string) => {
    try {
      const data = await apiFetch(`/chat/sessions/${sid}/messages`);
      setMessages(data);
      extractMediaItems(data);
    } catch (err) {
      console.error(err);
    }
  };

  const createNewSession = async () => {
    // Check for updates on new chat
    checkForUpdate();
    if (!token) {
      triggerSystemAlert('Bitte zuerst einloggen, um einen Chat zu starten.', true);
      handleLogout();
      return;
    }
    try {
      const session = await apiFetch('/chat/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: 'Neuer Chat' })
      });
      setSessions(prev => [session, ...prev]);
      setCurrentSessionId(session.id);
      setMessages([]);
    } catch (err: any) {
      console.error(err);
      // If auth error, force logout so user sees login screen
      if (err.message && (err.message.includes('401') || err.message.includes('Unauthorized') || err.message.includes('Token'))) {
        triggerSystemAlert('Sitzung abgelaufen — bitte neu einloggen.', true);
        handleLogout();
      } else {
        triggerSystemAlert(`Fehler beim Erstellen eines neuen Chats: ${err.message}`, true);
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || !currentSessionId) return;

    const userMessageContent = input;
    setInput('');
    const sentAttachments = [...attachments];
    setAttachments([]); // Clear previews on UI instantly
    localStorage.removeItem('chat_input_backup');
    setIsLoading(true);

    // Optimistically update UI
    setMessages(prev => [...prev, { 
      id: 'temp-user', 
      role: 'user', 
      content: userMessageContent + (sentAttachments.length > 0 ? `\n\n[Dateianhänge: ${sentAttachments.map(a => a.name).join(', ')}]` : '') 
    }]);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let finalSystemPrompt = youtubeSkillActive 
        ? `${systemPrompt}\n\n[SPEZIAL-SKILL: YouTube Video-Finder]\nWenn der Benutzer nach Videos sucht, Videos anfordert oder YouTube-bezogene Fragen stellt, MUSST du für die ersten 4 Suchergebnisse echte, direkte YouTube-Video-Links im Format '[Videotitel](https://www.youtube.com/watch?v=VIDEO_ID)' vorschlagen (damit der integrierte Player sie abspielen kann). Als 5. Link (Suchergebnis) hängst du einen allgemeinen YouTube-Suchlink an im Format '[YouTube-Suche: Suchbegriff](https://www.youtube.com/results?search_query=...)'.`
        : systemPrompt;

      // Inject Workspace Modes Instructions
      if (canvasWorkMode === 'ue5') {
        finalSystemPrompt += `\n\n[ARBEITSBEREICH-MODUS: Unreal Engine 5 C++ Programming Mode]
Du programmierst jetzt für Unreal Engine 5. Befolge diese C++-Formatierungsvorschriften:
- Verwende UE5-Makros wie UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Name") und UFUNCTION(BlueprintCallable).
- Deklariere Klassen mit Standard-Präfixen (z. B. 'AMyActor' für Actors, 'UMyComponent' für Components).
- Stelle sicher, dass die Include-Zeilen die '.generated.h' als letzte Include-Datei enthalten.
- Erkläre UE5-Speicherverwaltung (Smart Pointers TSharedPtr/TUniquePtr vs. Garbage Collected UObjects, UPROPERTY() als Referenzhalter).
- Beachte die Actor Component Construction im Constructor via CreateDefaultSubobject.`;
      } else if (canvasWorkMode === 'appweb') {
        finalSystemPrompt += `\n\n[ARBEITSBEREICH-MODUS: App / Web Development Mode]
Du programmierst für Web- und App-Anwendungen (HTML, Javascript, CSS, PHP, Node.js, Ajax, JSON, Python, Electron).
Befolge diese Architekturrichtlinien:
- Entwickle sauberen, modularen und responsive-fähigen Code.
- Verwende moderne CSS-Variablen, Flexbox/Grid und Vanilla JS/CSS für erstklassige Ästhetik.
- Nutze standardkonforme AJAX/Fetch-API Requests und JSON für Datentransfer.
- Nutze im Backend standardkonforme PHP/Node.js/Python Strukturen und vermeide Deprecated APIs.`;
      }

      const nickname = profileUsername || 'User';
      finalSystemPrompt = finalSystemPrompt.replace(/@username/g, nickname);

      // Wenn Miumiverse-Skill aktiv ist, lies den Canvas-Context aus
      let canvasContext = null;
      if (miumiverseSkillActive) {
        try {
          const savedNodes = localStorage.getItem('miuniverse_nodes_Miumiverse');
          const savedConns = localStorage.getItem('miuniverse_connections_Miumiverse');
          canvasContext = {
            nodes: savedNodes ? JSON.parse(savedNodes) : [],
            connections: savedConns ? JSON.parse(savedConns) : []
          };
          console.log('[Miumiverse Skill] Canvas Context mitgesendet:', canvasContext);
        } catch (e) {
          console.warn('Fehler beim Auslesen des Canvas-Contexts:', e);
        }
      }

      const res = await apiFetch('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: currentSessionId,
          content: userMessageContent,
          systemPrompt: finalSystemPrompt,
          model: selectedModel,
          activeUrl: activePanelUrl,
          webSearchSkillActive,
          miumiverseSkillActive,
          canvasContext, // Das Wissen wird mitgeschickt
          attachments: sentAttachments.map(att => ({ name: att.name, type: att.type, url: att.url }))
        }),
        signal: controller.signal
      });

      // Cleanup object URLs to free memory
      sentAttachments.forEach(att => URL.revokeObjectURL(att.url));

      // Reload messages to get final model entry with ids
      await loadMessages(currentSessionId);
      await loadProfileData();
      await loadSessions();
      setTimeout(() => {
        loadSessions();
      }, 1200);
      
      // Update token balance
      if (res.tokenBalance !== undefined) {
        setTokenBalance(res.tokenBalance);
        localStorage.setItem('tokenBalance', String(res.tokenBalance));
      }

      // Live-Manipulation des Canvas durch die KI
      if (res.canvasActions && res.canvasActions.length > 0) {
        console.log('[Miumiverse Skill] KI führt Canvas-Aktionen aus:', res.canvasActions);
        
        let updatedNodes = [...canvasNodes];
        let updatedConnections = [...canvasConnections];

        res.canvasActions.forEach((action: any) => {
          if (action.type === 'CREATE_NODE') {
            const newNode = {
              id: 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              type: action.nodeType || 'note',
              x: action.x !== undefined ? action.x : 100,
              y: action.y !== undefined ? action.y : 100,
              title: action.title || 'Neue Notiz',
              content: action.content || 'Inhalt...',
              color: action.color || '#8B5CF6',
              shape: action.shape || 'rect'
            };
            updatedNodes.push(newNode);
          } else if (action.type === 'CREATE_CONNECTION') {
            // Finde passende Nodes im aktuellen State
            const fromNode = updatedNodes.find(n => n.id === action.from || n.title.toLowerCase().includes(action.from.toLowerCase()));
            const toNode = updatedNodes.find(n => n.id === action.to || n.title.toLowerCase().includes(action.to.toLowerCase()));
            
            if (fromNode && toNode) {
              const newConn = {
                id: 'conn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                from: fromNode.id,
                fromPort: 'output' as const,
                to: toNode.id,
                toPort: 'input' as const
              };
              updatedConnections.push(newConn);
            }
          }
        });

        setCanvasNodes(updatedNodes);
        setCanvasConnections(updatedConnections);

        // Optional: Automatisch Canvas öffnen, damit der User das Resultat sofort sieht!
        setCanvasOpen(true);
      }

      // Check if server returned audio
      if (res.audio) {
        playAudio(res.audio);
      }

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      triggerSystemAlert(`Fehler beim Senden: ${err.message}`);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  const playAudio = (base64String: string) => {
    try {
      const binaryString = window.atob(base64String);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/mp3' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);

      // Stop currently playing audio first
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      }
      activeAudioRef.current = audio;

      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        activeAudioRef.current = null;
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        activeAudioRef.current = null;
      };

      audio.play().catch(e => {
        console.warn('Audio playback failed (browser interaction restrictions):', e);
        setIsSpeaking(false);
        activeAudioRef.current = null;
      });
    } catch (e) {
      console.error('Failed to parse audio payload:', e);
      setIsSpeaking(false);
      activeAudioRef.current = null;
    }
  };

  const stopAudio = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
    setIsSpeaking(false);
    setIsLoading(false);
    setExplainWordPopup(prev => prev ? { ...prev, loading: false } : null);
  };

  if (!token) {
    return (
      <div className="login-wrapper">
        <form className="login-form glass-card" onSubmit={handleLogin}>
          <div className="sharingan-spinner" style={{ margin: '0 auto 20px auto', width: '64px', height: '64px', borderWidth: '4px', boxShadow: '0 0 24px rgba(45, 200, 220, 0.95)' }}>
            <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block', color: '#2dc8dc' }}>
              <circle cx="50" cy="50" r="6.6" fill="currentColor" />
              <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(0 50 50)" />
              <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(60 50 50)" />
              <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(120 50 50)" />
            </svg>
          </div>
          <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>Thaimachine AI</h2>
          {authError && <div className="error-banner">{authError}</div>}
          <input
            type="text"
            placeholder="Nutzername"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Passwort"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ marginTop: '10px' }}
          />
          <button type="submit" className="login-btn">Eintreten</button>
        </form>
      </div>
    );
  }

  const isInspecting = !!localStorage.getItem('adminToken');

  return (
    <>
      {isInspecting && (
        <div className="inspect-banner">
          <span>👁️ <strong>Inspector-Modus aktiv:</strong> Du siehst das Portal als <strong>{profileUsername || email}</strong>.</span>
          <button onClick={handleExitInspectMode} className="exit-inspect-btn">Zurück zu Admin</button>
        </div>
      )}

      {/* Server restart banner — shown when health check fails for >30s */}
      {showRestartBanner && token && (
        <div className="server-restart-banner">
          <div className="server-restart-spinner" />
          <div className="server-restart-text">
            <strong>Server wird gerade neu gestartet</strong>
            <span>Render Free-Tier wacht auf — dauert ca. 30-60 Sekunden...</span>
          </div>
        </div>
      )}

      <div className={`app-container ${!sidebarOpen ? 'clean-mode' : ''} ${isInspecting ? 'inspecting' : ''}`}>
      {systemAlert && (
        <div className="system-alert-overlay">
          <div className="system-alert-card glass-card">
            <div className="system-alert-header">
              <span className="system-alert-icon">{systemAlert.isError ? '⚠️' : 'ℹ️'}</span>
              <h4>{systemAlert.isError ? 'System-Hinweis / Fehler' : 'System-Information'}</h4>
            </div>
            <div className="system-alert-content">
              <p>{systemAlert.message}</p>
            </div>
            <div className="system-alert-actions">
              <button 
                type="button" 
                className="system-alert-btn copy-btn"
                onClick={(e) => {
                  navigator.clipboard.writeText(systemAlert.message);
                  const btn = e.currentTarget;
                  const origText = btn.innerHTML;
                  btn.innerHTML = '✔️ Kopiert!';
                  btn.style.borderColor = '#2dc8dc';
                  btn.style.color = '#2dc8dc';
                  setTimeout(() => {
                    btn.innerHTML = origText;
                    btn.style.borderColor = '';
                    btn.style.color = '';
                  }, 1500);
                }}
              >
                📋 Kopieren
              </button>
              <button 
                type="button" 
                className="system-alert-btn close-btn" 
                onClick={() => setSystemAlert(null)}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header - Completely disappears in clean mode (sidebarOpen === false) */}
      {sidebarOpen && (
        <header className="app-header glass-card">
          <div className="header-left">
            <button 
              className={`sidebar-toggle-btn ${sidebarOpen ? 'active' : ''}`}
              onClick={() => {
                const next = !sidebarOpen;
                setSidebarOpen(next);
                if (next && isMobile()) { setAvatarOpen(false); setSettingsOpen(false); }
              }}
              title="Seitenleiste umschalten"
            >
              ☰
            </button>
            <div 
              className="header-logo select-none"
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchEnd={handleMouseUp}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
              title="Gedrückt halten für Admin Board"
            >
              <div className="sharingan-spinner" style={{ width: '28px', height: '28px', borderWidth: '2.5px', margin: 0, boxShadow: '0 0 10px rgba(45, 200, 220, 0.85)' }}>
                <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block', color: '#2dc8dc' }}>
                  <circle cx="50" cy="50" r="6.6" fill="currentColor" />
                  <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(0 50 50)" />
                  <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(60 50 50)" />
                  <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(120 50 50)" />
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, padding: 0, lineHeight: '1.2' }}>Thaimachine AI</h2>
                <span className="model-badge" style={{ marginTop: '2px' }}>
                  {selectedModel === 'MiniMax-M3' ? 'T.Ai.v3 Active' : selectedModel === 'MiniMax-M2.7-highspeed' ? 'T.Ai.v2.7 Highspeed Active' : selectedModel === 'Duo' ? 'T.Ai. Duo Active' : `${selectedModel} Active`}
                </span>
              </div>
            </div>
          </div>
          <div className="header-meta">
            {deferredPrompt && !window.matchMedia('(display-mode: standalone)').matches && (
              <button onClick={handleInstallApp} className="install-app-btn">
                📥 App installieren
              </button>
            )}
            {currentVersion && (
              <div
                className="version-header-badge"
                title={`Build-Zeit: ${versionBuildTime || 'unbekannt'}`}
              >
                🏷️ v{formatVersionShort(currentVersion)}
                {versionBuildTime && (
                  <span className="version-build-time"> · {formatBuildDate(versionBuildTime)}</span>
                )}
              </div>
            )}
            <div className="token-header-badge" title="Dein Token-Guthaben">
              <span className="token-coin-icon">🪙</span>
              <span className="token-amount">{tokenBalance.toLocaleString()}</span>
            </div>
            {!isAdmin && userNotifications.some((n: any) => !n.read) && (
              <div
                className="inbox-indicator"
                title={`${userNotifications.filter((n: any) => !n.read).length} ungelesene Benachrichtigung(en)`}
                onClick={async () => {
                  const first = userNotifications.find((n: any) => !n.read);
                  if (first) {
                    setShowNotificationsPopup(first);
                    seenNotifIds.add(first.id);
                  }
                  await handleMarkNotificationsRead();
                }}
                style={{
                  background: 'rgba(45, 200, 220, 0.15)',
                  border: '1px solid rgba(45, 200, 220, 0.4)',
                  color: '#2dc8dc',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 'bold'
                }}
              >
                🔔 {userNotifications.filter((n: any) => !n.read).length}
              </div>
            )}
            <span className="user-email">{userEmail}</span>
            <button
              onClick={handleHardReload}
              className="hard-reload-btn"
              title="Cache leeren & Seite neu laden (noCache Reload)"
            >
              🔄 Reload
            </button>
            <button onClick={handleLogout} className="logout-btn">Abmelden</button>
          </div>
        </header>
      )}

      {/* Main Workspace */}
      <div className="workspace-layout" onClick={handleContainerClick}>
        {/* Sidebar */}
        <aside className={`sidebar glass-card ${sidebarOpen ? 'open' : 'closed'}`}>
          {/* Mobile back button */}
          <button
            className="mobile-panel-close-btn"
            onClick={() => setSidebarOpen(false)}
          >
            ◀ Zurück zum Chat
          </button>
          <button 
            className="new-chat-btn" 
            onClick={() => {
              setSettingsOpen(true);
              setActiveSettingsTab(null);
            }} 
            style={{ marginBottom: '8px', background: 'linear-gradient(135deg, rgba(45, 200, 220, 0.25) 0%, rgba(20, 150, 170, 0.15) 100%)', border: '1px solid rgba(45, 200, 220, 0.4)' }}
          >
            ⚙️ Einstellungen
          </button>

          <button className="new-chat-btn" onClick={createNewSession}>
            ➕ Neuer Chat
          </button>

          <div className="sessions-list">
            <h4>Chat Verläufe</h4>
            {sessions.map(s => {
              const isEditing = editingSessionId === s.id;
              if (isEditing) {
                return (
                  <div key={s.id} className="session-item-edit-row">
                    <input
                      type="text"
                      className="session-rename-input"
                      value={editingSessionTitle}
                      onChange={e => setEditingSessionTitle(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          await handleRenameSession(s.id, editingSessionTitle);
                        } else if (e.key === 'Escape') {
                          setEditingSessionId(null);
                        }
                      }}
                      autoFocus
                    />
                    <button className="rename-save-btn" onClick={() => handleRenameSession(s.id, editingSessionTitle)}>✔</button>
                    <button className="rename-cancel-btn" onClick={() => setEditingSessionId(null)}>✕</button>
                  </div>
                );
              }
              return (
                <div key={s.id} className={`session-item-row ${currentSessionId === s.id ? 'active' : ''}`} style={{ display: 'flex', alignItems: 'center', width: '100%', marginBottom: '4px', borderRadius: '8px', background: currentSessionId === s.id ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
                  <button
                    className={`session-item ${currentSessionId === s.id ? 'active' : ''}`}
                    onMouseDown={() => handleSessionPressStart(s.id, s.title)}
                    onMouseUp={handleSessionPressEnd}
                    onMouseLeave={handleSessionPressEnd}
                    onTouchStart={() => handleSessionPressStart(s.id, s.title)}
                    onTouchEnd={handleSessionPressEnd}
                    onClick={() => handleSessionClick(s.id)}
                    title={getSessionTooltip(s)}
                    style={{ flexGrow: 1, textAlign: 'left', border: 'none', background: 'transparent', width: 'auto' }}
                  >
                    💬 {s.title}
                  </button>
                  <button
                    className="delete-session-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Möchtest du diesen Chat wirklich löschen?')) {
                        handleDeleteSession(s.id);
                      }
                    }}
                    title="Chat löschen"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255,255,255,0.3)',
                      cursor: 'pointer',
                      padding: '8px 12px',
                      fontSize: '14px',
                      transition: 'color 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    🗑
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Chat Feed */}
        <main className={`chat-feed-wrapper glass-card ${sidebarOpen ? 'with-sidebar' : 'full-width'} ${avatarWide && avatarOpen ? 'hidden-by-avatar-fullscreen' : ''}`}>
          {currentSessionId ? (
            <div className="feed-container" style={{ position: 'relative' }}>
              {canvasOpen ? (
                <div className="canvas-frame-container" style={{ width: '100%', height: 'calc(100% - 80px)', position: 'relative', overflow: 'hidden', borderRadius: '12px 12px 0 0' }}>
                  <MiuniverseCanvas
                    nodes={canvasNodes}
                    setNodes={setCanvasNodes}
                    connections={canvasConnections}
                    setConnections={setCanvasConnections}
                    workMode={canvasWorkMode}
                    onWorkModeChange={(mode) => {
                      setCanvasWorkMode(mode);
                      localStorage.setItem('miuniverse_canvas_workmode', mode);
                    }}
                    shortcutMap={shortcutMap}
                  />
                </div>
              ) : (
                <div 
                  className="messages-log" 
                  onMouseDown={handleMouseDownText}
                  onMouseUp={handleMouseUpTextSelection}
                  onTouchEnd={handleMouseUpTextSelection}
                  onDoubleClick={handleDoubleClickText}
                  style={{ height: 'calc(100% - 60px)' }}
                >
                  {messages.length === 0 && (
                    <div className="welcome-center">
                      <div className="welcome-logo-container">
                        <div className="sharingan-spinner welcome-sharingan" style={{ width: '80px', height: '80px', borderWidth: '3px', margin: '0 auto', boxShadow: '0 0 25px rgba(45, 200, 220, 0.6)' }}>
                          <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block', color: '#2dc8dc' }}>
                            <circle cx="50" cy="50" r="6.6" fill="currentColor" />
                            <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(0 50 50)" />
                            <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(60 50 50)" />
                            <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(120 50 50)" />
                          </svg>
                        </div>
                        <h3 className="welcome-title">Thaimachine AI</h3>
                        <div className={`api-status-badge ${apiOnline ? 'online' : 'connecting'}`}>
                          <span className="status-dot" />
                          {apiOnline ? 'Wir sind online' : 'Verbindung wird hergestellt...'}
                        </div>
                      </div>
                    </div>
                  )}
                  {messages.map((m, idx) => (
                    <MessageBubble 
                      key={m.id || idx} 
                      role={m.role} 
                      content={m.content} 
                      highlightWord={explainWordPopup?.word}
                    />
                  ))}
                  {isLoading && (
                    <div className="message-row assistant loading-bubble">
                      <div className="avatar-tag">KI</div>
                      <div className="message-content">Generiere Antwort...</div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
              <div className="chat-input-wrapper">
                <div className="chat-input-toolbar">
                  {/* Neuer Chat Button */}
                  <button
                    type="button"
                    onClick={createNewSession}
                    className="toolbar-btn new-chat-btn-toolbar"
                    title="Neuen Chat starten"
                  >
                    {sidebarOpen ? '➕ Neuer Chat' : '➕'}
                  </button>

                  {/* Model switcher dropdown */}
                  <div className="model-selector-wrapper">
                    <button
                      type="button"
                      className={`toolbar-btn model-select-btn ${selectedModel === 'Duo' ? 'active' : ''}`}
                      onClick={() => {
                        if (isLongPressActive.current) return;
                        setModelDropdownOpen(!modelDropdownOpen);
                      }}
                      onMouseDown={startLongPress}
                      onMouseUp={endLongPress}
                      onMouseLeave={endLongPress}
                      onTouchStart={startLongPress}
                      onTouchEnd={endLongPress}
                      title="Modell wechseln (2s gedrückt halten für Gemini)"
                    >
                      {sidebarOpen ? (
                        <>
                          {selectedModel === 'MiniMax-M3' ? '🧠 T.Ai.v3' : 
                           selectedModel === 'MiniMax-M2.7-highspeed' ? '⚡ T.Ai.v2.7 Highspeed' : 
                           selectedModel === 'Duo' ? '👥 T.Ai. Duo' : 
                           selectedModel === 'gemini-2.5-pro' ? '✨ G-2.5 Pro' : '⚡ G-2.5 Flash'}
                        </>
                      ) : (
                        <>
                          {selectedModel === 'MiniMax-M3' ? '🧠' : 
                           selectedModel === 'MiniMax-M2.7-highspeed' ? '⚡' : 
                           selectedModel === 'Duo' ? '👥' : 
                           selectedModel === 'gemini-2.5-pro' ? '✨' : '⚡'}
                        </>
                      )}
                    </button>
                    {modelDropdownOpen && (
                      <div className="model-dropdown-popover glass-card" style={{ width: '220px', bottom: '34px', left: '0', right: 'auto' }}>
                        <button
                          type="button"
                          className={`model-option-btn ${selectedModel === 'Duo' ? 'active' : ''}`}
                          data-tooltip="Duo-Mode: M2.7 antwortet sofort, M3 führt parallel eine tiefe Internetsuche durch."
                          onClick={() => {
                            setSelectedModel('Duo');
                            setModelDropdownOpen(false);
                          }}
                        >
                          👥 T.Ai. Duo
                        </button>
                        <button
                          type="button"
                          className={`model-option-btn ${selectedModel === 'MiniMax-M3' ? 'active' : ''}`}
                          data-tooltip="Ich denke hier gründlicher nach."
                          onClick={() => {
                            setSelectedModel('MiniMax-M3');
                            setModelDropdownOpen(false);
                          }}
                        >
                          🧠 T.Ai.v3
                        </button>
                        <button
                          type="button"
                          className={`model-option-btn ${selectedModel === 'MiniMax-M2.7-highspeed' ? 'active' : ''}`}
                          data-tooltip="Highspeed-Modell für superschnelle Antworten ohne lange Denkpause"
                          onClick={() => {
                            setSelectedModel('MiniMax-M2.7-highspeed');
                            setModelDropdownOpen(false);
                          }}
                        >
                          ⚡ T.Ai.v2.7 Highspeed
                        </button>
                        
                        {showGemini && (
                          <>
                            <div className="model-dropdown-divider" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '4px 0' }}></div>
                            
                            <button
                              type="button"
                              className={`model-option-btn ${selectedModel === 'gemini-2.5-pro' ? 'active' : ''}`}
                              data-tooltip="Neuestes Gemini 2.5 Pro Modell für komplexe Logik"
                              onClick={() => {
                                setSelectedModel('gemini-2.5-pro');
                                setModelDropdownOpen(false);
                              }}
                            >
                              ✨ Gemini 2.5 Pro
                            </button>
                            <button
                              type="button"
                              className={`model-option-btn ${selectedModel === 'gemini-2.5-flash' ? 'active' : ''}`}
                              data-tooltip="Neuestes, superschnelles Gemini 2.5 Flash Modell"
                              onClick={() => {
                                setSelectedModel('gemini-2.5-flash');
                                setModelDropdownOpen(false);
                              }}
                            >
                              ⚡ Gemini 2.5 Flash
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
 
                  {/* Skill Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      const next = !miumiverseSkillActive;
                      setMiumiverseSkillActive(next);
                      localStorage.setItem('miumiverseSkillActive', String(next));
                    }}
                    className={`toolbar-btn miumiverse-toggle-btn ${miumiverseSkillActive ? 'active' : ''}`}
                    title="Skill Miumiverse aktivieren (KI liest Canvas-Zustand)"
                  >
                    {sidebarOpen ? '🧩 Skill: Miumiverse' : '🧩'}
                  </button>
 
                  {/* Canvas Button */}
                  <button
                    type="button"
                    onClick={() => setCanvasOpen(!canvasOpen)}
                    className={`toolbar-btn canvas-toggle-btn ${canvasOpen ? 'active' : ''}`}
                    title="Canvas-Ansicht umschalten"
                  >
                    {sidebarOpen ? (canvasOpen ? '📊 Canvas ausblenden' : '📊 Canvas einblenden') : '📊'}
                  </button>
                </div>

                {/* File Input */}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleFileChange} 
                  multiple 
                />

                {/* Previews of attachments */}
                {attachments.length > 0 && (
                  <div className="chat-attachments-preview">
                    {attachments.map(att => (
                      <div key={att.id} className="attachment-preview-item">
                        {att.type === 'image' ? (
                          <img src={att.url} alt={att.name} />
                        ) : att.type === 'video' ? (
                          <span style={{ fontSize: '18px' }}>🎥</span>
                        ) : (
                          <span style={{ fontSize: '18px' }}>📁</span>
                        )}
                        <span className="attachment-name" style={{ fontSize: '11px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#ccc' }}>{att.name}</span>
                        <button 
                          type="button" 
                          className="remove-btn"
                          onClick={() => {
                            setAttachments(prev => prev.filter(x => x.id !== att.id));
                            URL.revokeObjectURL(att.url);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form className="chat-input-row" onSubmit={handleSendMessage} style={{ background: 'transparent', borderTop: 'none', padding: '0', position: 'relative' }}>
                  {/* Arrow Left: Toggle settings / sidebar */}
                  <button
                    type="button"
                    className="arrow-toggle-btn left-arrow"
                    onClick={() => {
                      const next = !sidebarOpen;
                      setSidebarOpen(next);
                      if (next && isMobile()) { setAvatarOpen(false); setSettingsOpen(false); }
                    }}
                    title={sidebarOpen ? "Seitenleiste ausblenden" : "Seitenleiste einblenden"}
                  >
                    {sidebarOpen ? '◀' : '▶'}
                  </button>
  
                  <div 
                    className={`chat-textarea-container ${inputExpanded ? 'expanded' : ''}`}
                    style={{
                      position: 'relative',
                      flexGrow: 1,
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                  >
                    {/* Expand Chevron Arrow */}
                    {(input.split('\n').length > 1 || (textareaRef.current && textareaRef.current.scrollHeight > 50) || inputExpanded) && (
                      <div 
                        className="chat-input-expand-arrow" 
                        onMouseDown={handleDragStart}
                        onClick={() => setInputExpanded(!inputExpanded)}
                        title={inputExpanded ? "Verkleinern" : "Aufziehen / Vollbild"}
                      >
                        {inputExpanded ? '▼' : '▲'}
                      </div>
                    )}

                    {/* Font controls in fullscreen mode */}
                    {inputExpanded && (
                      <div className="chat-input-font-controls">
                        <button type="button" onClick={() => setInputFontSize(prev => Math.max(10, prev - 2))}>-</button>
                        <button type="button" onClick={() => setInputFontSize(16)}>0</button>
                        <button type="button" onClick={() => setInputFontSize(prev => Math.min(32, prev + 2))}>+</button>
                      </div>
                    )}

                    <textarea
                      ref={textareaRef}
                      placeholder="Schreibe eine Nachricht..."
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePasteImage}
                      onFocus={() => setIsInputFocused(true)}
                      onBlur={() => setIsInputFocused(false)}
                      disabled={isLoading}
                      rows={1}
                      style={{
                        fontSize: `${inputFontSize}px`,
                        height: inputExpanded 
                          ? (inputHeight ? `${inputHeight}px` : 'calc(100vh - 180px)')
                          : (isInputFocused && (input.split('\n').length > 1 || (textareaRef.current && textareaRef.current.scrollHeight > 50)) ? '96px' : (input.split('\n').length > 1 ? '96px' : '48px')),
                        paddingTop: '12px',
                        paddingBottom: '12px',
                        resize: 'none',
                        overflowY: 'auto'
                      }}
                    />
                  </div>
  
                  {(isSpeaking || isLoading || (explainWordPopup && explainWordPopup.loading)) && (
                    <button
                      type="button"
                      className="stop-speech-btn"
                      onClick={stopAudio}
                      title="KI stoppen (Generierung & Audio abbrechen)"
                      style={{
                        background: 'rgba(255, 75, 75, 0.2)',
                        border: '1px solid rgba(255, 75, 75, 0.4)',
                        color: '#ff4b4b',
                        borderRadius: '8px',
                        padding: '0 12px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        boxShadow: '0 0 10px rgba(255, 75, 75, 0.2)',
                        height: '48px',
                        marginRight: '4px',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      ⏹ Stopp
                    </button>
                  )}

                  {/* Model Switcher - Apple Toggle Style */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginRight: '4px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: '2px' }}>🤖</span>
                    <button
                      type="button"
                      onClick={() => {
                        const modelMap: Record<string, string> = { Agnes: 'Agnes-Flash-2.0', DeepSeek: 'deepseek-chat', Gemini: 'gemini-1.5-flash', BytePlus: 'byteplus', 'MiniMax-M3': 'MiniMax-M3' };
                        const displayModels = enabledModels.length > 0 ? enabledModels : ['MiniMax-M3'];
                        const idx = displayModels.indexOf(selectedModel);
                        const next = displayModels[(idx + 1) % displayModels.length];
                        const backendName = modelMap[next] || next;
                        setSelectedModel(backendName);
                        localStorage.setItem('selectedModel', backendName);
                      }}
                      style={{
                        padding: '0 10px',
                        borderRadius: '16px',
                        border: '1px solid rgba(45,200,220,0.3)',
                        background: 'rgba(45,200,220,0.1)',
                        color: '#2dc8dc',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        maxHeight: '32px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title="Klicke zum Wechseln: " + (enabledModels.length > 0 ? enabledModels.join(', ') : 'MiniMax-M3')
                    >
                      {selectedModel}
                    </button>
                  </div>

                  {/* 3-dots Menu Button */}
                  <div ref={attachmentMenuRef} className="chat-input-attachment-menu-container" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="three-dots-btn"
                      onClick={() => setIsAttachmentMenuOpen(!isAttachmentMenuOpen)}
                      title="Dateien, Bilder oder Videos anhängen"
                    >
                      •••
                    </button>
                    {isAttachmentMenuOpen && (
                      <div className="three-dots-dropdown glass-card">
                        <button type="button" onClick={() => triggerFileSelect('image/*')}>🖼️ Bild anhängen</button>
                        <button type="button" onClick={() => triggerFileSelect('video/*')}>🎥 Video anhängen</button>
                        <button type="button" onClick={() => triggerFileSelect('*/*')}>📁 Datei anhängen</button>
                      </div>
                    )}
                  </div>

                  <button type="submit" className="send-btn" disabled={isLoading || (!input.trim() && attachments.length === 0)}>
                    Senden
                  </button>
  
                  {/* Arrow Right: Toggle avatar capsule */}
                  <button
                    type="button"
                    className="arrow-toggle-btn right-arrow"
                    onClick={() => {
                      const next = !avatarOpen;
                      setAvatarOpen(next);
                      if (next && isMobile()) { setSidebarOpen(false); setSettingsOpen(false); }
                    }}
                    title={avatarOpen ? "Avatar ausblenden" : "Avatar einblenden"}
                  >
                    {avatarOpen ? '▶' : '◀'}
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="no-chat-prompt">
              {!apiOnline ? (
                <>
                  <h3>⏳ Backend wird geladen…</h3>
                  <p>Der Server ist gerade nicht erreichbar (Render Free-Tier startet).<br/>Dies dauert ca. 30-60 Sekunden.</p>
                  <div className="loading-dots">
                    <span></span><span></span><span></span>
                  </div>
                </>
              ) : !token ? (
                <>
                  <h3>🔐 Bitte einloggen</h3>
                  <p>Du musst eingeloggt sein, um einen Chat zu starten.</p>
                  <button
                    type="button"
                    className="new-chat-btn"
                    onClick={handleLogout}
                    style={{ marginTop: '16px', maxWidth: '200px', display: 'flex', gap: '8px', alignSelf: 'center' }}
                  >
                    🔑 Zum Login
                  </button>
                </>
              ) : (
                <>
                  <h3>Bereit zum Start</h3>
                  <p>Erstelle einen neuen Chat, um mit T-AI zu sprechen.</p>
                  <button
                    type="button"
                    className="new-chat-btn"
                    onClick={createNewSession}
                    style={{ marginTop: '16px', maxWidth: '200px', display: 'flex', gap: '8px', alignSelf: 'center' }}
                  >
                    ➕ Neuen Chat starten
                  </button>
                </>
              )}
            </div>
          )}
        </main>

        {/* Avatar Sidebar */}
        <section className={`avatar-panel ${avatarOpen ? 'open' : 'closed'} ${avatarWide ? 'wide' : ''}`}>
          {/* Mobile back button */}
          <button
            className="mobile-panel-close-btn mobile-avatar-close"
            onClick={() => setAvatarOpen(false)}
          >
            ◀ Zurück zum Chat
          </button>
          <VideoAvatar 
            isSpeaking={isSpeaking} 
            isLoading={isLoading} 
            overlayItems={overlayItems}
            onCloseOverlay={() => setOverlayItems([])}
            activePanelUrl={activePanelUrl}
            setActivePanelUrl={setActivePanelUrl}
            onSummarize={handleSummarizeUrl}
            isSummarizing={isSummarizing}
            avatarWide={avatarWide}
            setAvatarWide={setAvatarWide}
            onStopAudio={stopAudio}
          />
        </section>
      </div>

      {/* Fullscreen Settings Overlay */}
      {settingsOpen && (
        <div className="fullscreen-settings-overlay">
          <div className="settings-window glass-card">
            {/* Left Column: Apple-like Settings Menu */}
            <div className="settings-sidebar">
              <div className="settings-sidebar-header">
                <h2>Einstellungen</h2>
              </div>
              <div className="settings-nav-list">
                <button
                  className={`settings-nav-item ${activeSettingsTab === 'profile' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('profile')}
                >
                  👤 Profil & Persona
                </button>
                <button
                  className={`settings-nav-item ${activeSettingsTab === 'token' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('token')}
                >
                  🪙 Token & Limits
                </button>
                <button
                  className={`settings-nav-item ${activeSettingsTab === 'skills' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('skills')}
                >
                  🧩 Skills & Module
                </button>
                <button
                  className={`settings-nav-item ${activeSettingsTab === 'system' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('system')}
                >
                  ⚙️ System & Design
                </button>
                {isAdmin && (
                  <button
                    className={`settings-nav-item ${activeSettingsTab === 'admin' ? 'active' : ''}`}
                    onClick={() => setActiveSettingsTab('admin')}
                  >
                    🧠 Gedächtnis
                  </button>
                )}
                <button
                  className={`settings-nav-item ${activeSettingsTab === 'canvas' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('canvas')}
                >
                  ⌨️ Canvas Shortcuts
                </button>
                <button
                  className="settings-nav-item"
                  onClick={() => {
                    setSettingsOpen(false);
                    handleLogout();
                  }}
                  style={{
                    color: '#ff4b4b',
                    border: '1px solid rgba(255, 75, 75, 0.25)',
                    background: 'rgba(255, 75, 75, 0.05)',
                    marginTop: '16px',
                    fontWeight: '600'
                  }}
                >
                  🚪 Abmelden
                </button>
              </div>
              <button className="settings-done-btn" onClick={() => setSettingsOpen(false)}>
                Fertig
              </button>
            </div>

            {/* Right Column: Settings Content */}
            <div className="settings-content">
              {activeSettingsTab === null && (
                <div className="settings-welcome-placeholder">
                  <div className="welcome-hud-logo">🐱</div>
                  <h3>Willkommen in den Einstellungen</h3>
                  <p>Wähle links eine Rubrik aus, um deine Präferenzen, Persona oder Systemoptionen anzupassen.</p>
                </div>
              )}

              {activeSettingsTab === 'profile' && (
                <div className="settings-section">
                  <h3>👤 Profil & Persona</h3>
                  
                  {!profileUsername ? (
                    <div className="username-popup-card glass-card">
                      <div className="welcome-hud-logo popup-logo">🐱</div>
                      <h3>Hi, mit wem rede ich?</h3>
                      <p>Trage bitte deinen Spitznamen oder Namen ein, um fortzufahren.</p>
                      <div className="username-input-row">
                        <input 
                          type="text" 
                          placeholder="Dein Spitzname / Nickname" 
                          value={tempUsername}
                          onChange={e => setTempUsername(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              await handleSaveUsername();
                            }
                          }}
                          autoFocus
                        />
                        <button onClick={handleSaveUsername}>Speichern</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="profile-welcome-card glass-card">
                        <h4>Prima, schön dich kennen zu lernen, <span className="highlight-username">{profileUsername}</span>.</h4>
                        <p className="welcome-subtitle">Schön, dass du da bist! 🌟</p>
                        <p>Damit ich dich optimal unterstützen und perfekt auf deine Bedürfnisse eingehen kann, hast du hier die Möglichkeit, ein paar Angaben mit mir zu teilen. Keine Sorge: Ob und wie viel du von dir erzählen möchtest, bleibt ganz allein dir überlassen.</p>
                        
                        <div className="data-privacy-badge">
                          <strong>Deine Daten gehören dir:</strong> Alle Angaben werden ausschließlich für deine internen Suchanfragen genutzt und niemals veröffentlicht oder weitergegeben.
                        </div>

                        <div className="why-benefits-box">
                          <h5>Warum hilft mir das?</h5>
                          <ul>
                            <li><strong>Lokale Relevanz:</strong> Wenn du nach dem Wetter fragst, weiß ich sofort, für welchen Ort der Welt du die Vorhersage brauchst.</li>
                            <li><strong>Präzise Recherche:</strong> Ich kann Suchergebnisse und wissenschaftliche Daten speziell auf deine Region und deine Umgebung abstimmen.</li>
                            <li><strong>Veranstaltungen direkt vor Ort:</strong> Egal ob Flohmarkt, Kirmes, Konzerte oder lokale Events – ich finde genau das, was in deiner Nähe passiert.</li>
                          </ul>
                        </div>
                        
                        <p className="welcome-footer-desc">Lass uns deine KI-Erfahrung persönlicher und effizienter gestalten!</p>
                      </div>

                      <div className="profile-fields-grid" style={{ marginTop: '24px' }}>
                        <div className="form-group">
                          <label>Spitzname / Name:</label>
                          <input 
                            type="text" 
                            value={profileUsername} 
                            onChange={e => {
                              setProfileUsername(e.target.value);
                              setTempUsername(e.target.value);
                            }} 
                            placeholder="Dein Spitzname"
                            className="profile-input"
                          />
                        </div>

                        <div className="form-group">
                          <label>Wohnort:</label>
                          <input 
                            type="text" 
                            value={profileWohnort} 
                            onChange={e => setProfileWohnort(e.target.value)} 
                            placeholder="z. B. Berlin"
                            className="profile-input"
                          />
                        </div>
                        
                        <div className="form-group">
                          <label>Adresse:</label>
                          <input 
                            type="text" 
                            value={profileAdresse} 
                            onChange={e => setProfileAdresse(e.target.value)} 
                            placeholder="Straße, Hausnummer"
                            className="profile-input"
                          />
                        </div>
                        
                        <div className="form-group">
                          <label>Telefon:</label>
                          <input 
                            type="text" 
                            value={profileTelefon} 
                            onChange={e => setProfileTelefon(e.target.value)} 
                            placeholder="Telefonnummer"
                            className="profile-input"
                          />
                        </div>

                        <div className="form-group">
                          <label>Beruf / Arbeit:</label>
                          <input 
                            type="text" 
                            value={profileBeruf} 
                            onChange={e => setProfileBeruf(e.target.value)} 
                            placeholder="Was arbeitest du?"
                            className="profile-input"
                          />
                        </div>

                        <div className="form-group auto-live-group">
                          <label>Auto / Live Standorterkennung:</label>
                          <div className="auto-live-toggle-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
                            <button
                              type="button"
                              className={`auto-live-btn ${profileAutoLive ? 'active' : ''}`}
                              onClick={handleToggleAutoLive}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px 16px',
                                borderRadius: '8px',
                                border: profileAutoLive ? '1px solid rgba(255, 99, 132, 0.4)' : '1px solid rgba(255, 255, 255, 0.15)',
                                background: profileAutoLive ? 'rgba(255, 99, 132, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                color: profileAutoLive ? '#ff6384' : '#888',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                transition: 'all 0.3s ease'
                              }}
                            >
                              {profileAutoLive && (
                                <span 
                                  className="live-pulse-dot" 
                                  style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: '#ff6384',
                                    boxShadow: '0 0 8px #ff6384',
                                    display: 'inline-block',
                                    animation: 'pulse 1.5s infinite'
                                  }}
                                />
                              )}
                              {profileAutoLive ? '🔴 LIVE AKTIV' : '⚪ AUS'}
                            </button>
                            <span className="location-coords" style={{ color: '#aaa', fontSize: '0.9rem' }}>
                              {profileLatitude && profileLongitude 
                                ? `📍 ${profileLatitude.toFixed(4)}, ${profileLongitude.toFixed(4)}` 
                                : 'Kein Standort'}
                            </span>
                          </div>
                        </div>

                        <div className="form-group full-width">
                          <label>Mein Mindset:</label>
                          <textarea 
                            value={profileMindset} 
                            onChange={e => setProfileMindset(e.target.value)} 
                            placeholder="Lebensphilosophie, Lebenseinstellung..."
                          />
                        </div>

                        <div className="form-group full-width">
                          <label>Persönliche Beschreibung (Wer bin ich):</label>
                          <textarea 
                            value={profileBio} 
                            onChange={e => setProfileBio(e.target.value)} 
                            placeholder="Kurze Biografie..."
                          />
                        </div>

                        <div className="form-group full-width">
                          <label>KI-Profil-Memory (Zusammenfassung):</label>
                          <textarea 
                            value={profileMemory} 
                            readOnly 
                            placeholder="Wird nach dem Profiling-Chat automatisch generiert..."
                            className="readonly-textarea"
                          />
                        </div>
                      </div>

                      <div className="settings-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button className="save-btn-settings" onClick={handleSaveProfileData}>
                          Profil Speichern
                        </button>
                        <button 
                          className="save-btn-settings profiling-btn" 
                          onClick={() => {
                            setSettingsOpen(false);
                            startProfilingSession();
                          }}
                        >
                          💬 Profiling starten
                        </button>
                        
                        <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', margin: '15px 0' }} />
                        
                        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                          <button
                            className="save-btn-settings admin-save-btn"
                            style={{ margin: 0, background: 'rgba(6, 182, 212, 0.15)', border: '1px solid rgba(6, 182, 212, 0.3)', color: '#2dd4e6' }}
                            onClick={() => {
                              const config = {
                                nodes: canvasNodes,
                                connections: canvasConnections
                              };
                              const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `miuniverse_canvas_${currentSessionId || 'export'}.json`;
                              a.click();
                              URL.revokeObjectURL(url);
                              triggerSystemAlert("Canvas-Layout erfolgreich exportiert! 💾", false);
                            }}
                          >
                            📤 Canvas Exportieren
                          </button>
                          
                          <label
                            className="save-btn-settings admin-save-btn"
                            style={{ margin: 0, textAlign: 'center', cursor: 'pointer', background: 'rgba(52, 211, 153, 0.15)', border: '1px solid rgba(52, 211, 153, 0.3)', color: '#34d399', display: 'inline-block' }}
                          >
                            📥 Canvas Importieren
                            <input
                              type="file"
                              accept=".json"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = (event) => {
                                  try {
                                    const parsed = JSON.parse(event.target?.result as string);
                                    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.connections)) {
                                      setCanvasNodes(parsed.nodes);
                                      setCanvasConnections(parsed.connections);
                                      triggerSystemAlert("Canvas-Layout erfolgreich importiert! 📥", false);
                                    } else {
                                      triggerSystemAlert("Ungültiges Canvas-Format!");
                                    }
                                  } catch (err: any) {
                                    triggerSystemAlert("Fehler beim Importieren: " + err.message);
                                  }
                                };
                                reader.readAsText(file);
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeSettingsTab === 'token' && (
                <div className="settings-section">
                  <h3>🪙 Token & Limits</h3>
                  {isAdmin ? (
                    <>
                      <p className="settings-section-desc">Überprüfe das verbleibende Kontingent deiner MiniMax-Verbindung oder trage einen eigenen API-Key ein.</p>

                      <div className="form-group full-width">
                        <label>Eigener MiniMax API Key (Überschreiben):</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input 
                            type="password" 
                            value={customMinimaxKey} 
                            onChange={e => {
                              setCustomMinimaxKey(e.target.value);
                              localStorage.setItem('customMinimaxKey', e.target.value);
                            }} 
                            placeholder="sk-cp-..."
                            style={{ flexGrow: 1 }}
                          />
                          <button 
                            className="save-btn-settings" 
                            style={{ margin: 0, padding: '10px 16px' }}
                            onClick={() => fetchMinimaxBalance()}
                          >
                            Prüfen
                          </button>
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Leer lassen, um den vom Server standardmäßig bereitgestellten API-Key zu nutzen.
                        </p>
                      </div>

                      <div className="token-balance-hud-card">
                        <h4>Live MiniMax Status</h4>
                        {isFetchingBalance && (
                          <div className="token-balance-loader">
                            <span className="balance-spinner"></span>
                            Frage Server ab...
                          </div>
                        )}
                        {balanceError && (
                          <div className="token-balance-error">
                            {balanceError}
                          </div>
                        )}
                        {!isFetchingBalance && !balanceError && minimaxBalanceData && (
                          <div className="token-metrics-layout">
                            {/* Token Plan card */}
                            {minimaxBalanceData.tokenPlan && minimaxBalanceData.tokenPlan.remains && minimaxBalanceData.tokenPlan.remains[0] && (
                              <div className="metric-box">
                                <span className="metric-label">Verbleibendes Guthaben</span>
                                <span className="metric-value">
                                  {parseInt(minimaxBalanceData.tokenPlan.remains[0].remains || '0').toLocaleString()} Tokens
                                </span>
                                <span className="metric-sub">
                                  Plan: {minimaxBalanceData.tokenPlan.remains[0].plan_name || 'Standard'}
                                </span>
                              </div>
                            )}

                            {/* Coding Plan card */}
                            {minimaxBalanceData.codingPlan && minimaxBalanceData.codingPlan.current_interval_total_count && (
                              <>
                                <div className="metric-box">
                                  <span className="metric-label">5-Stunden Auslastung</span>
                                  <span className="metric-value">
                                    {minimaxBalanceData.codingPlan.current_interval_usage_count || 0} / {minimaxBalanceData.codingPlan.current_interval_total_count}
                                  </span>
                                  <div className="progress-bar-container">
                                    <div 
                                      className="progress-fill" 
                                      style={{ width: `${Math.min(100, Math.round(((minimaxBalanceData.codingPlan.current_interval_usage_count || 0) / (minimaxBalanceData.codingPlan.current_interval_total_count || 1)) * 100))}%` }}
                                    ></div>
                                  </div>
                                  <span className="metric-sub">
                                    {Math.round(((minimaxBalanceData.codingPlan.current_interval_usage_count || 0) / (minimaxBalanceData.codingPlan.current_interval_total_count || 1)) * 100)}% benutzt
                                  </span>
                                </div>

                                <div className="metric-box">
                                  <span className="metric-label">Wöchentliches Limit</span>
                                  <span className="metric-value">
                                    {minimaxBalanceData.codingPlan.weekly_usage_count || 0} / {minimaxBalanceData.codingPlan.weekly_total_count}
                                  </span>
                                  <div className="progress-bar-container">
                                    <div 
                                      className="progress-fill weekly-fill" 
                                      style={{ width: `${Math.min(100, Math.round(((minimaxBalanceData.codingPlan.weekly_usage_count || 0) / (minimaxBalanceData.codingPlan.weekly_total_count || 1)) * 100))}%` }}
                                    ></div>
                                  </div>
                                  <span className="metric-sub">
                                    {Math.round(((minimaxBalanceData.codingPlan.weekly_usage_count || 0) / (minimaxBalanceData.codingPlan.weekly_total_count || 1)) * 100)}% benutzt
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {!isFetchingBalance && !balanceError && !minimaxBalanceData && (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Keine Daten geladen. Klicke auf "Prüfen", um deinen API Key zu validieren.</p>
                        )}
                      </div>
                    </>

                    {/* MULTI-MODEL CONFIG PANEL */}
                    <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(45,200,220,0.15)' }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: 'var(--accent-cyan)' }}>🤖 Multi-Model Konfiguration</h4>
                      <p className="settings-section-desc" style={{ marginBottom: '16px' }}>Wähle das Hauptmodell und aktiviere/deaktiviere verfügbare KI-Modelle.</p>

                      {/* Agnes API Key */}
                      <div className="form-group full-width">
                        <label>Agnes Flash 2.0 API Key:</label>
                        <input
                          type="password"
                          value={agnesApiKey}
                          onChange={e => setAgnesApiKey(e.target.value)}
                          placeholder="cpk-..."
                          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(45,200,220,0.3)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '0.9rem' }}
                        />
                      </div>

                      {/* Hauptmodell Selector */}
                      <div className="form-group full-width">
                        <label>Hauptmodell:</label>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {['MiniMax-M3', 'Agnes', 'DeepSeek', 'Gemini', 'BytePlus'].map(m => {
                            const available = enabledModels.includes(m);
                            return (
                              <button
                                key={m}
                                type="button"
                                disabled={!available}
                                onClick={() => setMainModel(m)}
                                style={{
                                  padding: '8px 16px',
                                  borderRadius: '20px',
                                  border: mainModel === m ? '2px solid #2dc8dc' : '1px solid rgba(45,200,220,0.3)',
                                  background: mainModel === m ? 'rgba(45,200,220,0.15)' : 'rgba(255,255,255,0.03)',
                                  color: available ? (mainModel === m ? '#2dc8dc' : '#ccc') : '#555',
                                  cursor: available ? 'pointer' : 'not-allowed',
                                  fontSize: '0.85rem',
                                  fontWeight: mainModel === m ? 'bold' : 'normal',
                                  transition: 'all 0.2s',
                                  opacity: available ? 1 : 0.4,
                                  textDecoration: mainModel === m ? 'underline' : 'none',
                                  textUnderlineOffset: '4px'
                                }}
                              >
                                {m}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Enabled Models Toggle - Apple Style Switches */}
                      <div className="form-group full-width">
                        <label>Modelle aktivieren/deaktivieren:</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
                          {['MiniMax-M3', 'Agnes', 'DeepSeek', 'Gemini', 'BytePlus'].map(m => {
                            const on = enabledModels.includes(m);
                            return (
                              <div key={m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
                                <span style={{ color: '#ccc', fontSize: '0.9rem' }}>{m}</span>
                                <button
                                  type="button"
                                  onClick={() => toggleModel(m)}
                                  style={{
                                    width: '44px',
                                    height: '24px',
                                    borderRadius: '12px',
                                    border: 'none',
                                    background: on ? '#2dc8dc' : 'rgba(255,255,255,0.15)',
                                    cursor: 'pointer',
                                    position: 'relative',
                                    transition: 'background 0.3s',
                                    flexShrink: 0
                                  }}
                                >
                                  <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    left: on ? '22px' : '2px',
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '50%',
                                    background: '#fff',
                                    transition: 'left 0.3s',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                                  }}></span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Save Button */}
                      <div className="settings-actions" style={{ marginTop: '20px' }}>
                        <button
                          className="save-btn-settings"
                          onClick={handleSaveModelConfig}
                          disabled={modelSaving}
                          style={{ minWidth: '160px' }}
                        >
                          {modelSaving ? '⏳ Speichern...' : '💾 Model-Konfiguration speichern'}
                        </button>
                      </div>
                      {modelSaveMsg && (
                        <div style={{
                          marginTop: '12px',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          background: modelSaveMsg.ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                          color: modelSaveMsg.ok ? '#10b981' : '#ef4444',
                          fontSize: '0.85rem'
                        }}>
                          {modelSaveMsg.text}
                        </div>
                      )}
                    </div>
                  </>
                  ) : (
                    <>
                      <p className="settings-section-desc">Übersicht über dein verbleibendes Token-Budget für diesen Monat.</p>
                      
                      <div className="token-balance-hud-card" style={{ marginTop: '16px' }}>
                        <div className="token-metrics-layout" style={{ gridTemplateColumns: '1fr' }}>
                          <div className="metric-box" style={{ padding: '24px', textAlign: 'center' }}>
                            <span className="metric-label" style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Verbleibendes Guthaben</span>
                            <span className="metric-value" style={{ fontSize: '2rem', display: 'block', margin: '12px 0 6px 0', color: 'var(--accent-cyan)' }}>
                              {tokenBalance.toLocaleString()} Tokens
                            </span>
                            <span className="metric-sub" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Dein Guthaben wird automatisch am 1. des nächsten Monats wieder auf 1.000.000 Tokens aufgeladen.
                            </span>
                            <div className="progress-bar-container" style={{ marginTop: '16px', height: '10px' }}>
                              <div 
                                className="progress-fill" 
                                style={{ 
                                  width: `${Math.min(100, Math.round((tokenBalance / 1000000) * 100))}%`, 
                                  background: 'linear-gradient(90deg, #10b981, #2dc8dc)' 
                                }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeSettingsTab === 'skills' && (
                <div className="settings-section">
                  <h3>🧩 Skills & Module</h3>
                  <p className="settings-section-desc">Aktiviere oder deaktiviere die intelligenten Spezial-Skills der KI.</p>

                  <div className="toggle-list">
                    <div className="setting-toggle-card">
                      <label className="checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={youtubeSkillActive} 
                          onChange={(e) => {
                            setYoutubeSkillActive(e.target.checked);
                            localStorage.setItem('youtubeSkillActive', String(e.target.checked));
                          }} 
                        />
                        <span className="toggle-title">YouTube Video-Finder Skill</span>
                      </label>
                      <p className="toggle-desc">sucht passende Videos als Quelle</p>
                    </div>

                    <div className="setting-toggle-card">
                      <label className="checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={webSearchSkillActive} 
                          onChange={(e) => {
                            setWebSearchSkillActive(e.target.checked);
                            localStorage.setItem('webSearchSkillActive', String(e.target.checked));
                          }} 
                        />
                        <span className="toggle-title">Echtzeit-Websuche & Factcheck Skill</span>
                      </label>
                      <p className="toggle-desc">sucht das internet vergleich das aktuellste. vergleich mit der datenbank</p>
                    </div>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'system' && (
                <div className="settings-section">
                  <h3>⚙️ System & Design</h3>
                  <p className="settings-section-desc">Passe die grundlegenden Portalsteuerungen und das Farbschema an.</p>

                  <div className="toggle-list">
                    <div className="setting-toggle-card">
                      <label className="checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={enterToSend} 
                          onChange={(e) => {
                            setEnterToSend(e.target.checked);
                            localStorage.setItem('enterToSend', String(e.target.checked));
                          }} 
                        />
                        <span className="toggle-title">Enter zum Senden</span>
                      </label>
                      <p className="toggle-desc">Eingabetaste sendet Nachricht ab. Verwende Shift+Enter für eine neue Zeile.</p>
                    </div>

                    <div className="setting-toggle-card" style={{ gap: '12px' }}>
                      <span className="toggle-title" style={{ fontSize: '1.05rem', fontWeight: 600, color: '#ffffff' }}>Farb-Theme</span>
                      <p className="toggle-desc" style={{ paddingLeft: 0, marginBottom: '4px' }}>Wähle ein Farbschema für das Portal-Interface aus:</p>
                      
                      <div className="theme-selectors-grid">
                        <button 
                          type="button"
                          className={`theme-select-btn theme-dark-btn ${theme === 'dark' ? 'active' : ''}`}
                          onClick={() => setTheme('dark')}
                        >
                          <span className="theme-indicator-circle dark"></span>
                          Dunkel (Cyan Neon)
                        </button>
                        <button 
                          type="button"
                          className={`theme-select-btn theme-light-btn ${theme === 'light' ? 'active' : ''}`}
                          onClick={() => setTheme('light')}
                        >
                          <span className="theme-indicator-circle light"></span>
                          Hell (Frost Weiss)
                        </button>
                        <button 
                          type="button"
                          className={`theme-select-btn theme-gray-btn ${theme === 'gray' ? 'active' : ''}`}
                          onClick={() => setTheme('gray')}
                        >
                          <span className="theme-indicator-circle gray"></span>
                          Grau (Matte Steel)
                        </button>
                      </div>
                    </div>
                  </div>

                  {deferredPrompt && (
                    <div className="pwa-install-section">
                      <h4>Verfügbare Aktionen</h4>
                      <button onClick={handleInstallApp} className="save-btn-settings pwa-btn">
                        📥 Portal App installieren (PWA)
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeSettingsTab === 'admin' && (
                <div className="settings-section">
                  <h3>🛠️ Admin Board</h3>
                  <p className="settings-section-desc">Globale Steuerung des Portals, Anpassung der Prompts und Benutzerüberwachung.</p>

                  {/* TOKEN GRANT PANEL */}
                  <div className="admin-token-grant-panel">
                    <h4>💰 Token-Verwaltung</h4>
                    <p className="admin-token-grant-desc">
                      Suche einen Benutzer, wähle ihn aus und lade Tokens auf. Der Benutzer erhält sofort eine Inbox-Nachricht.
                    </p>

                    <div className="admin-token-grant-form">
                      <div className="admin-token-grant-dropdown">
                        <label>Benutzer:</label>
                        <div
                          className="admin-token-grant-input"
                          onClick={() => setTokenGrantDropdownOpen(o => !o)}
                        >
                          {tokenGrantSelectedEmail ? (
                            <span>
                              <strong>{tokenGrantSelectedUsername}</strong>{' '}
                              <span style={{ opacity: 0.7 }}>({tokenGrantSelectedEmail})</span>
                            </span>
                          ) : (
                            <span style={{ opacity: 0.5 }}>— Benutzer suchen / auswählen —</span>
                          )}
                          <span className="admin-token-grant-caret">{tokenGrantDropdownOpen ? '▲' : '▼'}</span>
                        </div>
                        {tokenGrantDropdownOpen && (
                          <div className="admin-token-grant-dropdown-list">
                            <input
                              type="text"
                              autoFocus
                              placeholder="🔍 Suche nach Username oder E-Mail..."
                              value={tokenGrantSearch}
                              onChange={e => setTokenGrantSearch(e.target.value)}
                              className="admin-token-grant-search"
                            />
                            <div className="admin-token-grant-options">
                              {adminUsers
                                .filter(u =>
                                  u.username.toLowerCase().includes(tokenGrantSearch.toLowerCase()) ||
                                  u.email.toLowerCase().includes(tokenGrantSearch.toLowerCase())
                                )
                                .map(u => (
                                  <div
                                    key={u.id}
                                    className={`admin-token-grant-option ${tokenGrantSelectedEmail === u.email ? 'selected' : ''}`}
                                    onClick={() => {
                                      setTokenGrantSelectedEmail(u.email);
                                      setTokenGrantSelectedUsername(u.username);
                                      setTokenGrantDropdownOpen(false);
                                      setTokenGrantSearch('');
                                    }}
                                  >
                                    <span className="admin-token-grant-option-name">{u.username}</span>
                                    <span className="admin-token-grant-option-email">{u.email}</span>
                                    <span className="admin-token-grant-option-balance">
                                      💰 {u.tokenBalance?.toLocaleString('de-DE')}
                                    </span>
                                  </div>
                                ))}
                              {adminUsers.filter(u =>
                                u.username.toLowerCase().includes(tokenGrantSearch.toLowerCase()) ||
                                u.email.toLowerCase().includes(tokenGrantSearch.toLowerCase())
                              ).length === 0 && (
                                <div className="admin-token-grant-empty">Keine Benutzer gefunden.</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="admin-token-grant-row">
                        <div className="admin-token-grant-field">
                          <label>Token-Menge:</label>
                          <input
                            type="number"
                            min={1}
                            max={10000000}
                            value={tokenGrantAmount}
                            onChange={e => setTokenGrantAmount(e.target.value)}
                            className="admin-token-grant-amount"
                            placeholder="z.B. 1000"
                          />
                        </div>
                        <div className="admin-token-grant-field admin-token-grant-quick">
                          <label>Schnellauswahl:</label>
                          <div className="admin-token-grant-quick-btns">
                            {[100, 1000, 5000, 10000, 50000].map(v => (
                              <button
                                key={v}
                                type="button"
                                className="admin-token-grant-quick-btn"
                                onClick={() => setTokenGrantAmount(String(v))}
                              >
                                {v >= 1000 ? `${v / 1000}k` : v}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="admin-token-grant-field">
                        <label>Notiz (optional):</label>
                        <input
                          type="text"
                          value={tokenGrantNote}
                          onChange={e => setTokenGrantNote(e.target.value)}
                          className="admin-token-grant-note"
                          placeholder="z.B. Danke fürs Testen, Bonus fürs Onboarding..."
                        />
                      </div>

                      <div className="admin-token-grant-actions">
                        <button
                          type="button"
                          className="admin-action-btn grant"
                          onClick={handleGrantTokens}
                          disabled={tokenGrantSending || !tokenGrantSelectedEmail}
                        >
                          {tokenGrantSending ? '⏳ Sende...' : '🚀 Tokens versenden'}
                        </button>
                      </div>

                      {tokenGrantResult && (
                        <div className={`admin-token-grant-result ${tokenGrantResult.ok ? 'ok' : 'err'}`}>
                          {tokenGrantResult.message}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* RESET ALL TOKENS PANEL */}
                  <div className="admin-reset-all-panel">
                    <h4>🔄 Alle User zurücksetzen</h4>
                    <p className="admin-reset-all-desc">
                      Setzt das Token-Guthaben <strong>aller User</strong> auf einen festen Wert. Mit Bestätigungsdialog.
                    </p>

                    <div className="admin-reset-all-form">
                      <div className="admin-token-grant-row">
                        <div className="admin-token-grant-field">
                          <label>Neue Balance für alle:</label>
                          <input
                            type="number"
                            min={0}
                            max={100000000}
                            value={resetAllBalance}
                            onChange={e => setResetAllBalance(e.target.value)}
                            className="admin-token-grant-amount"
                            placeholder="z.B. 1000000"
                          />
                        </div>
                        <div className="admin-token-grant-field admin-token-grant-quick">
                          <label>Schnellauswahl:</label>
                          <div className="admin-token-grant-quick-btns">
                            {[100000, 500000, 1000000, 5000000, 10000000].map(v => (
                              <button
                                key={v}
                                type="button"
                                className="admin-token-grant-quick-btn"
                                onClick={() => setResetAllBalance(String(v))}
                              >
                                {v >= 1000000 ? `${v / 1000000}M` : `${v / 1000}k`}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="admin-reset-all-actions">
                        <button
                          type="button"
                          className="admin-action-btn reset-all"
                          onClick={handleResetAllTokens}
                          disabled={resetAllSending}
                        >
                          {resetAllSending ? '⏳ Setze zurück...' : '🔄 Alle User zurücksetzen'}
                        </button>
                      </div>

                      {resetAllResult && (
                        <div className={`admin-token-grant-result ${resetAllResult.ok ? 'ok' : 'err'}`}>
                          {resetAllResult.message}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="form-group full-width">
                    <label>System Prompt Ziel auswählen:</label>
                    <select
                      className="admin-prompt-target-select"
                      value={selectedPromptTarget}
                      onChange={e => setSelectedPromptTarget(e.target.value)}
                    >
                      <option value="global">🌍 Global (Standard für alle)</option>
                      {adminUsers.map(u => (
                        <option key={u.id} value={u.username}>
                          👤 {u.username} ({u.email})
                        </option>
                      ))}
                    </select>

                    <label>System Prompt ({selectedPromptTarget === 'global' ? 'Global' : `@${selectedPromptTarget}`}):</label>
                    <textarea
                      value={tempSystemPrompt}
                      onChange={e => setTempSystemPrompt(e.target.value)}
                      placeholder="Instruktionen für die KI..."
                      className="admin-system-prompt-textarea"
                      style={{ minHeight: '140px' }}
                    />
                  </div>

                  <div className="settings-actions" style={{ marginBottom: '20px' }}>
                    <button className="save-btn-settings admin-save-btn" onClick={handleSavePrompt}>
                      Prompt Speichern
                    </button>
                  </div>

                  {/* Users search and inspect section */}
                  <div className="admin-users-section">
                    <h4>Benutzer-Verwaltung & Monitoring</h4>
                    
                    <div className="admin-user-search-row">
                      <input
                        type="text"
                        placeholder="Benutzer suchen..."
                        value={adminSearch}
                        onChange={e => setAdminSearch(e.target.value)}
                        className="admin-user-search-input"
                      />
                    </div>

                    <div className="admin-users-grid">
                      {adminUsers
                        .filter(u => 
                          u.username.toLowerCase().includes(adminSearch.toLowerCase()) || 
                          u.email.toLowerCase().includes(adminSearch.toLowerCase())
                        )
                        .map(u => {
                          const hasRecentRequest = liveRequests.some((r: any) => 
                            r.email === u.email && 
                            (Date.now() - new Date(r.timestamp).getTime()) < 5 * 60 * 1000
                          );

                          return (
                            <div key={u.id} className="admin-user-item">
                              <div className="admin-user-meta">
                                <span className="admin-user-name">
                                  {u.username} 
                                  {hasRecentRequest && (
                                    <span style={{ color: '#10b981', fontSize: '0.75rem', fontWeight: 'bold', marginLeft: '8px' }}>
                                      ● Aktiv
                                    </span>
                                  )}
                                </span>
                                <span className="admin-user-email">
                                  {u.email} | Guthaben: {u.tokenBalance?.toLocaleString()} Tokens
                                </span>
                              </div>
                              <div className="admin-user-actions">
                                <button 
                                  onClick={() => handleInspectUser(u.email)} 
                                  className="admin-action-btn inspect"
                                  title={`Als ${u.username} einloggen`}
                                >
                                  👁️ Inspect
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'canvas' && (
                <CanvasShortcutsPanel
                  shortcuts={shortcutMap}
                  onSave={(map) => setShortcutMap(map)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Word Explainer / Mini-Chat Popup */}
      {explainWordPopup && explainWordPopup.visible && (
        <div 
          ref={explainPopupRef}
          className="explain-popup glass-card"
          onContextMenu={e => e.preventDefault()}
          onMouseDown={handleMouseDownText}
          onDoubleClick={handleDoubleClickText}
          style={{
            position: 'absolute',
            left: `${Math.min(window.innerWidth - 320, Math.max(20, explainWordPopup.x - 150))}px`,
            top: `${explainWordPopup.y - 8}px`,
            transform: 'translateY(-100%)',
            width: '300px',
            maxHeight: '480px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9999,
            padding: '12px',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
            borderRadius: '12px',
            background: 'rgba(3, 8, 9, 0.96)',
            backdropFilter: 'blur(10px)',
            color: '#fff',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '6px' }}>
            <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#2dc8dc', display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }} title={`"${explainWordPopup.word}"`}>
                🔍 "{explainWordPopup.word}"
              </span>
              <span style={{ opacity: 0.85, fontSize: '12px' }}>({countWordOccurrences(explainWordPopup.word)})</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button 
                onClick={() => setExplainWordPopupSettingsOpen(!explainWordPopupSettingsOpen)}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: explainWordPopupSettingsOpen ? '#2dc8dc' : 'rgba(255,255,255,0.6)', 
                  cursor: 'pointer', 
                  fontSize: '14px', 
                  padding: '0 4px', 
                  display: 'flex', 
                  alignItems: 'center',
                  transition: 'color 0.2s' 
                }}
                title="Einstellungen"
              >
                ⚙️
              </button>
              <button 
                onClick={() => {
                  setExplainWordPopup(null);
                  setExplainWordPopupSettingsOpen(false);
                }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '16px', padding: '0 4px', display: 'flex', alignItems: 'center' }}
              >
                &times;
              </button>
            </div>
          </div>

          {/* Settings View */}
          {explainWordPopupSettingsOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 2px', flex: 1, overflowY: 'auto' }} className="custom-scrollbar">
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#2dc8dc', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px', marginBottom: '4px' }}>
                ⚙️ Einstellungen
              </div>
              
              {/* Languages Settings */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', fontWeight: 'bold' }}>Übersetzungssprachen:</span>
                {explainLanguages.map(lang => (
                  <div key={lang} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                    <span style={{ color: '#ffc82d', fontWeight: 'bold' }}>{lang.toUpperCase()}</span>
                    <button
                      onClick={() => {
                        const nextLangs = explainLanguages.filter(l => l !== lang);
                        setExplainLanguages(nextLangs);
                      }}
                      style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '12px', padding: '0 4px' }}
                      title="Sprache löschen"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                
                <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                  <input
                    type="text"
                    placeholder="z.B. ES, FR, TH"
                    value={newLangInput}
                    onChange={(e) => setNewLangInput(e.target.value)}
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      color: '#fff',
                      fontSize: '10px',
                      outline: 'none'
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const code = newLangInput.trim().toUpperCase();
                        if (code && !explainLanguages.includes(code)) {
                          setExplainLanguages([...explainLanguages, code]);
                          setNewLangInput('');
                        }
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const code = newLangInput.trim().toUpperCase();
                      if (code && !explainLanguages.includes(code)) {
                        setExplainLanguages([...explainLanguages, code]);
                        setNewLangInput('');
                      }
                    }}
                    style={{
                      background: 'rgba(45, 200, 220, 0.2)',
                      border: '1px solid rgba(45, 200, 220, 0.3)',
                      color: '#2dc8dc',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
              
              {/* Buy Location Settings */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', fontWeight: 'bold' }}>📍 Einkaufsregion (für "Kaufen"):</span>
                <input
                  type="text"
                  placeholder="z.B. Thailand, Germany"
                  value={buyLocation}
                  onChange={(e) => setBuyLocation(e.target.value)}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    color: '#fff',
                    fontSize: '10px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>
          )}

          {/* Normal Mode View */}
          {!explainWordPopupSettingsOpen && (
            <>
              {/* Active Translations Display */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px', paddingBottom: '4px' }}>
                {explainLanguages.map(lang => {
                  const langUpper = lang.toUpperCase();
                  const val = explainWordPopup.translations?.[langUpper];
                  const isLoadingVal = explainWordPopup.loading && !val;
                  return (
                    <div key={lang} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', background: 'rgba(255,255,255,0.03)', padding: '3px 6px', borderRadius: '4px' }}>
                      <span style={{ color: '#ffc82d', fontWeight: 'bold', marginRight: '4px' }}>{langUpper}:</span>
                      <span 
                        className="translation-value"
                        title={val || 'n/a'}
                        style={{ flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: '#eee', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        {isLoadingVal ? (
                          <span className="tiny-cyan-spinner" style={{ verticalAlign: 'middle' }} />
                        ) : (
                          val || 'n/a'
                        )}
                      </span>
                      <button
                        onClick={() => {
                          if (val && window.speechSynthesis) {
                            window.speechSynthesis.cancel();
                            const utterance = new SpeechSynthesisUtterance(val);
                            let speechLang = 'en-US';
                            if (langUpper === 'DE') speechLang = 'de-DE';
                            else if (langUpper === 'TH' || langUpper === 'THAI') speechLang = 'th-TH';
                            else if (langUpper === 'FR') speechLang = 'fr-FR';
                            else if (langUpper === 'ES') speechLang = 'es-ES';
                            else if (langUpper === 'IT') speechLang = 'it-IT';
                            
                            utterance.lang = speechLang;
                            window.speechSynthesis.speak(utterance);
                          }
                        }}
                        disabled={!val || isLoadingVal}
                        style={{ background: 'none', border: 'none', color: val ? '#2dc8dc' : '#555', cursor: val ? 'pointer' : 'default', fontSize: '12px', padding: '0 4px' }}
                        title="Vorlesen lassen"
                      >
                        🔊
                      </button>
                    </div>
                  );
                })}
              </div>

              {explainWordPopup.error ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 4px', flex: 1 }}>
                  <div style={{ color: '#ff6b6b', fontSize: '12.5px', lineHeight: '1.4', wordBreak: 'break-word' }}>
                    ⚠️ Fehler beim Senden: {explainWordPopup.error}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(explainWordPopup.error || '').catch(() => {});
                      }}
                      style={{
                        flex: 1,
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        color: '#fff',
                        padding: '6px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      📋 Kopieren
                    </button>
                    <button
                      onClick={() => {
                        setExplainWordPopup(prev => prev ? { ...prev, error: undefined } : null);
                      }}
                      style={{
                        flex: 1,
                        background: '#2dc8dc',
                        border: 'none',
                        borderRadius: '4px',
                        color: '#030809',
                        padding: '6px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      OK
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {/* iOS Switch */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginRight: '2px', flexShrink: 0 }} title="Automatische Worterklärung bei Doppelklick">
                      <div 
                        onClick={() => setAutoExplain(!autoExplain)}
                        style={{
                          width: '24px',
                          height: '14px',
                          borderRadius: '10px',
                          background: autoExplain ? '#2dc8dc' : 'rgba(255,255,255,0.2)',
                          position: 'relative',
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <div style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: '#fff',
                          position: 'absolute',
                          top: '2px',
                          left: autoExplain ? '12px' : '2px',
                          transition: 'left 0.2s'
                        }} />
                      </div>
                      <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'rgba(255,255,255,0.6)' }}>Ki</span>
                    </div>

                    <button
                      onClick={() => handleExplainWordStart(undefined, 'detailed')}
                      disabled={explainWordPopup.loading}
                      style={{
                        flex: 1,
                        padding: '5px 4px',
                        background: 'rgba(45, 200, 220, 0.1)',
                        border: '1px solid rgba(45, 200, 220, 0.2)',
                        color: '#2dc8dc',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      📖 Detailliert
                    </button>
                    <button
                      onClick={() => handleExplainWordStart(undefined, 'simplified')}
                      disabled={explainWordPopup.loading}
                      style={{
                        flex: 1,
                        padding: '5px 4px',
                        background: 'rgba(255, 200, 45, 0.1)',
                        border: '1px solid rgba(255, 200, 45, 0.2)',
                        color: '#ffc82d',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      👶 V-Erklärt
                    </button>
                    <button
                      onClick={() => handleExplainWordStart(undefined, 'buy')}
                      disabled={explainWordPopup.loading}
                      style={{
                        flex: 1,
                        padding: '5px 4px',
                        background: 'rgba(220, 45, 120, 0.1)',
                        border: '1px solid rgba(220, 45, 120, 0.2)',
                        color: '#dc2d78',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      🛒 Kaufen
                    </button>
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', fontSize: '12.5px', marginBottom: '8px', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }} className="custom-scrollbar">
                    {/* Fast explanation (M2.7) */}
                    {explainWordPopup.fastContent && (
                      <div 
                        style={{ 
                          alignSelf: 'flex-start',
                          background: 'rgba(45, 200, 220, 0.08)',
                          borderLeft: '3px solid #2dc8dc',
                          padding: '6px 10px',
                          borderRadius: '0 8px 8px 0',
                          maxWidth: '95%',
                          lineHeight: '1.4',
                          color: '#f5f5f5',
                          wordBreak: 'break-word'
                        }}
                      >
                        <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#2dc8dc', marginBottom: '3px', textTransform: 'uppercase' }}>⚡ Kurzerklärung (fast M2.7)</div>
                        {explainWordPopup.fastContent}
                      </div>
                    )}

                    {/* Detailed explanation (M3) */}
                    {explainWordPopup.detailedContent && (
                      <div 
                        style={{ 
                          alignSelf: 'flex-start',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderLeft: '3px solid rgba(255,255,255,0.4)',
                          padding: '6px 10px',
                          borderRadius: '0 8px 8px 0',
                          maxWidth: '95%',
                          lineHeight: '1.4',
                          color: '#f5f5f5',
                          wordBreak: 'break-word'
                        }}
                      >
                        <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#ccc', marginBottom: '3px', textTransform: 'uppercase' }}>🧠 Detailliert (M3)</div>
                        {explainWordPopup.detailedContent}
                      </div>
                    )}

                    {/* Fallback to rendering history messages if any exist (e.g. from user follow-ups) */}
                    {explainWordPopup.messages.map((m, idx) => (
                      (m.content.startsWith('definiere das wort : ') ||
                       m.content.startsWith('Erkläre das Wort vereinfacht: ') ||
                       m.content.startsWith('Erkläre das Wort detailliert wissenschaftlich: ') ||
                       m.content.startsWith('kaufen: ') ||
                       m.content === 'translate-only') ? null : (
                        <div 
                          key={idx} 
                          style={{ 
                            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                            background: m.role === 'user' ? 'rgba(45, 200, 220, 0.15)' : 'rgba(255,255,255,0.06)',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            maxWidth: '90%',
                            lineHeight: '1.4',
                            color: m.role === 'user' ? '#e0f7fa' : '#f5f5f5',
                            wordBreak: 'break-word'
                          }}
                        >
                          {m.content}
                        </div>
                      )
                    ))}

                    {/* Show spinner when loading fast content OR when fast content is ready but detailed is still loading */}
                    {(explainWordPopup.loading || explainWordPopup.detailedLoading) && explainWordPopup.mode !== 'translate-only' && (
                      <div className="sharingan-spinner-container" style={{ padding: '10px 0' }}>
                        <div className="sharingan-spinner" style={{ width: '28px', height: '28px' }}>
                          <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block', color: '#2dc8dc' }}>
                            <circle cx="50" cy="50" r="6.6" fill="currentColor" />
                            <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(0 50 50)" />
                            <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(60 50 50)" />
                            <ellipse cx="50" cy="50" rx="46.2" ry="13.2" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(120 50 50)" />
                          </svg>
                        </div>
                        <span className="sharingan-text" style={{ fontSize: '10px' }}>
                          {explainWordPopup.status || 'Erklärung wird geladen...'}
                        </span>
                      </div>
                    )}
                  </div>

                  {explainWordPopup.messages.length > 0 && (
                    <form 
                      onSubmit={handleExplainWordFollowUp}
                      style={{ display: 'flex', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px', marginTop: 'auto' }}
                    >
                      <input
                        type="text"
                        placeholder="Hast du sonst noch Fragen?"
                        value={explainWordPopup.inputValue}
                        onChange={(e) => setExplainWordPopup(prev => prev ? { ...prev, inputValue: e.target.value } : null)}
                        disabled={explainWordPopup.loading}
                        style={{
                          flex: 1,
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '4px',
                          padding: '6px 10px',
                          color: '#fff',
                          fontSize: '12px',
                          outline: 'none'
                        }}
                      />
                      <button
                        type="submit"
                        disabled={explainWordPopup.loading || !explainWordPopup.inputValue.trim()}
                        style={{
                          background: '#2dc8dc',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#030809',
                          padding: '0 10px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        Senden
                      </button>
                    </form>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>

    {/* Live request popup container */}
    {showRequestPopup && (
      <div className="live-toast-container">
        <div className="live-toast" onClick={() => setIframeSessionId(showRequestPopup.sessionId)}>
          <div className="live-toast-header">
            <span>⚡ Neue Benutzer-Anfrage</span>
            <span>Jetzt ansehen</span>
          </div>
          <div className="live-toast-body">
            <strong>{showRequestPopup.username}:</strong> "{showRequestPopup.firstSentence}"
          </div>
        </div>
      </div>
    )}

    {/* User-facing notification popup (e.g. admin granted tokens) */}
    {showNotificationsPopup && !isAdmin && (
      <div className="live-toast-container">
        <div
          className="live-toast user-inbox-toast"
          onClick={async () => {
            setShowNotificationsPopup(null);
            await handleMarkNotificationsRead();
            // refresh balance
            try {
              const profileData = await apiFetch('/chat/profile');
              if (profileData && typeof profileData.tokenBalance === 'number') {
                setTokenBalance(profileData.tokenBalance);
                localStorage.setItem('tokenBalance', String(profileData.tokenBalance));
              }
            } catch (e) {}
          }}
        >
          <div className="live-toast-header inbox-toast-header">
            <span>💰 {showNotificationsPopup.title || 'Inbox-Nachricht'}</span>
            <span>Tippen zum Bestätigen</span>
          </div>
          <div className="live-toast-body">
            {showNotificationsPopup.message}
          </div>
        </div>
      </div>
    )}

    {/* Iframe Chat viewer modal */}
    {iframeSessionId && (
      <div className="iframe-preview-overlay" onClick={() => setIframeSessionId(null)}>
        <div className="iframe-preview-card" onClick={e => e.stopPropagation()}>
          <div className="iframe-preview-header">
            <h4>🔍 Chat-Inspektor</h4>
            <button className="iframe-close-btn" onClick={() => setIframeSessionId(null)}>×</button>
          </div>
          <iframe 
            src={`http://localhost:5000/api/admin/session/${iframeSessionId}`}
            className="iframe-preview-frame"
            title="Chat Inspektor Viewer"
          />
        </div>
      </div>
    )}
  </>
);
}

export default App;
