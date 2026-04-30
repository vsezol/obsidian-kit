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

type LeafKind = "counter" | "switcher" | "progress" | "daysLeft";

interface LeafSpec {
  kind: LeafKind;
  args: string[];
  raw: string;
}

interface WidthSpec {
  kind: "width";
  width: string;
  inner: LeafSpec;
  raw: string;
}

type WidgetSpec = LeafSpec | WidthSpec;

const WIDGET_PATTERN =
  /\b(counter|switcher|progress|daysLeft|width)\(((?:[^()\n]|\([^()\n]*\))*)\)/g;
const INNER_LEAF_PATTERN =
  /^(counter|switcher|progress|daysLeft)\(((?:[^()\n]|\([^()\n]*\))*)\)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function splitTopLevelCommas(s: string): string[] {
  if (!s.trim()) return [];
  const out: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inString = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    } else if (c === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

function parseSpec(
  kind: string,
  argsRaw: string,
  raw: string
): WidgetSpec | null {
  if (kind === "width") {
    const args = splitTopLevelCommas(argsRaw);
    if (args.length < 2) return null;
    const width = args[0];
    const innerRaw = args.slice(1).join(", ").trim();
    const m = innerRaw.match(INNER_LEAF_PATTERN);
    if (!m) return null;
    return {
      kind: "width",
      width,
      inner: {
        kind: m[1] as LeafKind,
        args: splitTopLevelCommas(m[2]),
        raw: innerRaw,
      },
      raw,
    };
  }
  return {
    kind: kind as LeafKind,
    args: splitTopLevelCommas(argsRaw),
    raw,
  };
}

function formatRaw(kind: LeafKind, args: string[]): string {
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
  const ymd = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!ymd) return null;
  const d = new Date(
    parseInt(ymd[1], 10),
    parseInt(ymd[2], 10) - 1,
    parseInt(ymd[3], 10)
  );
  return Number.isFinite(d.getTime()) ? d : null;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const CHECKBOX_PATTERN = /^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/;

function isWidgetComplete(spec: WidgetSpec): boolean | null {
  if (spec.kind === "width") return isWidgetComplete(spec.inner);

  if (spec.kind === "counter") {
    const value = toInt(spec.args[0], 0);
    const max = toInt(spec.args[1], 0);
    if (max <= 0) return null;
    return value >= max;
  }

  if (spec.kind === "switcher") {
    return (spec.args[0] ?? "false").toLowerCase() === "true";
  }

  if (spec.kind === "progress") {
    const a = spec.args[0] ?? "";
    const b = spec.args[1] ?? "";
    const dateA = parseDate(a);
    const dateB = parseDate(b);
    if (dateA && dateB) {
      return startOfDay(new Date()) >= startOfDay(dateB);
    }
    const value = toFloat(a, 0);
    const total = toFloat(b, 0);
    if (total <= 0) return null;
    return value >= total;
  }

  return null;
}

function buildWidget(
  spec: WidgetSpec,
  onChange: (newRaw: string) => void
): HTMLElement {
  if (spec.kind === "width") {
    const innerEl = buildLeafWidget(spec.inner, (newInnerRaw) => {
      onChange(`width(${spec.width}, ${newInnerRaw})`);
    });
    applyWidth(innerEl, spec.inner.kind, spec.width);
    return innerEl;
  }
  return buildLeafWidget(spec, onChange);
}

function applyWidth(el: HTMLElement, innerKind: LeafKind, width: string) {
  if (innerKind === "progress") {
    const bar = el.querySelector<HTMLElement>(".obsidian-kit-progress-bar");
    if (bar) bar.style.width = width;
    return;
  }
  el.style.display = "inline-block";
  el.style.width = width;
}

function buildLeafWidget(
  spec: LeafSpec,
  onChange: (newRaw: string) => void
): HTMLElement {
  const root = document.createElement("span");

  if (spec.kind === "daysLeft") {
    root.className = "obsidian-kit-days-left";
    renderDaysLeft(root, spec);
    return root;
  }

  root.className = `obsidian-kit-widget obsidian-kit-${spec.kind}`;

  if (spec.kind === "counter") {
    renderCounter(root, spec, onChange);
  } else if (spec.kind === "switcher") {
    renderSwitcher(root, spec, onChange);
  } else if (spec.kind === "progress") {
    renderProgress(root, spec);
  }

  return root;
}

function renderCounter(
  root: HTMLElement,
  spec: LeafSpec,
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
  spec: LeafSpec,
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

function renderProgress(root: HTMLElement, spec: LeafSpec) {
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

function renderDaysLeft(root: HTMLElement, spec: LeafSpec) {
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

function scheduleCheckboxSyncLivePreview(
  view: EditorView,
  pos: number,
  complete: boolean
) {
  const line = view.state.doc.lineAt(pos);
  const m = line.text.match(CHECKBOX_PATTERN);
  if (!m) return;
  const desired = complete ? "x" : " ";
  if (m[2] === desired) return;
  const cbPos = line.from + m[1].length;

  setTimeout(() => {
    const stillLine = view.state.doc.lineAt(cbPos);
    const stillMatch = stillLine.text.match(CHECKBOX_PATTERN);
    if (!stillMatch || stillMatch[2] === desired) return;
    const stillCbPos = stillLine.from + stillMatch[1].length;
    view.dispatch({
      changes: { from: stillCbPos, to: stillCbPos + 1, insert: desired },
    });
  }, 0);
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

      const spec = parseSpec(match[1], match[2], match[0]);
      if (!spec) continue;

      const complete = isWidgetComplete(spec);
      if (complete !== null) {
        scheduleCheckboxSyncLivePreview(view, start, complete);
      }

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

async function syncCheckboxReadingMode(
  app: App,
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
  widgetRaw: string,
  complete: boolean
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(file instanceof TFile)) return;
  const sectionInfo = ctx.getSectionInfo(el);
  if (!sectionInfo) return;

  await app.vault.process(file, (content) => {
    const lines = content.split("\n");
    const last = Math.min(sectionInfo.lineEnd, lines.length - 1);
    for (let i = sectionInfo.lineStart; i <= last; i++) {
      if (!lines[i].includes(widgetRaw)) continue;
      const m = lines[i].match(CHECKBOX_PATTERN);
      if (!m) return content;
      const desired = complete ? "x" : " ";
      if (m[2] === desired) return content;
      lines[i] =
        m[1] + desired + m[3] + lines[i].slice(m[0].length);
      return lines.join("\n");
    }
    return content;
  });
}

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
      if (
        !/\b(counter|switcher|progress|daysLeft|width)\(/.test(
          text
        )
      )
        continue;

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
        const spec = parseSpec(match[1], match[2], matchedRaw);
        if (!spec) {
          fragment.appendChild(document.createTextNode(matchedRaw));
          lastIndex = match.index + matchedRaw.length;
          continue;
        }

        const complete = isWidgetComplete(spec);
        if (complete !== null) {
          void syncCheckboxReadingMode(
            this.app,
            ctx,
            el,
            matchedRaw,
            complete
          );
        }

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
