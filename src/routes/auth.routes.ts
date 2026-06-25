import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { TokenService } from '../services/token.service';

const router = Router();

router.post('/mock-login', async (req: Request, res: Response) => {
  let { email, password } = req.body;
  
  const trimmedEmail = (email || '').trim().toLowerCase();
  
  if ((trimmedEmail === 'empresario' || trimmedEmail === 'empresario@miuniverse.de')) {
    if (password !== 'Wer2341q!!!') {
      logger.warn(`Auth failed: Incorrect password for Empresario`);
      return res.status(401).json({ error: 'Access Denied: Invalid credentials' });
    }
    email = 'empresario@miuniverse.de';
  } else if ((trimmedEmail === 'thaimachine' || trimmedEmail === 'admin@miuniverse.de')) {
    if (password !== 'Wer2341q!!!') {
      logger.warn(`Auth failed: Incorrect password for thaimachine`);
      return res.status(401).json({ error: 'Access Denied: Invalid credentials' });
    }
    email = 'admin@miuniverse.de';
  } else {
    logger.warn(`Auth failed: Invalid username or email ${email}`);
    return res.status(401).json({ error: 'Access Denied: Invalid credentials' });
  }

  try {
    // Find or create user in SQLite database
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          tokenBalance: 1000000 // Seed with 1,000,000 tokens
        }
      });
      logger.info(`New whitelisted user created: ${email}`);
    } else {
      const updatedBalance = await TokenService.checkAndResetMonthlyTokens(user);
      user.tokenBalance = updatedBalance;
    }

    // Sign JWT token
    const token = jwt.sign({ id: user.id, email: user.email }, env.JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        tokenBalance: user.tokenBalance
      }
    });
  } catch (error) {
    logger.error(`Error during mock-login: ${error}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export const authRoutes = router;
