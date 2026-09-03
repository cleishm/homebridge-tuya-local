#!/usr/bin/env node
'use strict';

/**
 * parser-harness.js — Exercise the protocol 3.3 frame parser in
 * lib/TuyaAccessory.js against a fake device on 127.0.0.1.
 *
 * The fake device answers heartbeats (cmd 9) with an empty ack and datapoint
 * queries (cmd 10) with an encrypted state payload, exactly as a real 3.3
 * device does. The harness passes only if the parser dispatches both: at
 * least one 'change' event with the state, and at least two heartbeats,
 * which proves the first ack was processed and a second ping scheduled.
 *
 * Usage:
 *   node scripts/parser-harness.js [path/to/TuyaAccessory.js]
 *
 * The optional argument runs another copy of the module, e.g. one from an
 * older commit, so a regression can be shown side by side with the fix. A copy
 * outside the repo needs NODE_PATH=node_modules to resolve the plugin's
 * dependencies. Exits 0 on PASS, 1 on FAIL.
 */

const net = require('net');
const path = require('path');
const crypto = require('crypto');

const modulePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'lib', 'TuyaAccessory.js');
const TuyaAccessory = require(modulePath);

const KEY = '0123456789abcdef';
const STATE = '{"dps":{"20":false,"21":"white","22":970,"23":0}}';
const RUN_MS = 13000; // two heartbeats at the plugin's 9 s ping gap, plus slack

function encrypt(str) {
    const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(KEY), '');
    return Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
}

// A 3.3 frame: prefix, seq, cmd, len, retcode, payload, crc, suffix. The plugin
// does not check the CRC on inbound frames, so a placeholder is fine.
function frame(cmd, seq, payload) {
    const body = Buffer.concat([Buffer.alloc(4), payload]);
    const header = Buffer.alloc(16);
    header.writeUInt32BE(0x000055aa, 0);
    header.writeUInt32BE(seq, 4);
    header.writeUInt32BE(cmd, 8);
    header.writeUInt32BE(body.length + 8, 12);
    return Buffer.concat([header, body, Buffer.from('deadbeef', 'hex'), Buffer.from('0000aa55', 'hex')]);
}

let heartbeats = 0;
let queries = 0;
const changes = [];

const server = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    sock.on('data', data => {
        buf = Buffer.concat([buf, data]);
        while (buf.length >= 16) {
            const len = buf.readUInt32BE(12) + 16;
            if (buf.length < len) break;
            const seq = buf.readUInt32BE(4);
            const cmd = buf.readUInt32BE(8);
            buf = buf.subarray(len);
            if (cmd === 9) {
                heartbeats++;
                sock.write(frame(9, seq, Buffer.alloc(0)));
            } else if (cmd === 10) {
                queries++;
                sock.write(frame(10, seq, encrypt(STATE)));
            }
        }
    });
    sock.on('error', () => {});
});

server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const tag = level => (...args) => console.log(`  [plugin:${level}]`, ...args);
    const log = {info: tag('info'), debug: tag('debug'), warn: tag('warn'), error: tag('error')};

    console.log(`Testing ${modulePath} on node ${process.version}`);
    const dev = new TuyaAccessory({
        name: 'Fake Lights', id: 'fakedevice00000000000', key: KEY,
        ip: '127.0.0.1', port, version: '3.3', type: 'SimpleDimmer', log, connect: false
    });
    dev.on('change', (changed, state) => changes.push(JSON.stringify(state)));
    dev.on('connect', () => dev.update());
    dev._connect();

    setTimeout(() => {
        const ok = changes.length > 0 && heartbeats >= 2;
        console.log(`  queries=${queries} heartbeats=${heartbeats} changes=${changes.length} state=${changes[0] || '(none)'}`);
        console.log(ok ? 'PASS' : 'FAIL');
        process.exit(ok ? 0 : 1);
    }, RUN_MS);
});
