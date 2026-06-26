import { Request, Response } from 'express';
import * as compressService from '../services/compress.service';
import * as fileService from '../services/file.service';
import { logger } from '../utils/logger';

export async function compressChat(req: Request, res: Response) {
  const email = fileService.getEmailFromToken(req.headers.authorization);
  if (!email) return res.status(401).json({ error: 'unauthorized' });

  const { session_id, message_count, messages: providedMessages } = req.body || {};
  if (!session_id && !providedMessages) {
    return res.status(400).json({ error: 'missing session_id or messages' });
  }

  try {
    let messages: { role: string; content: string }[];

    if (providedMessages && Array.isArray(providedMessages)) {
      messages = providedMessages;
    } else {
      messages = await loadMessagesFromSession(session_id, message_count || 50, email);
    }

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'no_messages' });
    }

    const { summary, tokens_used } = await compressService.compressChat(messages, email);

    return res.json({
      summary_markdown: summary,
      tokens_used,
      estimated_cost_usd: compressService.estimateCostUsd(tokens_used)
    });
  } catch (err: any) {
    logger.error(`[compress] endpoint error: ${err.message}`);
    if (err.status === 402 || err.code === 'token_budget' || /quota|budget/i.test(err.message || '')) {
      return res.status(402).json({ error: 'token_budget_exceeded' });
    }
    if (err.status === 401 || err.status === 403) {
      return res.status(err.status).json({ error: 'llm_auth_error' });
    }
    return res.status(500).json({ error: 'llm_error', message: err.message });
  }
}

async function loadMessagesFromSession(sessionId: string, limit: number, userEmail: string): Promise<{ role: string; content: string }[]> {
  logger.warn(`[compress] loadMessagesFromSession not implemented for session=${sessionId} user=${userEmail}`);
  return [];
}