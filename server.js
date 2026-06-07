const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== API Key 从环境变量读取 =====
const API_KEY = process.env.DASHSCOPE_API_KEY || 'sk-f11cb1a692264087846bc323704885ac';
const DASHSCOPE_HOST = 'dashscope.aliyuncs.com';
const DASHSCOPE_PATH = '/compatible-mode/v1/chat/completions';

// 解析 JSON 请求体（最大 10MB）
app.use(express.json({ limit: '10mb' }));

// 静态文件服务（前端页面）
app.use(express.static(path.join(__dirname, 'public')));

// ===== HTTPS 请求封装 =====
function dashScopeRequest(postData) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: DASHSCOPE_HOST,
      path: DASHSCOPE_PATH,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 120000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode !== 200) {
            reject(new Error(data.error?.message || 'API错误 ' + res.statusCode));
          } else {
            resolve(data);
          }
        } catch(e) {
          reject(new Error('响应解析失败'));
        }
      });
    });

    req.on('error', (e) => reject(new Error('网络错误: ' + e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(postData);
    req.end();
  });
}

// ===== API 代理 =====
app.post('/api/recognize', async (req, res) => {
  try {
    const { image, mode } = req.body;
    if (!image) {
      return res.status(400).json({ error: '缺少图片数据' });
    }

    const model = mode === 'hard' ? 'qwen-vl-plus' : 'qwen-vl-max';

    const promptText =
      '请识别图片中所有题目，先数一数共有几道题，然后逐题提取，一题不漏。\n' +
      '对每道题提取：\n' +
      '1. 完整题目（题干 + 所有选项，如"A. xxx\\nB. xxx\\nC. xxx\\nD. xxx"，数学公式保留 LaTeX 格式，用 $ 包裹）\n' +
      '2. 正确答案（请根据题目内容自己计算/判断，选择题从选项中选择，填空题给出计算结果的精确值）\n' +
      '3. 解题过程（简要写出计算步骤和推理过程，数学公式用 LaTeX 格式，用 $ 包裹）\n\n' +
      '严格返回 JSON 数组：[{"question":"第1题完整内容","answer":"答案1","process":"解题过程1"},{"question":"第2题完整内容","answer":"答案2","process":"解题过程2"},{"question":"第3题完整内容","answer":"答案3","process":"解题过程3"}]\n\n' +
      '规则：\n' +
      '1. 只输出 JSON，不要 markdown、不要代码块、不要解释文字\n' +
      '2. 必须把所有题目都提取出来，有几题就返回几个对象，绝不遗漏\n' +
      '3. question 字段必须包含完整题干和所有选项\n' +
      '4. answer 是你自己计算出的准确答案\n' +
      '5. 公式用 LaTeX 格式，用 $ 包裹';

    const postData = JSON.stringify({
      model: model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: promptText }
        ]
      }]
    });

    const data = await dashScopeRequest(postData);
    const text = data.choices[0].message.content;

    res.json({ text: text, model: model });
  } catch (err) {
    console.error('代理请求失败:', err.message);
    res.status(500).json({ error: err.message || '服务器内部错误' });
  }
});

// 启动
app.listen(PORT, () => {
  console.log('拍照识题服务已启动: ' + PORT);
});
