import { env } from '../config/env';
import { TokenService } from './token.service';
import { logger } from '../utils/logger';

export class ChatService {
  static async sendChatMessage(
    userId: string,
    messages: { role: string; content: string }[],
    systemPrompt?: string,
    model: string = 'MiniMax-M3'
  ): Promise<{ content: string; tokensUsed: number }> {
    // 1. Calculate input tokens
    let combinedInputText = systemPrompt || '';
    for (const msg of messages) {
      combinedInputText += `\n${msg.role}: ${msg.content}`;
    }
    const inputTokens = TokenService.countTokens(combinedInputText);

    // 2. Check token limit
    const tokenVerification = await TokenService.verifyAndDeduct(userId, inputTokens);
    if (!tokenVerification) {
      throw new Error('Insufficient token balance');
    }

    // 3. Make API request to MiniMax
    const payload = {
      model: model || 'MiniMax-M3',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages
      ],
      temperature: 0.7
    };

    logger.info(`Sending request to MiniMax model ${payload.model} with ${inputTokens} input tokens.`);

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
        throw new Error(`MiniMax API error: ${response.statusText}`);
      }

      const responseData = (await response.json()) as any;
      const responseText = responseData.choices?.[0]?.message?.content || '';

      // 4. Calculate output tokens and deduct
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
