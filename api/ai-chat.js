// MR AI — Vercel Serverless Function (Gemini API)
// Setup: Vercel → Settings → Environment Variables → GEMINI_API_KEY = your key
// Get free key: https://aistudio.google.com/apikey

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

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Set GEMINI_API_KEY in Vercel env vars' });

        const systemPrompt = 'You are MR AI, the official AI assistant for MR Chat — a premium social platform by MR Group. Founder: Tahmeed Bin Towfique. MR Chat features: Messaging (DMs, group rooms, E2E secret chat, voice/video calls), Social Feed (posts, stories, reactions), Premium Store (113 products, Gold & Diamonds), Games Arena (11 games with Gold entry fees), Admin Panel, Mind Reset (free wellness feature for stress relief), Motivation Hub (free daily motivation), Security (Firebase Auth, 2FA, E2E encryption), 10 themes, PWA. Be friendly and helpful. Use the user language (Bengali or English). If user mentions stress, recommend Mind Reset. If user mentions motivation, recommend Motivation Hub.';

        // Build conversation for Gemini format
        let contents = [];
        if (Array.isArray(history)) {
            for (const msg of history.slice(-10)) {
                if (msg.content) {
                    contents.push({
                        role: msg.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: msg.content }]
                    });
                }
            }
        }
        contents.push({ role: 'user', parts: [{ text: message }] });

        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: contents,
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 1000
                    }
                })
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            console.error('Gemini error:', response.status, errText);
            if (response.status === 429) {
                return res.status(200).json({ reply: 'MR AI is getting too many requests. Please wait a minute and try again.' });
            }
            return res.status(500).json({ error: 'AI error. Try again.' });
        }

        const data = await response.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';

        return res.status(200).json({ reply: reply });

    } catch (error) {
        console.error('MR AI error:', error);
        return res.status(500).json({ error: 'AI temporarily unavailable.' });
    }
};
