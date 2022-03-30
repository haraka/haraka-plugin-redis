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
    before(async function () {
        this.plugin = new fixtures.plugin('index')
        this.plugin.register()
    })

    it('loads', async function () {
        assert.equal(this.plugin.name, 'index');
    })

    it('config defaults', async function () {
        assert.equal(this.plugin.redisCfg.server.socket.host, '127.0.0.1')
        assert.equal(this.plugin.redisCfg.server.socket.port, 6379)
    })

    it('merges [opts] into server config', async function () {
        this.plugin.config = this.plugin.config.module_config(path.resolve('test'));
        this.plugin.load_redis_ini();
        assert.deepEqual(this.plugin.redisCfg, {
            main: {},
            socket: {},
            pubsub: {
                socket: {
                    host: '127.0.0.1',
                    port: '6379',
                },
                database: 5,
                password: 'dontUseThisOne'
            },
            opts: { database: 5, password: 'dontUseThisOne' },
            server: {
                socket: {
                    host: '127.0.0.1',
                    port: '6379',
                },
                database: 5,
                password: 'dontUseThisOne'
            }
        });
    })

    it('merges redis.ini [opts] into plugin config', async function () {
        this.plugin.config = this.plugin.config.module_config(path.resolve('test'));
        this.plugin.load_redis_ini();
        this.plugin.cfg = {};
        this.plugin.merge_redis_ini();
        assert.deepEqual(this.plugin.cfg, {
            redis: {
                socket: {
                    host: '127.0.0.1',
                    port: '6379',
                },
                database: 5,
                password: 'dontUseThisOne'
            }
        })
    })
})

describe('connects', function () {
    before(async function () {
        this.plugin = new fixtures.plugin('index')
        this.plugin.register()
    })

    it('loads', async function () {
        assert.equal(this.plugin.name, 'index');
    })

    it('connects', async function () {
        const redis = await this.plugin.get_redis_client({
            socket: {
                host: this.plugin.redisCfg.server.host,
                port: this.plugin.redisCfg.server.port,
            },
            retry_strategy: retry,
        })
        assert.ok(redis);
        redis.disconnect()
    })

    it('populates plugin.cfg.redis when asked', async function () {
        assert.equal(this.plugin.cfg, undefined);
        this.plugin.merge_redis_ini();
        assert.deepEqual(this.plugin.cfg.redis, { socket: { host: '127.0.0.1', port: '6379' } });
    })

    it('connects to a different redis db', async function () {
        this.plugin.merge_redis_ini();
        this.plugin.cfg.redis.database = 2;
        this.plugin.cfg.redis.retry_strategy = retry;
        const client = await this.plugin.get_redis_client(this.plugin.cfg.redis)
        const res = await client.ping()
        assert.equal(res, 'PONG')
        assert.ok(client)
        await client.disconnect()
    })
})
