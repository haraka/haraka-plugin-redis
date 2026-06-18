'use strict'
/* global server */

const redis = require('redis')

exports.register = function () {
  this.load_redis_ini()

  // another plugin has called us with: inherits('haraka-plugin-redis')
  if (this.name !== 'redis') return

  // register when 'redis' is declared in config/plugins
  this.register_hook('init_master', 'init_redis_shared')
  this.register_hook('init_child', 'init_redis_shared')
}

const DEFAULT_SOCKET = Object.freeze({ host: '127.0.0.1', port: '6379' })
const socketOpts = [
  'host',
  'port',
  'path',
  'tls',
  'connectTimeout',
  'noDelay',
  'keepAlive',
  'reconnectStrategy',
]

// Normalize one endpoint section (server, pubsub, or a merged plugin [redis]).
// Pure: returns a fresh object. Promotes legacy top-level fields into .socket.
function normalize_endpoint(section = {}, opts = {}) {
  const merged = { ...opts, ...section }
  const socket = { ...DEFAULT_SOCKET, ...merged.socket }

  if (merged.ip && !merged.host) merged.host = merged.ip // legacy: ip → host
  delete merged.ip

  const rest = {}
  for (const [k, v] of Object.entries(merged)) {
    if (k === 'socket') continue
    if (socketOpts.includes(k)) {
      if (v != null && v !== '') socket[k] = v
    } else {
      rest[k] = v
    }
  }
  return { ...rest, socket }
}

// Normalize the whole redis.ini blob. Pure: returns a fresh object so the
// caller cannot accidentally mutate haraka-config's cached value.
function normalize_redis_ini(raw = {}) {
  const out = {
    main: { ...raw.main },
    opts: { ...raw.opts },
    server: normalize_endpoint(raw.server, raw.opts),
    pubsub: normalize_endpoint(raw.pubsub, raw.opts),
  }
  // legacy: top-level db → database. Keep both when both are set.
  if (raw.database !== undefined) out.database = raw.database
  else if (raw.db !== undefined) out.database = raw.db
  if (raw.db !== undefined && raw.database !== undefined) out.db = raw.db
  return out
}

exports.normalize_redis_ini = normalize_redis_ini
exports.normalize_endpoint = normalize_endpoint

exports.load_redis_ini = function () {
  // store redis cfg at redisCfg, to avoid conflicting with plugins that
  // inherit this plugin and have *their* config at plugin.cfg
  this.redisCfg = normalize_redis_ini(
    this.config.get('redis.ini', () => this.load_redis_ini()),
  )
}

exports.merge_redis_ini = function () {
  if (!this.cfg) this.cfg = {} // no <plugin>.ini loaded?
  if (!this.cfg.redis) this.cfg.redis = {} // no [redis] in <plugin>.ini file
  if (!this.redisCfg) this.load_redis_ini()

  this.cfg.redis = normalize_endpoint({
    ...this.redisCfg.server,
    ...this.cfg.redis,
  })

  if (this.cfg.redis.db && !this.cfg.redis.database) {
    this.cfg.redis.database = this.cfg.redis.db
    delete this.cfg.redis.db
  }
}

exports.init_redis_shared = async function (next, server) {
  // server-wide redis, shared by plugins that don't specify a db ID.
  if (server.notes.redis?.isOpen) {
    try {
      await server.notes.redis.ping()
      this.loginfo('already connected')
      return next()
    } catch (e) {
      this.logerror(`Redis ping failed, reconnecting: ${e.message}`)
    }
  }

  try {
    server.notes.redis = await this.get_redis_client(this.redisCfg.server)
  } catch (e) {
    this.logerror(`Redis error: ${e.message}`)
  }
  next()
}

exports.init_redis_plugin = async function (next, server) {
  // this function is called by plugins at init_*, to establish their
  // shared or unique redis db handle.

  // for tests that do not load a shared config
  if (!this.cfg) {
    this.cfg = { redis: {} }
    if (this.redisCfg)
      this.cfg.redis = JSON.parse(JSON.stringify(this.redisCfg))
  }
  if (!server) server = { notes: {} }

  const pidb = this.cfg.redis.database
  if (server.notes.redis?.isOpen) {
    // server-wide redis is available
    // and the DB not specified or is the same as server-wide
    if (pidb === undefined || pidb === this.redisCfg.server.database) {
      server.loginfo(this, 'using server.notes.redis')
      this.db = server.notes.redis
      return next()
    }
  }

  try {
    this.db = await this.get_redis_client(this.cfg.redis)
  } catch (e) {
    this.logerror(`Redis error: ${e.message}`)
  }
  next()
}

exports.shutdown = function () {
  // Only quit a plugin-private connection. server.notes.redis must stay open
  // until all per-connection hooks (hook_disconnect, etc.) have finished —
  // calling quit() here races with those in-flight operations and causes
  // "The client is closed" errors. The socket is released when the process exits.
  if (this.db?.isOpen && this.db !== server?.notes?.redis) {
    this.db.quit()
  }
}

exports.redis_ping = async function () {
  this.redis_pings = false
  if (!this.db) throw new Error('redis not initialized')

  const r = await this.db.ping()
  if (r !== 'PONG') throw new Error('not PONG')
  this.redis_pings = true

  return true
}

function getUriStr(client, opts) {
  let msg = `redis://${opts?.socket?.host}:${opts?.socket?.port}`
  if (opts?.database) msg += `/${opts?.database}`
  if (client?.server_info?.redis_version) {
    msg += `\tv${client?.server_info?.redis_version}`
  }
  return msg
}

exports.get_redis_client = async function (opts) {
  const client = redis.createClient(opts)

  let urlStr

  client
    .on('error', (err) => {
      this.logerror(err.message)
    })
    .on('end', () => {
      this.loginfo(`Disconnected from ${urlStr}`)
    })

  try {
    await client.connect()

    if (opts?.database) client.dbid = opts?.database

    client.server_info = await client.info()
    urlStr = getUriStr(client, opts)
    this.loginfo(`connected to ${urlStr}`)

    return client
  } catch (e) {
    this.logerror(`Redis connect failed: ${e.message}`)
    throw e
  }
}

exports.get_redis_pub_channel = function (conn) {
  return `result-${conn.transaction ? conn.transaction.uuid : conn.uuid}`
}

exports.get_redis_sub_channel = function (conn) {
  return `result-${conn.uuid}*`
}

// formerly used by pi-watch
exports.redis_subscribe_pattern = async function (pattern, onMessage) {
  if (this.redis) return // already subscribed?

  this.redis = redis.createClient(this.redisCfg.pubsub)
  this.redis.on('error', (err) => {
    this.logerror(err.message)
  })
  await this.redis.connect()

  await this.redis.pSubscribe(pattern, onMessage)
  this.logdebug(this, `pSubscribed to ${pattern}`)
}

// the next two functions are use by pi-karma
exports.redis_subscribe = async function (connection, onMessage) {
  if (connection.notes.redis) {
    connection.logdebug(this, `redis already subscribed`)
    return // another plugin has already called this.
  }

  const timer = setTimeout(() => {
    connection.logerror('redis subscribe timed out')
  }, 3 * 1000)

  connection.notes.redis = redis.createClient(this.redisCfg.pubsub)
  connection.notes.redis.on('error', (err) => {
    this.logerror(err.message)
  })
  await connection.notes.redis.connect()

  clearTimeout(timer)

  const pattern = this.get_redis_sub_channel(connection)
  connection.notes.redis.pSubscribe(pattern, onMessage)
  connection.logdebug(this, `pSubscribed to ${pattern}`)
}

exports.redis_unsubscribe = async function (connection) {
  if (!connection.notes.redis) {
    connection.logerror(this, `redis_unsubscribe called when no redis`)
    return
  }

  const pattern = this.get_redis_sub_channel(connection)
  try {
    await connection.notes.redis.pUnsubscribe(pattern)
    connection.logdebug(this, `unsubscribed from ${pattern}`)
    await connection.notes.redis.quit()
  } catch (err) {
    connection.logerror(this, `redis_unsubscribe error: ${err.message}`)
  }
  connection.notes.redis = null
}
