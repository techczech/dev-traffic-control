import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface NoteContent {
  title: string; body: string; linkedRun?: string; handedOverAt?: string; shots: string[];
}

export function notePathFor(dir: string, date: string, slug: string): string {
  return path.join(dir, `${date}-note-${slug}.md`);
}

export function serialiseNote(n: NoteContent): string {
  const fm = [`title: ${JSON.stringify(n.title)}`];
  if (n.linkedRun) fm.push(`linkedRun: ${JSON.stringify(n.linkedRun)}`);
  if (n.handedOverAt) fm.push(`handedOverAt: ${JSON.stringify(n.handedOverAt)}`);
  const shots = n.shots.map(s => `![](${s})`).join('\n');
  return `---\n${fm.join('\n')}\n---\n\n${n.body.trim()}\n${shots ? '\n' + shots + '\n' : ''}`;
}

export function parseNote(raw: string): NoteContent {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = fm ? ((parseYaml(fm[1]) ?? {}) as Record<string, unknown>) : {};
  const rest = fm ? raw.slice(fm[0].length) : raw;
  const shots: string[] = [];
  const body = rest.split(/\r?\n/).filter(line => {
    const img = line.match(/^!\[\]\((.+)\)\s*$/);
    if (img) { shots.push(img[1]); return false; }
    return true;
  }).join('\n').trim();
  return {
    title: String(meta.title ?? 'Untitled note'),
    linkedRun: meta.linkedRun ? String(meta.linkedRun) : undefined,
    handedOverAt: meta.handedOverAt ? String(meta.handedOverAt) : undefined,
    body, shots,
  };
}
