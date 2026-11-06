// Application behavior behind injected streaming and the existing host context.
// The CLI owns credentials/TTY setup; tests can exercise cancellation and retry
// without starting a terminal or making network requests.
import { SYSTEM_PROMPT } from "./stream.mjs";

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function createChatController({ view, stream }) {
  const messages = [];
  let busy = false;
  let generation = 0;
  let composerVersion = 0;
  let activeController;
  let disposed = false;

  function markup(draft = "") {
    return view
      .replaceAll('id="composer"', `id="composer-${composerVersion}"`)
      .replaceAll('id="message"', `id="message-${composerVersion}"`)
      .replaceAll('for="message"', `for="message-${composerVersion}"`)
      .replaceAll('id="send"', `id="send-${composerVersion}"`)
      .replaceAll('id="new"', `id="new-${composerVersion}"`)
      .replace("</textarea>", `${escapeHtml(draft)}</textarea>`);
  }
  function paintHistory(ctx) {
    const content =
      messages
        .map((message) => {
          const body =
            message.role === "user"
              ? `<p>${escapeHtml(message.content).replace(/\n/g, "<br>")}</p>`
              : message.content || "<p>…</p>";
          return `<section><h3>${message.role === "user" ? "You" : "Assistant"}</h3>${body}</section>`;
        })
        .join("") || '<p><span class="text-muted">Ask a question to begin.</span></p>';
    ctx.replace(
      "history",
      `<div data-teml="grid" data-columns="1" data-id="history"><div class="card">${content}</div></div>`,
      "html",
    );
  }
  function status(ctx, kind, text) {
    ctx.replace(
      "status",
      `<div data-teml="grid" data-columns="1" data-id="status"><div class="alert alert-${kind}">${escapeHtml(text)}</div></div>`,
      "html",
    );
  }
  function cancel() {
    generation++;
    activeController?.abort();
    activeController = undefined;
    busy = false;
  }
  async function submit(ctx) {
    if (disposed) return;
    if (busy) {
      status(ctx, "info", "Still responding. Your draft is kept; New chat cancels this response.");
      return;
    }
    const text = (ctx.values()[`message-${composerVersion}`] ?? "").trim();
    if (!text) return;
    const id = ++generation;
    busy = true;
    const controller = new AbortController();
    activeController = controller;
    const assistant = { role: "assistant", content: "", streaming: true };
    messages.push({ role: "user", content: text }, assistant);
    composerVersion++;
    ctx.render(markup(), "html");
    paintHistory(ctx);
    status(ctx, "info", "Assistant is responding… New chat cancels this response.");
    try {
      const wireMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages
          .filter((message) => !message.streaming)
          .map(({ role, content }) => ({ role, content })),
      ];
      let lastPaint = 0;
      for await (const delta of stream(wireMessages, controller.signal)) {
        if (id !== generation || disposed) return;
        assistant.content += delta;
        if (Date.now() - lastPaint >= 60) {
          paintHistory(ctx);
          lastPaint = Date.now();
        }
      }
      if (id !== generation || disposed) return;
      assistant.streaming = false;
      paintHistory(ctx);
      status(ctx, "success", "Response complete. Ask a follow-up or start a new chat.");
    } catch (error) {
      if (id !== generation || disposed) return;
      // Remove the failed pair so retrying does not duplicate the user's turn.
      messages.splice(-2);
      // Preserve a new draft typed during streaming; otherwise restore the failed prompt.
      const draft = ctx.values()[`message-${composerVersion}`] || text;
      composerVersion++;
      ctx.render(markup(draft), "html");
      paintHistory(ctx);
      status(
        ctx,
        "danger",
        `Could not get a response: ${error instanceof Error ? error.message : String(error)}. Your draft is ready to retry.`,
      );
    } finally {
      if (id === generation) {
        busy = false;
        activeController = undefined;
      }
    }
  }
  return {
    markup,
    handlers: {
      onSubmit(_form, _values, ctx) {
        return submit(ctx);
      },
      onKey(key, modifiers, ctx) {
        if (key === "enter" && modifiers?.ctrl) return submit(ctx);
      },
      onClick(id, _values, ctx) {
        if (!id.startsWith("new-") || disposed) return;
        cancel();
        composerVersion++;
        messages.length = 0;
        ctx.render(markup(), "html");
        status(ctx, "info", "New conversation ready.");
      },
      onError(message, ctx) {
        if (!disposed && message !== "unknown mutation target 'status'")
          status(ctx, "danger", message);
      },
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
