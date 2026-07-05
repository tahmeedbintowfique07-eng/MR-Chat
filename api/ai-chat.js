// MR AI — Vercel Serverless Function (OpenRouter API)
// 20 free models — if one fails, instantly tries the next.
// Setup: Vercel → Settings → Environment Variables → OPENROUTER_API_KEY = your key

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { message, history } = req.body || {};
        if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message required' });
        if (message.length > 2000) return res.status(400).json({ error: 'Too long' });

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Set OPENROUTER_API_KEY in Vercel. Get key: https://openrouter.ai/keys' });

        const systemPrompt = `You are MR AI, the official AI assistant for MR Chat, a product of MR Group.
Founder of MR Group: Tahmeed Bin Towfique.

RULES:
- Reply in 1-3 sentences maximum. Be SHORT and helpful.
- Use the user's language (Bengali reply for Bengali, English for English).
- Never make up features. Only mention what's listed below.

MR CHAT FEATURES (memorize this — do NOT add anything):
- Messaging: 1:1 DMs, Group Rooms, Secret Chat (E2E encrypted), Voice/Video Calls
- Feed: Posts, Stories, Reactions, Comments, Share, Save
- Store: 113 items (frames, themes, avatars, name colors, boosts, etc.). Gold & Diamonds currencies.
- Games: 11 games (Dice, Quiz, Love Calc, Memory, Guess Number, 2048, Snake, Tic-Tac-Toe, Word Scramble, Math Blitz). Arcade games cost 500 Gold entry fee.
- Mind Reset: FREE wellness feature (breathing, meditation, stress relief). Brain icon on dashboard.
- Motivation Hub: FREE daily motivation, goal tracking. Fire icon on dashboard.
- Security: Firebase Auth, Google OAuth, 2FA, reCAPTCHA, E2E encryption, 30-day account deletion grace.
- Themes: 10 themes available.
- PWA: Installable on mobile & desktop.
- Admin Panel: Analytics, user management, gold/diamond distribution.

CURRENCIES:
- Gold: Earn from games, gifts. Used in store.
- Diamonds: Buy with Gold. Used for premium store items.

If user asks about stress/anxiety → suggest Mind Reset (free).
If user asks about motivation/goals → suggest Motivation Hub (free).
If you don't know something, say "I'm not sure about that. Try checking the Settings or asking in the app."`;

        const messages = [{ role: 'system', content: systemPrompt }];

        if (Array.isArray(history)) {
            for (const msg of history.slice(-10)) {
                if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }
        }
        messages.push({ role: 'user', content: message });

        // 20 free models — biggest/best first, small/fast as fallback
        const models = [
            'nvidia/nemotron-3-ultra-550b-a55b:free',
            'nousresearch/hermes-3-llama-3.1-405b:free',
            'qwen/qwen3-coder:free',
            'nvidia/nemotron-3-super-120b-a12b:free',
            'openai/gpt-oss-120b:free',
            'qwen/qwen3-next-80b-a3b-instruct:free',
            'meta-llama/llama-3.3-70b-instruct:free',
            'google/gemma-4-31b-it:free',
            'google/gemma-4-26b-a4b-it:free',
            'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
            'nvidia/nemotron-3-nano-30b-a3b:free',
            'openai/gpt-oss-20b:free',
            'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
            'nvidia/nemotron-nano-12b-v2-vl:free',
            'nvidia/nemotron-nano-9b-v2:free',
            'meta-llama/llama-3.2-3b-instruct:free',
            'poolside/laguna-m.1:free',
            'poolside/laguna-xs-2.1:free',
            'liquid/lfm-2.5-1.2b-instruct:free',
            'liquid/lfm-2.5-1.2b-thinking:free'
        ];

        let reply = null;
        let lastError = null;

        for (const model of models) {
            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + apiKey,
                        'HTTP-Referer': 'https://mrchat.vercel.app',
                        'X-Title': 'MR Chat'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        temperature: 0.7,
                        max_tokens: 800
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    reply = data?.choices?.[0]?.message?.content;
                    if (reply && reply.trim().length > 0) {
                        console.log('MR AI ✓', model);
                        break;
                    }
                } else {
                    const errData = await response.json().catch(() => ({}));
                    lastError = response.status + ' ' + (errData?.error?.message || '').substring(0, 80);
                    if (response.status === 401 || response.status === 403) {
                        return res.status(500).json({ error: 'Invalid OpenRouter API key. Check OPENROUTER_API_KEY.' });
                    }
                }
            } catch (e) {
                lastError = e.message;
            }
        }

        if (reply) {
            return res.status(200).json({ reply: reply });
        }

        console.error('MR AI: All models failed:', lastError);
        return res.status(200).json({ 
            reply: 'MR AI is busy right now. Please try again in a minute.' 
        });

    } catch (error) {
        console.error('MR AI error:', error);
        return res.status(500).json({ error: 'AI temporarily unavailable.' });
    }
};
