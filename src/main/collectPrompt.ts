import { homedir } from 'node:os'
import path from 'node:path'

const MAX_TITLE_LENGTH = 160

export function collectPrompt(title: string, requestPath: string, recordRoot: string): string {
  const root = normalisePath(recordRoot).replace(/\/+$/, '')
  const request = normalisePath(requestPath)
  const prefix = `${root}/`
  if (!request.startsWith(prefix)) {
    throw new Error('The request is outside the configured record folder')
  }
  if (!request.endsWith('.md')) {
    throw new Error('The request path must end in .md')
  }
  const relativeReportPath = request.slice(prefix.length).replace(/\.md$/, '.report.json')
  const safeTitle =
    sanitiseTitle(title) || sanitiseTitle(path.posix.basename(request, '.md')) || 'finished review'
  const renderedRoot = renderHomeRelative(root)
  return (
    `Collect the finished review "${safeTitle}".\n\n` +
    `Read ${renderedRoot}/${relativeReportPath} and act on the verdicts and comments. Look at every screenshot it names.`
  )
}

function normalisePath(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, '/'))
}

function sanitiseTitle(title: string): string {
  const singleLine = title.replace(/\s+/g, ' ').replace(/"/g, '').trim()
  if (singleLine.length <= MAX_TITLE_LENGTH) return singleLine
  return `${singleLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
}

function renderHomeRelative(absolutePath: string): string {
  const home = homedir().replace(/\/+$/, '')
  if (absolutePath === home) return '~'
  return absolutePath.startsWith(`${home}/`)
    ? `~/${absolutePath.slice(home.length + 1)}`
    : absolutePath
}
