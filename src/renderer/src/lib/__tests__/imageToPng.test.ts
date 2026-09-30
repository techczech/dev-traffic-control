import { expect, test } from 'vitest'
import { bufferLooksLikePng } from '../imageToPng'

test('accepts a real PNG magic number', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  expect(bufferLooksLikePng(png)).toBe(true)
})

test('rejects JPEG and other signatures', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
  expect(bufferLooksLikePng(jpeg)).toBe(false)
})

test('rejects a buffer shorter than the signature', () => {
  expect(bufferLooksLikePng(new Uint8Array([0x89, 0x50, 0x4e]))).toBe(false)
})

test('rejects an empty buffer', () => {
  expect(bufferLooksLikePng(new Uint8Array([]))).toBe(false)
})
