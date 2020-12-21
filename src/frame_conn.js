"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
exports.__esModule = true;
exports.FrameConn = exports.Frame = void 0;
var events = require("events");
var minFrameBufSize = 4 + 1 + 4 + 1 + 4 + 4;
var Frame = /** @class */ (function () {
    function Frame(id, sid, type, header, dataType, data) {
        this.id = id;
        this.sid = sid;
        this.type = type;
        this.header = header;
        this.dataType = dataType;
        this.data = data ? data : Buffer.alloc(0);
    }
    Frame.prototype.getBuffer = function () {
        var headerBuf = Buffer.alloc(0);
        if (this.header) {
            headerBuf = Buffer.from(JSON.stringify(this.header));
        }
        var buf = Buffer.alloc(minFrameBufSize);
        buf.writeUInt32BE(this.id, 0);
        buf.writeUInt8(this.type, 4);
        buf.writeUInt32BE(this.sid, 5);
        buf.writeUInt8(this.dataType, 9);
        buf.writeUInt32BE(headerBuf ? headerBuf.length : 0, 10);
        buf.writeUInt32BE(this.data ? this.data.length : 0, 14);
        return Buffer.concat([buf, headerBuf, this.data]);
    };
    Frame.prototype.setHeader = function (buf) {
        if (!buf || buf.length <= 0) {
            this.header = null;
        }
        else {
            try {
                this.header = JSON.parse(buf.toString('utf-8'));
            }
            catch (ex) {
                this.header = null;
            }
        }
    };
    Frame.prototype.setData = function (buf) {
        this.data = buf;
    };
    Frame.typeStreamData = 0;
    Frame.typeRequest = 1;
    Frame.typeResponseOK = 2;
    Frame.typeResponseErr = 3;
    Frame.typeDialRequest = 4;
    Frame.typeDialResponse = 5;
    Frame.typePing = 6;
    Frame.typePong = 7;
    Frame.binaryData = 0;
    Frame.textData = 1;
    Frame.jsonData = 2;
    return Frame;
}());
exports.Frame = Frame;
var FrameConn = /** @class */ (function (_super) {
    __extends(FrameConn, _super);
    function FrameConn(conn) {
        var _this = _super.call(this) || this;
        _this.conn = conn;
        _this.initReadState(Buffer.alloc(0));
        _this.conn.on('data', function (buf) { return _this.onData(buf); });
        return _this;
    }
    FrameConn.prototype.sendFrame = function (frame) {
        return this.conn.write(frame.getBuffer());
    };
    FrameConn.prototype.initReadState = function (buf) {
        this.wantSize = minFrameBufSize;
        this.savedBuf = buf;
        this.state = FrameConn.WAIT_HEADER;
        this.readingFrame = null;
        this.headerSize = 0;
        this.dataSize = 0;
    };
    FrameConn.prototype.onData = function (buf) {
        this.savedBuf = Buffer.concat([this.savedBuf, buf]);
        while (this.savedBuf.length >= this.wantSize) {
            switch (this.state) {
                case FrameConn.WAIT_HEADER:
                    var id = this.savedBuf.readUInt32BE(0);
                    var type = this.savedBuf.readUInt8(4);
                    var sid = this.savedBuf.readUInt32BE(5);
                    var dataType = this.savedBuf.readUInt8(9);
                    this.headerSize = this.savedBuf.readUInt32BE(10);
                    this.dataSize = this.savedBuf.readUInt32BE(14);
                    this.readingFrame = new Frame(id, sid, type, null, dataType, null);
                    this.wantSize += (this.headerSize + this.dataSize);
                    this.state = FrameConn.WAIT_ALL_DATA;
                    continue;
                case FrameConn.WAIT_ALL_DATA:
                    var headerBegin = minFrameBufSize;
                    var headerEnd = headerBegin + this.headerSize;
                    var dataBegin = headerEnd;
                    var dataEnd = dataBegin + this.dataSize;
                    if (this.headerSize > 0) {
                        this.readingFrame.setHeader(this.savedBuf.slice(headerBegin, headerEnd));
                    }
                    if (this.dataSize > 0) {
                        this.readingFrame.setData(this.savedBuf.slice(dataBegin, dataEnd));
                    }
                    this.emit('frame', this.readingFrame);
                    this.initReadState(this.savedBuf.slice(this.wantSize));
                    continue;
            }
        }
    };
    FrameConn.WAIT_HEADER = 0;
    FrameConn.WAIT_ALL_DATA = 1;
    return FrameConn;
}(events.EventEmitter));
exports.FrameConn = FrameConn;
