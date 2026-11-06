export const SYSTEM_PROMPT = `You are a helpful assistant inside a terminal chat client.
Reply with ONLY an HTML fragment, without a document wrapper or outer code fence.
Use concise prose, headings, lists, tables, and pre/code blocks when useful.
Supported inline elements: strong, em, code, del, mark, kbd, and absolute http(s) links.
Use text-success, text-danger, text-warning, and text-muted spans sparingly.
Use alert-info/success/warning/danger callouts only for genuine status information.
Use data-teml metric or progress only for real numeric data. Do not invent links.`;

export const MOCK_REPLY = `<h3>A better terminal conversation</h3>
<p>This response arrives in small chunks, just like a live DeepSeek stream. Your composer stays independent while the conversation reflows.</p>
<ul><li><strong>Single-file HTML views</strong></li><li>Sanitized rich responses</li><li>Actionable loading and error states</li></ul>
<div class="alert alert-success">The mock stream works without an API key.</div>
<pre><code class="language-js">const view = readFileSync("./app.html", "utf8");</code></pre>`;

export const MAX_SSE_EVENT_BYTES = 1_048_576;

export function createSseParser() {
  let buffer = "";
  let bufferedBytes = 0;
  let pendingCarriageReturn = false;
  const encoder = new TextEncoder();
  const byteLength = (value) => encoder.encode(value).byteLength;
  const oversized = () => {
    buffer = "";
    bufferedBytes = 0;
    pendingCarriageReturn = false;
    return new Error(`SSE event exceeds ${MAX_SSE_EVENT_BYTES} bytes`);
  };
  const appendNormalized = (value) => {
    buffer += value;
    bufferedBytes += byteLength(value);
  };
  const append = (chunk) => {
    if (pendingCarriageReturn) {
      appendNormalized("\n");
      if (chunk.startsWith("\n")) chunk = chunk.slice(1);
      pendingCarriageReturn = false;
    }
    if (chunk.endsWith("\r")) {
      pendingCarriageReturn = true;
      chunk = chunk.slice(0, -1);
    }
    appendNormalized(chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  };
  const take = (event) => {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return null;
    const payload = JSON.parse(data);
    return payload.choices?.[0]?.delta?.content ?? "";
  };
  return {
    push(chunk) {
      if (chunk) append(chunk);
      const deltas = [];
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        const eventBytes = byteLength(event);
        if (eventBytes > MAX_SSE_EVENT_BYTES) throw oversized();
        buffer = buffer.slice(boundary + 2);
        bufferedBytes -= eventBytes + 2;
        const delta = take(event);
        if (delta) deltas.push(delta);
      }
      if (bufferedBytes > MAX_SSE_EVENT_BYTES) throw oversized();
      return deltas;
    },
    flush() {
      if (pendingCarriageReturn) {
        pendingCarriageReturn = false;
        appendNormalized("\n");
      }
      if (byteLength(buffer) > MAX_SSE_EVENT_BYTES) throw oversized();
      if (!buffer.trim()) {
        buffer = "";
        bufferedBytes = 0;
        return [];
      }
      const event = buffer;
      buffer = "";
      bufferedBytes = 0;
      const delta = take(event);
      return delta ? [delta] : [];
    },
  };
}

export async function* mockStream(text = MOCK_REPLY, delay = 8) {
  for (let offset = 0; offset < text.length; offset += 72) {
    yield text.slice(offset, offset + 72);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export async function* deepSeekStream({ model, messages, apiKey, signal }) {
  const requestSignal = signal
    ? globalThis.AbortSignal.any([signal, globalThis.AbortSignal.timeout(60_000)])
    : globalThis.AbortSignal.timeout(60_000);
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: requestSignal,
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      detail = JSON.parse(text).error?.message ?? text;
    } catch {
      // Keep the server-provided text.
    }
    throw new Error(`DeepSeek API error ${response.status}: ${detail}`);
  }
  if (!response.body) throw new Error("DeepSeek returned no response body");

  const parser = createSseParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const delta of parser.push(decoder.decode(value, { stream: true }))) yield delta;
  }
  for (const delta of parser.push(decoder.decode())) yield delta;
  for (const delta of parser.flush()) yield delta;
}
