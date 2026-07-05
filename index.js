require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ================= [ إعدادات التحكم الخاصة بك ] =================
const OWNER_ID = '699208033921794168'; // معرف حسابك x8a.b1
// ==========================================================

const dbPath = path.resolve(__dirname, '6store.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS economy (
        userId TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        lastDaily TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        price INTEGER,
        description TEXT,
        emoji TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS shop_msg (
        guildId TEXT,
        channelId TEXT,
        messageId TEXT PRIMARY KEY
    )`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers
    ]
});

const allCommands = [
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('لفحص رصيدك الحالي من عملة 6coin'),
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('احصل على مكافأتك اليومية (10 من عملة 6coin)'),
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('عرض لوحة تحكم المنتجات والأيديات (خاص بالمالك فقط)'),
    new SlashCommandBuilder()
        .setName('addproduct')
        .setDescription('إضافة منتج جديد للمتجر (خاص بالمالك)')
        .addStringOption(op => op.setName('الاسم').setDescription('اسم المنتج').setRequired(true))
        .addIntegerOption(op => op.setName('السعر').setDescription('سعر المنتج من عملة 6coin').setRequired(true))
        .addStringOption(op => op.setName('الوصف').setDescription('وصف مختصر ومميز للمنتج').setRequired(true))
        .addStringOption(op => op.setName('الإيموجي').setDescription('كود الإيموجي المخصص المتروك مثل <:emoji:ID>').setRequired(false)),
    new SlashCommandBuilder()
        .setName('deleteproduct')
        .setDescription('حذف منتج من المتجر باستخدام الـ ID (خاص بالمالك)')
        .addIntegerOption(op => op.setName('id').setDescription('رقم تعريف المنتج المراد حذفه').setRequired(true)),
    new SlashCommandBuilder()
        .setName('setup-shop')
        .setDescription('تثبيت رسالة المتجر الدائمة في القناة الحالية (خاص بالمالك)')
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`تم تشغيل البوت بنجاح باسم: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: allCommands });
        console.log('✅ تم تسجيل وتحديث الأوامر بنجاح!');
    } catch (error) {
        console.error(error);
    }
});

// دالة بناء المصفوفات والأزرار المقسمة 3 فوق و 3 تحت بالتوالي
function buildShopComponents(rows, isOwner = false) {
    const components = [];
    let currentRow = new ActionRowBuilder();

    rows.forEach((product, index) => {
        const labelText = isOwner 
            ? `${product.name} | 🪙 ${product.price} (ID: ${product.id})`
            : `${product.name} | 🪙 ${product.price}`;

        const button = new ButtonBuilder()
            .setCustomId(`buy_${product.id}`)
            .setLabel(labelText)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(product.emoji);

        currentRow.addComponents(button);

        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            components.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
    });

    return components;
}

// دالة التحديث الديناميكي الفوري
async function updatePermanentShop(guild) {
    db.get(`SELECT * FROM shop_msg WHERE guildId = ? ORDER BY rowid DESC LIMIT 1`, [guild.id], (err, config) => {
        if (err || !config) return;

        db.all(`SELECT * FROM products`, [], async (pErr, rows) => {
            if (pErr) return;

            try {
                const channel = await guild.channels.fetch(config.channelId).catch(() => null);
                if (!channel) return;

                const message = await channel.messages.fetch(config.messageId).catch(() => null);
                if (!message) return;

                const embed = new EmbedBuilder()
                    .setColor('#000000')
                    .setTitle('▬▬▬▭ 𝟔𝒔𝒕𝒐𝒓𝒆 𝑴𝒂𝒓𝒌𝒆𝒕 ▭▬▬▬')
                    .setDescription('✨ **أهلاً بك في المتجر الرسمي الرقمي لـ 6store** ✨\n\n🛍️ *تصفح الخيارات المتاحة بالأسفل واضغط على زر المنتج للشراء المباشر بالعملات المجمعة في حسابك.*')
                    .setFooter({ text: 'تنبيه: سيتم فتح تذكرة تسليم خاصة بك تلقائياً عند الضغط على الزر.' });

                if (rows.length === 0) {
                    embed.setDescription('🛒 **المتجر فارغ حالياً في انتظار إضافة المنتجات.**');
                    await message.edit({ embeds: [embed], components: [] });
                    return;
                }

                const components = buildShopComponents(rows, false);
                await message.edit({ embeds: [embed], components: components });
            } catch (e) {
                console.error(e);
            }
        });
    });
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    const userId = interaction.user.id;
    db.run(`INSERT OR IGNORE INTO economy (userId, balance, lastDaily) VALUES (?, 0, '')`, [userId]);

    if (interaction.isChatInputCommand()) {
        
        // [ حماية الأوامر الحصرية للأونر فقط ]
        if (['addproduct', 'deleteproduct', 'setup-shop', 'shop'].includes(interaction.commandName)) {
            if (userId !== OWNER_ID) {
                return interaction.reply({ 
                    content: '❌ هذا الأمر مخصص لمالك البوت فقط! الشراء يكون مباشرة عبر أزرار المتجر المثبت في القناة العامة.', 
                    ephemeral: true 
                });
            }
        }

        if (interaction.commandName === 'addproduct') {
            const name = interaction.options.getString('الاسم');
            const price = interaction.options.getInteger('السعر');
            const description = interaction.options.getString('الوصف');
            const emoji = interaction.options.getString('الإيموجي') || '📦';

            db.run(`INSERT INTO products (name, price, description, emoji) VALUES (?, ?, ?, ?)`, [name, price, description, emoji], async (err) => {
                if (err) return interaction.reply({ content: 'حدث خطأ أثناء حفظ المنتج.', ephemeral: true });
                await interaction.reply({ content: `✅ تم إضافة المنتج **${name}** بنجاح وتحديث المتجر فوراً!`, ephemeral: true });
                await updatePermanentShop(interaction.guild);
            });
        }

        if (interaction.commandName === 'deleteproduct') {
            const prodId = interaction.options.getInteger('id');

            db.run(`DELETE FROM products WHERE id = ?`, [prodId], async (err) => {
                if (err) return interaction.reply({ content: 'حدث خطأ أثناء حذف المنتج.', ephemeral: true });
                await interaction.reply({ content: `✅ تم حذف المنتج رقم **${prodId}** وتحديث المتجر فوراً!`, ephemeral: true });
                await updatePermanentShop(interaction.guild);
            });
        }

        if (interaction.commandName === 'setup-shop') {
            await interaction.deferReply({ ephemeral: true });

            db.all(`SELECT * FROM products`, [], async (err, rows) => {
                const embed = new EmbedBuilder()
                    .setColor('#000000')
                    .setTitle('▬▬▬▭ 𝟔𝒔𝒕𝒐𝒓𝒆 𝑴𝒂𝒓𝒌𝒆𝒕 ▭▬▬▬')
                    .setDescription('✨ **أهلاً بك في المتجر الرسمي الرقمي لـ 6store** ✨\n\n🛍️ *تصفح الخيارات المتاحة بالأسفل واضغط على زر المنتج للشراء المباشر بالعملات المجمعة في حسابك.*')
                    .setFooter({ text: 'تنبيه: سيتم فتح تذكرة تسليم خاصة بك تلقائياً عند الضغط على الزر.' });

                let components = [];
                if (rows.length === 0) {
                    embed.setDescription('🛒 **المتجر فارغ حالياً في انتظار إضافة المنتجات.**');
                } else {
                    components = buildShopComponents(rows, false);
                }

                const shopMessage = await interaction.channel.send({ embeds: [embed], components: components });

                db.run(`INSERT OR REPLACE INTO shop_msg (guildId, channelId, messageId) VALUES (?, ?, ?)`, [interaction.guild.id, interaction.channel.id, shopMessage.id], () => {
                    interaction.editReply({ content: '✅ تم إعداد وتثبيت المتجر الدائم بالواجهة العمودية النظيفة والأزرار الشفافة!' });
                });
            });
        }

        if (interaction.commandName === 'balance') {
            db.get(`SELECT balance FROM economy WHERE userId = ?`, [userId], (err, row) => {
                if (err) return interaction.reply({ content: 'حدث خطأ في قاعدة البيانات.', ephemeral: true });
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('محفظتك الرقمية في 6store')
                    .setDescription(`رصيدك الحالي هو: **${row ? row.balance : 0}** من عملة **6coin** 🪙`)
                    .setTimestamp();
                interaction.reply({ embeds: [embed] });
            });
        }

        if (interaction.commandName === 'daily') {
            const today = new Date().toDateString();
            db.get(`SELECT balance, lastDaily FROM economy WHERE userId = ?`, [userId], (err, row) => {
                if (row && row.lastDaily === today) {
                    return interaction.reply({ content: '❌ لقد استلمت مكافأتك اليومية بالفعل! عد غداً.', ephemeral: true });
                }
                const reward = 10;
                db.run(`UPDATE economy SET balance = balance + ?, lastDaily = ? WHERE userId = ?`, [reward, today, userId], (err) => {
                    if (err) return interaction.reply({ content: 'حدث خطأ أثناء تحديث الرصيد.', ephemeral: true });
                    interaction.reply({ content: `✅ تم إضافة **${reward}** من عملة **6coin** إلى حسابك بنجاح! 🪙` });
                });
            });
        }

        // أمر /shop الآن حصري بالكامل للأونر ويعرض قائمة سرية بالأيديات مخفية عن الجميع
        if (interaction.commandName === 'shop') {
            db.all(`SELECT * FROM products`, [], (err, rows) => {
                if (err) return interaction.reply({ content: 'حدث خطأ أثناء جلب المنتجات.', ephemeral: true });
                if (rows.length === 0) return interaction.reply({ content: '🛒 المتجر فارغ حالياً.', ephemeral: true });

                const embed = new EmbedBuilder()
                    .setColor('#ffcc00')
                    .setTitle('🛠️ لوحة تحكم المالك | معرفات المنتجات والأسعار')
                    .setDescription('هذه القائمة تظهر لك وحدك في رسالة مخفية عن السيرفر بالكامل لتتمكن من معرفة الـ ID الخاص بكل منتج لحذفه بسهولة:')
                    .setTimestamp();

                const components = buildShopComponents(rows, true); // تفعيل إظهار الـ ID
                interaction.reply({ embeds: [embed], components: components, ephemeral: true });
            });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
        const productId = interaction.customId.split('_')[1];

        db.get(`SELECT * FROM products WHERE id = ?`, [productId], (err, product) => {
            if (!product) return interaction.reply({ content: '❌ هذا المنتج لم يعد متوفراً.', ephemeral: true });

            db.get(`SELECT balance FROM economy WHERE userId = ?`, [userId], async (err, row) => {
                if (!row || row.balance < product.price) {
                    return interaction.reply({ content: `❌ رصيدك غير كافٍ من الـ 6coin! سعر المنتج هو **${product.price}** ورصيدك الحالي **${row ? row.balance : 0}**.`, ephemeral: true });
                }

                db.run(`UPDATE economy SET balance = balance - ? WHERE userId = ?`, [product.price, userId], async (err) => {
                    if (err) return interaction.reply({ content: 'حدث خطأ أثناء معالجة عملية الدفع.', ephemeral: true });

                    await interaction.reply({ content: `⏳ جاري معالجة الشراء وتأمين التذكرة الخاصة بك...`, ephemeral: true });

                    try {
                        const ticketChannel = await interaction.guild.channels.create({
                            name: `🛒-${interaction.user.username}`,
                            type: ChannelType.GuildText,
                            permissionOverwrites: [
                                {
                                    id: interaction.guild.id,
                                    deny: [PermissionFlagsBits.ViewChannel],
                                },
                                {
                                    id: userId,
                                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                                },
                                {
                                    id: client.user.id,
                                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                                }
                            ],
                        });

                        const ticketEmbed = new EmbedBuilder()
                            .setColor('#00ff66')
                            .setTitle('🎉 فاتورة شراء وتذكرة استلام جديدة')
                            .setDescription(`مرحباً بك في تذكرة الاستلام المحمية الخاصة بـ **6store**.\nتم قفل هذه القناة لتظهر لك وللمسؤولين فقط للمراجعة والتسليم اليدوي.`)
                            .addFields(
                                { name: 'المشتري المعتمد', value: `<@${userId}> (ID: ${userId})`, inline: true },
                                { name: 'المنتج المطلوب', value: `${product.emoji} ${product.name}`, inline: true },
                                { name: 'المبلغ المستقطع', value: `**${product.price} 6coin** 🪙`, inline: true }
                            )
                            .setTimestamp();

                        await ticketChannel.send({ 
                            content: `🔔 تنبيه الإدارة: تم شراء منتج جديد، يرجى مراجعة المشتري هنا والتسليم الميداني. المالك المعتمد: <@${OWNER_ID}>`, 
                            embeds: [ticketEmbed] 
                        });

                        await interaction.followUp({ content: `✅ تم الشراء وخصم المبلغ! تم فتح تذكرتك بنجاح هنا: <#${ticketChannel.id}>`, ephemeral: true });

                    } catch (channelError) {
                        console.error(channelError);
                        await interaction.followUp({ content: `✅ تم الخصم بنجاح، ولكن تعذر إنشاء التذكرة تلقائياً بسبب الصلاحيات.`, ephemeral: true });
                    }
                });
            });
        });
    }
});

client.login(process.env.DISCORD_TOKEN);