export default async function handler(req, res) {
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
                error: 'AI not configured. Set ZAI_API_KEY in Vercel environment variables.'
            });
        }

        const systemPrompt = 'You are MR AI, the official AI assistant for MR Chat — a premium social platform by MR Group. Founder: Tahmeed Bin Towfique. MR Chat has: Messaging (1:1 DMs, group rooms, E2E secret chat, voice/video calls), Social Feed (posts, stories, reactions, comments), Premium Store (113 products, 14 categories, Gold & Diamonds currencies), Games Arena (11 games with Gold entry fees and rewards), Admin Panel, Mind Reset (free wellness feature with breathing exercises and meditation), Motivation Hub (free daily motivation and goal tracking), Security (Firebase Auth, reCAPTCHA, 2FA, E2E encryption). 10 themes. PWA installable. Tech: HTML/CSS/JS + Firebase + Vercel. Be friendly, helpful. Use the user language (Bengali or English). If user mentions stress, recommend Mind Reset. If user mentions motivation, recommend Motivation Hub. Both are free.';

        const messages = [{ role: 'system', content: systemPrompt }];

        if (Array.isArray(history)) {
            const recentHistory = history.slice(-10);
            for (const msg of recentHistory) {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    if (msg.content && typeof msg.content === 'string') {
                        messages.push({ role: msg.role, content: msg.content });
                    }
                }
            }
        }

        messages.push({ role: 'user', content: message });

        // Z.ai official API endpoint
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
            console.error('Z.ai API error:', response.status, errText);
            return res.status(500).json({
                error: 'AI service error: ' + response.status
            });
        }

        const data = await response.json();
        const reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'Sorry, I could not generate a response.';

        return res.status(200).json({ reply: reply });

    } catch (error) {
        console.error('MR AI error:', error);
        return res.status(500).json({
            error: 'AI service temporarily unavailable.'
        });
    }
}
