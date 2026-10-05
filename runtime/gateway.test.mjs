import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Events } from 'discord.js';
import { startGateway } from './gateway.mjs';

test('Gateway login, readiness, errors and missing credentials', async () => {
  const client = new EventEmitter();
  const logs = [];
  let destroyed = 0;
  let loggedIn;
  client.destroy = async () => { destroyed++; };
  client.login = async token => { loggedIn = token; };
  client.isReady = () => true;
  client.user = { id: '123456789012345678' };
  const received = [];
  startGateway({ DISCORD_BOT_TOKEN: ' secret ', DISCORD_CHANNEL_ID: 'channel' }, client, text => logs.push(text), message => received.push(message));
  assert.equal(loggedIn, 'secret');
  client.emit(Events.ClientReady);
  assert.match(logs[0], /온라인/);
  const message = { id: '1', channelId: 'channel', content: '<@123456789012345678> hello', type: 0, author: { id: 'user', username: 'name', bot: false } };
  for (const ignored of [{ ...message, channelId: 'other' }, { ...message, author: { bot: true } }, { ...message, webhookId: 'hook' }, { ...message, content: '' }]) client.emit(Events.MessageCreate, ignored);
  client.emit(Events.MessageCreate, message);
  assert.deepEqual(received, [{ id: '1', content: 'hello', authorId: 'user', channelId: 'channel' }]);
  client.emit(Events.Error, new Error('secret'));
  assert.ok(logs.every(text => !text.includes('secret')));
  await client.destroy();
  assert.equal(destroyed, 1);
  client.login = async () => { throw new Error('secret'); };
  startGateway({ DISCORD_BOT_TOKEN: 'secret' }, client, text => logs.push(text));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(destroyed, 2);
  assert.match(logs.at(-1), /로그인 실패/);
  loggedIn = undefined;
  startGateway({}, client, text => logs.push(text));
  assert.equal(loggedIn, undefined);
});

test('configured user IDs restrict feedback while all allows every channel participant', () => {
  const client = new EventEmitter();
  client.login = async () => {};
  client.isReady = () => true;
  client.user = { id: '123456789012345678' };
  const received = [];
  startGateway({ DISCORD_BOT_TOKEN: 'fake', DISCORD_CHANNEL_ID: 'channel', DISCORD_ALLOWED_USER_IDS: 'allowed' },
    client, () => {}, message => received.push(message));
  for (const id of ['other', 'allowed']) client.emit(Events.MessageCreate, {
    id, channelId: 'channel', type: 0, content: '<@123456789012345678> implement', author: { id, bot: false },
  });
  assert.deepEqual(received.map(message => message.authorId), ['allowed']);
});

test('only explicit bot mentions forward requests and bot mentions are removed', () => {
  const client = new EventEmitter();
  client.login = async () => {};
  client.isReady = () => true;
  client.user = { id: '123456789012345678' };
  const received = [];
  startGateway({ DISCORD_BOT_TOKEN: 'fake', DISCORD_CHANNEL_ID: 'channel' }, client, () => {},
    message => received.push(message));
  const emit = content => client.emit(Events.MessageCreate, {
    id: 'request', channelId: 'channel', type: 0, content, author: { id: 'user', bot: false },
    // A reply can implicitly mention the bot without containing an explicit mention.
    mentions: { users: new Map([[client.user.id, client.user]]) },
  });
  for (const content of ['hello', '<@999999999999999999> hello', '<@&123456789012345678> hello',
    '@everyone hello', '<@123456789012345678>', '<@!123456789012345678>   ']) emit(content);
  assert.equal(received.length, 0);
  emit('<@123456789012345678> 버그 수정해줘');
  emit('검토해줘 <@!123456789012345678>');
  emit('<@123456789012345678> <@999999999999999999> 확인 <@123456789012345678>');
  assert.deepEqual(received.map(message => message.content), [
    '버그 수정해줘', '검토해줘', '<@999999999999999999> 확인',
  ]);
});
