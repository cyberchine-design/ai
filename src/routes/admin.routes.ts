import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

const router = Router();

const systemPromptsPath = path.resolve(__dirname, '../../storage/system_prompts.json');
const liveRequestsPath = path.resolve(__dirname, '../../storage/live_requests.json');

// Ensure storage dir exists
const storageDir = path.resolve(__dirname, '../../storage');
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

// Helper to check if caller is admin
const verifyAdmin = (req: AuthenticatedRequest, res: Response, next: () => void) => {
  if (req.user?.email !== 'admin@miuniverse.de') {
    logger.warn(`Unauthorized admin access attempt by ${req.user?.email}`);
    return res.status(403).json({ error: 'Access Denied: Admin privileges required' });
  }
  next();
};

// 1. List all users
router.get('/users', authMiddleware, verifyAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const mappedUsers = users.map(u => {
      let username = u.email;
      if (u.email === 'admin@miuniverse.de') username = 'thaimachine';
      else if (u.email === 'empresario@miuniverse.de') username = 'empresario';
      else username = u.email.split('@')[0];

      return {
        id: u.id,
        email: u.email,
        username,
        tokenBalance: u.tokenBalance,
        createdAt: u.createdAt
      };
    });

    return res.json(mappedUsers);
  } catch (err: any) {
    logger.error(`Error loading admin users: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// 2. Fetch all system prompts
router.get('/system-prompts', authMiddleware, verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!fs.existsSync(systemPromptsPath)) {
      return res.json({
        global: 'Du bist ein kompetenter KI-Architekt.',
        users: {}
      });
    }
    const data = JSON.parse(fs.readFileSync(systemPromptsPath, 'utf8'));
    return res.json(data);
  } catch (err: any) {
    logger.error(`Error reading system prompts: ${err.message}`);
    return res.status(500).json({ error: 'Failed to read system prompts' });
  }
});

// 3. Save system prompts
router.post('/system-prompts', authMiddleware, verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { global, users } = req.body;
    const data = {
      global: global || 'Du bist ein kompetenter KI-Architekt.',
      users: users || {}
    };
    fs.writeFileSync(systemPromptsPath, JSON.stringify(data, null, 2), 'utf8');
    logger.info('Admin updated system prompts configurations.');
    return res.json({ success: true, data });
  } catch (err: any) {
    logger.error(`Error saving system prompts: ${err.message}`);
    return res.status(500).json({ error: 'Failed to save system prompts' });
  }
});

// 4. Fetch live requests
router.get('/live-requests', authMiddleware, verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!fs.existsSync(liveRequestsPath)) {
      return res.json([]);
    }
    let list = JSON.parse(fs.readFileSync(liveRequestsPath, 'utf8'));
    
    // Filter out requests older than 30 minutes to keep list clean
    const halfHourAgo = Date.now() - 30 * 60 * 1000;
    list = list.filter((r: any) => new Date(r.timestamp).getTime() > halfHourAgo);
    
    fs.writeFileSync(liveRequestsPath, JSON.stringify(list, null, 2), 'utf8');
    return res.json(list);
  } catch (err: any) {
    return res.json([]);
  }
});

// 5. Inspect target user (Generate impersonation JWT)
router.post('/inspect', authMiddleware, verifyAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetEmail } = req.body;
    if (!targetEmail) {
      return res.status(400).json({ error: 'Target email is required' });
    }

    const user = await prisma.user.findUnique({ where: { email: targetEmail } });
    if (!user) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    // Sign a temporary token valid for 2 hours for the inspected user
    const token = jwt.sign(
      { id: user.id, email: user.email, isInspected: true }, 
      env.JWT_SECRET, 
      { expiresIn: '2h' }
    );

    let displayUsername = user.email;
    if (user.email === 'admin@miuniverse.de') displayUsername = 'thaimachine';
    else if (user.email === 'empresario@miuniverse.de') displayUsername = 'empresario';

    logger.info(`Admin initiated inspection session for user: ${user.email}`);
    return res.json({ token, email: user.email, username: displayUsername });
  } catch (err: any) {
    logger.error(`Error entering inspection: ${err.message}`);
    return res.status(500).json({ error: 'Failed to initiate inspection mode' });
  }
});

// 6. View chat session as HTML inside iframe
router.get('/session/:sessionId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { 
        messages: { 
          orderBy: { createdAt: 'asc' } 
        } 
      }
    });

    if (!session) {
      return res.send('<h3>Session nicht gefunden oder gelöscht.</h3>');
    }

    // Render a clean, styled HTML view
    const messageRows = session.messages.map(m => {
      const isUser = m.role === 'user';
      const bubbleClass = isUser ? 'user-bubble' : 'ai-bubble';
      const label = isUser ? 'User' : 'Thaimachine AI';
      return `
        <div class="message-row ${m.role}">
          <div class="bubble-label">${label}</div>
          <div class="bubble ${bubbleClass}">${m.content.replace(/\n/g, '<br/>')}</div>
        </div>
      `;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            background-color: #030809;
            color: #e2f1f2;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0;
            padding: 16px;
          }
          .header {
            border-bottom: 1px solid rgba(45, 200, 220, 0.15);
            padding-bottom: 12px;
            margin-bottom: 16px;
          }
          .title {
            margin: 0;
            font-size: 1.15rem;
            color: #2dc8dc;
          }
          .message-row {
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
          }
          .message-row.user {
            align-items: flex-end;
          }
          .message-row.assistant {
            align-items: flex-start;
          }
          .bubble-label {
            font-size: 0.75rem;
            color: rgba(45, 200, 220, 0.6);
            margin-bottom: 4px;
            margin-left: 4px;
            margin-right: 4px;
          }
          .bubble {
            max-width: 85%;
            padding: 10px 14px;
            border-radius: 12px;
            font-size: 0.9rem;
            line-height: 1.4;
          }
          .user-bubble {
            background-color: rgba(45, 200, 220, 0.15);
            color: #ffffff;
            border-bottom-right-radius: 2px;
          }
          .ai-bubble {
            background-color: rgba(255, 255, 255, 0.05);
            color: #eee;
            border-bottom-left-radius: 2px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h4 class="title">Inspektor-Ansicht: ${session.title}</h4>
        </div>
        <div class="chat-log">
          ${messageRows}
        </div>
      </body>
      </html>
    `;

    return res.send(html);
  } catch (err: any) {
    return res.status(500).send(`<h3>Fehler beim Laden des Chats: ${err.message}</h3>`);
  }
});

export const adminRoutes = router;
