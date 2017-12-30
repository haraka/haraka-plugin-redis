'use strict';
/* global server */

const redis  = require('redis');

exports.register = function () {
    const plugin = this;

    plugin.load_redis_ini();

    // some other plugin doing: inherits('haraka-plugin-redis')
    if (plugin.name !== 'redis') return;

    // do register these when 'redis' is declared in config/plugins
    plugin.register_hook('init_master',  'init_redis_shared');
    plugin.register_hook('init_child',   'init_redis_shared');
};

exports.load_redis_ini = function () {
    const plugin = this;

    plugin.redisCfg = plugin.config.get('redis.ini', function () {
        plugin.load_redis_ini();
    });

    if (!plugin.redisCfg.server) plugin.redisCfg.server = {};
    const s = plugin.redisCfg.server;
    if (s.ip && !s.host) s.host = s.ip;
    if (!s.host) s.host = '127.0.0.1';
    if (!s.port) s.port = '6379';

    if (!plugin.redisCfg.pubsub) {
        plugin.redisCfg.pubsub = JSON.parse(JSON.stringify(s));
    }
    const ps = plugin.redisCfg.pubsub;
    if (!ps.host) ps.host = s.host;
    if (!ps.port) ps.port = s.port;

    if (plugin.redisCfg.opts === undefined) plugin.redisCfg.opts = {};
    Object.keys(plugin.redisCfg.opts).forEach(opt => {
        if (ps[opt] === undefined) ps[opt] = plugin.redisCfg.opts[opt];
    });
};

exports.merge_redis_ini = function () {
    const plugin = this;

    if (!plugin.cfg) plugin.cfg = {};   // no <plugin>.ini loaded?

    if (!plugin.cfg.redis) {            // no [redis] in <plugin>.ini file
        plugin.cfg.redis = {};
    }

    if (!plugin.redisCfg) plugin.load_redis_ini();

    ['host', 'port', 'db'].forEach(function (k) {
        if (plugin.cfg.redis[k]) return;  // property already set
        plugin.cfg.redis[k] = plugin.redisCfg.server[k];
    });
}

exports.init_redis_shared = function (next, server) {
    const plugin = this;

    let calledNext = false;
    function nextOnce () {
        if (calledNext) return;
        calledNext = true;
        next();
    }

    // this is the server-wide redis, shared by plugins that don't
    // specificy a db ID.
    if (server.notes.redis) {
        server.notes.redis.ping(function (err, res) {
            if (err) {
                plugin.logerror(err);
                return nextOnce(err);
            }
            plugin.loginfo('already connected');
            nextOnce(); // connection is good
        });
    }
    else {
        const opts = JSON.parse(JSON.stringify(plugin.redisCfg.opts));
        opts.host = plugin.redisCfg.server.host;
        opts.port = plugin.redisCfg.server.port;
        server.notes.redis = plugin.get_redis_client(opts, nextOnce);
    }
};

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

    // use server-wide redis connection when using default DB id
    if (!plugin.cfg.redis.db) {
        if (server.notes.redis) {
            server.loginfo(plugin, 'using server.notes.redis');
            plugin.db = server.notes.redis;
            return nextOnce();
        }
    }

    plugin.db = plugin.get_redis_client(plugin.cfg.redis, nextOnce);
};

exports.shutdown = function () {
    if (this.db) {
        this.db.quit();
    }
    if (server && server.notes && server.notes.redis) {
        server.notes.redis.quit();
    }
}

exports.redis_ping = function (done) {
    const plugin = this;
    const nope = function (err) {
        plugin.redis_pings=false;
        done(err);
    };

    if (!plugin.db) {
        return nope(new Error('redis not initialized'));
    }

    plugin.db.ping(function (err, res) {
        if (err           ) { return nope(err); }
        if (res !== 'PONG') { return nope(new Error('not PONG')); }
        plugin.redis_pings=true;
        done(err, true);
    });
};

exports.get_redis_client = function (opts, next) {
    const plugin = this;

    const client = redis.createClient(opts)
        .on('error', function (error) {
            plugin.logerror('Redis error: ' + error.message);
            next();
        })
        .on('ready', function () {
            let msg = 'connected to redis://' + opts.host + ':' + opts.port;
            if (opts.db) msg += '/' + opts.db;
            if (client.server_info && client.server_info.redis_version) {
                msg += ' v' + client.server_info.redis_version;
            }
            plugin.loginfo(plugin, msg);
            next();
        })
        .on('end', function () {
            if (arguments.length) console.log(arguments);
            // plugin.logerror('Redis error: ' + error.message);
            next();
        });

    return client;
};

exports.get_redis_pub_channel = function (conn) {
    return 'result-' + conn.transaction ? conn.transaction.uuid : conn.uuid;
};

exports.get_redis_sub_channel = function (conn) {
    return 'result-' + conn.uuid + '*';
};

exports.redis_subscribe_pattern = function (pattern, next) {
    const plugin = this;
    if (plugin.redis) {
        // already subscribed?
        return next();
    }

    plugin.redis = require('redis').createClient(plugin.redisCfg.pubsub)
        .on('psubscribe', function (pattern2, count) {
            plugin.logdebug(plugin, 'psubscribed to ' + pattern2);
            next();
        })
        .on('punsubscribe', function (pattern3, count) {
            plugin.logdebug(plugin, 'unsubsubscribed from ' + pattern3);
        });
    plugin.redis.psubscribe(pattern);
};

exports.redis_subscribe = function (connection, next) {
    const plugin = this;

    if (connection.notes.redis) {
        // another plugin has already called this. Do nothing
        return next();
    }

    connection.notes.redis = require('redis').createClient(plugin.redisCfg.pubsub)
        .on('psubscribe', function (pattern, count) {
            connection.logdebug(plugin, 'psubscribed to ' + pattern);
            next();
        })
        .on('punsubscribe', function (pattern, count) {
            connection.logdebug(plugin, 'unsubsubscribed from ' + pattern);
            connection.notes.redis.quit();
        });
    connection.notes.redis.psubscribe(plugin.get_redis_sub_channel(connection));
};

exports.redis_unsubscribe = function (connection) {
    if (!connection.notes.redis) return;
    connection.notes.redis.punsubscribe(this.get_redis_sub_channel(connection));
    connection.notes.redis.quit();
};
