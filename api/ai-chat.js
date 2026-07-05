// MR AI — Vercel Serverless Function (OpenRouter API)
// Fast: only 3 quick models, short system prompt, streaming disabled.
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
        if (message.length > 1500) return res.status(400).json({ error: 'Too long' });

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Set OPENROUTER_API_KEY in Vercel env vars.' });

        // Short system prompt = faster response
        const systemPrompt = `You are MR AI, assistant for MR Chat (by MR Group, founder: Tahmeed Bin Towfique). Features: DMs, group rooms, secret chat, calls, feed (posts/stories), store (113 items, Gold & Diamonds), 11 games (500 Gold entry), Mind Reset (free wellness), Motivation Hub (free), 10 themes, PWA. Reply in 1-3 sentences. Use user's language. Be concise. Don't invent features. Suggest Mind Reset for stress, Motivation Hub for goals.`;

        const messages = [{ role: 'system', content: systemPrompt }];

        // Only keep last 6 messages for speed
        if (Array.isArray(history)) {
            for (const msg of history.slice(-6)) {
                if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }
        }
        messages.push({ role: 'user', content: message });

        // Only 3 fast models — less waiting, quicker response
        const models = [
            'meta-llama/llama-3.3-70b-instruct:free',
            'openai/gpt-oss-20b:free',
            'meta-llama/llama-3.2-3b-instruct:free'
        ];

        let reply = null;

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
                        max_tokens: 500,
                        stream: false
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    reply = data?.choices?.[0]?.message?.content;
                    if (reply && reply.trim().length > 0) break;
                }
            } catch (e) {}
        }

        if (reply) return res.status(200).json({ reply: reply });
        return res.status(200).json({ reply: 'MR AI is busy. Please try again in a moment.' });

    } catch (error) {
        return res.status(500).json({ error: 'AI temporarily unavailable.' });
    }
};
