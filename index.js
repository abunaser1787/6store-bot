require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ================= [ إعدادات التحكم الخاصة بك ] =================
const OWNER_ID = '699208033921794168'; // معرفك كمالك للبوت
// ==========================================================

const dbPath = path.resolve(__dirname, '6store.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // إنشاء الجداول الأساسية
    db.run(`CREATE TABLE IF NOT EXISTS economy (userId TEXT PRIMARY KEY, balance INTEGER DEFAULT 0, lastDaily TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, guildId TEXT, name TEXT, price INTEGER, description TEXT, emoji TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS shop_msg (guildId TEXT PRIMARY KEY, channelId TEXT, messageId TEXT)`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// تعريف جميع الأوامر مع الأوصاف الإجبارية لتفادي الأخطاء
const allCommands = [
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('لفحص رصيدك الحالي من عملة 6coin 🪙'),
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('احصل على مكافأتك اليومية (10 من عملة 6coin) 🎁'),
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('عرض لوحة تحكم المنتجات ومعرفاتها (خاص بالمالك فقط) 🛠️'),
    new SlashCommandBuilder()
        .setName('give')
        .setDescription('إعطاء رصيد من العملات لمستخدم (خاص بالمالك) 💰')
        .addUserOption(op => op.setName('user').setDescription('المستخدم المراد إعطاؤه الرصيد').setRequired(true))
        .addIntegerOption(op => op.setName('amount').setDescription('كمية الرصيد').setRequired(true)),
    new SlashCommandBuilder()
        .setName('addproduct')
        .setDescription('إضافة منتج جديد للمتجر (خاص بالمالك) ➕')
        .addStringOption(op => op.setName('الاسم').setDescription('اسم المنتج').setRequired(true))
        .addIntegerOption(op => op.setName('السعر').setDescription('سعر المنتج من عملة 6coin').setRequired(true))
        .addStringOption(op => op.setName('الوصف').setDescription('وصف مختصر للمنتج').setRequired(true))
        .addStringOption(op => op.setName('الإيموجي').setDescription('إيموجي المنتج (اختياري)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('deleteproduct')
        .setDescription('حذف منتج من المتجر باستخدام الـ ID (خاص بالمالك) ❌')
        .addIntegerOption(op => op.setName('id').setDescription('رقم تعريف المنتج المراد حذفه').setRequired(true)),
    new SlashCommandBuilder()
        .setName('setup-shop')
        .setDescription('تثبيت رسالة المتجر الدائمة في القناة الحالية (خاص بالمالك) 🛒')
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`✅ تم تشغيل البوت بنجاح باسم: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: allCommands });
        console.log('✅ تم تسجيل وتحديث الأوامر بنجاح بدون أخطاء!');
    } catch (error) {
        console.error(error);
    }
});

// دالة بناء أزرار المتجر
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
            .setEmoji(product.emoji || '📦');

        currentRow.addComponents(button);

        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            components.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
    });

    return components;
}

// دالة التحديث الديناميكي للمتجر مع الترحيب الفخم
async function updatePermanentShop(guild) {
    db.get(`SELECT * FROM shop_msg WHERE guildId = ?`, [guild.id], (err, config) => {
        if (err || !config) return;

        db.all(`SELECT * FROM products WHERE guildId = ?`, [guild.id], async (pErr, rows) => {
            if (pErr) return;

            try {
                const channel = await guild.channels.fetch(config.channelId).catch(() => null);
                if (!channel) return;

                const message = await channel.messages.fetch(config.messageId).catch(() => null);
                if (!message) return;

                // تصميم الترحيب الفخم باستخدام Markdown المدعوم في ديسكورد
                const embed = new EmbedBuilder()
                    .setColor('#FFD700') // لون ذهبي فخم
                    .setTitle('▬▬▬▭ 𝟔𝒔𝒕𝒐𝒓𝒆 𝑴𝒂𝒓𝒌𝒆𝒕 ▭▬▬▬')
                    .setDescription('# ✨ أهـلاً بـك فـي مـتـجـر 6store ✨\n## 🛒 الـوجـهـة الأولـى لـخـدمـاتـك الـرقـمـيـة\n\n> 🛍️ **تصفح الخيارات المتاحة بالأسفل واضغط على زر المنتج للشراء المباشر بالعملات المجمعة في حسابك.**\n\n**⚠️ ملاحظة هامة:** سيتم فتح تذكرة تسليم خاصة بك تلقائياً عند الضغط على زر الشراء.')
                    .setImage('https://i.imgur.com/qKOnkQp.png') // خط فاصل جميل (اختياري)
                    .setFooter({ text: 'نتمنى لك تسوقاً ممتعاً 🤍', iconURL: guild.iconURL() });

                if (rows.length === 0) {
                    embed.setDescription('# ✨ أهـلاً بـك فـي مـتـجـر 6store ✨\n## 🛒 الـوجـهـة الأولـى لـخـدمـاتـك الـرقـمـيـة\n\n> 🛒 **المتجر فارغ حالياً في انتظار إضافة أحدث المنتجات.**');
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
    // التأكد من وجود المستخدم في قاعدة البيانات للرصيد
    db.run(`INSERT OR IGNORE INTO economy (userId, balance, lastDaily) VALUES (?, 0, '')`, [userId]);

    // معالجة الأوامر (Slash Commands)
    if (interaction.isChatInputCommand()) {
        
        // [ 🔒 حماية الأوامر الحصرية للأونر فقط ]
        const ownerOnlyCommands = ['addproduct', 'deleteproduct', 'setup-shop', 'shop', 'give'];
        if (ownerOnlyCommands.includes(interaction.commandName) && userId !== OWNER_ID) {
            return interaction.reply({ 
                content: '❌ **عذراً، هذا الأمر مخصص لمالك البوت فقط!**', 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        // [ 💰 أمر إعطاء الرصيد - للمالك ]
        if (interaction.commandName === 'give') {
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            db.run(`INSERT OR IGNORE INTO economy (userId, balance) VALUES (?, 0)`, [target.id]);
            db.run(`UPDATE economy SET balance = balance + ? WHERE userId = ?`, [amount, target.id], () => {
                interaction.reply({ 
                    content: `✅ تم إضافة **${amount} 🪙** بنجاح إلى حساب المستخدم **${target.username}**.`, 
                    flags: [MessageFlags.Ephemeral] 
                });
            });
        }

        // [ ➕ أمر إضافة منتج - للمالك ]
        if (interaction.commandName === 'addproduct') {
            const name = interaction.options.getString('الاسم');
            const price = interaction.options.getInteger('السعر');
            const description = interaction.options.getString('الوصف');
            const emoji = interaction.options.getString('الإيموجي') || '📦';

            db.run(`INSERT INTO products (guildId, name, price, description, emoji) VALUES (?, ?, ?, ?, ?)`, 
            [interaction.guild.id, name, price, description, emoji], async (err) => {
                if (err) return interaction.reply({ content: '❌ حدث خطأ أثناء حفظ المنتج.', flags: [MessageFlags.Ephemeral] });
                await interaction.reply({ content: `✅ تم إضافة المنتج **${name}** بنجاح وتحديث المتجر فوراً!`, flags: [MessageFlags.Ephemeral] });
                await updatePermanentShop(interaction.guild);
            });
        }

        // [ ❌ أمر حذف منتج - للمالك ]
        if (interaction.commandName === 'deleteproduct') {
            const prodId = interaction.options.getInteger('id');

            db.run(`DELETE FROM products WHERE id = ? AND guildId = ?`, [prodId, interaction.guild.id], async (err) => {
                if (err) return interaction.reply({ content: '❌ حدث خطأ أثناء الحذف.', flags: [MessageFlags.Ephemeral] });
                await interaction.reply({ content: `✅ تم حذف المنتج رقم **${prodId}** وتحديث المتجر فوراً!`, flags: [MessageFlags.Ephemeral] });
                await updatePermanentShop(interaction.guild);
            });
        }

        // [ 🛒 تثبيت المتجر - للمالك ]
        if (interaction.commandName === 'setup-shop') {
            await interaction.reply({ content: '⏳ جاري إعداد وتثبيت المتجر...', flags: [MessageFlags.Ephemeral] });
            
            // نرسل رسالة مؤقتة ليتم استبدالها لاحقاً بالتصميم الفخم
            const shopMessage = await interaction.channel.send({ content: 'جاري تحميل واجهة المتجر...' });
            
            db.run(`INSERT OR REPLACE INTO shop_msg (guildId, channelId, messageId) VALUES (?, ?, ?)`, 
            [interaction.guild.id, interaction.channel.id, shopMessage.id], async () => {
                await updatePermanentShop(interaction.guild);
                await interaction.editReply({ content: '✅ تم تثبيت المتجر بنجاح!' });
            });
        }

        // [ 🛠️ لوحة تحكم المالك لمعرفة معرفات المنتجات ]
        if (interaction.commandName === 'shop') {
            db.all(`SELECT * FROM products WHERE guildId = ?`, [interaction.guild.id], (err, rows) => {
                if (err) return interaction.reply({ content: '❌ حدث خطأ أثناء جلب المنتجات.', flags: [MessageFlags.Ephemeral] });
                if (rows.length === 0) return interaction.reply({ content: '🛒 المتجر فارغ حالياً.', flags: [MessageFlags.Ephemeral] });

                const embed = new EmbedBuilder()
                    .setColor('#ffcc00')
                    .setTitle('🛠️ لوحة تحكم المالك | معرفات المنتجات والأسعار')
                    .setDescription('هذه القائمة تظهر لك وحدك لتتمكن من معرفة الـ ID الخاص بكل منتج لحذفه أو تعديله بسهولة:');

                const components = buildShopComponents(rows, true);
                interaction.reply({ embeds: [embed], components: components, flags: [MessageFlags.Ephemeral] });
            });
        }

        // [ 💳 أمر معرفة الرصيد - للجميع ]
        if (interaction.commandName === 'balance') {
            db.get(`SELECT balance FROM economy WHERE userId = ?`, [userId], (err, row) => {
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('💳 محفظتك الرقمية في 6store')
                    .setDescription(`رصيدك الحالي هو: **${row ? row.balance : 0}** من عملة **6coin** 🪙`);
                interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
            });
        }

        // [ 🎁 أمر المكافأة اليومية - للجميع ]
        if (interaction.commandName === 'daily') {
            const today = new Date().toDateString();
            db.get(`SELECT balance, lastDaily FROM economy WHERE userId = ?`, [userId], (err, row) => {
                if (row && row.lastDaily === today) {
                    return interaction.reply({ content: '❌ لقد استلمت مكافأتك اليومية بالفعل! عد غداً.', flags: [MessageFlags.Ephemeral] });
                }
                const reward = 10;
                db.run(`UPDATE economy SET balance = balance + ?, lastDaily = ? WHERE userId = ?`, [reward, today, userId], (err) => {
                    interaction.reply({ content: `✅ مبروك! تم إضافة **${reward} 🪙** إلى حسابك كمكافأة يومية.`, flags: [MessageFlags.Ephemeral] });
                });
            });
        }
    }

    // ================= [ نظام الشراء وإنشاء التذاكر ] =================
    if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
        const productId = interaction.customId.split('_')[1];

        db.get(`SELECT * FROM products WHERE id = ? AND guildId = ?`, [productId, interaction.guild.id], (err, product) => {
            if (!product) return interaction.reply({ content: '❌ هذا المنتج لم يعد متوفراً.', flags: [MessageFlags.Ephemeral] });

            db.get(`SELECT balance FROM economy WHERE userId = ?`, [userId], async (err, row) => {
                if (!row || row.balance < product.price) {
                    return interaction.reply({ 
                        content: `❌ رصيدك غير كافٍ! سعر المنتج هو **${product.price} 🪙** ورصيدك الحالي **${row ? row.balance : 0} 🪙**.`, 
                        flags: [MessageFlags.Ephemeral] 
                    });
                }

                db.run(`UPDATE economy SET balance = balance - ? WHERE userId = ?`, [product.price, userId], async (err) => {
                    if (err) return interaction.reply({ content: '❌ حدث خطأ أثناء عملية الدفع.', flags: [MessageFlags.Ephemeral] });

                    await interaction.reply({ content: `⏳ جاري معالجة الشراء وتأمين التذكرة الخاصة بك...`, flags: [MessageFlags.Ephemeral] });

                    try {
                        const ticketChannel = await interaction.guild.channels.create({
                            name: `🛒-${interaction.user.username}`,
                            type: ChannelType.GuildText,
                            permissionOverwrites: [
                                {
                                    id: interaction.guild.id, // منع الجميع من رؤية الروم
                                    deny: [PermissionFlagsBits.ViewChannel],
                                },
                                {
                                    id: userId, // السماح للمشتري
                                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                                },
                                {
                                    id: client.user.id, // السماح للبوت
                                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                                }
                            ],
                        });

                        const ticketEmbed = new EmbedBuilder()
                            .setColor('#00ff66')
                            .setTitle('🎉 فاتورة شراء وتذكرة استلام جديدة')
                            .setDescription(`مرحباً بك في تذكرة الاستلام الخاصة بـ **6store**.\nتم قفل هذه القناة لتظهر لك وللإدارة فقط للمراجعة والتسليم اليدوي.`)
                            .addFields(
                                { name: 'المشتري المعتمد', value: `<@${userId}>`, inline: true },
                                { name: 'المنتج المطلوب', value: `${product.emoji || '📦'} ${product.name}`, inline: true },
                                { name: 'المبلغ المستقطع', value: `**${product.price} 6coin** 🪙`, inline: true }
                            )
                            .setTimestamp();

                        await ticketChannel.send({ 
                            content: `🔔 تنبيه الإدارة: <@${OWNER_ID}> | تم فتح تذكرة شراء جديدة.`, 
                            embeds: [ticketEmbed] 
                        });

                        await interaction.editReply({ content: `✅ **تم الشراء بنجاح وخصم المبلغ!**\nتفضل بزيارة تذكرتك لاستلام طلبك: <#${ticketChannel.id}>` });

                    } catch (channelError) {
                        console.error(channelError);
                        await interaction.editReply({ content: `✅ تم الخصم بنجاح، ولكن تعذر إنشاء التذكرة بسبب نقص الصلاحيات (الرجاء إعطاء البوت صلاحية Manage Channels).` });
                    }
                });
            });
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
