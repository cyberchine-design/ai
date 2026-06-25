import { Router } from 'express';
import { ChatController } from '../controllers/chat.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware as any);

router.get('/sessions', ChatController.getSessions as any);
router.post('/sessions', ChatController.createSession as any);
router.get('/sessions/:sessionId/messages', ChatController.getSessionMessages as any);
router.post('/messages', ChatController.sendMessage as any);
router.post('/summarize', ChatController.summarizeUrl as any);
router.get('/profile', ChatController.getProfile as any);
router.post('/profile', ChatController.updateProfile as any);
router.put('/sessions/:sessionId', ChatController.updateSession as any);
router.delete('/sessions/:sessionId', ChatController.deleteSession as any);
router.get('/minimax-balance', ChatController.getMinimaxBalance as any);
router.post('/weather-report', ChatController.getWeatherReport as any);
router.post('/explain-word', ChatController.explainWord as any);

export const chatRoutes = router;
