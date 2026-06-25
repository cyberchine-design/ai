import { ChatService } from './src/services/chat.service';
import { prisma } from './src/config/database';
import { logger } from './src/utils/logger';

async function runTest() {
  logger.info('Starting MiniMax Connection test...');

  try {
    // 1. Seed Whitelisted User
    const email = 'testuser@miunicorn.de';
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          tokenBalance: 100000
        }
      });
      logger.info(`Seeded test user: ${email}`);
    }

    // 2. Call Chat Service
    logger.info('Calling ChatService to send a message to MiniMax M3...');
    const response = await ChatService.sendChatMessage(
      user.id,
      [{ role: 'user', content: 'Hallo, wer bist du und was ist deine Version?' }],
      'Du bist ein freundlicher Assistent.'
    );

    logger.info('Successfully received response from MiniMax:');
    console.log('-----------------------------------------');
    console.log(response.content);
    console.log('-----------------------------------------');
    logger.info(`Tokens used: ${response.tokensUsed}`);

  } catch (error: any) {
    logger.error(`Connection test failed: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
