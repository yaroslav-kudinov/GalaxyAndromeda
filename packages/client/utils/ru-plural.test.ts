import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { pluralRu } from './ru-plural'

const centers = (n: number) => `${n} ${pluralRu(n, 'центр', 'центра', 'центров')}`

describe('pluralRu', () => {
  test('единственное число — только для «один»', () => {
    assert.equal(centers(1), '1 центр')
    assert.equal(centers(21), '21 центр')
    assert.equal(centers(101), '101 центр')
  })

  test('форма «два-четыре»', () => {
    assert.equal(centers(2), '2 центра')
    assert.equal(centers(4), '4 центра')
    assert.equal(centers(22), '22 центра')
  })

  test('множественное число', () => {
    assert.equal(centers(0), '0 центров')
    assert.equal(centers(5), '5 центров')
    assert.equal(centers(25), '25 центров')
  })

  test('одиннадцать-четырнадцать — множественное, несмотря на последнюю цифру', () => {
    assert.equal(centers(11), '11 центров')
    assert.equal(centers(12), '12 центров')
    assert.equal(centers(14), '14 центров')
    assert.equal(centers(111), '111 центров')
  })
})
