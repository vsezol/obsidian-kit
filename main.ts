import {
  App,
  MarkdownPostProcessorContext,
  Plugin,
  TFile,
} from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

type Kind = "counter" | "switcher" | "progress" | "daysLeft";

interface WidgetSpec {
  kind: Kind;
  args: string[];
  raw: string;
}

const WIDGET_PATTERN = /\b(counter|switcher|progress|daysLeft)\(([^)\n]*)\)/g;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((s) => s.trim());
}

function formatRaw(kind: Kind, args: string[]): string {
  return `${kind}(${args.join(", ")})`;
}

function toInt(s: string | undefined, fallback: number): number {
  if (s === undefined) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(s: string | undefined, fallback: number): number {
  if (s === undefined) return fallback;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, "").trim();
}

function parseDate(raw: string): Date | null {
  const s = stripQuotes(raw);
  if (!s) return null;
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const d = new Date(
      parseInt(ymd[1], 10),
      parseInt(ymd[2], 10) - 1,
      parseInt(ymd[3], 10)
    );
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function buildWidget(
  spec: WidgetSpec,
  onChange: (newRaw: string) => void
): HTMLElement {
  const root = document.createElement("span");
  root.className = `obsidian-kit-widget obsidian-kit-${spec.kind}`;

  if (spec.kind === "counter") {
    renderCounter(root, spec, onChange);
  } else if (spec.kind === "switcher") {
    renderSwitcher(root, spec, onChange);
  } else if (spec.kind === "progress") {
    renderProgress(root, spec);
  } else if (spec.kind === "daysLeft") {
    renderDaysLeft(root, spec);
  }

  return root;
}

function renderCounter(
  root: HTMLElement,
  spec: WidgetSpec,
  onChange: (newRaw: string) => void
) {
  const value = toInt(spec.args[0], 0);
  const max = toInt(spec.args[1], 0);
  const stepProvided = spec.args.length > 2;
  const step = stepProvided ? toInt(spec.args[2], 1) : 1;

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "obsidian-kit-btn";
  minus.textContent = "−";
  minus.disabled = value <= 0;

  const display = document.createElement("span");
  display.className = "obsidian-kit-value";
  display.textContent = `${value}/${max}`;

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "obsidian-kit-btn";
  plus.textContent = "+";
  plus.disabled = value >= max;

  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const emit = (next: number) => {
    const args: string[] = [String(next), String(max)];
    if (stepProvided) args.push(String(step));
    onChange(formatRaw("counter", args));
  };

  minus.addEventListener("click", (e) => {
    stop(e);
    if (value <= 0) return;
    emit(Math.max(0, value - step));
  });
  plus.addEventListener("click", (e) => {
    stop(e);
    if (value >= max) return;
    emit(Math.min(max, value + step));
  });

  root.appendChild(minus);
  root.appendChild(display);
  root.appendChild(plus);
}

function renderSwitcher(
  root: HTMLElement,
  spec: WidgetSpec,
  onChange: (newRaw: string) => void
) {
  const value = (spec.args[0] ?? "false").toLowerCase() === "true";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = `obsidian-kit-switch ${value ? "on" : "off"}`;
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", String(value));

  const thumb = document.createElement("span");
  thumb.className = "obsidian-kit-switch-thumb";
  toggle.appendChild(thumb);

  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange(formatRaw("switcher", [String(!value)]));
  });

  root.appendChild(toggle);
}

function renderProgress(root: HTMLElement, spec: WidgetSpec) {
  const a = spec.args[0] ?? "";
  const b = spec.args[1] ?? "";

  const dateA = parseDate(a);
  const dateB = parseDate(b);

  let percent: number;
  let label: string;

  if (dateA && dateB) {
    const start = startOfDay(dateA);
    const end = startOfDay(dateB);
    const now = startOfDay(new Date());
    const total = Math.max(0, end - start);
    const elapsed = Math.max(0, Math.min(total, now - start));
    percent = total > 0 ? (elapsed / total) * 100 : 0;
    const totalDays = Math.round(total / DAY_MS);
    const elapsedDays = Math.round(elapsed / DAY_MS);
    label = `${elapsedDays}/${totalDays}d`;
  } else {
    const value = toFloat(a, 0);
    const total = toFloat(b, 0);
    percent = total > 0 ? (value / total) * 100 : 0;
    label = `${formatNumber(value)}/${formatNumber(total)}`;
  }

  percent = Math.max(0, Math.min(100, percent));

  const bar = document.createElement("span");
  bar.className = "obsidian-kit-progress-bar";

  const fill = document.createElement("span");
  fill.className = "obsidian-kit-progress-fill";
  fill.style.width = `${percent}%`;
  bar.appendChild(fill);

  const text = document.createElement("span");
  text.className = "obsidian-kit-progress-label";
  text.textContent = label;

  root.appendChild(bar);
  root.appendChild(text);
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

function renderDaysLeft(root: HTMLElement, spec: WidgetSpec) {
  const date = parseDate(spec.args[0] ?? "");
  if (!date) {
    root.textContent = "?";
    root.classList.add("obsidian-kit-days-invalid");
    return;
  }
  const target = startOfDay(date);
  const now = startOfDay(new Date());
  const days = Math.round((target - now) / DAY_MS);
  root.textContent = String(days);
  if (days < 0) root.classList.add("obsidian-kit-days-overdue");
}

class ObsidianKitWidget extends WidgetType {
  constructor(
    private spec: WidgetSpec,
    private from: number,
    private to: number
  ) {
    super();
  }

  eq(other: ObsidianKitWidget): boolean {
    return (
      other.spec.raw === this.spec.raw &&
      other.from === this.from &&
      other.to === this.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    return buildWidget(this.spec, (newRaw) => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: newRaw },
      });
    });
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const cursor = view.state.selection.main.head;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    WIDGET_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIDGET_PATTERN.exec(text)) !== null) {
      const start = from + match.index;
      const end = start + match[0].length;

      if (cursor >= start && cursor <= end) continue;

      const spec: WidgetSpec = {
        kind: match[1] as Kind,
        args: parseArgs(match[2]),
        raw: match[0],
      };

      builder.add(
        start,
        end,
        Decoration.replace({
          widget: new ObsidianKitWidget(spec, start, end),
        })
      );
    }
  }

  return builder.finish();
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildLivePreviewDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

async function replaceInFile(
  app: App,
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
  oldRaw: string,
  newRaw: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(file instanceof TFile)) return;

  const sectionInfo = ctx.getSectionInfo(el);

  await app.vault.process(file, (content) => {
    const lines = content.split("\n");
    if (sectionInfo) {
      for (let i = sectionInfo.lineStart; i <= sectionInfo.lineEnd; i++) {
        if (i < lines.length && lines[i].includes(oldRaw)) {
          lines[i] = lines[i].replace(oldRaw, newRaw);
          return lines.join("\n");
        }
      }
    }
    const idx = content.indexOf(oldRaw);
    if (idx === -1) return content;
    return content.slice(0, idx) + newRaw + content.slice(idx + oldRaw.length);
  });
}

export default class ObsidianKitPlugin extends Plugin {
  async onload() {
    this.registerEditorExtension(livePreviewPlugin);

    this.registerMarkdownPostProcessor((el, ctx) => {
      this.processReadingMode(el, ctx);
    });
  }

  private processReadingMode(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? "";
      if (!/\b(counter|switcher|progress|daysLeft)\(/.test(text)) continue;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      const regex = new RegExp(WIDGET_PATTERN.source, "g");
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.slice(lastIndex, match.index))
          );
        }

        const matchedRaw = match[0];
        const spec: WidgetSpec = {
          kind: match[1] as Kind,
          args: parseArgs(match[2]),
          raw: matchedRaw,
        };

        const widgetEl = buildWidget(spec, (newRaw) => {
          void replaceInFile(this.app, ctx, el, matchedRaw, newRaw);
        });

        fragment.appendChild(widgetEl);
        lastIndex = match.index + matchedRaw.length;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(
          document.createTextNode(text.slice(lastIndex))
        );
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  }
}
