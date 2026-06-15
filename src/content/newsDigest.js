/**
 * Generates a daily AI-in-trading news digest using OpenAI GPT-4o with web search.
 * Posted to the PUBLIC channel daily at 07:00 UTC.
 */

import OpenAI from 'openai';

const getClient = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT = `You are a trading news curator. Search the web and find the 3 most important news stories from the LAST 24 HOURS about:
- Major XAU/USD (Gold) or BTC/USD price-moving events
- AI tools being used in financial markets or trading
- Central bank decisions, CPI, NFP, or macro events affecting gold or crypto

Format your response as ONLY this JSON (no markdown, no extra text):
{
  "items": [
    { "headline": "Short headline (max 10 words)", "summary": "One sentence summary.", "source": "Publication name" },
    { "headline": "...", "summary": "...", "source": "..." },
    { "headline": "...", "summary": "...", "source": "..." }
  ]
}`;

/**
 * Fetch and format a daily news digest post for Telegram.
 * @returns {Promise<string>} Telegram HTML formatted message
 */
export async function generateNewsDigest() {
  const response = await getClient().chat.completions.create({
    model: 'gpt-4o-search-preview',
    web_search_options: { search_context_size: 'medium' },
    messages: [{ role: 'user', content: PROMPT }],
  });

  const text = response.choices[0].message.content ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Could not parse news digest JSON: ${text.slice(0, 200)}`);

  const { items } = JSON.parse(jsonMatch[0]);

  const bullets = items.map(
    (item, i) =>
      `${i + 1}. <b>${item.headline}</b>\n   <i>${item.summary}</i> — <code>${item.source}</code>`
  ).join('\n\n');

  return [
    `🤖 <b>AI Trading News — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</b>`,
    '',
    bullets,
    '',
    '─────────────────────',
    '🤖 AI is reshaping trading. Are you ahead of it?',
    `👉 Join VIP: ${process.env.PAYMENT_LINK ?? 'Link in bio'}`,
  ].join('\n');
}
