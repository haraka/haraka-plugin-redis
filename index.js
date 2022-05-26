'use strict';
/* global server */

const redis = require('redis');

exports.register = function () {
    this.load_redis_ini();

    // another plugin has called us with: inherits('haraka-plugin-redis')
    if (this.name !== 'redis') return;

    // register when 'redis' is declared in config/plugins
    this.register_hook('init_master', 'init_redis_shared');
    this.register_hook('init_child',  'init_redis_shared');
}

const defaultOpts = { socket: { host: '127.0.0.1', port: '6379' } }
const socketOpts = [ 'host', 'port', 'path', 'tls', 'connectTimeout', 'noDelay', 'keepAlive', 'reconnectStrategy' ]

exports.load_redis_ini = function () {
    const plugin = this;

    // store redis cfg at redisCfg, to avoid conflicting with plugins that
    // inherit this plugin and have *their* config at plugin.cfg
    plugin.redisCfg = plugin.config.get('redis.ini', function () {
        plugin.load_redis_ini();
    });

    // backwards compat
    if (plugin.redisCfg?.server?.ip && !plugin.redisCfg?.server?.host) {
        plugin.redisCfg.server.host = plugin.redisCfg.server.ip
        delete plugin.redisCfg.server.ip
    }
    if (plugin.redisCfg.db && !plugin.redisCfg.database) {
        plugin.redisCfg.database = plugin.redisCfg.db
        delete plugin.redisCfg.db
    }

    plugin.redisCfg.server = Object.assign({}, defaultOpts, plugin.redisCfg.opts, plugin.redisCfg.server);
    plugin.redisCfg.pubsub = Object.assign({}, defaultOpts, plugin.redisCfg.opts, plugin.redisCfg.pubsub);

    // socket options. In redis < 4, the options like host and port were
    // top level, now they're in socket.*. Permit legacy configs to still work
    for (const o in socketOpts) {
        if (plugin.redisCfg.server[o]) plugin.redisCfg.server.socket[o] = plugin.redisCfg.server[o]
        delete plugin.redisCfg.server[o]

        if (plugin.redisCfg.pubsub[o]) plugin.redisCfg.pubsub.socket[o] = plugin.redisCfg.pubsub[o]
        delete plugin.redisCfg.pubsub[o]
    }
}

exports.merge_redis_ini = function () {

    if (!this.cfg)       this.cfg = {};   // no <plugin>.ini loaded?
    if (!this.cfg.redis) this.cfg.redis = {}; // no [redis] in <plugin>.ini file
    if (!this.redisCfg)  this.load_redis_ini();

    this.cfg.redis = Object.assign({}, this.redisCfg.server, this.cfg.redis);

    // backwards compatibility
    for (const o in socketOpts) {
        if (this.cfg.redis[o] === undefined) continue
        this.cfg.redis.server.socket[o] = this.cfg.redis[o]
        delete this.cfg.redis[o]
    }
    if (this.cfg.redis.db && !this.cfg.redis.database) {
        this.cfg.redis.database = this.cfg.redis.db
        delete this.cfg.redis.db
    }
}

exports.init_redis_shared = function (next, server) {

    let calledNext = false;
    function nextOnce (e) {
        if (e) this.logerror(`Redis error: ${e.message}`);
        if (calledNext) return;
        calledNext = true;
        next();
    }

    // this is the server-wide redis, shared by plugins that don't
    // specificy a db ID.
    if (!server.notes.redis) {
        this.get_redis_client(this.redisCfg.server).then(client => {
            server.notes.redis = client
            nextOnce()
        })
        return
    }

    server.notes.redis.ping((err, res) => {
        if (err) return nextOnce(err);

        this.loginfo('already connected');
        nextOnce(); // connection is good
    });
}

exports.init_redis_plugin = function (next, server) {
    const plugin = this;

    // this function is called by plugins at init_*, to establish their
    // shared or unique redis db handle.

    let calledNext=false;
    function nextOnce () {
        if (calledNext) return;
        calledNext = true;
        next();
    }

    // for tests that do not load a shared config
    if (!plugin.cfg) {
        plugin.cfg = { redis: {} };
        if (plugin.redisCfg) plugin.cfg.redis = JSON.parse(JSON.stringify(plugin.redisCfg))
    }
    if (!server) server = { notes: {} };

    const pidb = plugin.cfg.redis.database;
    if (server.notes.redis) {    // server-wide redis is available
        // and the DB not specified or is the same as server-wide
        if (pidb === undefined || pidb === plugin.redisCfg.db) {
            server.loginfo(plugin, 'using server.notes.redis');
            plugin.db = server.notes.redis;
            nextOnce();
            return;
        }
    }

    plugin.get_redis_client(plugin.cfg.redis).then(client => {
        plugin.db = client
        nextOnce()
    })
}

exports.shutdown = function () {
    if (this.db) this.db.quit();

    if (server && server.notes && server.notes.redis) {
        server.notes.redis.quit();
    }
}

exports.redis_ping = async function () {

    this.redis_pings=false;
    if (!this.db) throw new Error('redis not initialized');

    const r = await this.db.ping()
    if (r !== 'PONG') throw new Error('not PONG');
    this.redis_pings=true
    return true
}

function getUriStr (client, opts) {
    let msg = `redis://${opts?.socket?.host}:${opts?.socket?.port}`;
    if (opts?.database) msg += `/${opts?.database}`;
    if (client?.server_info?.redis_version) {
        msg += `\tv${client?.server_info?.redis_version}`;
    }
    return msg;
}

exports.get_redis_client = async function (opts) {

    const client = redis.createClient(opts)

    let urlStr

    client
        .on('error', (err) => {
            this.logerror(err.message);
        })
        .on('end', () => {
            this.loginfo(`Disconnected from ${urlStr}`);
        })

    try {
        await client.connect()

        if (opts?.database) client.dbid = opts?.database

        client.server_info = await client.info()
        urlStr = getUriStr(client, opts)
        this.loginfo(`connected to ${urlStr}`);

        return client
    }
    catch (e) {
        console.error(e)
        this.logerror(e);
    }
}

exports.get_redis_pub_channel = function (conn) {
    return `result-${conn.transaction ? conn.transaction.uuid : conn.uuid}`;
}

exports.get_redis_sub_channel = function (conn) {
    return `result-${conn.uuid}*`;
}

exports.redis_subscribe_pattern = async function (pattern) {

    if (this.redis) return // already subscribed?

    this.redis = redis.createClient(this.redisCfg.pubsub)
    await this.redis.connect()

    await this.redis.pSubscribe(pattern);
    this.logdebug(this, `pSubscribed to ${pattern}`);
}

exports.redis_subscribe = async function (connection) {

    if (connection.notes.redis) {
        connection.logdebug(this, `redis already subscribed`);
        return; // another plugin has already called this.
    }

    const timer = setTimeout(() => {
        connection.logerror('redis subscribe timed out');
    }, 3 * 1000);

    connection.notes.redis = redis.createClient(this.redisCfg.pubsub)
    await connection.notes.redis.connect()

    clearTimeout(timer);

    const pattern = this.get_redis_sub_channel(connection)
    connection.notes.redis.pSubscribe(pattern);
    connection.logdebug(this, `pSubscribed to ${pattern}`);
}

exports.redis_unsubscribe = async function (connection) {

    if (!connection.notes.redis) {
        connection.logerror(this, `redis_unsubscribe called when no redis`)
        return;
    }

    const pattern = this.get_redis_sub_channel(connection)
    await connection.notes.redis.unsubscribe(pattern);
    connection.logdebug(this, `unsubsubscribed from ${pattern}`);
    connection.notes.redis.quit();
}
