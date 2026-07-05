// MR AI — Vercel Serverless Function (OpenRouter API)
// 5 fast models with quick timeouts — first success wins.
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
        if (message.length > 1000) return res.status(400).json({ error: 'Too long' });

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Set OPENROUTER_API_KEY in Vercel env vars.' });

        const systemPrompt = `You are MR AI for MR Chat (MR Group, founder: Tahmeed Bin Towfique). Reply in user's language (English->English, Bengali->Bengali). 1-2 sentences max. Be casual like a friend. If "hi"->"Hi! I'm MR AI. How can I help?" Features: chat, feed, store(113 items), 11 games, Mind Reset(free), Motivation(free). Don't list features unless asked. Suggest Mind Reset for stress.`;

        const messages = [{ role: 'system', content: systemPrompt }];
        if (Array.isArray(history)) {
            for (const msg of history.slice(-4)) {
                if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }
        }
        messages.push({ role: 'user', content: message });

        // 5 models — try each with a 8-second timeout, first success wins
        const models = [
            'meta-llama/llama-3.3-70b-instruct:free',
            'openai/gpt-oss-20b:free',
            'nvidia/nemotron-nano-9b-v2:free',
            'meta-llama/llama-3.2-3b-instruct:free',
            'liquid/lfm-2.5-1.2b-instruct:free'
        ];

        for (const model of models) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);

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
                        temperature: 0.5,
                        max_tokens: 200,
                        stream: false
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeout);

                if (response.ok) {
                    const data = await response.json();
                    const reply = data?.choices?.[0]?.message?.content;
                    if (reply && reply.trim().length > 0) {
                        return res.status(200).json({ reply: reply });
                    }
                }
            } catch (e) {
                // timeout or error — try next model immediately
            }
        }

        return res.status(200).json({ reply: 'MR AI is busy. Try again in a moment.' });

    } catch (error) {
        return res.status(500).json({ error: 'AI unavailable.' });
    }
};
