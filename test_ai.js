// filename: volc-bot-node.js

/**
 * 火山方舟 v3 Bot 接入点（与 OpenAI Chat Completions 协议兼容）的 Node.js 示例。
 * - 使用 OpenAI 官方 SDK
 * - baseURL 指向方舟 v3 bots 接口：https://ark.cn-beijing.volces.com/api/v3/bots
 * - model 使用本页的 Bot ID：bot-20251225001119-59jt9
 * - 从环境变量 ARK_API_KEY 读取密钥
 *
 * 运行：
 *   export ARK_API_KEY="YOUR_API_KEY"
 *   node volc-bot-node.js
 *
 * 安全提示：
 * - 不要把 API Key 写死在代码里；使用环境变量或安全的密钥管理方案。
 */

import OpenAI from "openai";

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Missing ARK_API_KEY. Please set environment variable: export ARK_API_KEY=\"YOUR_API_KEY\"");
  process.exit(1);
}

// 初始化客户端，baseURL 指向火山方舟 v3 bots
const client = new OpenAI({
  baseURL: "https://ark.cn-beijing.volces.com/api/v3/bots",
  apiKey: API_KEY,
});

// 公用消息示例（你可以替换为自己的对话内容）
const messages = [
  { role: "system", content: "你是豆包，是由字节跳动开发的 AI 人工智能助手" },
  { role: "user", content: "今天几号，告知我信息来源？" },
];

async function nonStreamingDemo() {
  console.log("----- standard request -----");
  const completion = await client.chat.completions.create({
    model: "bot-20251225001119-59jt9", // 使用本页的 Bot ID
    messages,
    // 可选：包含用量统计（不同 SDK 版本/服务端可能行为不同）
    // 注意：OpenAI SDK 的 chat.completions 不直接支持 stream_options 作为参数，
    // 如果需要用量，请以服务端返回为准。
    extra_body: {
      // 火山方舟扩展参数：强制返回 tokens 用量
      stream_options: { include_usage: true },
    },  
  });

  const content = completion?.choices?.[0]?.message?.content ?? "";
  console.log(content);

  // 用量统计（可能因协议兼容层差异而为空）
  if (completion?.usage) {
    console.log("usage:", completion.usage);
    console.log('输入 tokens:', completion.usage.prompt_tokens);
    console.log('输出 tokens:', completion.usage.completion_tokens);
    console.log('总 tokens:', completion.usage.total_tokens);    
  }
}

async function main() {
  try {
    await nonStreamingDemo();
  } catch (err) {
    // 友好错误输出
    if (err && typeof err === "object") {
      console.error("Error:", err?.message ?? err);
      // 可能包含服务端返回的详细错误
      if (err?.response?.data) {
        console.error("Server response data:", err.response.data);
      }
    } else {
      console.error("Unknown error:", err);
    }
    process.exit(1);
  }
}

main();
