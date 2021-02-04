'use strict';

const assert = require('assert')
const path   = require('path')

const fixtures = require('haraka-test-fixtures')

function retry (options) {
    if (options.error) {
        console.error(options.error);
    }
    return undefined;
}

describe('config', function () {
    before(function (done) {
        this.plugin = new fixtures.plugin('index')
        this.plugin.register()
        done()
    })

    it('loads', function (done) {
        assert.equal(this.plugin.name, 'index');
        done()
    })

    it('config defaults', function (done) {
        assert.equal(this.plugin.redisCfg.server.host, '127.0.0.1')
        assert.equal(this.plugin.redisCfg.server.port, 6379)
        done()
    })

    it('merges [opts] into server config', function (done) {
        this.plugin.config = this.plugin.config.module_config(path.resolve('test'));
        this.plugin.load_redis_ini();
        assert.deepEqual(this.plugin.redisCfg, {
            main: {
                // "host": "localhost"
            },
            pubsub: {
                host: '127.0.0.1',
                port: '6379',
                db: 5,
                password: 'dontUseThisOne'
            },
            opts: { db: 5, password: 'dontUseThisOne' },
            server: {
                host: '127.0.0.1',
                port: '6379',
                db: 5,
                password: 'dontUseThisOne'
            }
        });
        done();
    })

    it('merges redis.ini [opts] into plugin config', function (done) {
        this.plugin.config = this.plugin.config.module_config(path.resolve('test'));
        this.plugin.load_redis_ini();
        this.plugin.cfg = {};
        this.plugin.merge_redis_ini();
        assert.deepEqual(this.plugin.cfg, {
            redis: {
                host: '127.0.0.1',
                port: '6379',
                db: 5,
                password: 'dontUseThisOne'
            }
        })
        done()
    })
})

describe('connects', function () {
    before(function (done) {
        this.plugin = new fixtures.plugin('index')
        this.plugin.register()
        done()
    })

    it('loads', function (done) {
        assert.equal(this.plugin.name, 'index');
        done();
    })

    it('connects', function (done) {
        const redis = this.plugin.get_redis_client({
            host: this.plugin.redisCfg.server.host,
            port: this.plugin.redisCfg.server.port,
            retry_strategy: retry,
        },
        function () {
            assert.ok(redis.connected);
            done();
        });
    })

    it('populates plugin.cfg.redis when asked', function (done) {
        assert.equal(this.plugin.cfg, undefined);
        this.plugin.merge_redis_ini();
        assert.deepEqual(this.plugin.cfg.redis, { host: '127.0.0.1', port: '6379' });
        done();
    })

    it('connects to a different redis db', function (done) {
        this.plugin.merge_redis_ini();
        this.plugin.cfg.redis.db = 2;
        this.plugin.cfg.redis.retry_strategy = retry;
        const client = this.plugin.get_redis_client(this.plugin.cfg.redis, function () {
            // console.log(client);
            assert.equal(client.connected, true)
            assert.equal(client.selected_db, 2)
            done()
        })
    })
})
