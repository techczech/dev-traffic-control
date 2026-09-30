import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import { slugify, uniqueId } from './slug';
import type { DocumentHeading, ParkedItem, QaRequest, RequestItem, RequestMode } from './types';

const KNOWN = ['id', 'title', 'app', 'version', 'build', 'date', 'intro', 'mode'] as const;
type Section = 'steps' | 'expected' | 'notes';

export function parseRequest(raw: string, filePath: string): QaRequest {
  const basename = path.basename(filePath, '.md');
  const base: QaRequest = {
    id: basename, title: basename, labels: {}, mode: 'test', items: [], parked: [],
    degraded: true, raw, path: filePath,
  };

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) return base;

  let meta: Record<string, unknown>;
  try {
    const parsed: unknown = parseYaml(fm[1]) ?? {};
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('frontmatter is not a map');
    meta = parsed as Record<string, unknown>;
  } catch {
    // Field failure 2026-07-19: one unquoted multiline intro abandoned a whole
    // request. Salvage what the block still says instead of giving up on it.
    meta = salvageFrontmatter(fm[1]);
    base.fmSalvaged = true;
  }

  const req = { ...base };
  for (const k of KNOWN) {
    if (k === 'mode') continue;
    const v = meta[k];
    if (v !== undefined) (req as Record<string, unknown>)[k] = String(v);
  }
  for (const [k, v] of Object.entries(meta)) {
    if (!(KNOWN as readonly string[]).includes(k)) req.labels[k] = String(v);
  }

  const body = raw.slice(fm[0].length);
  const kind = req.labels.kind?.trim().toLowerCase();
  const explicitMode = String(meta.mode ?? '').trim().toLowerCase();
  if (kind === 'doc-review' || explicitMode === 'doc-review') {
    // A review request's body is the Snapshot for the Reading surface, never
    // items — so it is never degraded either (ADR-0007 §4).
    req.mode = 'doc-review';
    req.document = parseDocument(body);
    req.degraded = false;
  } else {
    const parsed = parseItems(body);
    req.items = parsed.items;
    req.parked = parsed.parked;
    req.degraded = req.items.length === 0 && req.parked.length === 0;
    req.mode = resolveMode(meta.mode, kind, req.items, req.parked, parsed.contextParagraphs);
  }
  return req;
}

function resolveMode(
  rawMode: unknown,
  kind: string | undefined,
  items: RequestItem[],
  parked: ParkedItem[],
  contextParagraphs: ReadonlyMap<string, number>
): RequestMode {
  const explicit = String(rawMode ?? kind ?? '').trim().toLowerCase();
  if (explicit === 'light') return 'light';
  if (explicit === 'detailed') return 'test';
  const hasContent = items.length + parked.length > 0;
  const flat = items.every((item) => {
    const context = item.context?.trim();
    if (!context || contextParagraphs.get(item.id) !== 1) return false;
    if (/^(?:[-*]|\d+\.)\s/m.test(context)) return false;
    return (
      item.steps.every((step) => !step.trim()) &&
      item.expected.every((expected) => !expected.trim())
    );
  });
  return hasContent && flat ? 'light' : 'test';
}

// Lenient line scanner over a frontmatter block YAML rejected: `key: value`
// lines start a key, other non-empty lines continue the previous value.
// Exported so the thread-entry parser (ADR-0009) reuses the exact salvage path.
export function salvageFrontmatter(block: string): Record<string, string> {
  const map: Record<string, string> = {};
  let lastKey: string | null = null;
  for (const line of block.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      map[lastKey] = kv[2].trim();
    } else if (line.trim() && lastKey) {
      map[lastKey] = `${map[lastKey]} ${line.trim()}`.trim();
    }
  }
  for (const [k, v] of Object.entries(map)) {
    const quoted = v.match(/^(["'])([\s\S]*)\1$/);
    const value = quoted ? quoted[2] : v;
    if (value) map[k] = value;
    else delete map[k];
  }
  return map;
}

function parseDocument(body: string): NonNullable<QaRequest['document']> {
  const bodyMarkdown = body.replace(/^\r?\n/, '');
  const headings: DocumentHeading[] = [];
  const taken = new Set<string>();
  let inFence = false;
  for (const line of bodyMarkdown.split(/\r?\n/)) {
    // Reviewed documents quote request formats in fences — a literal
    // "## heading" example must not become a phantom TOC entry.
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (!m) continue;
    let title = m[2];
    let id: string | undefined;
    const explicit = title.match(/\{#([a-z0-9-]+)\}\s*$/i);
    if (explicit) { id = explicit[1].toLowerCase(); title = title.slice(0, explicit.index).trim(); }
    id = uniqueId(id ?? slugify(title), taken);
    taken.add(id);
    headings.push({ id, title, level: m[1].length as 2 | 3 });
  }
  return { headings, bodyMarkdown };
}

function parseItems(body: string): {
  items: RequestItem[];
  parked: ParkedItem[];
  contextParagraphs: Map<string, number>;
} {
  const items: RequestItem[] = [];
  const parked: ParkedItem[] = [];
  const contextParagraphs = new Map<string, number>();
  const taken = new Set<string>();
  let cur: RequestItem | null = null;
  let inParked = false;
  let section: Section | null = null;
  const contextLines: string[] = [];
  let paragraphCount = 0;
  let inContextParagraph = false;

  const flushContext = (): void => {
    if (cur && contextLines.length) {
      cur.context = contextLines.join('\n').trim() || undefined;
      contextParagraphs.set(cur.id, paragraphCount);
    }
    contextLines.length = 0;
    paragraphCount = 0;
    inContextParagraph = false;
  };

  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flushContext();
      let title = heading[1];
      let id: string | undefined;
      const explicit = title.match(/\{#([a-z0-9-]+)\}\s*$/i);
      if (explicit) { id = explicit[1].toLowerCase(); title = title.slice(0, explicit.index).trim(); }
      const parkedTitle = title
        .replace(/\s*\([^()]*\)\s*$/, '')
        .replace(/[^\p{L}\p{N}]+$/u, '')
        .trim();
      if (/^also\s+worth\s+checking$/i.test(parkedTitle)) {
        cur = null;
        inParked = true;
        section = null;
        continue;
      }
      inParked = false;
      id = uniqueId(id ?? slugify(title), taken);
      taken.add(id);
      cur = { id, title, steps: [], expected: [], notes: [] };
      items.push(cur);
      section = null;
      continue;
    }

    const sec = line.match(/^\*\*(Steps|Expected|Notes)\*\*\s*$/i);
    const bullet = line.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (inParked) {
      if (bullet) {
        const text = bullet[1].trim();
        const id = uniqueId(`also-${slugify(text)}`, taken);
        taken.add(id);
        parked.push({ id, text });
      }
      continue;
    }
    if (!cur) continue;

    if (sec) { flushContext(); section = sec[1].toLowerCase() as Section; continue; }

    if (bullet && section) { cur[section].push(bullet[1].trim()); continue; }

    if (!section && line.trim()) {
      if (!inContextParagraph) paragraphCount += 1;
      inContextParagraph = true;
      contextLines.push(line.trim());
    } else if (!section && contextLines.length > 0) {
      inContextParagraph = false;
    }
  }
  flushContext();
  return { items, parked, contextParagraphs };
}
