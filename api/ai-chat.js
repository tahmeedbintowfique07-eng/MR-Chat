// MR AI — Vercel Serverless API Route
// Uses CommonJS (require) for maximum Vercel compatibility.

const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
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

        // Get API key from environment variable
        let apiKey = process.env.ZAI_API_KEY;
        let baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';

        // Fallback: try .z-ai-config file
        if (!apiKey) {
            const configPaths = [
                path.join(process.cwd(), '.z-ai-config'),
                path.join(process.env.HOME || '/tmp', '.z-ai-config'),
                '/etc/.z-ai-config'
            ];
            for (const p of configPaths) {
                try {
                    const configStr = fs.readFileSync(p, 'utf-8');
                    const config = JSON.parse(configStr);
                    if (config.apiKey) {
                        apiKey = config.apiKey;
                        if (config.baseUrl) baseUrl = config.baseUrl;
                        break;
                    }
                } catch (e) {}
            }
        }

        if (!apiKey) {
            return res.status(500).json({
                error: 'AI service not configured. Set ZAI_API_KEY in Vercel environment variables.'
            });
        }

        const systemPrompt = `You are MR AI, the official AI assistant for MR Chat — a premium social platform by MR Group.

ABOUT MR GROUP:
- MR Group is the parent company/organization
- Founder: Tahmeed Bin Towfique
- MR Chat is a product of MR Group
- MR Group focuses on premium, secure, and innovative digital products

ABOUT MR CHAT:
MR Chat is a full-featured social platform with Facebook/Instagram-level features:

MESSAGING (Inbox):
- 1:1 Direct Messages with real-time sync
- Group chat rooms (create, join, leave)
- End-to-end encrypted Secret Chat (burn after reading)
- Voice & Video calls (WebRTC)
- Sticker packs, emojis, reactions
- Message types: text, image, voice, file, gift
- Message features: reply, copy, forward, pin, delete, recall
- Typing indicators, read receipts
- Online/offline status
- Gift sending (Gold/Diamonds)

SOCIAL FEED:
- Posts (text, image, video)
- Stories (auto-expire)
- 6 reactions (like, love, haha, wow, sad, angry)
- Comments (real-time)
- Share & save/bookmark posts
- Trending hashtags
- Smart feed algorithm

PREMIUM STORE (113 products):
- 14 categories: frames, borders, themes, avatars, name colors, music, ringtones, badges, voice effects, chat styles, sticker packs, boosts, special features, utilities
- Two currencies: Gold (earned) and Diamonds (premium)
- Gift packs / bundles
- Auto-equip on purchase

GAMES ARENA (11 games):
- Dice Arena, Science Quiz, Love Calculator, Memory Match, Guess the Number
- 2048, Snake, Tic-Tac-Toe, Word Scramble, Math Blitz
- Leaderboards
- Entry fees (500 Gold for arcade games) with Gold rewards
- Snake has touch/swipe controls + pause
- Word Scramble has 152 words across 12 categories

ADMIN PANEL:
- Analytics dashboard
- User management (ban/unban, role change, edit)
- Gold/Diamond distribution
- Quiz question management
- Announcements
- Content moderation
- System settings

MIND RESET (Wellness Feature):
- A mental wellness and relaxation feature within MR Chat
- Helps users reset their mind, reduce stress, and find calm
- Includes: guided breathing exercises, meditation timers, calming sounds, mood tracking
- Designed for users who feel overwhelmed, anxious, or just need a mental break
- Accessible from the dashboard with a brain icon
- MR Group believes mental health is just as important as social connection
- Mind Reset is a free feature — no Gold or Diamonds needed
- If a user asks about stress, anxiety, feeling down — recommend Mind Reset

MOTIVATION (Inspiration Hub):
- A daily motivation and inspiration feature within MR Chat
- Provides motivational quotes, success stories, goal-setting tools, productivity tips
- Helps users stay positive, focused, and driven
- Includes: daily quotes, goal tracker, habit builder, success stories
- Accessible from the dashboard with a fire icon
- Motivation is a free feature — no Gold or Diamonds needed
- If a user asks about motivation, goals, success — recommend Motivation Hub

SECURITY:
- Firebase Authentication (Email/Password + Google OAuth)
- reCAPTCHA v3 bot protection
- 2FA (TOTP)
- E2E encryption for secret chat (libsodium.js)
- XSS protection
- Account deletion with 30-day grace period

CURRENCIES:
- Gold: Earned through games, received as gifts, used in store
- Diamonds: Premium currency, bought with Gold, used for premium store items

THEMES:
- 10 themes: Dark, White, Purple, Neon, Ocean, Sunset, Matrix, Rose Gold, Cyber, Aurora

PURCHASABLE FEATURES:
- Invisible Mode, Secret Chat, Message Recall, Double Tap Reaction
- Message Scheduler, Auto Reply Bot, Profile Tracker, Custom Notification
- Animated Profile BG, Chat Translator, Voice to Text

PWA:
- Installable on mobile & desktop
- Offline support via Service Worker
- Push notifications

YOUR ROLE:
- You are friendly, helpful, and knowledgeable about all MR Chat features
- Help users understand how to use features
- Answer questions about the app, store, games, security
- If a user mentions stress, anxiety — recommend Mind Reset
- If a user mentions motivation, goals — recommend Motivation Hub
- Both are free features
- Be concise but thorough
- Use the user's language (Bengali → Bengali reply, English → English reply)
- You represent MR Group — be professional yet approachable`;

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

        const response = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                messages: messages,
                temperature: 0.7,
                max_tokens: 1000,
                thinking: { type: 'disabled' }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('Z.ai API error:', response.status, errText);
            return res.status(500).json({
                error: 'AI service error. Please try again.'
            });
        }

        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

        return res.status(200).json({ reply });

    } catch (error) {
        console.error('MR AI error:', error);
        return res.status(500).json({
            error: 'AI service temporarily unavailable.'
        });
    }
};
