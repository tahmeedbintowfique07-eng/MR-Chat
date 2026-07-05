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
        if (!apiKey) return res.status(500).json({ error: 'Set OPENROUTER_API_KEY in Vercel env vars. Get free key: https://openrouter.ai/keys' });

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

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
                'HTTP-Referer': 'https://mr-chat.vercel.app',
                'X-Title': 'MR Chat'
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-3.3-70b-instruct:free',
                messages: messages,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('OpenRouter error:', response.status, errText);
            if (response.status === 429) {
                return res.status(200).json({ 
                    reply: 'MR AI is getting too many requests. Please wait a minute and try again.' 
                });
            }
            return res.status(500).json({ error: 'AI error. Try again.' });
        }

        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

        return res.status(200).json({ reply: reply });

    } catch (error) {
        console.error('MR AI error:', error);
        return res.status(500).json({ error: 'AI temporarily unavailable.' });
    }
};
