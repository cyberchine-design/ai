import { Router } from 'express';
import * as fileCtrl from '../controllers/file.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware as any);

router.get('/temp-list', fileCtrl.listTempFiles as any);
router.get('/temp-download/:id', fileCtrl.downloadTempFile as any);

export const filesRoutes = router;