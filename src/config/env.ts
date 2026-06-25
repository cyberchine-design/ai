import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from root directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const env = {
  PORT: process.env.PORT || '5000',
  JWT_SECRET: process.env.JWT_SECRET || 'supersecrettokenkeymiunicorn',
  WHITELIST_EMAILS: (process.env.WHITELIST_EMAILS || '').split(','),
  
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY || '',
  MINIMAX_BASE_URL: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1/',
  
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
  
  BYTEPLUS_API_KEY: process.env.BYTEPLUS_API_KEY || '',
  BYTEPLUS_BASE_URL: process.env.BYTEPLUS_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3',
  BYTEPLUS_ENDPOINT_ID: process.env.BYTEPLUS_ENDPOINT_ID || '',
};

// Simple validation
if (!env.MINIMAX_API_KEY) {
  console.warn('⚠️ WARNING: MINIMAX_API_KEY is not configured in environment.');
}
