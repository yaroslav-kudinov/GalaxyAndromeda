import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { connectionToastFor, isConnectionLost } from './connection-status'

describe('isConnectionLost', () => {
  it('сервер отвечает — связь есть', () => {
    assert.equal(
      isConnectionLost({ roomId: 'room-1', serverStatus: 'online', syncWarningVisible: false }),
      false,
    )
  })

  it('сервер недоступен — связь потеряна', () => {
    assert.equal(
      isConnectionLost({ roomId: 'room-1', serverStatus: 'offline', syncWarningVisible: false }),
      true,
    )
  })

  it('плашка рассинхрона — тоже обрыв: состояние на экране не подтверждено', () => {
    assert.equal(
      isConnectionLost({ roomId: 'room-1', serverStatus: 'online', syncWarningVisible: true }),
      true,
    )
  })

  it('загрузка страницы обрывом не считается', () => {
    for (const serverStatus of ['idle', 'loading'] as const) {
      assert.equal(
        isConnectionLost({ roomId: 'room-1', serverStatus, syncWarningVisible: false }),
        false,
      )
    }
  })

  it('комната local-* играется без сервера — её связь не теряется', () => {
    assert.equal(
      isConnectionLost({ roomId: 'local-1', serverStatus: 'offline', syncWarningVisible: true }),
      false,
    )
  })
})

describe('connectionToastFor', () => {
  it('первое срабатывание при загрузке молчит', () => {
    assert.equal(connectionToastFor(false, undefined), null)
    assert.equal(connectionToastFor(true, undefined)?.title, 'Связь потеряна')
  })

  it('обрыв и возвращение называются вслух, повтор — молчит', () => {
    assert.equal(connectionToastFor(true, false)?.title, 'Связь потеряна')
    assert.equal(connectionToastFor(false, true)?.title, 'Связь восстановлена')
    assert.equal(connectionToastFor(true, true), null)
    assert.equal(connectionToastFor(false, false), null)
  })

  it('возвращение связи выделено, потеря — нет', () => {
    assert.equal(connectionToastFor(false, true)?.accent, true)
    assert.equal(connectionToastFor(true, false)?.accent, false)
  })
})
