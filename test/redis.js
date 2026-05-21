'use strict'

const assert = require('node:assert')
const path = require('node:path')
const { describe, it, before, after } = require('node:test')

const fixtures = require('haraka-test-fixtures')

const { normalize_redis_ini } = require('../index')

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

describe('get_redis_client dbid', () => {
  let plugin

  before(() => {
    plugin = new fixtures.plugin('index')
    plugin.register()
    plugin.merge_redis_ini()
  })

  it('assigns opts.database to client.dbid', async () => {
    const client = await plugin.get_redis_client({
      ...plugin.cfg.redis,
      database: 3,
    })
    try {
      assert.equal(client.dbid, 3)
    } finally {
      await client.quit()
    }
  })

  it('leaves dbid unset when opts.database is omitted', async () => {
    const client = await plugin.get_redis_client(plugin.cfg.redis)
    try {
      assert.equal(client.dbid, undefined)
    } finally {
      await client.quit()
    }
  })
})

// regression: get_redis_client used to swallow connect errors and return
// undefined, leaving callers with an undefined client. It must reject now.
describe('get_redis_client error propagation', () => {
  it('rejects when the server is unreachable', async () => {
    const plugin = new fixtures.plugin('index')
    plugin.register()

    await assert.rejects(
      plugin.get_redis_client({
        socket: {
          host: '127.0.0.1',
          port: 1,
          reconnectStrategy: false,
          connectTimeout: 500,
        },
      }),
    )
  })
})

// regression: init_redis_plugin compared pidb against plugin.redisCfg.db
// (always undefined post-load) instead of redisCfg.server.database (the DB
// the shared client is actually on), so the reuse branch never fired when a
// plugin explicitly requested the same DB as the shared client.
describe('init_redis_plugin shared-client reuse', () => {
  let plugin
  let server

  before(() => {
    plugin = new fixtures.plugin('index')
    plugin.register()
    // pin the shared client to DB 0 and have the plugin request the same DB
    // explicitly, so the comparison's second clause is what decides reuse.
    plugin.redisCfg.server.database = 0
    plugin.merge_redis_ini()
    plugin.cfg.redis.database = 0
    server = { notes: {}, loginfo: () => {} }
  })

  after(async () => {
    if (plugin.db && plugin.db !== server.notes.redis) await plugin.db.quit()
    if (server.notes.redis) await server.notes.redis.quit()
  })

  it('reuses server.notes.redis when pidb matches the shared DB', async () => {
    await new Promise((resolve) => {
      plugin.init_redis_shared(resolve, server)
    })
    assert.ok(server.notes.redis, 'shared client established')

    await new Promise((resolve) => {
      plugin.init_redis_plugin(resolve, server)
    })
    assert.equal(plugin.db, server.notes.redis)
  })
})

describe('normalize_redis_ini legacy compat', () => {
  it('rewrites server.ip → server.host', () => {
    const cfg = normalize_redis_ini({ server: { ip: '10.0.0.5' } })
    assert.equal(cfg.server.socket.host, '10.0.0.5')
    assert.equal(cfg.server.ip, undefined)
  })

  it('rewrites top-level db → database', () => {
    const cfg = normalize_redis_ini({ db: 3 })
    assert.equal(cfg.database, 3)
    assert.equal(cfg.db, undefined)
  })

  it('keeps explicit database when both db and database are set', () => {
    const cfg = normalize_redis_ini({ db: 3, database: 7 })
    assert.equal(cfg.database, 7)
    // legacy db is left in place when database is also set
    assert.equal(cfg.db, 3)
  })

  it('promotes top-level socket opts on server into server.socket', () => {
    const cfg = normalize_redis_ini({
      server: {
        host: '10.0.0.5',
        port: 6380,
        connectTimeout: 1234,
        keepAlive: 1,
      },
    })
    assert.equal(cfg.server.socket.host, '10.0.0.5')
    assert.equal(cfg.server.socket.port, 6380)
    assert.equal(cfg.server.socket.connectTimeout, 1234)
    assert.equal(cfg.server.socket.keepAlive, 1)
    assert.equal(cfg.server.host, undefined)
    assert.equal(cfg.server.connectTimeout, undefined)
  })

  it('promotes top-level socket opts on pubsub into pubsub.socket', () => {
    const cfg = normalize_redis_ini({
      pubsub: { host: '10.0.0.6', port: 6381 },
    })
    assert.equal(cfg.pubsub.socket.host, '10.0.0.6')
    assert.equal(cfg.pubsub.socket.port, 6381)
    assert.equal(cfg.pubsub.host, undefined)
  })

  // regression: defaultOpts.socket used to be a shared sub-object at module
  // scope, so promoting a top-level host/port into one result's .socket also
  // poisoned the defaults for every subsequent call.
  it('does not share .socket references between successive calls', () => {
    normalize_redis_ini({ pubsub: { host: '10.0.0.99', port: 6399 } })
    const cfg = normalize_redis_ini({})
    assert.equal(cfg.server.socket.host, '127.0.0.1')
    assert.equal(cfg.server.socket.port, '6379')
    assert.equal(cfg.pubsub.socket.host, '127.0.0.1')
    assert.equal(cfg.pubsub.socket.port, '6379')
  })

  it('keeps server.socket and pubsub.socket independent within one call', () => {
    const cfg = normalize_redis_ini({
      pubsub: { host: '10.0.0.6', port: 6381 },
    })
    assert.notStrictEqual(cfg.server.socket, cfg.pubsub.socket)
    assert.equal(cfg.server.socket.host, '127.0.0.1')
    assert.equal(cfg.server.socket.port, '6379')
  })

  it('does not mutate its input', () => {
    const raw = { server: { ip: '10.0.0.5' }, pubsub: { host: '10.0.0.6' } }
    const snapshot = JSON.parse(JSON.stringify(raw))
    normalize_redis_ini(raw)
    assert.deepEqual(raw, snapshot)
  })
})

describe('redis_ping error paths', () => {
  it('throws when this.db is not set', async () => {
    const plugin = new fixtures.plugin('index')
    plugin.register()
    await assert.rejects(plugin.redis_ping(), /redis not initialized/)
    assert.equal(plugin.redis_pings, false)
  })

  it('throws when ping reply is not PONG', async () => {
    const plugin = new fixtures.plugin('index')
    plugin.register()
    plugin.db = { ping: async () => 'NOT PONG' }
    await assert.rejects(plugin.redis_ping(), /not PONG/)
    assert.equal(plugin.redis_pings, false)
  })
})

// regression: redis_unsubscribe used unsubscribe() for a pattern subscription
// established with pSubscribe(). With the bug, the PUNSUBSCRIBE command was
// never sent — the pattern stayed bound (the immediate quit() masked it in
// production). This test stubs quit() so we can confirm the pattern is
// actually unbound after redis_unsubscribe returns.
describe('redis_unsubscribe uses pUnsubscribe', () => {
  it('stops receiving messages on the pattern after unsubscribe', async () => {
    const plugin = new fixtures.plugin('index')
    plugin.register()
    plugin.merge_redis_ini()

    const publisher = await plugin.get_redis_client(plugin.cfg.redis)

    const conn = {
      uuid: `test-uuid-${Date.now()}-${Math.random()}`,
      notes: {},
      logdebug: () => {},
      logerror: () => {},
    }
    const messages = []
    let realQuit
    try {
      await plugin.redis_subscribe(conn, (msg) => messages.push(msg))

      // redis_subscribe doesn't await pSubscribe; give it a beat to register
      await new Promise((r) => setTimeout(r, 100))

      await publisher.publish(`result-${conn.uuid}`, 'first')
      await new Promise((r) => setTimeout(r, 100))
      assert.deepEqual(messages, ['first'], 'first publish received')

      // prevent redis_unsubscribe from closing the connection so we can verify
      // the pattern is actually unbound (not just the socket gone)
      realQuit = conn.notes.redis.quit.bind(conn.notes.redis)
      conn.notes.redis.quit = async () => {}

      await plugin.redis_unsubscribe(conn)

      await publisher.publish(`result-${conn.uuid}`, 'second')
      await new Promise((r) => setTimeout(r, 100))
      assert.deepEqual(messages, ['first'], 'second publish must NOT arrive')
    } finally {
      if (realQuit) await realQuit().catch(() => {})
      else if (conn.notes.redis) await conn.notes.redis.quit().catch(() => {})
      await publisher.quit().catch(() => {})
    }
  })
})

// regression for C2 on the shared init hook: a connect failure must still
// resolve init (next() fires) and must NOT assign undefined onto
// server.notes.redis, so plugins that gate on `if (server.notes.redis)`
// correctly skip the redis path.
describe('init_redis_shared connect failure', () => {
  it('calls next() and leaves server.notes.redis unset', async () => {
    const plugin = new fixtures.plugin('index')
    plugin.register()
    plugin.redisCfg.server = {
      socket: {
        host: '127.0.0.1',
        port: 1,
        reconnectStrategy: false,
        connectTimeout: 500,
      },
    }
    const server = { notes: {} }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('init_redis_shared did not call next()')),
        3000,
      )
      plugin.init_redis_shared(() => {
        clearTimeout(timer)
        resolve()
      }, server)
    })
    assert.equal(server.notes.redis, undefined)
  })
})

describe('init_redis_shared re-entrant ping path', () => {
  let plugin
  let server

  before(() => {
    plugin = new fixtures.plugin('index')
    plugin.register()
    server = { notes: {} }
  })

  after(async () => {
    if (server.notes.redis) await server.notes.redis.quit()
  })

  it('completes when server.notes.redis already exists', async () => {
    // first call establishes server.notes.redis
    await new Promise((resolve) => plugin.init_redis_shared(resolve, server))
    assert.ok(server.notes.redis)

    // second call exercises the ping path and must call next()
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('init_redis_shared hung on ping path')),
        2000,
      )
      plugin.init_redis_shared(() => {
        clearTimeout(timer)
        resolve()
      }, server)
    })
  })
})
