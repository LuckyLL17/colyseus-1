import './util';
import { afterEach, describe, test, vi } from "vitest";
import { assert } from "chai";
import { schema, t } from "@colyseus/schema";

import { Room } from "../src/index.ts";
import { WebSocketTransport } from "../src/transport/WebSocketTransport.ts";
import { H3TransportTransport } from "../src/transport/H3Transport.ts";

//
// `Room.connect(endpoint)` must work with no `options` argument at all — the
// browser-side minimal call. A missing `options` used to throw on
// `options.protocol` before any connection was attempted. These tests stub
// the transports (no real sockets) and pin down the three connect paths:
// default WebSocket, explicit H3/WebTransport, and skipHandshake when the
// room was restored from an already-serialized state.
//

describe("Room.connect() parameter defaults", () => {
    afterEach(() => vi.restoreAllMocks());

    test("default: connects over WebSocket when options are omitted", () => {
        const wsConnect = vi.spyOn(WebSocketTransport.prototype, "connect").mockImplementation(() => {});
        const h3Connect = vi.spyOn(H3TransportTransport.prototype, "connect").mockImplementation(() => {});

        const room = new Room("chat");
        const endpoint = "ws://localhost:2567/chat/roomId?sessionId=abc";
        assert.doesNotThrow(() => room.connect(endpoint));

        assert.instanceOf(room.connection.transport, WebSocketTransport);
        assert.equal(h3Connect.mock.calls.length, 0, "h3 transport must not connect");
        assert.equal(wsConnect.mock.calls.length, 1);
        // no local state → endpoint untouched (no skipHandshake)
        assert.equal(wsConnect.mock.calls[0][0], endpoint);
    });

    test("explicit h3: connects over WebTransport to the origin with merged options", () => {
        const wsConnect = vi.spyOn(WebSocketTransport.prototype, "connect").mockImplementation(() => {});
        const h3Connect = vi.spyOn(H3TransportTransport.prototype, "connect").mockImplementation(() => {});

        const room = new Room("chat");
        const options = { protocol: "h3", sessionId: "abc", roomId: "roomId" };
        room.connect("https://localhost:2567/chat/roomId?sessionId=abc", options);

        assert.instanceOf(room.connection.transport, H3TransportTransport);
        assert.equal(wsConnect.mock.calls.length, 0, "ws transport must not connect");
        assert.equal(h3Connect.mock.calls.length, 1);
        // h3 carries session params in the seat-reservation message, not the URL
        assert.equal(h3Connect.mock.calls[0][0], "https://localhost:2567");
        assert.deepEqual(h3Connect.mock.calls[0][1], { ...options, skipHandshake: false });
    });

    test("restored state: appends skipHandshake=1 when the serializer already holds state", () => {
        const wsConnect = vi.spyOn(WebSocketTransport.prototype, "connect").mockImplementation(() => {});

        const State = schema({ hp: t.number().default(0) }, 'ConnectState');
        const room = new Room<any, InstanceType<typeof State>>("chat", State);
        room.connect("ws://localhost:2567/chat/roomId?sessionId=abc");

        assert.instanceOf(room.connection.transport, WebSocketTransport);
        assert.equal(wsConnect.mock.calls.length, 1);
        assert.equal(wsConnect.mock.calls[0][0], "ws://localhost:2567/chat/roomId?sessionId=abc&skipHandshake=1");
    });

});
