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
        if (!apiKey) return res.status(500).json({ error: 'Set GEMINI_API_KEY in Vercel env vars. Get free key: https://aistudio.google.com/apikey' });

        const systemPrompt = 'You are MR AI, the official AI assistant for MR Chat by MR Group. Founder: Tahmeed Bin Towfique. MR Chat features: Messaging (DMs, group rooms, E2E secret chat, voice/video calls), Social Feed (posts, stories, reactions), Premium Store (113 products, Gold & Diamonds), Games Arena (11 games), Mind Reset (free wellness), Motivation Hub (free motivation), Security (Firebase Auth, 2FA, E2E). Be friendly. Use user language (Bengali or English). If user mentions stress, recommend Mind Reset. If user mentions motivation, recommend Motivation Hub.';

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

        // Try models in order — lite versions have free tier quota
        const models = [
            'gemini-2.0-flash-lite',
            'gemini-2.0-flash',
            'gemini-flash-latest'
        ];

        let reply = null;
        let lastError = null;

        for (const model of models) {
            try {
                const response = await fetch(
                    'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey,
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

                if (response.ok) {
                    const data = await response.json();
                    reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (reply) {
                        console.log('MR AI: Success with model:', model);
                        break;
                    }
                } else {
                    const errData = await response.json().catch(() => ({}));
                    lastError = response.status + ' ' + (errData?.error?.message || '').substring(0, 150);
                    console.log('MR AI: Model ' + model + ' failed:', response.status, errData?.error?.message?.substring(0, 100));
                    
                    // Don't try next model if it's 429 (rate limit) or 400 (bad request)
                    if (response.status === 429) {
                        return res.status(200).json({ 
                            reply: 'MR AI is getting too many requests right now. Please wait a minute and try again.' 
                        });
                    }
                }
            } catch (e) {
                lastError = e.message;
            }
        }

        if (reply) {
            return res.status(200).json({ reply: reply });
        }

        console.error('MR AI: All models failed. Last error:', lastError);
        return res.status(500).json({ error: 'AI service error. Please try again.' });

    } catch (error) {
        console.error('MR AI error:', error);
        return res.status(500).json({ error: 'AI temporarily unavailable.' });
    }
};
