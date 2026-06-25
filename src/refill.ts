import { prisma } from './config/database';

async function main() {
  try {
    const updated = await prisma.user.updateMany({
      data: {
        tokenBalance: 5000000,
        maxTokenLimit: 5000000
      }
    });
    console.log(`Successfully refilled tokens in database:`, updated);
  } catch (err) {
    console.error("Error updating tokens:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
