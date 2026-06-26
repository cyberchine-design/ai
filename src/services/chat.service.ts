import { env } from '../config/env';
import { TokenService } from './token.service';
import { logger } from '../utils/logger';

const BASE64_MARKDOWN_REGEX = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+)\)/g;
const UPLOAD_URL_REGEX = /https?:\/\/[^\/]+\/(?:[^\/]+\/)?uploads\/bilder\/([a-zA-Z0-9_\-]+)\/([a-f0-9]+\.[a-z]+)/g;
const ANY_IMAGE_MARKDOWN_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type ChatMessageInput = {
  role: string;
  content: string;
};

function stripMarkdownImages(rawContent: string, regex: RegExp): string {
  return rawContent.replace(regex, '').trim();
}

function extractImageUrls(rawContent: string): { filename: string; fullUrl: string }[] {
  const found: { filename: string; fullUrl: string }[] = [];
  let m;
  while ((m = UPLOAD_URL_REGEX.exec(rawContent)) !== null) {
    found.push({ filename: m[2], fullUrl: m[0] });
  }
  return found;
}

/**
 * Laedt ein Bild von einer URL herunter und konvertiert es zu base64 Data-URL.
 * M3 akzeptiert keine externen HTTPS-URLs in image_url - nur data:image/...;base64,...
 */
async function fetchImageAsBase64(url: string, timeoutMs: number = 10000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      logger.warn(`[Multimodal] Failed to fetch image ${url}: HTTP ${res.status}`);
      return null;
    }
    const contentType = res.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      logger.warn(`[Multimodal] URL is not an image: ${contentType}`);
      return null;
    }
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (e: any) {
    logger.error(`[Multimodal] Error fetching image ${url}: ${e.message}`);
    return null;
  }
}

async function buildMultimodalContent(rawContent: string): Promise<string | MessageContentPart[]> {
  const allImageMatches = [...rawContent.matchAll(ANY_IMAGE_MARKDOWN_REGEX)];
  const uploadedUrls = extractImageUrls(rawContent);
  const base64Matches = [...rawContent.matchAll(BASE64_MARKDOWN_REGEX)];

  if (allImageMatches.length === 0) {
    return rawContent;
  }

  let textOnly = stripMarkdownImages(rawContent, ANY_IMAGE_MARKDOWN_REGEX);

  const parts: MessageContentPart[] = [];
  if (textOnly) {
    parts.push({ type: 'text', text: textOnly });
  }

  for (const m of base64Matches) {
    parts.push({
      type: 'image_url',
      image_url: { url: m[2] }
    });
  }

  for (const { fullUrl } of uploadedUrls) {
    const base64 = await fetchImageAsBase64(fullUrl);
    if (base64) {
      parts.push({
        type: 'image_url',
        image_url: { url: base64 }
      });
      logger.info(`[Multimodal] Fetched ${fullUrl} -> base64 (${base64.length} chars)`);
    } else {
      logger.warn(`[Multimodal] Skipping image ${fullUrl} (fetch failed)`);
    }
  }

  if (parts.length === 0) {
    return textOnly || rawContent;
  }

  logger.info(`[Multimodal] Built payload with ${parts.length} part(s): ${uploadedUrls.length} uploaded -> base64, ${base64Matches.length} inline base64`);
  return parts;
}

export class ChatService {
  static async sendChatMessage(
    userId: string,
    messages: ChatMessageInput[],
    systemPrompt?: string,
    model: string = 'MiniMax-M3'
  ): Promise< { content: string; tokensUsed: number; error?: string; rawError?: string }> {
    let combinedInputText = systemPrompt || '';
    for (const msg of messages) {
      combinedInputText += `\n${msg.role}: ${msg.content}`;
    }
    const inputTokens = TokenService.countTokens(combinedInputText);

    const tokenVerification = await TokenService.verifyAndDeduct(userId, inputTokens);
    if (!tokenVerification) {
      throw new Error('Insufficient token balance');
    }

    const transformedMessages: { role: string; content: string | MessageContentPart[] }[] = [];
    for (const msg of messages) {
      const content = await buildMultimodalContent(msg.content);
      transformedMessages.push({
        role: msg.role,
        content
      });
    }

    const payload = {
      model: model || 'MiniMax-M3',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...transformedMessages
      ],
      temperature: 0.7
    };

    logger.info(`Sending request to MiniMax model ${payload.model} with ${inputTokens} input tokens (${transformedMessages.length} msgs, multimodal-aware).`);
    try {
      const response = await fetch(`${env.MINIMAX_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MINIMAX_API_KEY}`
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`MiniMax API request failed: ${response.status} - ${errorText}`);
        throw new Error(`MiniMax API error: ${response.statusText} | ${errorText.substring(0, 500)}`);
      }
      const responseData = (await response.json()) as any;
      const responseText = responseData.choices?.[0]?.message?.content || '';
      const outputTokens = TokenService.countTokens(responseText);
      await TokenService.verifyAndDeduct(userId, outputTokens);
      return {
        content: responseText,
        tokensUsed: inputTokens + outputTokens
      };
    } catch (error: any) {
      logger.error(`Error invoking MiniMax API: ${error.message}`);
      throw error;
    }
  }
}
