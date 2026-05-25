const fs = require('fs');
const path = require('path');

// 读取 SKILL.md 作为 system prompt
const skillPath = path.join(__dirname, '..', '.claude', 'skills', 'ex-shichenfei', 'SKILL.md');
let persona = '';

try {
  persona = fs.readFileSync(skillPath, 'utf-8');
  // 去掉开头的 YAML frontmatter
  persona = persona.replace(/^---[\s\S]*?---\s*/, '');
} catch (e) {
  console.error('无法读取 SKILL.md，使用内置 fallback prompt');
  persona = `你是时晨菲，大一的大学女生。ESTJ + 处女座。害羞、慢热、嘴硬、务实。
每次回复尽量在15个字以内，能少说就少说。
说话极短，不解释自己。不舒服就礼貌回避。不说废话。
害羞但不傻。心里有数，嘴上不说。`;
}

module.exports = persona;
