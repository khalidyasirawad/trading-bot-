/**
 * Generates twice-weekly promo posts:
 *   - Caption  → OpenAI GPT-4o
 *   - Image    → OpenAI DALL-E 3 (1792×1024 landscape)
 *
 * Posted Tue + Fri at 10:00 UTC to the PUBLIC channel.
 */

import OpenAI from 'openai';

const getClient = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CAPTION_PROMPT = `Write a punchy Telegram promo caption for a VIP trading signal channel.
Rules:
- Max 175 characters
- Dark, confident tone (professional trader voice)
- Reference gold (XAU/USD) trading or market edge
- End with a call to action mentioning VIP access
- NO hashtags, NO emojis at start, plain text only

Return ONLY the caption text, nothing else.`;

const IMAGE_PROMPT =
  'Dark futuristic trading terminal, multiple glowing gold candlestick charts on black screens, ' +
  'subtle gold (#f5c842) accent lighting, cinematic depth of field, no text, no UI elements, ' +
  'photorealistic, 8k, dramatic atmosphere, luxury finance aesthetic';

/**
 * Generate a promo caption via GPT-4o.
 * @returns {Promise<string>}
 */
async function generateCaption() {
  const response = await getClient().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 256,
    messages: [{ role: 'user', content: CAPTION_PROMPT }],
  });
  const text = response.choices[0].message.content?.trim() ?? '';
  return `${text}\n\n👉 Join VIP: ${process.env.PAYMENT_LINK ?? 'Link in bio'}`;
}

/**
 * Generate a trading chart image via DALL-E 3.
 * Returns image as a Buffer, or null if generation fails.
 * @returns {Promise<Buffer|null>}
 */
async function generateImage() {
  try {
    const response = await getClient().images.generate({
      model: 'dall-e-3',
      prompt: IMAGE_PROMPT,
      n: 1,
      size: '1792x1024',
      quality: 'standard',
      response_format: 'url',
    });

    const imageUrl = response.data[0]?.url;
    if (!imageUrl) return null;

    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn('[promoPost] DALL-E 3 image generation failed:', err.message);
    return null;
  }
}

/**
 * Build and return the promo post data.
 * @returns {Promise<{ caption: string, imageBuffer: Buffer|null }>}
 */
export async function generatePromoPost() {
  const [caption, imageBuffer] = await Promise.all([
    generateCaption(),
    generateImage(),
  ]);
  return { caption, imageBuffer };
}
