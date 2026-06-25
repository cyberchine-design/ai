import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { authRoutes } from './routes/auth.routes';
import { chatRoutes } from './routes/chat.routes';
import { adminRoutes } from './routes/admin.routes';
import { logger } from './utils/logger';
import { prisma } from './config/database';

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

// Seed default users if they don't exist
async function seedDefaultUsers() {
  try {
    const defaultEmails = ['admin@miuniverse.de', 'empresario@miuniverse.de'];
    for (const email of defaultEmails) {
      const exists = await prisma.user.findUnique({ where: { email } });
      if (!exists) {
        await prisma.user.create({
          data: {
            email,
            tokenBalance: 1000000
          }
        });
        logger.info(`Seeded default user: ${email}`);
      }
    }
  } catch (err: any) {
    logger.error(`Failed to seed default users: ${err.message}`);
  }
}
seedDefaultUsers();

// Simple health probe
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Global error handler caught: ${err.message}`);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

export default app;
