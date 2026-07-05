require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const OWNER_ID = '699208033921794168'; 

const dbPath = path.resolve(__dirname, '6storee.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // جدول الاقتصاد (مشترك بين السيرفرات)
    db.run(`CREATE TABLE IF NOT EXISTS economy (userId TEXT PRIMARY KEY, balance INTEGER DEFAULT 0, lastDaily TEXT)`);
    // جدول المنتجات (مفصول بـ guildId)
    db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, guildId TEXT, name TEXT, price INTEGER, description TEXT, emoji TEXT)`);
    // جدول إعدادات المتجر
    db.run(`CREATE TABLE IF NOT EXISTS shop_msg (guildId TEXT PRIMARY KEY, channelId TEXT, messageId TEXT)`);
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});

const allCommands = [
    new SlashCommandBuilder().setName('balance').setDescription('لفحص رصيدك الحالي'),
    new SlashCommandBuilder().setName('daily').setDescription('احصل على مكافأتك اليومية'),
    new SlashCommandBuilder().setName('give').setDescription('إعطاء رصيد لمستخدم (خاص بالمالك)')
        .addUserOption(op => op.setName('user').setDescription('المستخدم').setRequired(true))
        .addIntegerOption(op => op.setName('amount').setDescription('المبلغ').setRequired(true)),
    new SlashCommandBuilder().setName('shop').setDescription('عرض المنتجات'),
    new SlashCommandBuilder().setName('addproduct').setDescription('إضافة منتج')
        .addStringOption(op => op.setName('الاسم').setRequired(true))
        .addIntegerOption(op => op.setName('السعر').setRequired(true))
        .addStringOption(op => op.setName('الوصف').setRequired(true))
        .addStringOption(op => op.setName('الإيموجي').setRequired(false)),
    new SlashCommandBuilder().setName('deleteproduct').setDescription('حذف منتج')
        .addIntegerOption(op => op.setName('id').setRequired(true)),
    new SlashCommandBuilder().setName('setup-shop').setDescription('تثبيت رسالة المتجر')
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`تم تشغيل البوت: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: allCommands });
});

function buildShopComponents(rows, isOwner = false) {
    const components = [];
    let currentRow = new ActionRowBuilder();
    rows.forEach((product, index) => {
        const label = isOwner ? `${product.name} | 🪙 ${product.price} (ID: ${product.id})` : `${product.name} | 🪙 ${product.price}`;
        currentRow.addComponents(new ButtonBuilder().setCustomId(`buy_${product.id}`).setLabel(label).setStyle(ButtonStyle.Secondary).setEmoji(product.emoji || '📦'));
        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            components.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
    });
    return components;
}

async function updatePermanentShop(guild) {
    db.get(`SELECT * FROM shop_msg WHERE guildId = ?`, [guild.id], (err, config) => {
        if (!config) return;
        db.all(`SELECT * FROM products WHERE guildId = ?`, [guild.id], async (pErr, rows) => {
            const channel = await guild.channels.fetch(config.channelId).catch(() => null);
            if (!channel) return;
            const message = await channel.messages.fetch(config.messageId).catch(() => null);
            if (!message) return;

            const embed = new EmbedBuilder().setColor('#000000').setTitle('𝟔𝒔𝒕𝒐𝒓𝒆 𝑴𝒂𝒓𝒌𝒆𝒕').setDescription('تسوق الآن!');
            const components = rows.length > 0 ? buildShopComponents(rows, false) : [];
            await message.edit({ embeds: [embed], components: components });
        });
    });
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
    const userId = interaction.user.id;

    if (interaction.isChatInputCommand()) {
        if (['addproduct', 'deleteproduct', 'setup-shop', 'shop', 'give'].includes(interaction.commandName) && userId !== OWNER_ID) 
            return interaction.reply({ content: '❌ هذا الأمر للمالك فقط!', ephemeral: true });

        if (interaction.commandName === 'give') {
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            db.run(`INSERT OR IGNORE INTO economy (userId, balance) VALUES (?, 0)`, [target.id]);
            db.run(`UPDATE economy SET balance = balance + ? WHERE userId = ?`, [amount, target.id], () => {
                interaction.reply({ content: `✅ تم إضافة ${amount} 🪙 للمستخدم ${target.username}`, ephemeral: true });
            });
        }

        if (interaction.commandName === 'addproduct') {
            const name = interaction.options.getString('الاسم');
            const price = interaction.options.getInteger('السعر');
            const desc = interaction.options.getString('الوصف');
            const emoji = interaction.options.getString('الإيموجي') || '📦';
            db.run(`INSERT INTO products (guildId, name, price, description, emoji) VALUES (?, ?, ?, ?, ?)`, [interaction.guild.id, name, price, desc, emoji], () => {
                interaction.reply({ content: '✅ تم إضافة المنتج', ephemeral: true });
                updatePermanentShop(interaction.guild);
            });
        }

        if (interaction.commandName === 'deleteproduct') {
            const id = interaction.options.getInteger('id');
            db.run(`DELETE FROM products WHERE id = ? AND guildId = ?`, [id, interaction.guild.id], () => {
                interaction.reply({ content: '✅ تم حذف المنتج', ephemeral: true });
                updatePermanentShop(interaction.guild);
            });
        }

        if (interaction.commandName === 'setup-shop') {
            const msg = await interaction.channel.send({ content: 'جاري تحميل المتجر...' });
            db.run(`INSERT OR REPLACE INTO shop_msg (guildId, channelId, messageId) VALUES (?, ?, ?)`, [interaction.guild.id, interaction.channel.id, msg.id]);
            updatePermanentShop(interaction.guild);
            interaction.reply({ content: '✅ تم التثبيت', ephemeral: true });
        }

        if (interaction.commandName === 'balance') {
            db.get(`SELECT balance FROM economy WHERE userId = ?`, [userId], (err, row) => {
                interaction.reply({ content: `رصيدك الحالي: **${row ? row.balance : 0}** 🪙`, ephemeral: true });
            });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
        const prodId = interaction.customId.split('_')[1];
        db.get(`SELECT * FROM products WHERE id = ? AND guildId = ?`, [prodId, interaction.guild.id], (err, product) => {
            if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });
            db.get(`SELECT balance FROM economy WHERE userId = ?`, [userId], async (err, row) => {
                if (!row || row.balance < product.price) return interaction.reply({ content: '❌ رصيدك غير كافٍ.', ephemeral: true });
                
                db.run(`UPDATE economy SET balance = balance - ? WHERE userId = ?`, [product.price, userId]);
                const channel = await interaction.guild.channels.create({ name: `🛒-${interaction.user.username}`, type: ChannelType.GuildText });
                interaction.reply({ content: `✅ تم الشراء بنجاح! تذكرتك: <#${channel.id}>`, ephemeral: true });
            });
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
