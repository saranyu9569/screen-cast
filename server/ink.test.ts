import { expect, test } from 'bun:test'
import { parseStroke } from './ink'
const base = { id: 'a', tool: 'pen', color: '#ff0000', size: 4 }
test('pressure points', () => {
  expect(parseStroke({ ...base, points: [[0.1, 0.2], [0.3, 0.4, 0.5]] })?.points).toEqual([[0.1, 0.2], [0.3, 0.4, 0.5]])
  expect(parseStroke({ ...base, points: [[0.1, 0.2, 2]] })).toBeNull()
  expect(parseStroke({ ...base, points: [[0.1, 0.2, 0.5, 9]] })).toBeNull()
  expect(parseStroke({ ...base, points: [['x', 0.2]] })).toBeNull()
})
