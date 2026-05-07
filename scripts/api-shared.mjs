import {
  formatResultsForPrompt,
  loadData,
  loadDataAsync,
  localFallbackAnswerAsync,
  searchKnowledge,
  searchKnowledgeAsync
} from "./data-store.mjs";

export function jsonResponse(payload, statusCode = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

export function textResponse(text, statusCode = 200, headers = {}) {
  return new Response(text, {
    status: statusCode,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...headers
    }
  });
}

export async function readJsonBody(request) {
  if (request && typeof request.json === "function") {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getModelTimeoutMs() {
  const rawTimeout = Number(process.env.LLM_TIMEOUT_MS || 7500);
  if (!Number.isFinite(rawTimeout)) return 7500;
  return Math.max(1000, Math.min(rawTimeout, 9000));
}

export async function callModel(message, history = []) {
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey) {
    return { answer: await localFallbackAnswerAsync(message), mode: "local" };
  }

  const baseUrl = process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL?.trim() || "gpt-4o-mini";
  const results = await searchKnowledgeAsync(message, 18);
  const context = formatResultsForPrompt(results);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getModelTimeoutMs());

  let upstream;
  try {
    upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "你是一个洛克王国世界朋友群使用的虚拟助手。必须优先根据提供的本地资料回答，资料包括精灵图鉴、种族值、特性、技能、蛋组和朋友交换记录。遇到最高威力、排序、筛选、对比类问题时，优先使用本地资料里的可计算结论；资料不足时明确说明不确定。回答用简洁中文。"
          },
          ...history.slice(-4).map((item) => ({
            role: item.role === "assistant" ? "assistant" : "user",
            content: String(item.content || "").slice(0, 800)
          })),
          {
            role: "user",
            content: `用户问题：${message}\n\n本地检索资料：\n${context}`
          }
        ]
      })
    });
  } catch (error) {
    return {
      answer: await localFallbackAnswerAsync(message),
      mode: "local",
      warning: error?.name === "AbortError" ? "模型接口响应超时，已改用本地资料摘要。" : "模型接口暂时不可达，已改用本地资料摘要。"
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    const errorText = await upstream.text();
    return {
      answer: await localFallbackAnswerAsync(message),
      mode: "local",
      warning: `模型接口调用失败：${errorText.slice(0, 300)}`
    };
  }

  const payload = await upstream.json();
  return {
    answer: payload?.choices?.[0]?.message?.content || await localFallbackAnswerAsync(message),
    mode: "llm",
    results
  };
}

export { loadData, loadDataAsync, searchKnowledge, searchKnowledgeAsync };
