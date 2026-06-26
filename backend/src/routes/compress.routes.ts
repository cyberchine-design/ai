import { Router } from 'express';
import { compressChat } from '../controllers/compress.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware as any);

router.post('/compress', compressChat as any);

export const compressRoutes = router;