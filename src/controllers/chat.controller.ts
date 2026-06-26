import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/database';
import { ChatService } from '../services/chat.service';
import { TtsService } from '../services/tts.service';
import { TokenService } from '../services/token.service';
import { MiumiverseService } from '../services/miumiverse.service';
import { HermesService } from '../services/hermes.service';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import fs from 'fs';
import path from 'path';

const getUserDir = (email: string) => {
  const dir = path.resolve(__dirname, `../../storage/users/${email}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

// Global in-memory cache for word explanations
const explanationCache = new Map<string, { content: string; webContent: string | null; translations: Record<string, string>; tokensUsed: number }>();

let localDeEn: Record<string, string> | null = null;
let localEnTh: Record<string, string> | null = null;

function loadLocalDictionaries() {
  if (localDeEn && localEnTh) return;
  try {
    const storageDir = path.join(__dirname, '..', '..', 'storage');
    const deEnPath = path.join(storageDir, 'de-en.json');
    const enThPath = path.join(storageDir, 'en-th.json');
    if (fs.existsSync(deEnPath) && !localDeEn) {
      logger.info('[Backend Dict] Loading local de-en.json...');
      localDeEn = JSON.parse(fs.readFileSync(deEnPath, 'utf-8'));
      logger.info(`[Backend Dict] Loaded de-en dictionary: ${Object.keys(localDeEn || {}).length} words.`);
    }
    if (fs.existsSync(enThPath) && !localEnTh) {
      logger.info('[Backend Dict] Loading local en-th.json...');
      localEnTh = JSON.parse(fs.readFileSync(enThPath, 'utf-8'));
      logger.info(`[Backend Dict] Loaded en-th dictionary: ${Object.keys(localEnTh || {}).length} words.`);
    }
  } catch (e: any) {
    logger.warn(`Failed to load local dictionaries: ${e.message}`);
  }
}

function parseSafeJSON(text: string): any {
  try {
    const clean = text.replace(/```json/i, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const extracted = text.substring(startIdx, endIdx + 1);
      return JSON.parse(extracted);
    }
    throw e;
  }
}

function sanitizeLLMContent(text: string): string {
  if (!text) return '';
  let clean = text;
  
  // 1. Remove markdown bold and italic markers
  clean = clean.replace(/\*\*/g, '');
  clean = clean.replace(/\*/g, '');
  clean = clean.replace(/__/g, '');
  clean = clean.replace(/_/g, '');
  
  // 2. Replace German smart quotes and other non-standard quotes with standard double quotes
  clean = clean.replace(/[„“”«»‘’]/g, '"');
  
  // 3. Replace equals signs with 'bedeutet' to avoid math/formulaic look
  clean = clean.replace(/\s*=\s*/g, ' bedeutet ');
  
  // 4. Replace slash '/' with ' oder ' when it separates words
  clean = clean.replace(/(\w+)\s*\/\s*(\w+)/g, '$1 oder $2');
  
  // 5. Replace fancy/unusual characters like arrows, bullets, etc.
  clean = clean.replace(/[→⇒•●■]/g, ' ');
  
  // 6. Clean up multiple spaces
  clean = clean.replace(/ {2,}/g, ' ');
  
  return clean.trim();
}

export class ChatController {
  static async getSessions(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const sessions = await prisma.session.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } }
      });
      return res.json(sessions);
    } catch (error: any) {
      logger.error(`Error retrieving sessions: ${error.message}`);
      return res.status(500).json({ error: 'Failed to retrieve sessions' });
    }
  }

  static async createSession(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    const { title } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const session = await prisma.session.create({
        data: {
          title: title || 'New Chat Session',
          userId
        }
      });
      return res.status(201).json(session);
    } catch (error: any) {
      logger.error(`Error creating session: ${error.message}`);
      return res.status(500).json({ error: 'Failed to create session' });
    }
  }

  static async getSessionMessages(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    const { sessionId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId }
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const messages = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' }
      });

      return res.json(messages);
    } catch (error: any) {
      logger.error(`Error retrieving messages: ${error.message}`);
      return res.status(500).json({ error: 'Failed to retrieve messages' });
    }
  }

  static async searchDuckDuckGo(query: string): Promise<string> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeoutId);
      if (!res.ok) return '';
      const html = await res.text();
      const parts = html.split('<div class="result results_links results_links_deep web-result');
      
      const results: { title: string; url: string; snippet: string }[] = [];
      for (let i = 1; i < parts.length && results.length < 5; i++) {
        const block = parts[i];
        const titleUrlRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
        const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i;
        
        const titleUrlMatch = block.match(titleUrlRegex);
        const snippetMatch = block.match(snippetRegex);
        
        if (titleUrlMatch) {
          const rawUrl = titleUrlMatch[1];
          const title = titleUrlMatch[2].replace(/<[^>]*>/g, '').trim();
          const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';
          
          let href = rawUrl;
          if (rawUrl.startsWith('//')) {
            href = 'https:' + rawUrl;
          }
          if (href.includes('uddg=')) {
            const splitParts = href.split('uddg=')[1].split('&');
            href = decodeURIComponent(splitParts[0]);
          }
          results.push({ title, url: href, snippet });
        }
      }
      return results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   Snippet: ${r.snippet}`).join('\n\n');
    } catch (err: any) {
      logger.error(`DuckDuckGo search failed: ${err.message}`);
      return '';
    }
  }

  static async sendMessage(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    const { 
      sessionId, 
      content, 
      systemPrompt, 
      model, 
      activeUrl, 
      webSearchSkillActive,
      miumiverseSkillActive,
      canvasContext 
    } = req.body;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!sessionId || !content) {
      return res.status(400).json({ error: 'Session ID and message content are required' });
    }

    // Get username / email details
    const userEmail = req.user?.email || '';
    let username = userEmail;
    if (userEmail === 'admin@miuniverse.de') username = 'thaimachine';
    else if (userEmail === 'empresario@miuniverse.de') username = 'empresario';
    else username = userEmail.split('@')[0];

    // Load Admin-set system prompts (global vs user specific)
    let adminSystemPrompt = 'Du bist ein kompetenter KI-Architekt.';
    const systemPromptsPath = path.resolve(__dirname, '../../storage/system_prompts.json');
    if (fs.existsSync(systemPromptsPath)) {
      try {
        const promptsData = JSON.parse(fs.readFileSync(systemPromptsPath, 'utf8'));
        if (promptsData.users && promptsData.users[username]) {
          adminSystemPrompt = promptsData.users[username];
        } else if (promptsData.users && promptsData.users[userEmail]) {
          adminSystemPrompt = promptsData.users[userEmail];
        } else if (promptsData.global) {
          adminSystemPrompt = promptsData.global;
        }
      } catch (e: any) {
        logger.error(`Error parsing system prompts: ${e.message}`);
      }
    }

    // Profiling mode check
    const isProfiling = systemPrompt && systemPrompt.includes('Du bist ein professioneller Profiler');
    if (isProfiling) {
      adminSystemPrompt = systemPrompt;
    }

    // Load user's personalization memory (profile.json)
    let memoryPrompt = '';
    const userDir = getUserDir(userEmail);
    const profileJsonPath = path.join(userDir, 'profile.json');
    if (fs.existsSync(profileJsonPath)) {
      try {
        const profileData = JSON.parse(fs.readFileSync(profileJsonPath, 'utf8'));
        memoryPrompt = `\n\n[USER PERSONALIZATION MEMORY]:
Username: ${profileData.username || 'User'}
Wohnort: ${profileData.wohnort || 'Nicht angegeben'}
Adresse: ${profileData.adresse || 'Nicht angegeben'}
Telefon: ${profileData.telefon || 'Nicht angegeben'}
Beruf/Arbeit: ${profileData.beruf || 'Nicht angegeben'}
Mindset: ${profileData.mindset || 'Nicht angegeben'}
Wer bin ich (Biografie): ${profileData.bio || 'Nicht angegeben'}
Profile Memory Analysis: ${profileData.profileMemory || 'Keine'}
`;
      } catch (e: any) {
        logger.error(`Error loading profile.json for memory prompt: ${e.message}`);
      }
    }

    // System prompt comes first (more powerful), then user memory
    let baseSystemPrompt = adminSystemPrompt;

    // Append workspace modes / skill rules if they exist in the incoming frontend prompt
    if (systemPrompt && !isProfiling) {
      const workspaceIndex = systemPrompt.indexOf('\n\n[ARBEITSBEREICH-MODUS:');
      if (workspaceIndex !== -1) {
        baseSystemPrompt += systemPrompt.substring(workspaceIndex);
      }
      const skillIndex = systemPrompt.indexOf('\n\n[SPEZIAL-SKILL:');
      if (skillIndex !== -1 && !baseSystemPrompt.includes('[SPEZIAL-SKILL:')) {
        baseSystemPrompt += systemPrompt.substring(skillIndex);
      }
    }

    baseSystemPrompt = `${baseSystemPrompt}${memoryPrompt}`;

    if (miumiverseSkillActive) {
      baseSystemPrompt += MiumiverseService.generateSystemContext(canvasContext);
    }

    // Log request to live_requests.json for Admin Board monitor
    try {
      const liveRequestsPath = path.resolve(__dirname, '../../storage/live_requests.json');
      let liveList = [];
      if (fs.existsSync(liveRequestsPath)) {
        liveList = JSON.parse(fs.readFileSync(liveRequestsPath, 'utf8'));
      }
      
      const firstSentence = content.split(/[.!?\n]/)[0].trim() || content;
      
      const reqLog = {
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        username,
        email: userEmail,
        message: content,
        firstSentence,
        sessionId,
        timestamp: new Date().toISOString()
      };
      
      liveList.unshift(reqLog);
      if (liveList.length > 50) {
        liveList = liveList.slice(0, 50);
      }
      fs.writeFileSync(liveRequestsPath, JSON.stringify(liveList, null, 2), 'utf8');
    } catch (e: any) {
      logger.error(`Failed to write live request log: ${e.message}`);
    }

    try {
      // 1. Verify session ownership
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId }
      });
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // 2. Save User Message
      await prisma.message.create({
        data: {
          sessionId,
          role: 'user',
          content
        }
      });

      // 3. Retrieve chat history for context
      const history = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' }
      });

      // If it's the first user message, auto-generate a thematic title in the background
      if (history.length === 1) {
        (async () => {
          try {
            const titlePrompt = `Generiere einen kurzen, prägnanten Titel (maximal 4-5 Wörter, KEINE Anführungszeichen, KEINE Interpunktion am Ende) für eine Chat-Unterhaltung, die mit folgender Nachricht beginnt:\n"${content}"`;
            const titleResponse = await ChatService.sendChatMessage(
              userId,
              [{ role: 'user', content: titlePrompt }],
              'Du bist ein Assistent, der extrem kurze, prägnante Chat-Themen-Titel auf Deutsch erstellt.',
              'MiniMax-M3'
            );
            const title = titleResponse.content.trim().replace(/^"(.*)"$/, '$1').replace(/[.!?]$/, '');
            if (title && title.length < 50) {
              await prisma.session.update({
                where: { id: sessionId },
                data: { title }
              });
              logger.info(`Auto-generated session title: "${title}" for session ${sessionId}`);
            }
          } catch (err: any) {
            logger.warn(`Failed to auto-generate session title: ${err.message}`);
          }
        })();
      }

      const formattingRules = `\n\n[STRIKTE ANTWORT-REGELN]:
1. Antworte extrem kurz, präzise und direkt auf Deutsch (maximal 1-3 Sätze, es sei denn, es ist eine komplexe technische Programmieraufgabe). Keine Wiederholungen, keine langen Einleitungen oder Formatierungs-Schnörkel. Wenn der Benutzer mehr Details will, fragt er nach.
2. Alle Web-Links und URLs MÜSSEN als anklickbare Markdown-Links wie [Name](URL) formatiert sein. Keine Roh-URLs im Text.
3. Alle Quellennachweise, Suchergebnisse, Links und recherchierten Quellen MÜSSEN zwingend am Ende der Antwort in ein einklappbares Element gepackt werden:
<details>
<summary>Source</summary>
[Hier die Quellen oder Links als Liste]
</details>
Platziere absolut KEINE Links, Weblinks oder Quellen außerhalb dieses details-Tags.`;

      const messagePayload = history.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      let responseContent = '';
      let tokensUsed = 0;

      // DUO Mode implementation
      if (model === 'Duo') {
        logger.info('Duo Mode active. Requesting fast M2.7 response first...');
        const m27SystemPrompt = baseSystemPrompt + formattingRules;
        const response27 = await ChatService.sendChatMessage(userId, messagePayload, m27SystemPrompt, 'MiniMax-M2.7-highspeed');
        
        let sanitizedM27 = `**[M2.7 Flash Antwort]:**\n\n${response27.content}`;
        const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
        if (response27.content.match(thinkRegex)) {
          sanitizedM27 = `**[M2.7 Flash Antwort]:**\n\n${response27.content.replace(thinkRegex, '').trim()}`;
        }

        // Save M2.7 response to database immediately so it populates history
        const assistantMessage = await prisma.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: sanitizedM27,
            tokenCount: response27.tokensUsed
          }
        });
        logger.info('Duo Mode: M2.7 response saved to database.');

        // Optionally invoke Speech Synthesis (TTS) for M2.7
        let base64Audio: string | null = null;
        try {
          const ttsResult = await TtsService.synthesizeText(response27.content.replace(thinkRegex, '').trim());
          if (ttsResult) {
            base64Audio = ttsResult.audioBuffer.toString('base64');
          }
        } catch (e) {}

        const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

        return res.json({
          message: assistantMessage,
          audio: base64Audio,
          tokenBalance: updatedUser?.tokenBalance,
          hasDuoM3Pending: true
        });
      }

      // 3.5 Check for Auto-Search intent if Skill is active
      let searchContext = '';
      if (webSearchSkillActive) {
        const queryLower = content.toLowerCase();
        const keywords = ['suche', 'search', 'news', 'aktuell', 'neuigkeiten', 'neues', 'neu', 'heute', 'wer ist', 'was ist', 'reddit', 'google', 'twitter', 'youtube', 'claude', 'fable', 'wissen', 'update', 'zeitung', 'artikel', 'bericht', 'neueste', 'letzte', 'informationen', 'info', 'stand', 'wetter', 'regen', 'temperatur', 'grad', 'wind', 'vorhersage', 'wettervorhersage', 'schneit', 'sonne', 'schnee'];
        const hasSearchIntent = keywords.some(kw => queryLower.includes(kw));

        if (hasSearchIntent) {
          logger.info(`Web Search Skill active. User query "${content}" matched keywords. Searching DuckDuckGo...`);
          const searchResults = await ChatController.searchDuckDuckGo(content);
          if (searchResults) {
            searchContext = `\n\n[SPEZIAL-SKILL: ECHTZEIT-INTERNETSUCHE & FAKTENCHECK]
Du hast soeben eine erfolgreiche Websuche durchgeführt. Hier sind die echten Echtzeit-Suchergebnisse aus dem Internet für die Anfrage des Benutzers (Quellen: Google, Reddit, Twitter, YouTube):
${searchResults}

WICHTIGE ANWEISUNGEN FÜR DIE ANTWORT:
1. Du hast vollen Echtzeitzugriff durch diese Suchergebnisse. Behaupte nicht, dass du keinen Internetzugang hast.
2. Falls die Suchergebnisse nur generische Hauptseiten (wie 'handelsblatt.com/themen' oder 'all-ai.de') ohne konkrete aktuelle Nachrichtendetails enthalten, darfst du auf KEINEN Fall Nachrichten erfinden (z. B. keine erfundenen Deals wie "SpaceX kauft Cursor" oder erfundene Modelle). 
3. Wenn die Suchergebnisse keine echten Nachrichtendetails hergeben, antworte ehrlich: Sag dem Benutzer, dass die Websuche nur allgemeine AI-Nachrichtenportale geliefert hat und frage ihn höflich, nach welchem konkreten Thema oder Ereignis (z.B. "OpenAI Sora", "Claude 3.5", "DeepMind AlphaFold") er suchen möchte, um präzisere Suchergebnisse zu erhalten.
4. Strukturiere die Antwort (falls nutzbare Daten da sind) übersichtlich in "Zusammenfassung der Neuigkeiten", "Faktencheck (Was stimmt wirklich - Vergleich zwischen Reddit, Google, Twitter & YouTube)" und "Quellen & Links".
5. Falls YouTube-Videos oder Links in den Suchergebnissen vorkommen, liste sie im Format '[Titel](URL)' auf.`;
          }
        }
      }



      const isGeminiRequested = model && model.toLowerCase().startsWith('gemini');

      if (activeUrl || isGeminiRequested) {
        const geminiModel = isGeminiRequested ? model : 'gemini-1.5-flash';
        logger.info(`Processing chat request with Gemini model: ${geminiModel}`);
        
        let webpageText = '';
        if (activeUrl) {
          try {
            const fetchRes = await fetch(activeUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              }
            });
            if (fetchRes.ok) {
              const html = await fetchRes.text();
              webpageText = html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 15000);
            }
          } catch (err: any) {
            logger.error(`Error scraping url context: ${err.message}`);
            webpageText = `[Webseiten-Inhalt konnte nicht geladen werden]`;
          }
        }

        try {
          let systemContent = baseSystemPrompt + formattingRules;
          if (activeUrl) {
            systemContent += `\n\nDer Benutzer stellt Fragen bezüglich dieser Webseite/dieses YouTube-Videos: ${activeUrl}\n\nWebseiten-Inhalt:\n${webpageText}\n\nBitte beantworte die Fragen des Benutzers präzise basierend auf diesem Kontext.`;
          }
          if (searchContext) {
            systemContent += searchContext;
          }

          const geminiPayload = {
            model: geminiModel,
            messages: [
              {
                role: 'system',
                content: systemContent
              },
              ...messagePayload
            ],
            temperature: 0.7
          };

          const geminiRes = await fetch(`${env.GEMINI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.GEMINI_API_KEY}`
            },
            body: JSON.stringify(geminiPayload)
          });

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json() as any;
            responseContent = geminiData.choices?.[0]?.message?.content || '';
            
            // Count and deduct tokens for Gemini call
            const inputTokens = TokenService.countTokens(JSON.stringify(geminiPayload));
            const outputTokens = TokenService.countTokens(responseContent);
            tokensUsed = inputTokens + outputTokens;
            await TokenService.verifyAndDeduct(userId, tokensUsed);
          } else {
            const errText = await geminiRes.text();
            logger.warn(`Gemini query failed with status ${geminiRes.status} (${errText}). Falling back to MiniMax.`);
          }
        } catch (err: any) {
          logger.warn(`Gemini query failed with error: ${err.message}. Falling back to MiniMax.`);
        }
      }

      // Fallback to MiniMax if not processed or if Gemini failed
      if (!responseContent) {
        logger.info('Processing chat query with MiniMax model.');
        let minimaxSystemPrompt = baseSystemPrompt + formattingRules;
        if (activeUrl) {
          let webpageText = '';
          try {
            const fetchRes = await fetch(activeUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              }
            });
            if (fetchRes.ok) {
              const html = await fetchRes.text();
              webpageText = html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 15000);
            }
          } catch (e) {}
          minimaxSystemPrompt += `\n\nDer Benutzer stellt Fragen bezüglich dieser Webseite/dieses YouTube-Videos: ${activeUrl}\n\nWebseiten-Inhalt:\n${webpageText}\n\nBitte beantworte die Fragen des Benutzers präzise basierend auf diesem Kontext.`;
        }
        if (searchContext) {
          minimaxSystemPrompt += searchContext;
        }
        const minimaxModel = model && model.toLowerCase().startsWith('gemini') ? 'MiniMax-M3' : model;
        const response = await ChatService.sendChatMessage(userId, messagePayload, minimaxSystemPrompt, minimaxModel);
        responseContent = response.content;
        tokensUsed = response.tokensUsed;
      }

      // Clean think blocks that leak developer policy/system prompts
      let sanitizedContent = responseContent;
      const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
      const match = responseContent.match(thinkRegex);
      if (match) {
        const thinkText = match[1];
        const forbiddenWords = ['policy', 'system_prompt', 'instruction', 'regel', 'developer policy', 'systemprompt'];
        const containsForbidden = forbiddenWords.some(word => thinkText.toLowerCase().includes(word));
        
        if (containsForbidden) {
          // Replace only the think block, leave the actual content untouched
          sanitizedContent = responseContent.replace(thinkRegex, '').trim();
          logger.info('Sanitized model think block due to developer policy leak prevention.');
        }
      }

      // Check if response contains profiling summary
      const email = req.user?.email;
      const profileSummaryRegex = /\[PROFILE_SUMMARY_START\]([\s\S]*?)\[PROFILE_SUMMARY_END\]/i;
      const profileMatch = sanitizedContent.match(profileSummaryRegex);
      if (profileMatch && email) {
        const extractedMemory = profileMatch[1].trim();
        logger.info(`AI Profiling summary detected for user ${email}. Saving to profile.json/md...`);
        
        try {
          const userDir = getUserDir(email);
          const jsonPath = path.join(userDir, 'profile.json');
          const mdPath = path.join(userDir, 'profile.md');

          let profileData = {
            wohnort: '',
            adresse: '',
            telefon: '',
            beruf: '',
            mindset: '',
            bio: '',
            profileMemory: ''
          };

          if (fs.existsSync(jsonPath)) {
            try {
              profileData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            } catch (e) {}
          }

          profileData.profileMemory = extractedMemory;
          
          const extractField = (text: string, keywords: string[]) => {
            for (const kw of keywords) {
              const regex = new RegExp(`${kw}\\s*:\\s*([^\\n\\r]+)`, 'i');
              const match = text.match(regex);
              if (match) return match[1].trim();
            }
            return null;
          };

          profileData.wohnort = extractField(extractedMemory, ['wohnort', 'ort', 'stadt', 'city', 'location']) || profileData.wohnort;
          profileData.adresse = extractField(extractedMemory, ['adresse', 'address', 'anschrift']) || profileData.adresse;
          profileData.telefon = extractField(extractedMemory, ['telefon', 'telefonnummer', 'phone', 'mobil', 'tel']) || profileData.telefon;
          profileData.beruf = extractField(extractedMemory, ['beruf', 'arbeit', 'job', 'occupation', 'profession']) || profileData.beruf;
          profileData.mindset = extractField(extractedMemory, ['mindset', 'einstellung', 'lebensphilosophie']) || profileData.mindset;
          profileData.bio = extractField(extractedMemory, ['bio', 'biografie', 'wer bin ich', 'beschreibung']) || profileData.bio;

          fs.writeFileSync(jsonPath, JSON.stringify(profileData, null, 2), 'utf8');

          const mdContent = `# Profil & Persona von ${email}

## Personalien
- **Wohnort:** ${profileData.wohnort}
- **Adresse:** ${profileData.adresse}
- **Telefon:** ${profileData.telefon}

## Profil-Details
- **Beruf / Arbeit:** ${profileData.beruf}
- **Mindset / Einstellung:** ${profileData.mindset}
- **Wer bin ich (Biografie):** ${profileData.bio}

## KI-Profil-Memory (Analyse)
${profileData.profileMemory}
`;
          fs.writeFileSync(mdPath, mdContent, 'utf8');
        } catch (err: any) {
          logger.error(`Failed to auto-update profile memory: ${err.message}`);
        }
        
        // Strip the tags and block from visible content
        sanitizedContent = sanitizedContent.replace(profileSummaryRegex, '').trim();
      }

      // Miumiverse & Hermes Parser ausführen
      const { cleanResponse: afterCanvasText, actions } = MiumiverseService.extractCanvasActions(sanitizedContent);
      const { cleanResponse: finalCleanResponse, exportedFiles } = HermesService.processHermesExports(afterCanvasText);

      // 5. Optionally invoke Speech Synthesis (TTS)
      let base64Audio: string | null = null;
      try {
        const ttsResult = await TtsService.synthesizeText(finalCleanResponse.replace(thinkRegex, '').trim());
        if (ttsResult) {
          base64Audio = ttsResult.audioBuffer.toString('base64');
        }
      } catch (ttsError) {
        logger.warn(`TTS synthesis skipped or failed: ${ttsError}`);
      }

      // 6. Save Assistant response (Speichere den gesäuberten Text)
      const assistantMessage = await prisma.message.create({
        data: {
          sessionId,
          role: 'assistant',
          content: finalCleanResponse,
          tokenCount: tokensUsed
        }
      });

      // 7. Get remaining balance
      const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

      return res.json({
        message: assistantMessage,
        audio: base64Audio, // Send as base64 string for direct frontend reproduction
        tokenBalance: updatedUser?.tokenBalance,
        canvasActions: actions,         // Canvas Befehle ans Frontend schicken
        exportedFiles: exportedFiles     // Generierte Dateien mitsenden
      });

    } catch (error: any) {
      logger.error(`Error sending chat message: ${error.message}`);
      return res.status(500).json({ error: error.message || 'Failed to process chat message' });
    }
  }

  static async handleDuoM3(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    const { sessionId, systemPrompt, activeUrl } = req.body;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });

    try {
      // 1. Verify session ownership
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId }
      });
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // 2. Get the last user message for context
      const lastUserMessage = await prisma.message.findFirst({
        where: { sessionId, role: 'user' },
        orderBy: { createdAt: 'desc' }
      });
      if (!lastUserMessage) {
        return res.status(400).json({ error: 'No user message found in this session' });
      }

      // 3. Retrieve chat history for context
      const history = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' }
      });

      const messagePayload = history.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const formattingRules = `\n\n[STRIKTE ANTWORT-REGELN]:
1. Antworte extrem kurz, präzise und direkt auf Deutsch (maximal 1-3 Sätze, es sei denn, es ist eine komplexe technische Programmieraufgabe). Keine Wiederholungen, keine langen Einleitungen oder Formatierungs-Schnörkel. Wenn der Benutzer mehr Details will, fragt er nach.
2. Alle Web-Links und URLs MÜSSEN als anklickbare Markdown-Links wie [Name](URL) formatiert sein. Keine Roh-URLs im Text.
3. Alle Quellennachweise, Suchergebnisse, Links und recherchierten Quellen MÜSSEN zwingend am Ende der Antwort in ein einklappbares Element gepackt werden:
<details>
<summary>Source</summary>
[Liste der Quellen / Links]
</details>`;

      // Force web search for M3
      logger.info('Duo Mode handleDuoM3: Performing web search for M3 Think...');
      const searchResults = await ChatController.searchDuckDuckGo(lastUserMessage.content);
      let duoSearchContext = '';
      if (searchResults) {
        duoSearchContext = `\n\n[ECHTZEIT-SUCHERGEBNISSE AUS DEM INTERNET - FAKTENCHECK]:
Heute ist der ${new Date().toLocaleDateString('de-DE')}. Hier sind die aktuellen, echten Internetsuchergebnisse für die Anfrage des Benutzers:
${searchResults}

WICHTIGE ANWEISUNSEN FÜR DIE DUO-ANTWORT:
1. Du bist MiniMax M3.
2. Der Benutzer hat soeben eine schnelle Kurzantwort von M2.7 Flash erhalten.
3. Deine Aufgabe ist es, eine tiefere Analyse durchzuführen.
4. Vergleiche die echten Suchergebnisse mit der Fragestellung und liefere eine präzise, detaillierte Ergänzung oder Korrektur.
5. Verwende das aktuelle Datum (${new Date().toLocaleDateString('de-DE')}) falls relevant.
6. Strukturiere die Antwort in "Zusammenfassung der Neuigkeiten", "Faktencheck" und "Quellen & Links".`;
      } else {
        duoSearchContext = `\n\n[ECHTZEIT-SUCHERGEBNISSE AUS DEM INTERNET]:
Die Internetsuche lieferte keine Ergebnisse. Heute ist der ${new Date().toLocaleDateString('de-DE')}.
Deine Aufgabe ist es, die M2.7 Flash Antwort durch deine gründlichere M3 Think logische Analyse zu ergänzen oder zu präzisieren.`;
      }

      let m3SystemPrompt = (systemPrompt || '') + formattingRules + duoSearchContext;
      if (activeUrl) {
        let webpageText = '';
        try {
          const fetchRes = await fetch(activeUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          if (fetchRes.ok) {
            const html = await fetchRes.text();
            webpageText = html
              .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .substring(0, 15000);
          }
        } catch (e) {}
        m3SystemPrompt += `\n\nDer Benutzer stellt Fragen bezüglich dieser Webseite/dieses YouTube-Videos: ${activeUrl}\n\nWebseiten-Inhalt:\n${webpageText}\n\nBitte beantworte die Fragen des Benutzers präzise basierend auf diesem Kontext.`;
      }

      logger.info('Duo Mode handleDuoM3: Requesting deep M3 response...');
      const response3 = await ChatService.sendChatMessage(userId, messagePayload, m3SystemPrompt, 'MiniMax-M3');
      
      const m3Content = `**[M3 Deep Analysis Antwort]:**\n\n${response3.content}`;

      // Clean think blocks that leak developer policy
      let sanitizedContent = m3Content;
      const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
      const match = m3Content.match(thinkRegex);
      if (match) {
        const thinkText = match[1];
        const forbiddenWords = ['policy', 'system_prompt', 'instruction', 'regel', 'developer policy', 'systemprompt'];
        const containsForbidden = forbiddenWords.some(word => thinkText.toLowerCase().includes(word));
        if (containsForbidden) {
          sanitizedContent = m3Content.replace(thinkRegex, '').trim();
        }
      }

      // Save Assistant response
      const assistantMessage = await prisma.message.create({
        data: {
          sessionId,
          role: 'assistant',
          content: sanitizedContent,
          tokenCount: response3.tokensUsed
        }
      });

      // Optionally invoke Speech Synthesis (TTS)
      let base64Audio: string | null = null;
      try {
        const ttsResult = await TtsService.synthesizeText(sanitizedContent.replace(thinkRegex, '').trim());
        if (ttsResult) {
          base64Audio = ttsResult.audioBuffer.toString('base64');
        }
      } catch (e) {}

      // Get remaining balance
      const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

      return res.json({
        message: assistantMessage,
        audio: base64Audio,
        tokenBalance: updatedUser?.tokenBalance
      });

    } catch (error: any) {
      logger.error(`Error in handleDuoM3: ${error.message}`);
      return res.status(500).json({ error: error.message || 'Failed to process Duo M3 analysis' });
    }
  }

  static async summarizeUrl(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    const { url, sessionId } = req.body;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!url || !sessionId) {
      return res.status(400).json({ error: 'URL and Session ID are required' });
    }

    try {
      // 1. Verify session ownership
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId }
      });
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // 2. Determine if it is a YouTube video
      const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
      const actionText = isYoutube ? 'Zusammenfassung des YouTube-Videos anfordern' : 'Zusammenfassung der Webseite anfordern';

      // Save user message to database
      await prisma.message.create({
        data: {
          sessionId,
          role: 'user',
          content: `${actionText}: ${url}`
        }
      });

      // 3. Fetch webpage text
      let webpageText = '';
      try {
        const fetchRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        if (!fetchRes.ok) throw new Error(`HTTP Status ${fetchRes.status}`);
        const html = await fetchRes.text();
        
        // Strip scripts, styles, html tags
        webpageText = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 15000); // safety cap
      } catch (err: any) {
        logger.error(`Error scraping URL ${url}: ${err.message}`);
        webpageText = `[Webseite konnte nicht geladen werden. Fehler: ${err.message}]`;
      }

      // 4. Try Gemini API first
      let summaryText = '';
      try {
        const geminiPayload = {
          model: 'gemini-1.5-flash',
          messages: [
            {
              role: 'system',
              content: 'Du bist ein kompetenter KI-Assistent. Deine Aufgabe ist es, den bereitgestellten Text einer Webseite oder eines YouTube-Videos prägnant, strukturiert und professionell auf Deutsch zusammenzufassen. Konzentriere dich auf die Kernaussagen, Links, wichtige Namen oder Termine.'
            },
            {
              role: 'user',
              content: `Bitte fasse folgenden Webseiten- bzw. Videoinhalt zusammen:\nURL: ${url}\n\nInhalt:\n${webpageText}`
            }
          ],
          temperature: 0.5
        };

        const geminiRes = await fetch(`${env.GEMINI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.GEMINI_API_KEY}`
          },
          body: JSON.stringify(geminiPayload)
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json() as any;
          summaryText = geminiData.choices?.[0]?.message?.content || '';
        } else {
          const errText = await geminiRes.text();
          logger.warn(`Gemini summarizer failed with status ${geminiRes.status} (${errText}). Falling back to MiniMax.`);
        }
      } catch (err: any) {
        logger.warn(`Gemini summarizer failed with error: ${err.message}. Falling back to MiniMax.`);
      }

      // Fallback to MiniMax-M3 if Gemini failed
      if (!summaryText) {
        logger.info('Performing summarization using MiniMax-M3.');
        const minimaxResponse = await ChatService.sendChatMessage(
          userId,
          [
            {
              role: 'user',
              content: `Bitte fasse folgenden Webseiten- bzw. Videoinhalt zusammen:\nURL: ${url}\n\nInhalt:\n${webpageText}`
            }
          ],
          'Du bist ein kompetenter KI-Assistent. Deine Aufgabe ist es, den bereitgestellten Text einer Webseite oder eines YouTube-Videos prägnant, strukturiert und professionell auf Deutsch zusammenzufassen. Konzentriere dich auf die Kernaussagen, Links, wichtige Namen oder Termine.',
          'MiniMax-M3'
        );
        summaryText = minimaxResponse.content;
      }

      // Save assistant message
      const assistantMessage = await prisma.message.create({
        data: {
          sessionId,
          role: 'assistant',
          content: summaryText,
          tokenCount: 0 // Free or handled by Gemini/MiniMax fallback
        }
      });

      // Optionally generate speech audio using MiniMax TTS
      let base64Audio: string | null = null;
      try {
        const ttsResult = await TtsService.synthesizeText(summaryText.substring(0, 400));
        if (ttsResult) {
          base64Audio = ttsResult.audioBuffer.toString('base64');
        }
      } catch (ttsError) {
        logger.warn(`TTS for summary failed: ${ttsError}`);
      }

      const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

      return res.json({
        message: assistantMessage,
        audio: base64Audio,
        tokenBalance: updatedUser?.tokenBalance
      });

    } catch (error: any) {
      logger.error(`Error in summarizeUrl: ${error.message}`);
      return res.status(500).json({ error: error.message || 'Zusammenfassung fehlgeschlagen.' });
    }
  }

  static async getProfile(req: AuthenticatedRequest, res: Response) {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const userDir = getUserDir(email);
      const jsonPath = path.join(userDir, 'profile.json');
      let profileData: any = {};
      
      if (fs.existsSync(jsonPath)) {
        try {
          profileData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        } catch (e) {}
      } else {
        profileData = {
          username: '',
          wohnort: '',
          adresse: '',
          telefon: '',
          beruf: '',
          mindset: '',
          bio: '',
          profileMemory: '',
          autoLive: false,
          latitude: null,
          longitude: null,
          lastLocationUpdate: null
        };
      }

      // Inject token balance from SQLite database
      if (req.user?.id) {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (user) {
          const updatedBalance = await TokenService.checkAndResetMonthlyTokens(user);
          profileData.tokenBalance = updatedBalance;
        }
      }

      return res.json(profileData);
    } catch (error: any) {
      logger.error(`Error loading profile: ${error.message}`);
      return res.status(500).json({ error: 'Failed to load profile' });
    }
  }

  static async updateProfile(req: AuthenticatedRequest, res: Response) {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const { 
        username, wohnort, adresse, telefon, beruf, mindset, bio, profileMemory,
        autoLive, latitude, longitude, lastLocationUpdate 
      } = req.body;
      const userDir = getUserDir(email);
      const jsonPath = path.join(userDir, 'profile.json');
      const mdPath = path.join(userDir, 'profile.md');

      const profileData = {
        username: username || '',
        wohnort: wohnort || '',
        adresse: adresse || '',
        telefon: telefon || '',
        beruf: beruf || '',
        mindset: mindset || '',
        bio: bio || '',
        profileMemory: profileMemory || '',
        autoLive: autoLive ?? false,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        lastLocationUpdate: lastLocationUpdate || null
      };

      fs.writeFileSync(jsonPath, JSON.stringify(profileData, null, 2), 'utf8');

      const mdContent = `# Profil & Persona von ${email}

## Name / Spitzname
- **Spitzname / Name:** ${profileData.username}

## Personalien
- **Wohnort:** ${profileData.wohnort}
- **Adresse:** ${profileData.adresse}
- **Telefon:** ${profileData.telefon}

## Live-Ortung & Status (Auto / Live)
- **Auto / Live aktiv:** ${profileData.autoLive ? 'Ja' : 'Nein'}
- **Letzte Koordinaten:** ${profileData.latitude && profileData.longitude ? `${profileData.latitude}, ${profileData.longitude}` : 'Keine'}
- **Letztes Update:** ${profileData.lastLocationUpdate || 'Nie'}

## Profil-Details
- **Beruf / Arbeit:** ${profileData.beruf}
- **Mindset / Einstellung:** ${profileData.mindset}
- **Wer bin ich (Biografie):** ${profileData.bio}

## KI-Profil-Memory (Analyse)
${profileData.profileMemory || 'Noch keine KI-Profil-Analyse vorhanden.'}
`;

      fs.writeFileSync(mdPath, mdContent, 'utf8');
      return res.json(profileData);
    } catch (error: any) {
      logger.error(`Error updating profile: ${error.message}`);
      return res.status(500).json({ error: 'Failed to update profile' });
    }
  }

  static async updateSession(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    const { sessionId } = req.params;
    const { title } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!title) return res.status(400).json({ error: 'Title is required' });

    try {
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId }
      });
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const updated = await prisma.session.update({
        where: { id: sessionId },
        data: { title }
      });

      return res.json(updated);
    } catch (error: any) {
      logger.error(`Error updating session: ${error.message}`);
      return res.status(500).json({ error: 'Failed to update session' });
    }
  }

  static async deleteSession(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    const { sessionId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId }
      });
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // First delete associated messages to avoid foreign key violations in SQLite/Prisma
      await prisma.message.deleteMany({
        where: { sessionId }
      });

      // Then delete the session
      await prisma.session.delete({
        where: { id: sessionId }
      });

      return res.json({ message: 'Session deleted successfully' });
    } catch (error: any) {
      logger.error(`Error deleting session: ${error.message}`);
      return res.status(500).json({ error: 'Failed to delete session' });
    }
  }

  static async getMinimaxBalance(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const customKey = req.query.key as string;
    const apiKey = customKey || env.MINIMAX_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: 'No MiniMax API Key available' });
    }

    let tokenPlanData = null;
    let codingPlanData = null;
    let errorMsg = null;

    // 1. Try Token Plan remains
    try {
      const response = await fetch('https://api.minimax.chat/v1/token_plan/remains', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        tokenPlanData = await response.json();
      } else {
        errorMsg = `Token Plan: ${response.status} ${await response.text()}`;
      }
    } catch (err: any) {
      errorMsg = `Token Plan Request Error: ${err.message}`;
    }

    // 2. Try Coding Plan remains
    try {
      const response2 = await fetch('https://api.minimax.chat/v1/api/openplatform/coding_plan/remains', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (response2.ok) {
        codingPlanData = await response2.json();
      } else if (!tokenPlanData) {
        errorMsg = `Coding Plan: ${response2.status} ${await response2.text()}`;
      }
    } catch (err: any) {
      if (!tokenPlanData) {
        errorMsg = `Coding Plan Request Error: ${err.message}`;
      }
    }

    if (!tokenPlanData && !codingPlanData) {
      return res.status(500).json({ error: errorMsg });
    }

    return res.json({
      tokenPlan: tokenPlanData,
      codingPlan: codingPlanData
    });
  }

  static async getWeatherReport(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    const { latitude, longitude, isChangeCheck } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    try {
      // 1. Fetch weather from Open-Meteo
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=temperature_2m,precipitation_probability,precipitation&timezone=auto`;
      const response = await fetch(weatherUrl);
      if (!response.ok) {
        throw new Error(`Open-Meteo returned status ${response.status}`);
      }
      const data = await response.json() as any;

      const current = data.current_weather;
      const hourly = data.hourly;
      
      // Determine precipitation probability for the next 4 hours
      let rainIncomingMinutes = 0; // 0 means no immediate rain expected
      let maxPrecipProb = 0;
      
      const now = new Date();
      const currentHourIdx = now.getHours();

      // Look ahead 4 hours
      for (let i = 0; i < 4; i++) {
        const idx = (currentHourIdx + i) % 24;
        const prob = hourly.precipitation_probability[idx] || 0;
        const precip = hourly.precipitation[idx] || 0;
        if (prob > maxPrecipProb) {
          maxPrecipProb = prob;
        }
        if (precip > 0.1 && prob > 30 && rainIncomingMinutes === 0) {
          rainIncomingMinutes = (i === 0) ? 15 : i * 60;
        }
      }

      // 2. Draft AI Prompt
      const weatherInfoText = `Aktuelle Temperatur: ${current.temperature}°C. Windgeschwindigkeit: ${current.windspeed} km/h. Maximale Regenwahrscheinlichkeit in den nächsten Stunden: ${maxPrecipProb}%. Regen angesagt in ca: ${rainIncomingMinutes > 0 ? `${rainIncomingMinutes} Minuten` : 'Nein (trocken)'}.`;
      
      let systemPrompt = `Du bist der persönliche Wetter-Assistent der KI-Plattform Miunicorn. Deine Aufgabe ist es, einen super kurzen, freundlichen, gesprochenen Wetterbericht auf Deutsch zu formulieren (maximal 2-3 Sätze).
Beachte folgende Regeln:
1. Wenn Regen bevorsteht (z.B. in 15 bis 60 Minuten), warne den Benutzer direkt (z.B. "Achtung, es kommt Regen in ca. 30 Minuten. Nimm einen Regenschirm mit!").
2. Wenn kein Regen bevorsteht und das Wetter gut/stabil ist, antworte positiv (z.B. "Das Wetter sieht stabil aus. Es bleibt warm und trocken. Du kannst beruhigt spazieren gehen.").
3. Schreibe rein sprechbaren Text, keine Listen, keine Sonderzeichen, keine Tabellen.`;

      if (isChangeCheck) {
        systemPrompt += `\nWICHTIG: Dies ist ein automatischer Sicherheitscheck. Antworte NUR, wenn sich das Wetter verschlechtert (Regen droht) oder wenn es sich signifikant ändert. Wenn das Wetter trocken und stabil bleibt, antworte EXAKT mit dem Wort 'STABIL' (ohne andere Zeichen), damit wir den Benutzer nicht unnötig stören.`;
      }

      // 3. Invoke LLM (Gemini or fallback to MiniMax)
      let reportText = '';
      try {
        const geminiPayload = {
          model: 'gemini-1.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Generiere den gesprochenen Wetterbericht basierend auf diesen Daten:\n${weatherInfoText}` }
          ],
          temperature: 0.5
        };

        const geminiRes = await fetch(`${env.GEMINI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.GEMINI_API_KEY}`
          },
          body: JSON.stringify(geminiPayload)
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json() as any;
          reportText = geminiData.choices?.[0]?.message?.content?.trim() || '';
        }
      } catch (e) {}

      if (!reportText) {
        const minimaxResponse = await ChatService.sendChatMessage(
          userId,
          [{ role: 'user', content: `Generiere den gesprochenen Wetterbericht basierend auf diesen Daten:\n${weatherInfoText}` }],
          systemPrompt,
          'MiniMax-M3'
        );
        reportText = minimaxResponse.content.trim();
      }

      // If it is just a change-check check and the weather is stable, or LLM returned 'STABIL'
      if (isChangeCheck && (reportText.toUpperCase().includes('STABIL') || maxPrecipProb < 30)) {
        return res.json({ status: 'stable', speak: false });
      }

      // 4. Generate TTS audio
      let base64Audio = null;
      try {
        const ttsResult = await TtsService.synthesizeText(reportText);
        if (ttsResult) {
          base64Audio = ttsResult.audioBuffer.toString('base64');
        }
      } catch (ttsErr) {
        logger.warn(`TTS for weather report failed: ${ttsErr}`);
      }

      return res.json({
        status: rainIncomingMinutes > 0 ? 'rain' : 'fine',
        text: reportText,
        audio: base64Audio,
        speak: true
      });

    } catch (error: any) {
      logger.error(`Error in getWeatherReport: ${error.message}`);
      return res.status(500).json({ error: 'Failed to generate weather report' });
    }
  }

  static async explainWord(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    const { messages, model, mode, languages, buyLocation } = req.body;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // Set streaming headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendSSE = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      sendSSE({ status: 'Nachricht wird analysiert...' });

      const selectedModel = model || 'MiniMax-M3';

      let word = '';
      if (messages && messages.length > 0) {
        const lastMsg = messages[messages.length - 1].content;
        const match = lastMsg.match(/(?:definiere das wort\s*:\s*|kaufen\s*:\s*|Erkläre das Wort vereinfacht\s*:\s*)(.*)/i);
        word = match ? match[1].trim() : lastMsg.trim();
      }

      // Load local dictionaries
      loadLocalDictionaries();

      // Check local dictionaries
      const isCapitalized = /^[A-ZÄÖÜ]/.test(word.trim());
      const cleanWord = word.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
      let localTranslations: Record<string, string> = {};
      let allFoundLocally = true;

      if (localDeEn && Array.isArray(languages)) {
        for (const lang of languages) {
          const langUpper = lang.toUpperCase();
          const normLang = langUpper === 'THAI' ? 'TH' : langUpper;
          if (normLang === 'EN') {
            let translationsList: string[] = [];
            
            // 1. If capitalized, prioritize noun stem translations first (e.g. Vögeln -> Vögel)
            if (isCapitalized && cleanWord.endsWith('n')) {
              const stem1 = cleanWord.slice(0, -1);
              if (localDeEn[stem1]) {
                const parts = localDeEn[stem1].split('|').map(p => p.trim()).filter(Boolean);
                translationsList.push(...parts);
              }
              if (cleanWord.endsWith('en')) {
                const stem2 = cleanWord.slice(0, -2);
                if (localDeEn[stem2]) {
                  const parts = localDeEn[stem2].split('|').map(p => p.trim()).filter(Boolean);
                  translationsList.push(...parts);
                }
              }
            }
            
            // 2. Add the direct translation of the cleanWord
            if (localDeEn[cleanWord]) {
              const parts = localDeEn[cleanWord].split('|').map(p => p.trim()).filter(Boolean);
              translationsList.push(...parts);
            }
            
            // Deduplicate
            translationsList = [...new Set(translationsList)];
            
            if (translationsList.length > 0) {
              localTranslations[langUpper] = translationsList.slice(0, 3).join(' | ');
            } else {
              allFoundLocally = false;
            }
          } else if (normLang === 'TH' && localEnTh) {
            // Find English synonyms first from DE-EN translations (including stems)
            let enWords: string[] = [];
            
            if (isCapitalized && cleanWord.endsWith('n')) {
              const stem1 = cleanWord.slice(0, -1);
              if (localDeEn[stem1]) {
                const parts = localDeEn[stem1].split(/[|;,]/).map(w => w.replace(/[\(\)\{\}\[\]]/g, '').trim().toLowerCase());
                enWords.push(...parts);
              }
              if (cleanWord.endsWith('en')) {
                const stem2 = cleanWord.slice(0, -2);
                if (localDeEn[stem2]) {
                  const parts = localDeEn[stem2].split(/[|;,]/).map(w => w.replace(/[\(\)\{\}\[\]]/g, '').trim().toLowerCase());
                  enWords.push(...parts);
                }
              }
            }
            
            if (localDeEn[cleanWord]) {
              const parts = localDeEn[cleanWord].split(/[|;,]/).map(w => w.replace(/[\(\)\{\}\[\]]/g, '').trim().toLowerCase());
              enWords.push(...parts);
            }
            
            enWords = [...new Set(enWords)];
            
            if (enWords.length > 0) {
              let foundTh = false;
              let thTranslationsList: string[] = [];
              for (const rawEn of enWords) {
                const cleanEn = rawEn.replace(/^(the|a|an|to)\s+/, '').trim();
                if (cleanEn && localEnTh[cleanEn]) {
                  const rawTh = localEnTh[cleanEn];
                  const thParts = rawTh.split('|').map(p => p.trim()).filter(Boolean);
                  thTranslationsList.push(...thParts);
                  foundTh = true;
                }
              }
              if (foundTh) {
                thTranslationsList = [...new Set(thTranslationsList)];
                localTranslations[langUpper] = thTranslationsList.slice(0, 3).join(' | ');
              } else {
                allFoundLocally = false;
              }
            } else {
              allFoundLocally = false;
            }
          } else if (normLang === 'DE') {
            localTranslations[langUpper] = word;
          } else {
            allFoundLocally = false;
          }
        }
      } else {
        allFoundLocally = false;
      }

      if (allFoundLocally && Object.keys(localTranslations).length > 0) {
        logger.info(`[Backend Dict] Local hit for word: "${word}" -> ${JSON.stringify(localTranslations)}`);
        sendSSE({ translations: localTranslations, tokensUsed: 0 });
        if (mode === 'translate-only') {
          res.end();
          return;
        }
      }

      // Check Cache
      const langKey = Array.isArray(languages) ? [...languages].sort().join(',') : 'EN';
      const cacheKey = `${mode || 'normal'}:${selectedModel}:${word.toLowerCase()}:${langKey}`;
      if (explanationCache.has(cacheKey)) {
        const cached = explanationCache.get(cacheKey)!;
        logger.info(`Explanation Cache Hit for key: ${cacheKey}`);
        sendSSE({ status: 'Lade aus dem Cache...' });
        sendSSE({ 
          fastContent: (cached as any).fastContent,
          content: cached.content, 
          webContent: cached.webContent, 
          translations: (cached as any).translations,
          tokensUsed: cached.tokensUsed 
        });
        res.end();
        return;
      }

      // 1. Build Base System Prompt (without web search)
      let systemPrompt = `Erkläre das Wort kurz und verständlich in 1-2 Sätzen für einen 15-Jährigen auf Deutsch.
Befolge diese Formatierungsregeln strikt:
- Benutze NIEMALS Nummerierungen wie "**1:**" oder "**2:**".
- Benutze NIEMALS Markdown-Formatierung wie Fett (**wort**) oder Kursiv (*wort* oder _wort_). Antworte in reinem Fließtext.
- Benutze NIEMALS Sonderzeichen wie deutsche Anführungszeichen (,, und “), Schrägstriche (/), Gleichheitszeichen (=), Pfeile oder Spiegelstriche.
- Die einzig erlaubten Satzzeichen sind Punkte, Kommas, normale Anführungszeichen (") und Klammern ().
- Gib die Erklärungen als einfache Absätze aus, getrennt durch eine Leerzeile.
- Zeige die wahrscheinlichste Bedeutung (basierend auf der Groß-/Kleinschreibung des gesuchten Wortes) zuerst oben an. Da deutsche Nomen großgeschrieben werden, soll für ein großgeschriebenes Wort (z.B. "Macht") zuerst die Nomen-Bedeutung (die Macht, Stärke, Kraft) ganz oben stehen.
- Zeige alternative Grammatik-Rollen (z.B. dass "Macht" als Verb von "machen" kommt, wenn man es am Satzanfang großschreibt) darunter an, getrennt durch eine Leerzeile.`;

      if (mode === 'detailed') {
        systemPrompt = `Definiere und erkläre das Wort extrem wissenschaftlich, präzise und detailliert auf Deutsch. Maximal 2-3 Sätze.
Befolge diese Formatierungsregeln strikt:
- Benutze NIEMALS Nummerierungen wie "**1:**" oder "**2:**".
- Benutze NIEMALS Markdown-Formatierung wie Fett (**wort**) oder Kursiv (*wort* oder _wort_). Antworte in reinem Fließtext.
- Benutze NIEMALS Sonderzeichen wie deutsche Anführungszeichen (,, und “), Schrägstriche (/), Gleichheitszeichen (=), Pfeile oder Spiegelstriche.
- Die einzig erlaubten Satzzeichen sind Punkte, Kommas, normale Anführungszeichen (") und Klammern ().
- Gib die Erklärungen als einfache Absätze aus, getrennt durch eine Leerzeile.
- Zeige die wahrscheinlichste Bedeutung (basierend auf der Groß-/Kleinschreibung des gesuchten Wortes) zuerst oben an. Da deutsche Nomen großgeschrieben werden, soll für ein großgeschriebenes Wort (z.B. "Macht") zuerst die Nomen-Bedeutung (die Macht, Stärke, Kraft) ganz oben stehen.
- Zeige alternative Grammatik-Rollen (z.B. dass "Macht" als Verb von "machen" kommt, wenn man es am Satzanfang großschreibt) darunter an, getrennt durch eine Leerzeile.`;
      } else if (mode === 'simplified') {
        systemPrompt = `Erkläre das Wort extrem einfach und bildhaft für ein 8-jähriges Kind auf Deutsch. Maximal 1-2 kurze Sätze.
Befolge diese Formatierungsregeln strikt:
- Benutze NIEMALS Nummerierungen wie "**1:**" oder "**2:**".
- Benutze NIEMALS Markdown-Formatierung wie Fett (**wort**) oder Kursiv (*wort* oder _wort_). Antworte in reinem Fließtext.
- Benutze NIEMALS Sonderzeichen wie deutsche Anführungszeichen (,, und “), Schrägstriche (/), Gleichheitszeichen (=), Pfeile oder Spiegelstriche.
- Die einzig erlaubten Satzzeichen sind Punkte, Kommas, normale Anführungszeichen (") und Klammern ().
- Gib die Erklärungen als einfache Absätze aus, getrennt durch eine Leerzeile.
- Zeige die wahrscheinlichste Bedeutung (basierend auf der Groß-/Kleinschreibung des gesuchten Wortes) zuerst oben an. Da deutsche Nomen großgeschrieben werden, soll für ein großgeschriebenes Wort (z.B. "Macht") zuerst die Nomen-Bedeutung (die Macht, Stärke, Kraft) ganz oben stehen.
- Zeige alternative Grammatik-Rollen (z.B. dass "Macht" als Verb von "machen" kommt, wenn man es am Satzanfang großschreibt) darunter an, getrennt durch eine Leerzeile.`;
      } else if (mode === 'buy') {
        const location = buyLocation ? buyLocation.trim() : 'Deutschland';
        systemPrompt = `Nenne direkt und extrem kurz 2-3 konkrete, länderspezifische Einkaufsmöglichkeiten für das Produkt in der Region/Land "${location}" auf Deutsch.
Befolge diese Formatierungsregeln strikt:
- Benutze NIEMALS Nummerierungen oder Auflistungszeichen.
- Benutze NIEMALS Markdown-Formatierung wie Fett (**wort**) oder Kursiv (*wort* oder _wort_). Antworte in reinem Fließtext.
- Benutze NIEMALS Sonderzeichen wie deutsche Anführungszeichen (,, und “), Schrägstriche (/), Gleichheitszeichen (=), Pfeile oder Spiegelstriche.
- Die einzig erlaubten Satzzeichen sind Punkte, Kommas, normale Anführungszeichen (") und Klammern ().
Speziell für das Land/die Region:
- Falls es Deutschland ist: nenne bekannte deutsche Plattformen wie eBay, eBay Kleinanzeigen, Amazon oder andere passende deutsche Fachgeschäfte/Online-Shops.
- Falls es Thailand ist: nenne bekannte Plattformen in Thailand wie Lazada, Shopee, Kaidee oder große offizielle thailändische Warenhäuser/Zentrallager/Shops.
- Falls es ein anderes Land ist: passe die Einkaufsmöglichkeiten entsprechend an dieses Land an.`;
      }

      const callLLM = async (sysPrompt: string, modelOverride?: string): Promise<{ content: string; tokens: number }> => {
        let responseContent = '';
        let tokensUsed = 0;
        const targetModel = modelOverride || selectedModel;
        const isGemini = targetModel.toLowerCase().startsWith('gemini');

        if (isGemini) {
          const geminiModel = targetModel;
          try {
            const geminiPayload = {
              model: geminiModel,
              messages: [
                { role: 'system', content: sysPrompt },
                ...messages
              ],
              temperature: 0.1
            };

            const geminiRes = await fetch(`${env.GEMINI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.GEMINI_API_KEY}`
              },
              body: JSON.stringify(geminiPayload)
            });

            if (geminiRes.ok) {
              const geminiData = await geminiRes.json() as any;
              responseContent = geminiData.choices?.[0]?.message?.content || '';
              const inputTokens = TokenService.countTokens(JSON.stringify(geminiPayload));
              const outputTokens = TokenService.countTokens(responseContent);
              tokensUsed = inputTokens + outputTokens;
              await TokenService.verifyAndDeduct(userId, tokensUsed);
            } else {
              const errText = await geminiRes.text();
              logger.warn(`Gemini explain-word failed with status ${geminiRes.status} (${errText}). Falling back to MiniMax.`);
            }
          } catch (err: any) {
            logger.warn(`Gemini explain-word failed with error: ${err.message}. Falling back to MiniMax.`);
          }
        }

        if (!responseContent) {
          const minimaxModel = isGemini ? 'MiniMax-M3' : targetModel;
          const response = await ChatService.sendChatMessage(userId, messages, sysPrompt, minimaxModel);
          responseContent = response.content;
          tokensUsed = response.tokensUsed;
        }

        // Clean think blocks
        let sanitizedContent = responseContent;
        const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
        const match = responseContent.match(thinkRegex);
        if (match) {
          sanitizedContent = responseContent.replace(thinkRegex, '').trim();
        }

        return { content: sanitizedContent, tokens: tokensUsed };
      };

      if (mode === 'translate-only') {
        sendSSE({ status: 'Übersetzen...' });
        let translations: Record<string, string> = {};
        let totalTokens = 0;
        if (word && Array.isArray(languages) && languages.length > 0) {
          try {
            const transPrompt = `Translate the word "${word}" into the following languages: ${languages.join(', ')}.
            Respond with a valid JSON object only, where keys are uppercase language codes and values are the translations. Example: {"EN": "translation", "ES": "translation"}.`;
            const transLLMRes = await callLLM(transPrompt);
            translations = parseSafeJSON(transLLMRes.content);
            totalTokens = transLLMRes.tokens;
            sendSSE({ translations });
          } catch (err: any) {
            logger.warn(`Failed to translate word "${word}": ${err.message}`);
          }
        }
        explanationCache.set(cacheKey, {
          fastContent: '',
          content: '',
          webContent: null,
          translations,
          tokensUsed: totalTokens
        } as any);
        res.end();
        return;
      }

      // 2. Call MiniMax-M2.7-highspeed for immediate fast response
      sendSSE({ status: 'Kurzerklärung (M2.7) wird geladen...' });
      const fastLLMRes = await callLLM(systemPrompt, 'MiniMax-M2.7-highspeed');
      const sanitizedFast = sanitizeLLMContent(fastLLMRes.content);
      
      // Send immediate fast response
      sendSSE({ fastContent: sanitizedFast, tokensUsed: fastLLMRes.tokens });

      let totalTokens = fastLLMRes.tokens;

      // 3. Call MiniMax-M3 for a detailed explanation
      sendSSE({ status: 'Ausführliche Erklärung (M3) wird geladen...' });
      const detailedLLMRes = await callLLM(systemPrompt, 'MiniMax-M3');
      const sanitizedDetailed = sanitizeLLMContent(detailedLLMRes.content);

      // Send detailed explanation response
      sendSSE({ content: sanitizedDetailed, tokensUsed: totalTokens + detailedLLMRes.tokens });
      totalTokens += detailedLLMRes.tokens;

      // 4. Translation and background search
      let translations: Record<string, string> = {};
      if (word && Array.isArray(languages) && languages.length > 0) {
        try {
          const transPrompt = `Translate the word "${word}" into the following languages: ${languages.join(', ')}.
          Respond with a valid JSON object only, where keys are uppercase language codes and values are the translations. Example: {"EN": "translation", "ES": "translation"}.`;
          const transLLMRes = await callLLM(transPrompt, 'MiniMax-M2.7-highspeed'); // use fast model for translations too
          translations = parseSafeJSON(transLLMRes.content);
          totalTokens += transLLMRes.tokens;
          sendSSE({ translations });
        } catch (err: any) {
          logger.warn(`Failed to translate word "${word}": ${err.message}`);
        }
      }

      let webContent: string | null = null;

      // 5. Background search and second LLM call (only if word is set)
      if (word) {
        sendSSE({ status: `Suche im Web nach "${word}" läuft im Hintergrund...` });
        const searchQuery = mode === 'buy' 
          ? `"${word}" kaufen online-shop kleinanzeigen second-hand`
          : `"${word}"`;

        try {
          const searchResults = await ChatController.searchDuckDuckGo(searchQuery);
          if (searchResults) {
            sendSSE({ status: 'Suchergebnisse werden verarbeitet...' });
            
            // Build second prompt incorporating the search context
            const webSystemPrompt = `${systemPrompt}\n\n[ECHTZEIT-SUCHERGEBNISSE AUS DEM INTERNET]:\n${searchResults}\n\nNutze diese Websuch-Ergebnisse, um die vorherige Definition zu aktualisieren, zu ergänzen oder zu präzisieren. Liefere eine kurze, aktualisierte Definition in 1-2 Sätzen (oder im gleichen Format) auf Deutsch.`;
            
            const webLLMRes = await callLLM(webSystemPrompt, 'MiniMax-M3');
            webContent = sanitizeLLMContent(webLLMRes.content);
            totalTokens += webLLMRes.tokens;
            
            sendSSE({ webContent, tokensUsed: totalTokens });
          } else {
            sendSSE({ webContent: null });
          }
        } catch (err: any) {
          logger.warn(`Web search/hybrid call failed: ${err.message}`);
          sendSSE({ webContent: null });
        }
      } else {
        sendSSE({ webContent: null });
      }

      // 6. Save to Cache
      explanationCache.set(cacheKey, { 
        fastContent: sanitizedFast,
        content: sanitizedDetailed, 
        webContent, 
        translations,
        tokensUsed: totalTokens 
      } as any);

      res.end();
    } catch (error: any) {
      logger.error(`Error in explainWord: ${error.message}`);
      sendSSE({ error: error.message || 'Failed to explain word' });
      res.end();
    }
  }
}
