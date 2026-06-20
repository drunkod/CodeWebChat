#!/usr/bin/env node
// Fill the handoff template from a packet.json.
// Usage: node fill-handoff.mjs <packet.json> [template.txt]
//   template default: ./templates/handoff.txt (relative to this script)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const [, , packetPath, templateArg] = process.argv
if (!packetPath) {
  console.error('usage: fill-handoff.mjs <packet.json> [template.txt]')
  process.exit(2)
}
const templatePath = templateArg ?? join(here, 'templates', 'handoff.txt')

const packet = JSON.parse(readFileSync(packetPath, 'utf8'))
const template = readFileSync(templatePath, 'utf8')

const view = {
  ...packet,
  changed_files: Array.isArray(packet.changed_files)
    ? packet.changed_files.join('\n')
    : String(packet.changed_files ?? '')
}

const filled = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in view)) throw new Error(`missing packet field: ${key}`)
  return String(view[key])
})

process.stdout.write(filled)
