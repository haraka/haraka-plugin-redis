'use strict';
/* global server */

const redis  = require('redis');

exports.register = function () {
    const plugin = this;

    plugin.load_redis_ini();

    // another plugin doing: inherits('haraka-plugin-redis')
    if (plugin.name !== 'redis') return;

    // do register these when 'redis' is declared in config/plugins
    plugin.register_hook('init_master',  'init_redis_shared');
    plugin.register_hook('init_child',   'init_redis_shared');
}

const defaultOpts = { host: '127.0.0.1', port: '6379' };

exports.load_redis_ini = function () {
    const plugin = this;

    // store redis cfg at redisCfg, to avoid conflicting with plugins that
    // inherit this plugin and have *their* config at plugin.cfg
    plugin.redisCfg = plugin.config.get('redis.ini', function () {
        plugin.load_redis_ini();
    });

    const rc = plugin.redisCfg;
    plugin.redisCfg.server = Object.assign({}, defaultOpts, rc.opts, rc.server);
    if (rc.server.ip && !rc.server.host) rc.server.host = rc.server.ip;  // backwards compat

    plugin.redisCfg.pubsub = Object.assign({}, defaultOpts, rc.opts, rc.server, rc.pubsub);
}

exports.merge_redis_ini = function () {
    const plugin = this;

    if (!plugin.cfg)       plugin.cfg = {};   // no <plugin>.ini loaded?
    if (!plugin.cfg.redis) plugin.cfg.redis = {}; // no [redis] in <plugin>.ini file
    if (!plugin.redisCfg)  plugin.load_redis_ini();

    plugin.cfg.redis = Object.assign({}, plugin.redisCfg.server, plugin.cfg.redis);
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

    const pidb = plugin.cfg.redis.db;
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
    if (this.db) this.db.quit();

    if (server && server.notes && server.notes.redis) {
        server.notes.redis.quit();
    }
}

exports.redis_ping = function (done) {
    const plugin = this;

    function nope (err) {
        if (err) plugin.logerror(err.message);
        plugin.redis_pings=false;
        done(err);
    }

    if (!plugin.db) {
        return nope(new Error('redis not initialized'));
    }

    plugin.db.ping((err, res) => {
        if (err) return nope(err);
        if (res !== 'PONG') return nope(new Error('not PONG'));
        plugin.redis_pings=true;
        done(err, true);
    });
}

function getUriStr (client, opts) {
    let msg = `redis://${opts.host}:${opts.port}`;
    if (opts.db) msg += `/${opts.db}`;
    if (client && client.server_info && client.server_info.redis_version) {
        msg += `\tv${client.server_info.redis_version}`;
    }
    return msg;
}

exports.get_redis_client = function (opts, next) {
    const plugin = this;

    const client = redis.createClient(opts);
    const urlStr = getUriStr(client, opts);

    client
        .on('error', (err) => {
            plugin.logerror(err.message);
            next(err);
        })
        .on('ready', () => {
            plugin.loginfo(`connected to ${urlStr}`);
            next();
        })
        .on('end', () => {
            plugin.loginfo(`Disconnected from ${urlStr}`);
        });

    return client;
}

exports.get_redis_pub_channel = function (conn) {
    return `result-${conn.transaction ? conn.transaction.uuid : conn.uuid}`;
}

exports.get_redis_sub_channel = function (conn) {
    return `result-${conn.uuid}*`;
}

exports.redis_subscribe_pattern = function (pattern, next) {
    const plugin = this;

    if (plugin.redis) return next(); // already subscribed?

    plugin.redis = require('redis').createClient(plugin.redisCfg.pubsub)
        .on('error', function (err) {
            next(err.message);
        })
        .on('psubscribe', function (pattern2, count) {
            plugin.logdebug(plugin, `psubscribed to ${pattern2}`);
            next();
        })
        .on('punsubscribe', function (pattern3, count) {
            plugin.logdebug(plugin, `unsubsubscribed from ${pattern3}`);
            connection.notes.redis.quit();
        });

    plugin.redis.psubscribe(pattern);
}

exports.redis_subscribe = function (connection, next) {
    const plugin = this;

    if (connection.notes.redis) {
        connection.logdebug(plugin, `redis already subscribed`);
        // another plugin has already called this. Do nothing
        return next();
    }

    let calledNext = false;
    function nextOnce (errMsg) {
        if (calledNext) return;
        calledNext = true;
        if (errMsg && connection) connection.logerror(plugin, errMsg);
        next();
    }

    const timer = setTimeout(() => {
        nextOnce('redis psubscribe timed out');
    }, 3 * 1000);

    connection.notes.redis = require('redis').createClient(plugin.redisCfg.pubsub)
        .on('error', (err) => {
            clearTimeout(timer);
            nextOnce(err.message);
        })
        .on('psubscribe', function (pattern, count) {
            clearTimeout(timer);
            connection.logdebug(plugin, `psubscribed to ${pattern}`);
            nextOnce();
        })
        .on('punsubscribe', function (pattern, count) {
            connection.logdebug(plugin, `unsubsubscribed from ${pattern}`);
            connection.notes.redis.quit();
        });

    connection.notes.redis.psubscribe(plugin.get_redis_sub_channel(connection));
}

exports.redis_unsubscribe = function (connection) {
    const plugin = this;

    if (!connection.notes.redis) {
        connection.logerror(plugin, `redis_unsubscribe called when no redis`)
        return;
    }
    connection.notes.redis.punsubscribe(plugin.get_redis_sub_channel(connection));
}
