require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk').default;
const WeChatCrypto = require('./wechat-crypto');
const persona = require('./persona');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
});

const MODEL = process.env.ANTHROPIC_MODEL || 'mimo-v2.5-pro';

const crypto = new WeChatCrypto(
  process.env.TOKEN,
  process.env.ENCODING_AES_KEY,
  process.env.CORP_ID
);

const chatHistories = new Map();
const MAX_HISTORY = 20;

let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${process.env.CORP_ID}&corpsecret=${process.env.CORP_SECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(`获取 access_token 失败: ${data.errmsg}`);
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

async function getReply(userId, userMessage) {
  if (!chatHistories.has(userId)) chatHistories.set(userId, []);
  const history = chatHistories.get(userId);
  history.push({ role: 'user', content: userMessage });
  while (history.length > MAX_HISTORY * 2) history.shift();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: persona,
    messages: history,
  });

  let reply = response.content?.[0]?.text || '嗯';
  // 去掉句号
  reply = reply.replace(/。/g, '');
  history.push({ role: 'assistant', content: reply });
  return reply;
}

async function sendWeChatMessage(userId, content) {
  const token = await getAccessToken();
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
  const body = {
    touser: userId,
    msgtype: 'text',
    agentid: parseInt(process.env.AGENT_ID),
    text: { content },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.errcode !== 0) console.error('发送失败:', data.errmsg);
  return data;
}

// 企业微信回调验证（GET）
app.get('/callback', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  if (crypto.verifySignature(msg_signature, timestamp, nonce, echostr)) {
    try {
      res.send(crypto.decrypt(echostr));
    } catch (e) {
      res.status(500).send('解密失败');
    }
  } else {
    res.status(403).send('签名验证失败');
  }
});

// 企业微信消息回调（POST）
app.post('/callback', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce } = req.query;
    const body = req.body.toString('utf-8');
    const xmlData = await crypto.parseXML(body);
    const encryptedMsg = xmlData.Encrypt || xmlData.xml?.Encrypt;

    if (!encryptedMsg) return res.send('success');
    if (!crypto.verifySignature(msg_signature, timestamp, nonce, encryptedMsg)) {
      return res.status(403).send('签名验证失败');
    }

    const decrypted = crypto.decrypt(encryptedMsg);
    const parsed = await crypto.parseXML(`<xml>${decrypted}</xml>`);
    const msg = parsed.xml || parsed;

    if (msg.MsgType !== 'text') return res.send('success');

    const fromUser = msg.FromUserName;
    const userMessage = msg.Content;
    console.log(`[${new Date().toLocaleTimeString()}] ${fromUser}: ${userMessage}`);

    res.send('success');

    const reply = await getReply(fromUser, userMessage);
    console.log(`[${new Date().toLocaleTimeString()}] 时晨菲: ${reply}`);
    await sendWeChatMessage(fromUser, reply);
  } catch (err) {
    console.error('处理消息出错:', err.message);
    res.send('success');
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// 查看出站 IP
app.get('/myip', async (req, res) => {
  try {
    const ip = await getPublicIP();
    res.json({ ip });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// 自动更新可信 IP
let lastIP = null;

async function getPublicIP() {
  return new Promise((resolve, reject) => {
    require('https').get('https://api64.ipify.org', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
    }).on('error', reject);
  });
}

async function updateTrustedIP() {
  try {
    const currentIP = await getPublicIP();

    if (currentIP === lastIP) return;
    lastIP = currentIP;

    console.log(`[IP更新] IP变更为: ${currentIP}`);

    // IP 变了，给用户发消息提醒更新可信 IP
    try {
      await sendWeChatMessage('SunSiZhuo', `IP变了：${currentIP}\n去管理后台更新可信IP`);
    } catch (e) {
      // 发不出去也没关系，可能是 IP 还没加
    }
  } catch (err) {
    console.error('[IP更新] 检测IP出错:', err.message);
  }
}

// 启动时立即检测一次，之后每 3 分钟检测一次
updateTrustedIP();
setInterval(updateTrustedIP, 3 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`时晨菲机器人已启动，监听端口 ${PORT}`);
});
