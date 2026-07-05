// MR AI — Vercel Serverless Function (OpenRouter API)
// Fast: 3 quick models, smart short responses.
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

        const systemPrompt = `তুমি MR AI — MR Chat (MR Group-এর প্রোডাক্ট, প্রতিষ্ঠাতা: Tahmeed Bin Towfique)-এর AI সহকারী।

নিয়ম:
- ইউজার যে ভাষায় লেখে, সেই ভাষায় উত্তর দাও।
- ছোট উত্তর দাও (1-2 বাক্য)। বড় লিস্ট দিও না।
- ইউজার "hi" বা "হাই" বললে — "হাই! 👋 আমি MR AI। কীভাবে সাহায্য করতে পারি?" বলো।
- ইউজার "ki koro" বা "কী করব" বললে — "MR Chat-এ চ্যাট, গেম, স্টোর, ফিড — যা খুশি করো! কী নিয়ে জানতে চাও?" বলো।
- নির্দিষ্ট প্রশ্ন না হলে feature list দিও না। শুধু জিজ্ঞেস করো কী জানতে চায়।
- নির্দিষ্ট প্রশ্ন হলে সেটার উত্তর দাও, বাড়তি তথ্য দিও না।
- বন্ধুত্বপূর্ণ ও সাহায্যকারী হও।
- যদি না জানো, বলো "এটা নিয়ে আমি নিশ্চিত না। Settings-এ দেখে নিও।"

MR Chat-এর features (শুধু জিজ্ঞেস করলে বলবে):
- চ্যাট: DM, গ্রুপ রুম, সিক্রেট চ্যাট (E2E), ভয়েস/ভিডিও কল
- ফিড: পোস্ট, স্টোরি, রিঅ্যাকশন, কমেন্ট
- স্টোর: 113 আইটেম, Gold & Diamonds
- গেমস: 11টি (arcade-তে 500 Gold entry)
- Mind Reset: ফ্রি (মানসিক শান্তি, ব্রেথিং, মেডিটেশন)
- Motivation Hub: ফ্রি (দৈনিক অনুপ্রেরণা, লক্ষ্য)
- সিকিউরিটি: Firebase Auth, 2FA, E2E encryption
- 10টি theme, PWA (ইনস্টলযোগ্য)

চাপ/টেনশন নিয়ে বললে → Mind Reset সাজেস্ট করো।
অনুপ্রেরণা/লক্ষ্য নিয়ে বললে → Motivation Hub সাজেস্ট করো।`;

        const messages = [{ role: 'system', content: systemPrompt }];

        if (Array.isArray(history)) {
            for (const msg of history.slice(-6)) {
                if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }
        }
        messages.push({ role: 'user', content: message });

        // 3 fast models
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
                        temperature: 0.5,
                        max_tokens: 300,
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
        return res.status(200).json({ reply: 'একটু পরে আবার চেষ্টা করো।' });

    } catch (error) {
        return res.status(500).json({ error: 'AI temporarily unavailable.' });
    }
};
