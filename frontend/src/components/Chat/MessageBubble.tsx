import React, { useState } from 'react';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  highlightWord?: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ role, content, highlightWord }) => {
  const [showThink, setShowThink] = useState(false);

  // Formatter for markdown links [label](url), raw URLs, and bold text **bold**
  const formatText = (text: string) => {
    const mdLinkRegex = /\[(.*?)\]\((.*?)\)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    // Helper to highlight a specific word in plain text segments
    const highlightWordInText = (plainText: string, subKey: string) => {
      if (!highlightWord || !plainText) return plainText;
      
      // Escape special regex characters
      const escaped = highlightWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const isAlphaNum = /^[a-zA-Z0-9äöüÄÖÜß]+$/.test(highlightWord);
      // Case-insensitive boundary match for normal words, exact match for text with symbols
      const regex = new RegExp(isAlphaNum ? `\\b(${escaped})\\b` : `(${escaped})`, 'gi');
      
      const resParts: React.ReactNode[] = [];
      let resLastIndex = 0;
      let resMatch;
      
      while ((resMatch = regex.exec(plainText)) !== null) {
        if (resMatch.index > resLastIndex) {
          resParts.push(plainText.substring(resLastIndex, resMatch.index));
        }
        resParts.push(
          <span 
            key={`${subKey}-highlight-${resMatch.index}`} 
            style={{ color: '#ffd700' }}
          >
            {resMatch[1]}
          </span>
        );
        resLastIndex = regex.lastIndex;
      }
      
      if (resLastIndex < plainText.length) {
        resParts.push(plainText.substring(resLastIndex));
      }
      
      return resParts.length > 0 ? resParts : plainText;
    };

    // Helper to format bold text and raw links inside text segments
    const formatBoldAndUrls = (str: string, keyPrefix: string) => {
      const boldRegex = /\*\*(.*?)\*\*/g;
      const subparts: React.ReactNode[] = [];
      let subLastIndex = 0;
      let subMatch;

      const parseUrls = (textSegment: string, subKey: string) => {
        // Regex to match URLs starting with http:// or https:// (stopping at spaces or punctuation)
        const urlRegex = /(https?:\/\/[^\s\(\)\[\]\{\}<>]+)/g;
        const urlParts: React.ReactNode[] = [];
        let urlLastIndex = 0;
        let urlMatch;

        while ((urlMatch = urlRegex.exec(textSegment)) !== null) {
          if (urlMatch.index > urlLastIndex) {
            const segment = textSegment.substring(urlLastIndex, urlMatch.index);
            urlParts.push(highlightWordInText(segment, `${subKey}-seg-${urlLastIndex}`));
          }
          const url = urlMatch[1];
          urlParts.push(
            <a key={`${subKey}-url-${urlMatch.index}`} href={url} target="_blank" rel="noopener noreferrer" className="chat-link">
              {url}
            </a>
          );
          urlLastIndex = urlRegex.lastIndex;
        }
        if (urlLastIndex < textSegment.length) {
          const segment = textSegment.substring(urlLastIndex);
          urlParts.push(highlightWordInText(segment, `${subKey}-seg-${urlLastIndex}`));
        }
        return urlParts.length > 0 ? urlParts : highlightWordInText(textSegment, subKey);
      };

      while ((subMatch = boldRegex.exec(str)) !== null) {
        if (subMatch.index > subLastIndex) {
          const plainText = str.substring(subLastIndex, subMatch.index);
          const parsed = parseUrls(plainText, `${keyPrefix}-plain-${subLastIndex}`);
          if (Array.isArray(parsed)) subparts.push(...parsed);
          else subparts.push(parsed);
        }
        
        // Also parse URLs inside bold sections just in case
        const boldText = subMatch[1];
        const parsedBold = parseUrls(boldText, `${keyPrefix}-bold-${subMatch.index}`);
        subparts.push(
          <strong key={`${keyPrefix}-bold-${subMatch.index}`}>
            {parsedBold}
          </strong>
        );
        subLastIndex = boldRegex.lastIndex;
      }

      if (subLastIndex < str.length) {
        const plainText = str.substring(subLastIndex);
        const parsed = parseUrls(plainText, `${keyPrefix}-plain-${subLastIndex}`);
        if (Array.isArray(parsed)) subparts.push(...parsed);
        else subparts.push(parsed);
      }

      return subparts.length > 0 ? subparts : highlightWordInText(str, keyPrefix);
    };

    while ((match = mdLinkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const precedingText = text.substring(lastIndex, match.index);
        const boldFormatted = formatBoldAndUrls(precedingText, `text-${lastIndex}`);
        if (Array.isArray(boldFormatted)) {
          parts.push(...boldFormatted);
        } else {
          parts.push(boldFormatted);
        }
      }
      const label = match[1];
      const url = match[2];
      parts.push(
        <a key={`link-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="chat-link">
          {label}
        </a>
      );
      lastIndex = mdLinkRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      const remainingText = text.substring(lastIndex);
      const boldFormatted = formatBoldAndUrls(remainingText, `text-${lastIndex}`);
      if (Array.isArray(boldFormatted)) {
        parts.push(...boldFormatted);
      } else {
        parts.push(boldFormatted);
      }
    }

    return parts.length > 0 ? parts : text;
  };

  const [showSources, setShowSources] = useState(false);

  // Check if content contains a think block
  const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
  const thinkMatch = content.match(thinkRegex);

  // Check if content contains a sources details block
  const sourceRegex = /<details>\s*<summary>Source<\/summary>([\s\S]*?)<\/details>/i;
  const sourceMatch = content.match(sourceRegex);

  let cleanContent = content;
  let thinkText = '';
  let sourceText = '';

  if (thinkMatch) {
    thinkText = thinkMatch[1].trim();
    cleanContent = cleanContent.replace(thinkRegex, '').trim();
  }
  if (sourceMatch) {
    sourceText = sourceMatch[1].trim();
    cleanContent = cleanContent.replace(sourceRegex, '').trim();
  }

  if (role === 'assistant' && (thinkMatch || sourceMatch)) {
    return (
      <div className="message-row assistant">
        <div className="avatar-tag">KI</div>
        <div className="message-body">
          {/* Think Block Accordion Header */}
          {thinkText && (
            <>
              <div 
                className="think-block-header" 
                onClick={() => setShowThink(!showThink)}
                title="Klicken zum Aufklappen des Gedankengangs"
              >
                <span className="think-icon">💭</span>
                <span className="think-status-text">
                  {showThink ? 'Gedankengang ausblenden' : 'Gedankengang anzeigen...'}
                </span>
                <span className="think-arrow">{showThink ? '▼' : '▶'}</span>
              </div>
              
              {/* Think Block Content */}
              {showThink && (
                <div className="think-block-content">
                  {thinkText.split('\n').map((line, idx) => (
                    <div key={idx} className="think-line">{line}</div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Actual Assistant Answer text */}
          {cleanContent && <div className="message-content">{formatText(cleanContent)}</div>}

          {/* Sources Block Accordion */}
          {sourceText && (
            <div style={{ marginTop: '8px' }}>
              <div 
                className="source-block-header" 
                onClick={() => setShowSources(!showSources)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  color: 'rgba(45, 200, 220, 0.7)',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background: 'rgba(45, 200, 220, 0.06)',
                  border: '1px solid rgba(45, 200, 220, 0.15)',
                  transition: 'all 0.2s',
                  userSelect: 'none',
                  marginTop: '4px',
                  fontWeight: 'bold'
                }}
              >
                <span style={{ fontSize: '0.8rem' }}>🔗</span>
                <span>{showSources ? 'Quelle ausblenden' : 'Quelle anzeigen'}</span>
                <span style={{ fontSize: '0.65rem' }}>{showSources ? '▼' : '▶'}</span>
              </div>
              {showSources && (
                <div 
                  className="source-block-content"
                  style={{
                    background: 'rgba(5, 11, 12, 0.5)',
                    padding: '8px 12px',
                    borderRadius: '0 6px 6px 0',
                    fontSize: '0.8rem',
                    color: 'rgba(255, 255, 255, 0.75)',
                    marginTop: '6px',
                    lineHeight: '1.4',
                    whiteSpace: 'pre-wrap',
                    border: '1px solid rgba(45, 200, 220, 0.1)',
                    borderLeft: '2.5px solid rgba(45, 200, 220, 0.6)'
                  }}
                >
                  {formatText(sourceText)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`message-row ${role}`}>
      <div className="avatar-tag">{role === 'user' ? 'Du' : 'KI'}</div>
      <div className="message-content">{formatText(cleanContent)}</div>
    </div>
  );
};
