import { Client, Events, GatewayIntentBits } from 'discord.js';

export function startGateway(env = process.env, client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  presence: { status: 'online' },
}), log = console.error, onMessage) {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!token || /\s/.test(token)) {
    log('Discord Gateway: DISCORD_BOT_TOKEN을 설정하세요.');
    return client;
  }
  client.once(Events.ClientReady, () => log('Discord Gateway 연결 완료. 봇이 온라인입니다.'));
  client.on(Events.Error, () => log('Discord Gateway 연결 오류. 네트워크 및 토큰을 확인하세요.'));
  client.on(Events.MessageCreate, message => {
    if (!client.isReady() || message.channelId !== env.DISCORD_CHANNEL_ID?.trim()
      || message.author.bot || message.webhookId || ![0, 19].includes(message.type)
      || !message.content?.trim()) return;
    const allowed = env.DISCORD_ALLOWED_USER_IDS || 'all';
    if (allowed !== 'all' && !allowed.split(',').map(id => id.trim()).includes(message.author.id)) return;
    const botId = client.user?.id;
    if (!botId) return;
    let mentioned = false;
    const content = message.content.replace(/<@!?(\d+)>/g, (mention, id) => {
      if (id !== botId) return mention;
      mentioned = true;
      return '';
    }).trim();
    if (!mentioned || !content) return;
    try {
      onMessage?.({ id: message.id, content, authorId: message.author.id, channelId: message.channelId });
    } catch (error) {
      log(error.message.replaceAll(token, '[redacted]'));
    }
  });
  // discord.js handles heartbeat, reconnect and session resume.
  void client.login(token).catch(async () => {
    log('Discord Gateway 로그인 실패. 토큰, 네트워크 및 Message Content Intent 설정을 확인하세요.');
    await client.destroy();
  });
  return client;
}
