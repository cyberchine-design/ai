import { env } from '../config/env';
import { logger } from '../utils/logger';

export class TtsService {
  /**
   * Convert text to speech audio buffer or return a mock base64/URL.
   */
  static async synthesizeText(text: string): Promise<{ audioBuffer: Buffer; contentType: string } | null> {
    if (!env.MINIMAX_API_KEY) {
      logger.warn('No MiniMax key configured for TTS synthesis.');
      return null;
    }

    try {
      // MiniMax voice clone / synthesis endpoint
      // Typically: /v1/text_to_speech/stream or /v1/t2a_v2
      const response = await fetch('https://api.minimax.chat/v1/t2a_v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MINIMAX_API_KEY}`
        },
        body: JSON.stringify({
          model: 'speech-01',
          text: text,
          voice_setting: {
            voice_id: 'female-yujia', // standard MiniMax voice id
            speed: 1.0,
            vol: 1.0,
            pitch: 0
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: 'mp3'
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`MiniMax TTS API failed with status ${response.status}: ${errorText}. Falling back to default Web Audio.`);
        return null;
      }

      // Parse the response which contains the audio or file download link
      const data = (await response.json()) as any;
      
      // Some minimax formats return base64 or download url
      if (data.audio_data) {
        const audioBuffer = Buffer.from(data.audio_data, 'base64');
        return { audioBuffer, contentType: 'audio/mp3' };
      }
      
      return null;
    } catch (error: any) {
      logger.error(`Error during speech synthesis: ${error.message}`);
      return null;
    }
  }
}
