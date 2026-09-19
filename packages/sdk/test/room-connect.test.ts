import './util';
import { describe, test, vi, afterEach } from "vitest";
import { assert } from "chai";

import { Room } from "../src/Room.ts";
import { WebSocketTransport } from "../src/transport/WebSocketTransport.ts";
import { H3TransportTransport } from "../src/transport/H3Transport.ts";

//
// Regression: `Room.connect(endpoint)` must be callable with ONLY the endpoint
// and establish the default (WebSocket) transport. It used to dereference
// `options.protocol` on `undefined` and throw before ever opening a socket.
//
// The transport constructors don't open anything themselves, so spying on their
// `connect()` methods lets us assert transport selection + arguments with no
// real network I/O.
//

const WS_ENDPOINT = "ws://localhost:2567/processId/roomId?sessionId=sessionId";
const H3_ENDPOINT = "https://localhost:14434/processId/roomId?sessionId=sessionId";

describe("Room.connect()", () => {

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("endpoint-only call defaults to WebSocket and does not throw", () => {
        // stub the actual socket open — selection/arguments are what we assert
        const wsConnect = vi
            .spyOn(WebSocketTransport.prototype, "connect")
            .mockImplementation(() => {});

        const room = new Room("game");

        assert.doesNotThrow(() => room.connect(WS_ENDPOINT));

        assert.instanceOf(room.connection.transport, WebSocketTransport,
            "no protocol option must select the WebSocket transport");

        // no local serializer state → no "&skipHandshake=1" suffix; headers absent
        assert.equal(wsConnect.mock.calls.length, 1);
        assert.equal(wsConnect.mock.calls[0][0], WS_ENDPOINT);
        assert.isUndefined(wsConnect.mock.calls[0][1]);
    });

    test("explicit protocol: 'h3' selects WebTransport and passes connect options", () => {
        const h3Connect = vi
            .spyOn(H3TransportTransport.prototype, "connect")
            .mockImplementation(() => {});

        const room = new Room("game");
        const options = { protocol: "h3" as const, roomId: "roomId", sessionId: "sessionId" };

        room.connect(H3_ENDPOINT, options);

        assert.instanceOf(room.connection.transport, H3TransportTransport,
            "protocol: 'h3' must select the WebTransport transport");

        assert.equal(h3Connect.mock.calls.length, 1);
        // WebTransport connects to the origin — seat reservation rides the
        // bidi stream message, not the URL
        assert.equal(h3Connect.mock.calls[0][0], "https://localhost:14434");
        assert.deepEqual(h3Connect.mock.calls[0][1], { ...options, skipHandshake: false });
    });

    test("reconnect restores the previously serialized connection options", () => {
        // WebSocket path: initial headers are stashed as Connection.options and
        // must be handed back to the transport on reconnect, alongside the
        // reconnection query params.
        const wsConnect = vi
            .spyOn(WebSocketTransport.prototype, "connect")
            .mockImplementation(() => {});

        const headers = { authorization: "bearer-token" };
        const room = new Room("game");
        room.connect(WS_ENDPOINT, {}, headers);

        wsConnect.mockClear();
        room.connection.reconnect({ reconnectionToken: "reconnect-token", skipHandshake: true });

        assert.equal(wsConnect.mock.calls.length, 1);
        const [reconnectUrl, reconnectOptions] = wsConnect.mock.calls[0];
        const url = new URL(reconnectUrl as string);
        assert.equal(url.searchParams.get("reconnectionToken"), "reconnect-token");
        assert.equal(url.searchParams.get("skipHandshake"), "true");
        assert.strictEqual(reconnectOptions, headers,
            "the headers/options from the original connect must survive reconnect");

        // WebTransport path: seat-reservation params (roomId/sessionId) live in
        // the connect options and must be merged (not replaced) with the
        // reconnection params on reconnect.
        const h3Connect = vi
            .spyOn(H3TransportTransport.prototype, "connect")
            .mockImplementation(() => {});

        const h3Room = new Room("game");
        const seatReservation = { protocol: "h3" as const, roomId: "roomId", sessionId: "sessionId" };
        h3Room.connect(H3_ENDPOINT, seatReservation);

        h3Connect.mockClear();
        h3Room.connection.reconnect({ reconnectionToken: "reconnect-token", skipHandshake: true });

        assert.equal(h3Connect.mock.calls.length, 1);
        assert.equal(h3Connect.mock.calls[0][0], "https://localhost:14434");
        assert.deepEqual(h3Connect.mock.calls[0][1], {
            ...seatReservation,
            reconnectionToken: "reconnect-token",
            skipHandshake: true,
        });
    });

});
