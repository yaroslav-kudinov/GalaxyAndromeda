function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineMarkdown(text: string): string {
  let html = escapeHtml(text)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g,
    '<a href="$2">$1</a>',
  )
  return html
}

/** Trusted project markdown → HTML (headings, lists, code, paragraphs). */
export function renderMarkdownLite(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (line.startsWith('```')) {
      const fence: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        fence.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const level = heading[1]!.length
      out.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`)
      i += 1
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? '')) {
        items.push(`<li>${inlineMarkdown((lines[i] ?? '').replace(/^[-*]\s+/, ''))}</li>`)
        i += 1
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (line.trim() === '') {
      i += 1
      continue
    }

    const para: string[] = []
    while (i < lines.length) {
      const current = lines[i] ?? ''
      if (
        current.trim() === ''
        || current.startsWith('#')
        || current.startsWith('```')
        || /^[-*]\s+/.test(current)
      ) {
        break
      }
      para.push(current)
      i += 1
    }
    out.push(`<p>${inlineMarkdown(para.join(' '))}</p>`)
  }

  return out.join('\n')
}
