'use strict'

const assert = require('node:assert')
const path = require('node:path')
const { describe, it, before, after } = require('node:test')

const fixtures = require('haraka-test-fixtures')

function retry(options) {
  if (options.error) {
    console.error(options.error)
  }
  return undefined
}

describe('config', () => {
  let plugin

  before(async () => {
    plugin = new fixtures.plugin('index')
    plugin.config = plugin.config.module_config(path.resolve('test'))
  })

  it('loads', async () => {
    assert.equal(plugin.name, 'index')
  })

  it('config defaults', async () => {
    plugin.load_redis_ini()
    assert.equal(plugin.redisCfg.server.socket.host, '127.0.0.1')
    assert.equal(plugin.redisCfg.server.socket.port, 6379)
  })

  it('merges [opts] into server config', async () => {
    plugin.load_redis_ini()
    assert.deepEqual(plugin.redisCfg, {
      main: {},
      pubsub: {
        socket: {
          host: '127.0.0.1',
          port: '6379',
        },
        database: 5,
        password: 'dontUseThisOne',
      },
      opts: { database: 5, password: 'dontUseThisOne' },
      server: {
        socket: {
          host: '127.0.0.1',
          port: '6379',
        },
        database: 5,
        password: 'dontUseThisOne',
      },
    })
  })

  it('merges redis.ini [opts] into plugin config', async () => {
    plugin.load_redis_ini()
    plugin.cfg = {}
    plugin.merge_redis_ini()
    assert.deepEqual(plugin.cfg.redis, {
      socket: {
        host: '127.0.0.1',
        port: '6379',
      },
      database: 5,
      password: 'dontUseThisOne',
    })
  })
})

describe('connects', () => {
  let plugin

  before(async () => {
    plugin = new fixtures.plugin('index')
    plugin.register()
  })

  it('loads', async () => {
    assert.equal(plugin.name, 'index')
  })

  it('connects', async () => {
    const redis = await plugin.get_redis_client({
      socket: {
        host: plugin.redisCfg.server.host,
        port: plugin.redisCfg.server.port,
      },
      retry_strategy: retry,
    })
    assert.ok(redis)
    await redis.quit()
  })

  it('populates plugin.cfg.redis when asked', async () => {
    assert.equal(plugin.cfg, undefined)
    plugin.merge_redis_ini()
    assert.deepEqual(plugin.cfg.redis, {
      socket: { host: '127.0.0.1', port: '6379' },
    })
  })

  it('connects to a different redis db', async () => {
    plugin.merge_redis_ini()
    plugin.cfg.redis.database = 2
    plugin.cfg.redis.retry_strategy = retry
    const client = await plugin.get_redis_client(plugin.cfg.redis)
    const res = await client.ping()
    assert.equal(res, 'PONG')
    assert.ok(client)
    await client.quit()
  })
})

describe('init_redis_plugin', () => {
  let plugin
  let server

  before(() => {
    server = { notes: {} }

    plugin = new fixtures.plugin('index')
    plugin.register()
    plugin.merge_redis_ini()
  })

  after(() => {
    plugin.db.quit()
  })

  it('connects to redis', async () => {
    await new Promise((resolve) => {
      plugin.init_redis_plugin(() => {
        assert.ok(plugin.db?.server_info)
        resolve()
      }, server)
    })
  })

  it('pings and gets PONG answer', async () => {
    const r = await plugin.redis_ping()
    assert.equal(r, true)
  })
})
