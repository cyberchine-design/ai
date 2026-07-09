import React from 'react';
import './VideoAvatar.css';

export interface OverlayItem {
  number: number;
  title: string;
  url: string;
  type: 'youtube' | 'link' | 'image';
}

interface VideoAvatarProps {
  isSpeaking: boolean;
  isLoading: boolean;
  overlayItems: OverlayItem[];
  onCloseOverlay: () => void;
  activePanelUrl: string | null;
  setActivePanelUrl: (url: string | null) => void;
  onSummarize: (url: string) => void;
  isSummarizing: boolean;
  avatarWide: boolean;
  setAvatarWide: (wide: boolean) => void;
  onStopAudio?: () => void;
}

export const VideoAvatar: React.FC<VideoAvatarProps> = ({
  isSpeaking,
  isLoading,
  overlayItems,
  onCloseOverlay,
  activePanelUrl,
  setActivePanelUrl,
  onSummarize,
  isSummarizing,
  avatarWide,
  setAvatarWide,
  onStopAudio
}) => {
  const [isOnline, setIsOnline] = React.useState(navigator.onLine);

  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const speedClassSuffix = isSpeaking ? '-fast' : isLoading ? '-medium' : '-slow';

  const openPopupAtPanel = (url: string) => {
    if (!url) return;
    
    // Default dimensions
    let width = 1000;
    let height = 800;
    let left = Math.round((window.screen.width - width) / 2);
    let top = Math.round((window.screen.height - height) / 2);

    try {
      const container = document.querySelector('.web-viewer-container') || document.querySelector('.avatar-capsule');
      if (container) {
        const rect = container.getBoundingClientRect();
        const screenLeft = window.screenLeft ?? window.screenX ?? 0;
        const screenTop = window.screenTop ?? window.screenY ?? 0;

        left = Math.round(screenLeft + rect.left);
        top = Math.round(screenTop + rect.top);
        width = Math.round(rect.width);
        height = Math.round(rect.height);
      }
    } catch (e) {
      console.warn('Failed to calculate popup position:', e);
    }

    const features = `left=${left},top=${top},width=${width},height=${height},scrollbars=yes,resizable=yes`;
    const win = window.open(url, 'miunicorn_browser', features);
    if (win) {
      win.focus();
    } else {
      console.warn('Popup blocked by browser');
    }
  };

  React.useEffect(() => {
    if (activePanelUrl && !(activePanelUrl.includes('youtube.com') || activePanelUrl.includes('youtu.be'))) {
      openPopupAtPanel(activePanelUrl);
    }
  }, [activePanelUrl]);

  // Helper to extract YouTube ID
  const getYouTubeId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  return (
    <div className={`avatar-capsule glass-card ${avatarWide ? 'wide' : ''}`}>
      <button 
        type="button" 
        className="avatar-wide-toggle-tab"
        onClick={() => setAvatarWide(!avatarWide)}
        title={avatarWide ? "Splitscreen verkleinern" : "Splitscreen vergrößern"}
      >
        {avatarWide ? '▶' : '◀'}
      </button>

      <div className="avatar-status">
        {isSpeaking ? (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span className="badge speaking">Spreche...</span>
            {onStopAudio && (
              <button 
                onClick={onStopAudio}
                style={{
                  background: 'rgba(255, 75, 75, 0.2)',
                  border: '1px solid rgba(255, 75, 75, 0.4)',
                  color: '#ff4b4b',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  boxShadow: '0 0 6px rgba(255, 75, 75, 0.3)',
                  transition: 'all 0.2s ease'
                }}
                title="Sprachausgabe stoppen"
              >
                ⏹ STOPP
              </button>
            )}
          </div>
        ) : isLoading ? (
          <span className="badge loading">Denke nach...</span>
        ) : isOnline ? (
          <span className="badge online">Online</span>
        ) : (
          <span className="badge offline">Offline</span>
        )}
      </div>

      <div className="avatar-graphic-wrapper">
        {activePanelUrl ? (
          <div className="web-viewer-container glass-card">
            <div className="web-viewer-header">
              <button 
                type="button" 
                className="summary-btn"
                onClick={() => onSummarize(activePanelUrl)}
                disabled={isSummarizing}
              >
                {isSummarizing ? '⌛ Fasse zusammen...' : (activePanelUrl.includes('youtube.com') || activePanelUrl.includes('youtu.be') ? '← Video' : '← Webseite')}
              </button>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <a 
                  href={activePanelUrl} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="open-tab-btn"
                  title="In neuem Tab öffnen"
                >
                  ↗
                </a>
                <button 
                  type="button" 
                  className="close-viewer-btn"
                  onClick={() => setActivePanelUrl(null)}
                  title="Schließen"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="web-viewer-content">
              {(activePanelUrl.includes('youtube.com') || activePanelUrl.includes('youtu.be')) ? (
                getYouTubeId(activePanelUrl) ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${getYouTubeId(activePanelUrl)}`}
                    title="YouTube video player"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="web-viewer-iframe"
                  />
                ) : (
                  <div className="web-fallback-container">
                    <div className="web-fallback-card glass-card">
                      <div className="fallback-icon">🔍</div>
                      <h3>YouTube-Seite</h3>
                      <p>Diese YouTube-Seite (z. B. Suche oder Kanal) kann aus Sicherheitsgründen nicht direkt eingebettet werden.</p>
                      <div className="fallback-actions">
                        <a 
                          href={activePanelUrl} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="fallback-btn primary"
                        >
                          In neuem Tab öffnen ↗
                        </a>
                        <button 
                          type="button" 
                          className="fallback-btn secondary"
                          onClick={() => onSummarize(activePanelUrl)}
                          disabled={isSummarizing}
                        >
                          {isSummarizing ? '⌛ Fasse zusammen...' : 'Inhalt zusammenfassen'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="web-fallback-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '16px' }}>
                  <div className="web-fallback-card glass-card" style={{ padding: '24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', maxWidth: '340px' }}>
                    <div className="fallback-icon" style={{ fontSize: '36px' }}>🌐</div>
                    <h3 style={{ fontSize: '1.2rem', color: '#2dc8dc', margin: 0, fontWeight: 'bold' }}>Schwebender Browser</h3>
                    <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', margin: 0, lineHeight: '1.4' }}>
                      Diese Webseite wurde in einem separaten, schwebenden Browser-Fenster geöffnet, um Anzeigefehler zu vermeiden.
                    </p>
                    <div className="fallback-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '8px' }}>
                      <button 
                        type="button"
                        className="fallback-btn primary"
                        onClick={() => openPopupAtPanel(activePanelUrl)}
                        style={{
                          background: '#2dc8dc',
                          color: '#030809',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '10px 16px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          fontSize: '0.9rem'
                        }}
                      >
                        📱 Browser öffnen
                      </button>
                      <button 
                        type="button" 
                        className="fallback-btn secondary"
                        onClick={() => onSummarize(activePanelUrl)}
                        disabled={isSummarizing}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#fff',
                          borderRadius: '6px',
                          padding: '10px 16px',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          fontSize: '0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                      >
                        {isSummarizing ? '⌛ Fasse zusammen...' : '📝 Text zusammenfassen'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Render Jarvis Arc Reactor background */
          <div className="jarvis-wrapper">
            <div className={`jarvis-pulse ${isSpeaking ? 'speaking-pulse' : ''}`}></div>
            <svg
              className="jarvis-svg text-cyan-400"
              viewBox="0 0 200 200"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                className={`animate-spin${speedClassSuffix}`}
                cx="100"
                cy="100"
                r="82"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="25 12 8 12"
                strokeLinecap="round"
              />
              <circle
                className="animate-spin-reverse-slow opacity-40"
                cx="100"
                cy="100"
                r="75"
                stroke="currentColor"
                strokeWidth="0.75"
                strokeDasharray="4 8"
              />
              <circle
                className={`animate-spin-reverse${speedClassSuffix}`}
                cx="100"
                cy="100"
                r="64"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray="45 20 15 20"
                strokeLinecap="round"
              />
              <circle
                className="animate-spin-medium opacity-70"
                cx="100"
                cy="100"
                r="52"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeDasharray="12 24"
              />
              <circle
                cx="100"
                cy="100"
                r="38"
                stroke="currentColor"
                strokeWidth="0.75"
                strokeDasharray="2 4"
                className="opacity-60"
              />
              <g className={`animate-spin${speedClassSuffix}`}>
                <path d="M 72 100 A 28 28 0 0 1 100 72" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
                <path d="M 128 100 A 28 28 0 0 1 100 128" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
              </g>
              <g className={`animate-spin-reverse${speedClassSuffix}`}>
                <path d="M 100 72 A 28 28 0 0 1 128 100" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
                <path d="M 100 128 A 28 28 0 0 1 72 100" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
              </g>
              <circle 
                cx="100" 
                cy="100" 
                r="24" 
                fill="#050c0d" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                className={`core-circle ${isSpeaking ? 'speaking-core' : ''}`}
              />
              <g 
                className="sharingan-rotate"
                style={{ 
                  opacity: isLoading ? 1 : 0, 
                  transition: 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)' 
                }}
              >
                <circle cx="100" cy="100" r="3.3" fill="currentColor" />
                <ellipse cx="100" cy="100" rx="23.1" ry="6.6" fill="none" stroke="currentColor" stroke-width="1.1" transform="rotate(0 100 100)" />
                <ellipse cx="100" cy="100" rx="23.1" ry="6.6" fill="none" stroke="currentColor" stroke-width="1.1" transform="rotate(60 100 100)" />
                <ellipse cx="100" cy="100" rx="23.1" ry="6.6" fill="none" stroke="currentColor" stroke-width="1.1" transform="rotate(120 100 100)" />
              </g>
            </svg>
          </div>
        )}

        {/* Media Overlay - Slide-up drawer inside the capsule */}
        {overlayItems.length > 0 && (
          <div className="avatar-media-overlay glass-card">
            <div className="media-overlay-header">
              <h4>🔍 Fundstücke</h4>
              <button className="close-media-btn" onClick={onCloseOverlay} title="Schließen">✕</button>
            </div>
            <div className="media-overlay-list">
              {overlayItems.map((item) => (
                <div key={item.number} className="media-card glass-card">
                  <div className="media-number-tag">{item.number}</div>
                  <div className="media-card-body">
                    <span className="media-card-title">{item.title}</span>
                    
                    {/* Render different block types */}
                    {item.type === 'youtube' && getYouTubeId(item.url) ? (
                      <div className="youtube-embed-container">
                        <iframe
                          src={`https://www.youtube.com/embed/${getYouTubeId(item.url)}`}
                          title={item.title}
                          frameBorder="0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : item.type === 'image' ? (
                      <div className="image-embed-container">
                        <img src={item.url} alt={item.title} />
                      </div>
                    ) : (
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="media-card-link">
                        Link öffnen ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="avatar-subtitle">
        <p>{isSpeaking ? '"Ich antworte dir..."' : isLoading ? '"MiuTec Thinking..."' : '"Ich höre dir zu."'}</p>
      </div>
    </div>
  );
};
