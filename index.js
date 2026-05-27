const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// База данных
const db = new sqlite3.Database('buboshkin.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        today_clicks INTEGER DEFAULT 0,
        cooldown_until INTEGER DEFAULT 0
    )`);
});

// Получить или создать user_id
function getUserId(req, res) {
    let userId = req.cookies.user_id;
    if (!userId) {
        userId = crypto.randomBytes(16).toString('hex');
        res.cookie('user_id', userId, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
        db.run(`INSERT OR IGNORE INTO users (id, balance, today_clicks, cooldown_until) VALUES (?, 0, 0, 0)`, [userId]);
    }
    return userId;
}

// API маршруты
app.get('/api/auth', (req, res) => {
    const userId = getUserId(req, res);
    res.json({ user_id: userId });
});

app.get('/api/user/:id', (req, res) => {
    db.get(`SELECT balance, today_clicks, cooldown_until FROM users WHERE id = ?`, [req.params.id], (err, row) => {
        if (err || !row) return res.json({ balance: 0, today_clicks: 0, cooldown_until: 0 });
        res.json({ balance: row.balance, today_clicks: row.today_clicks, cooldown_until: row.cooldown_until });
    });
});

app.post('/api/click', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'no user' });

    const now = Date.now();
    db.get(`SELECT balance, today_clicks, cooldown_until FROM users WHERE id = ?`, [user_id], (err, user) => {
        if (err || !user) return res.json({ error: 'user not found' });

        if (user.cooldown_until > now) {
            return res.json({ error: 'cooldown', cooldown_until: user.cooldown_until });
        }

        let todayClicks = user.today_clicks + 1;
        let newBalance = user.balance + 1;
        let cooldownUntil = 0;
        let responseCooldown = false;

        if (todayClicks >= 1000) {
            cooldownUntil = now + 10000;
            responseCooldown = true;
        }

        db.run(`UPDATE users SET balance = ?, today_clicks = ?, cooldown_until = ? WHERE id = ?`,
            [newBalance, todayClicks, cooldownUntil, user_id]);

        res.json({ success: true, new_balance: newBalance, today_clicks: todayClicks, cooldown: responseCooldown, cooldown_until: cooldownUntil });
    });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('user_id');
    res.json({ success: true });
});

// Telegram Bot
const BOT_TOKEN = '8404099875:AAGfB3cWqtIjnONLK_wBHQ-lfn8t1kqxA84';
const ADMIN_ID = '8435880144';
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    db.run(`INSERT OR IGNORE INTO users (id, balance, today_clicks) VALUES (?, 0, 0)`, [userId]);
    ctx.reply(`🐿️ Добро пожаловать в Бубошкин Кликер!\n\nИграй тут: https://buboshkinclickkk.onrender.com`);
});

bot.command('base', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('❌ Нет прав администратора');
    }
    
    db.all(`SELECT id, balance, today_clicks FROM users`, async (err, rows) => {
        if (err) return ctx.reply('Ошибка базы данных');
        
        let text = "📊 БАЗА ПОЛЬЗОВАТЕЛЕЙ\n━━━━━━━━━━━━━━━━━━━━━━\n\n";
        text += `📅 ${new Date().toLocaleString()}\n`;
        text += `👥 Всего игроков: ${rows.length}\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        rows.forEach(row => {
            text += `🆔 ${row.id}\n`;
            text += `💰 Баланс: ${row.balance} монет\n`;
            text += `🖱️ Кликов: ${row.today_clicks}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        });
        
        if (text.length > 4000) {
            for (let i = 0; i < text.length; i += 4000) {
                await ctx.reply(text.substring(i, i + 4000));
            }
        } else {
            await ctx.reply(text);
        }
    });
});

bot.command('stats', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('❌ Нет прав администратора');
    }
    
    db.get(`SELECT SUM(balance) as total_balance, SUM(today_clicks) as total_clicks, COUNT(*) as total_users FROM users`, async (err, stats) => {
        if (err) return ctx.reply('Ошибка');
        
        let text = `📊 СТАТИСТИКА\n\n`;
        text += `👥 Игроков: ${stats.total_users}\n`;
        text += `💰 Всего монет: ${stats.total_balance}\n`;
        text += `🖱️ Всего кликов: ${stats.total_clicks}\n`;
        text += `📈 Средний баланс: ${Math.floor(stats.total_balance / stats.total_users || 0)}\n`;
        
        await ctx.reply(text);
    });
});

// Запуск бота
bot.launch().then(() => console.log('🤖 Telegram бот запущен'));
console.log('🤖 Telegram бот активен');

// Запуск сервера
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));