const crypto = require('crypto');
const xml2js = require('xml2js');

class WeChatCrypto {
  constructor(token, encodingAESKey, corpId) {
    this.token = token;
    this.corpId = corpId;
    // EncodingAESKey 是 Base64 编码的 43 字符，解码后为 32 字节 AES 密钥
    this.aesKey = Buffer.from(encodingAESKey + '=', 'base64');
    this.iv = this.aesKey.subarray(0, 16);
  }

  // 验证签名
  verifySignature(signature, timestamp, nonce, echostr) {
    const arr = [this.token, timestamp, nonce, echostr].filter(Boolean).sort();
    const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');
    return hash === signature;
  }

  // 解密消息
  decrypt(encrypted) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, this.iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encrypted, 'base64'), decipher.final()]);
    // 去 PKCS7 padding
    const pad = decrypted[decrypted.length - 1];
    decrypted = decrypted.subarray(0, decrypted.length - pad);
    // 前 16 字节是随机字符串，接下来 4 字节是消息长度（网络字节序），然后是消息体，最后是 CorpID
    const msgLen = decrypted.readUInt32BE(16);
    const message = decrypted.subarray(20, 20 + msgLen).toString('utf-8');
    const corpId = decrypted.subarray(20 + msgLen).toString('utf-8');
    if (corpId !== this.corpId) {
      throw new Error('CorpID 不匹配');
    }
    return message;
  }

  // 加密消息
  encrypt(message) {
    const msgBuf = Buffer.from(message, 'utf-8');
    const msgLen = Buffer.alloc(4);
    msgLen.writeUInt32BE(msgBuf.length, 0);
    const randomBytes = crypto.randomBytes(16);
    const corpIdBuf = Buffer.from(this.corpId, 'utf-8');
    const plaintext = Buffer.concat([randomBytes, msgLen, msgBuf, corpIdBuf]);
    // PKCS7 padding
    const blockSize = 32;
    const padLen = blockSize - (plaintext.length % blockSize);
    const padBuf = Buffer.alloc(padLen, padLen);
    const padded = Buffer.concat([plaintext, padBuf]);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.aesKey, this.iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return encrypted.toString('base64');
  }

  // 生成回复的签名
  getSignature(encrypted, timestamp, nonce) {
    const arr = [this.token, timestamp, nonce, encrypted].sort();
    return crypto.createHash('sha1').update(arr.join('')).digest('hex');
  }

  // 解析 XML 消息体
  async parseXML(xml) {
    const parser = new xml2js.Parser({ explicitArray: false, trim: true });
    const result = await parser.parseStringPromise(xml);
    return result.xml;
  }

  // 构造加密的 XML 回复
  buildEncryptedXML(encryptedMsg, signature, timestamp, nonce) {
    return `<xml>
<Encrypt><![CDATA[${encryptedMsg}]]></Encrypt>
<MsgSignature><![CDATA[${signature}]]></MsgSignature>
<TimeStamp>${timestamp}</TimeStamp>
<Nonce><![CDATA[${nonce}]]></Nonce>
</xml>`;
  }

  // 构造明文 XML 回复（用于消息回复）
  buildReplyXML(toUser, fromUser, content, msgType = 'text') {
    const timestamp = Math.floor(Date.now() / 1000);
    if (msgType === 'text') {
      return `<xml>
<ToUserName><![CDATA[${toUser}]]></ToUserName>
<FromUserName><![CDATA[${fromUser}]]></FromUserName>
<CreateTime>${timestamp}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
    }
  }
}

module.exports = WeChatCrypto;
