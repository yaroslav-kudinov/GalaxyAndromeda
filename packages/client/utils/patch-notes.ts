export interface PatchNote {
  slug: string
  title: string
  date: string
  branch?: string
  summary: string
  markdown: string
}

const rawNotes = import.meta.glob('../../../docs/patch-notes/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function filenameFromGlobPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? path
}

function firstParagraph(text: string): string {
  const block = text.trim().split(/\n\s*\n/)[0] ?? ''
  return block.replace(/\s+/g, ' ').trim()
}

export function parsePatchNoteMarkdown(filename: string, markdown: string): PatchNote {
  const slug = filename.replace(/\.md$/i, '')
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug
  const date = markdown.match(/^Дата:\s*(.+)$/m)?.[1]?.trim() ?? slug.slice(0, 10)
  const branch = markdown.match(/^Ветка:\s*(.+)$/m)?.[1]?.trim()
  const essence = markdown.match(/## Суть\s*\n+([\s\S]*?)(?=\n## |\s*$)/)?.[1]
  const summary = firstParagraph(essence ?? '') || firstParagraph(markdown.replace(/^#.*$/m, ''))
  return { slug, title, date, branch, summary, markdown }
}

function compareNotes(a: PatchNote, b: PatchNote): number {
  if (a.date !== b.date) return b.date.localeCompare(a.date)
  return b.slug.localeCompare(a.slug)
}

export function listPatchNotes(): PatchNote[] {
  const notes: PatchNote[] = []
  for (const [path, markdown] of Object.entries(rawNotes)) {
    const filename = filenameFromGlobPath(path)
    if (filename.toLowerCase() === 'readme.md') continue
    notes.push(parsePatchNoteMarkdown(filename, markdown))
  }
  notes.sort(compareNotes)
  return notes
}

export function getPatchNote(slug: string): PatchNote | undefined {
  return listPatchNotes().find((note) => note.slug === slug)
}

export function latestPatchNote(): PatchNote | null {
  return listPatchNotes()[0] ?? null
}
