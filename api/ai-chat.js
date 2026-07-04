// MR AI — Vercel Serverless Function (CommonJS — no package.json needed)

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, history } = req.body || {};

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required' });
        }

        if (message.length > 2000) {
            return res.status(400).json({ error: 'Message too long' });
        }

        const apiKey = process.env.ZAI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: 'AI not configured. Set ZAI_API_KEY in Vercel Settings → Environment Variables.'
            });
        }

        const systemPrompt = 'You are MR AI, the official AI assistant for MR Chat by MR Group. Founder: Tahmeed Bin Towfique. MR Chat has: Messaging (DMs, group rooms, E2E secret chat, voice/video calls), Social Feed (posts, stories, reactions), Premium Store (113 products, Gold & Diamonds), Games Arena (11 games), Admin Panel, Mind Reset (free wellness feature), Motivation Hub (free motivation feature), Security (Firebase Auth, 2FA, E2E encryption). 10 themes. PWA. Be friendly and helpful. Use the user language.';

        const messages = [{ role: 'system', content: systemPrompt }];

        if (Array.isArray(history)) {
            for (const msg of history.slice(-10)) {
                if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }
        }

        messages.push({ role: 'user', content: message });

        const response = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model: 'glm-4.6',
                messages: messages,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('Z.ai error:', response.status, errText);
            if (response.status === 429) {
                return res.status(200).json({
                    reply: 'MR AI is getting too many requests right now. Please wait a minute and try again.'
                });
            }
            return res.status(500).json({ error: 'AI service error. Please try again.' });
        }

        const data = await response.json();
        const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'Sorry, I could not generate a response.';

        return res.status(200).json({ reply: reply });

    } catch (error) {
        console.error('MR AI error:', error);
        return res.status(500).json({ error: 'AI service temporarily unavailable.' });
    }
};
