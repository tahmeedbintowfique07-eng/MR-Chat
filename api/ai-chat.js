// MR AI — Vercel Serverless Function (OpenRouter API)
// Setup: Vercel → Settings → Environment Variables → OPENROUTER_API_KEY = your key
// Get free key: https://openrouter.ai/keys

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

        const systemPrompt = 'You are MR AI, the official AI assistant for MR Chat by MR Group. Founder: Tahmeed Bin Towfique. MR Chat features: Messaging (DMs, group rooms, E2E secret chat, voice/video calls), Social Feed (posts, stories, reactions), Premium Store (113 products, Gold & Diamonds), Games Arena (11 games), Mind Reset (free wellness), Motivation Hub (free motivation), Security (Firebase Auth, 2FA, E2E). Be friendly. Use user language (Bengali or English). If user mentions stress, recommend Mind Reset. If user mentions motivation, recommend Motivation Hub.';

        const messages = [{ role: 'system', content: systemPrompt }];

        if (Array.isArray(history)) {
            for (const msg of history.slice(-10)) {
                if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }
        }
        messages.push({ role: 'user', content: message });

        // Correct free model names from OpenRouter (verified 2025)
        const models = [
            'meta-llama/llama-3.3-70b-instruct:free',
            'openai/gpt-oss-120b:free',
            'nvidia/nemotron-3-super-120b-a12b:free',
            'qwen/qwen3-next-80b-a3b-instruct:free',
            'meta-llama/llama-3.2-3b-instruct:free'
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
                        max_tokens: 1000
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    reply = data?.choices?.[0]?.message?.content;
                    if (reply) {
                        console.log('MR AI: Success with', model);
                        break;
                    }
                } else {
                    const errData = await response.json().catch(() => ({}));
                    lastError = response.status + ' ' + (errData?.error?.message || '').substring(0, 100);
                    console.log('MR AI: ' + model + ' →', response.status);
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
