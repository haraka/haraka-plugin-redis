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

exports.load_redis_ini = function () {
    const plugin = this;

    // store redis cfg at redisCfg, to avoid conflicting with plugins that
    // inherit this plugin and have *their* config at plugin.cfg
    plugin.redisCfg = plugin.config.get('redis.ini', function () {
        plugin.load_redis_ini();
    });

    const rc = plugin.redisCfg;
    plugin.redisCfg.server = Object.assign({}, defaultOpts, rc.opts, rc.socket);

    // backwards compat
    if (rc.server.ip && !rc.server.host) {
        rc.server.host = rc.server.ip
        delete rc.server.ip
    }

    // backwards compat with node-redis < 4
    if (rc.server && !rc.socket) {
        rc.socket = rc.server
        delete rc.server
    }

    // same as above
    if (rc.db && !rc.database) {
        rc.database = rc.db
        delete rc.db
    }

    plugin.redisCfg.pubsub = Object.assign({}, defaultOpts, rc.opts, rc.socket, rc.pubsub);
}

exports.merge_redis_ini = function () {

    if (!this.cfg)       this.cfg = {};   // no <plugin>.ini loaded?
    if (!this.cfg.redis) this.cfg.redis = {}; // no [redis] in <plugin>.ini file
    if (!this.redisCfg)  this.load_redis_ini();

    this.cfg.redis = Object.assign({}, this.redisCfg.server, this.cfg.redis);
}

exports.init_redis_shared = function (next, server) {
    const plugin = this;

    let calledNext = false;
    function nextOnce (e) {
        if (e) plugin.logerror(`Redis error: ${e.message}`);
        if (calledNext) return;
        calledNext = true;
        next();
    }

    // this is the server-wide redis, shared by plugins that don't
    // specificy a db ID.
    if (!server.notes.redis) {
        server.notes.redis = plugin.get_redis_client(plugin.redisCfg.server, nextOnce);
        return
    }

    server.notes.redis.ping((err, res) => {
        if (err) return nextOnce(err);

        plugin.loginfo('already connected');
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

    // tests that do not load config
    if (!plugin.cfg) plugin.cfg = { redis: {} };
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

    plugin.db = plugin.get_redis_client(plugin.cfg.redis, nextOnce);
}

exports.shutdown = function () {
    if (this.db) this.db.disconnect();

    if (server && server.notes && server.notes.redis) {
        server.notes.redis.disconnect();
    }
}

exports.redis_ping = async function () {

    this.redis_pings=false;

    if (!this.db) {
        return new Error('redis not initialized');
    }

    try {
        const r = await this.db.ping()
        if (r !== 'PONG') return new Error('not PONG');
        this.redis_pings=true
    }
    catch (e) {
        this.logerror(e.message)
    }
}

function getUriStr (client, opts) {
    let msg = `redis://${opts?.socket?.host}:${opts?.socket?.port}`;
    if (opts.database) msg += `/${opts.database}`;
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

        if (opts.database) client.dbid = opts.database

        client.server_info = await client.info()
        urlStr = getUriStr(client, opts)
        this.loginfo(`connected to ${urlStr}`);

        return client
    }
    catch (e) {
        console.error(e)
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

    this.redis = await redis.createClient(this.redisCfg.pubsub)
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

    connection.notes.redis = await redis.createClient(this.redisCfg.pubsub)
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
