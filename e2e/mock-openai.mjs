/**
 * 本地 OpenAI 兼容 mock。覆盖：
 *   GET  /v1/models
 *   POST /v1/chat/completions   非流式（查词 / 翻译）与流式 tool call（侧边栏）
 *   GET  /page                  验收用文章
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixture.html'));

function messageText(messages) {
  return (messages ?? []).map((message) => {
    if (typeof message?.content === 'string') return message.content;
    if (message?.content == null) return '';
    return JSON.stringify(message.content);
  }).join('\n');
}

function toolResultCount(messages) {
  return (messages ?? []).filter((message) => message?.role === 'tool').length;
}

function findTitle(messages) {
  for (const message of messages ?? []) {
    if (message?.role !== 'tool') continue;
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) return parsed.title.trim();
    } catch {
      /* 工具结果不一定是 JSON */
    }
    const match = content.match(/BYOK Acceptance Article/);
    if (match) return match[0];
  }
  return null;
}

function firstJsonArray(text) {
  const marker = text.lastIndexOf('Input:\n');
  const slice = marker >= 0 ? text.slice(marker + 'Input:\n'.length) : text;
  const start = slice.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < slice.length; i++) {
    const ch = slice[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(slice.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function completion(content) {
  return {
    id: 'chatcmpl-sync',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-text',
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 12, completion_tokens: 12, total_tokens: 24 },
  };
}

function chunk(id, delta, finish) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-chat',
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function writeSse(res, events) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function syncContent(text) {
  if (text.includes('Translate English paragraphs')) {
    const inputs = firstJsonArray(text);
    const translations = Array.isArray(inputs)
      ? inputs.map((item) => `译:${String(item).slice(0, 48)}`)
      : ['译:fallback'];
    return { kind: 'translate', content: JSON.stringify({ translations }) };
  }
  if (text.includes('lexicographer')) {
    return {
      kind: 'lookup',
      content: JSON.stringify({
        ipa: '/ˈkwɔːrveks/',
        partsOfSpeech: [{
          pos: 'noun',
          definitions: [{
            definition: 'A made-up noun used by the acceptance test.',
            cn: '验收测试词',
            example: 'The qorvex sat on the page.',
          }],
        }],
      }),
    };
  }
  if (text.includes('Chinese glosses') || text.includes('Chinese strings')) {
    const inputs = firstJsonArray(text);
    const count = Array.isArray(inputs) && inputs.length > 0 ? inputs.length : 1;
    return { kind: 'gloss', content: JSON.stringify(Array.from({ length: count }, () => '验收测试词')) };
  }
  return { kind: 'ping', content: 'pong' };
}

function streamEvents(body, text) {
  const id = `chatcmpl-${Math.random().toString(16).slice(2, 10)}`;
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const wantsPage = /页面|读取/.test(text);
  if (tools.length > 0 && wantsPage) {
    const done = toolResultCount(body.messages);
    if (done === 0) {
      return {
        kind: 'tool:get_page_content',
        events: [
          chunk(id, {
            role: 'assistant',
            content: null,
            tool_calls: [{
              index: 0,
              id: `call_page_${id}`,
              type: 'function',
              function: { name: 'get_page_content', arguments: '{"maxChars":12000}' },
            }],
          }, null),
          chunk(id, {}, 'tool_calls'),
        ],
      };
    }
    if (done === 1) {
      return {
        kind: 'tool:save_word_card',
        events: [
          chunk(id, {
            role: 'assistant',
            content: null,
            tool_calls: [{
              index: 0,
              id: `call_save_${id}`,
              type: 'function',
              function: {
                name: 'save_word_card',
                arguments: JSON.stringify({ word: 'qorvex', note: 'agent saved' }),
              },
            }],
          }, null),
          chunk(id, {}, 'tool_calls'),
        ],
      };
    }
    const title = findTitle(body.messages) ?? 'UNKNOWN';
    const answer = `文章标题是 ${title}。已把 qorvex 存入学习记录。`;
    return {
      kind: 'chat-final',
      events: [
        chunk(id, { role: 'assistant', content: answer }, null),
        chunk(id, {}, 'stop'),
      ],
    };
  }
  return {
    kind: 'chat-plain',
    events: [
      chunk(id, { role: 'assistant', content: '收到。' }, null),
      chunk(id, {}, 'stop'),
    ],
  };
}

export function startMockServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/page' || url.pathname === '/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fixture);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      requests.push({ kind: 'models' });
      sendJson(res, 200, { object: 'list', data: [{ id: 'mock-chat' }, { id: 'mock-text' }] });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readBody(req);
      const text = messageText(body.messages);
      if (body.stream) {
        const streamed = streamEvents(body, text);
        requests.push({ kind: streamed.kind });
        console.log('[mock]', streamed.kind);
        writeSse(res, streamed.events);
        return;
      }
      const sync = syncContent(text);
      requests.push({ kind: sync.kind });
      console.log('[mock]', sync.kind);
      sendJson(res, 200, completion(sync.content));
      return;
    }
    sendJson(res, 404, { error: `no route ${req.method} ${url.pathname}` });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        server,
        port,
        requests,
        baseURL: `http://127.0.0.1:${port}/v1`,
        pageURL: `http://127.0.0.1:${port}/page`,
      });
    });
  });
}
