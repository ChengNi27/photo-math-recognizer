const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 配置：API Key 只存在服务器上，永不暴露给前端 =====
const API_KEY = process.env.DASHSCOPE_API_KEY || 'sk-f11cb1a692264087846bc323704885ac';
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

// 解析 JSON 请求体（最大 10MB，支持图片 base64）
app.use(express.json({ limit: '10mb' }));

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// ===== API 代理：转发请求到阿里云百炼 =====
app.post('/api/recognize', async (req, res) => {
  try {
    const { image, mode } = req.body;
    if (!image) {
      return res.status(400).json({ error: '缺少图片数据' });
    }

    // 根据模式选择模型
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
      '3. question 字段必须包含完整题干和所有选项（A/B/C/D等），选项之间用换行分隔\n' +
      '4. answer 是你自己计算出的准确答案，不要依赖图片中可能存在的手写批改\n' +
      '5. 公式用 LaTeX 格式，用 $ 包裹\n' +
      '6. 如果文字中有"第1题""第2题"等标记，务必每一题都提取';

    // 转发到阿里云百炼
    const response = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            { type: 'text', text: promptText }
          ]
        }]
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: err.error?.message || 'API 请求失败 ' + response.status
      });
    }

    const data = await response.json();
    const text = data.choices[0].message.content;

    res.json({ text: text, model: model });
  } catch (err) {
    console.error('代理请求失败:', err.message);
    res.status(500).json({ error: err.message || '服务器内部错误' });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log('🚀 拍照识题服务已启动: http://localhost:' + PORT);
  console.log('📝 API Key 安全存储在服务器，前端不可见');
});
