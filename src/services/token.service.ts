import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

export class TokenService {
  static async checkAndResetMonthlyTokens(user: { id: string; email: string; tokenBalance: number }): Promise<number> {
    try {
      const currentMonth = new Date().toISOString().substring(0, 7); // e.g. "2026-06"
      const dir = path.resolve(__dirname, `../../storage/users/${user.email}`);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const resetFilePath = path.join(dir, 'token_reset.json');
      let lastResetMonth = '';
      if (fs.existsSync(resetFilePath)) {
        try {
          const data = JSON.parse(fs.readFileSync(resetFilePath, 'utf8'));
          lastResetMonth = data.lastResetMonth || '';
        } catch (e) {}
      }

      if (lastResetMonth !== currentMonth) {
        const defaultTokenBalance = 1000000;
        await prisma.user.update({
          where: { id: user.id },
          data: { tokenBalance: defaultTokenBalance }
        });
        fs.writeFileSync(resetFilePath, JSON.stringify({ lastResetMonth: currentMonth }), 'utf8');
        logger.info(`Monthly token reset applied for user ${user.email}. Reset to ${defaultTokenBalance}.`);
        return defaultTokenBalance;
      }
    } catch (error) {
      logger.error(`Error in checkAndResetMonthlyTokens: ${error}`);
    }
    return user.tokenBalance;
  }

  /**
   * Approximate token count based on character length.
   * Approx. 4 characters per token for western languages.
   */
  static countTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  static async verifyAndDeduct(userId: string, requestedAmount: number): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    if (user.tokenBalance < requestedAmount) {
      logger.warn(`User ${user.email} exceeded token limit. Balance: ${user.tokenBalance}, Requested: ${requestedAmount}`);
      return false;
    }

    // Deduct tokens
    await prisma.user.update({
      where: { id: userId },
      data: {
        tokenBalance: {
          decrement: requestedAmount
        }
      }
    });

    logger.info(`Deducted ${requestedAmount} tokens from user ${user.email}. New Balance: ${user.tokenBalance - requestedAmount}`);
    return true;
  }

  static async getBalance(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return user ? user.tokenBalance : 0;
  }
}
