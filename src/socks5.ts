import * as events from 'events'
import { StreamLike } from './stream';
import * as net from 'net'
import { Stream } from 'stream';

function createServer(cb:any) {
  return net.createServer(function (conn:net.Socket) {
    conn.on('data', function (buf) {

    })
  })
}

const rfc1928 = {
  version: 0x05,
  methodNoAuth: 0x00,
  methodGSSAPI: 0x01,
  methodPassword: 0x02,
  methodNoAccept: 0xff,
  cmdConnect: 0x01,
  cmdBind: 0x02,
  cmdUDP: 0x03,
  addrV4: 0x01,
  addrV6: 0x04,
  addrDomain: 0x03,
  repSuccess: 0x00,
  repGeneralErr: 0x01,
  repConnectNotAllow: 0x02,
  repNetworkUnreachable: 0x03,
  repHostUnreachable: 0x04,
  repConnectionRefused: 0x05,
  repTTLExpired: 0x06,
  repCommandErr: 0x07,
  repAddrTypeErr: 0x08,
}
const rfc1929 = {
  version: 0x01,
  success: 0x00,
  failure: 0x01
}

type AuthChecker = (username:string, password:string) => boolean
type Dialer = (username:string, password:string, addr:string) => Promise<StreamLike>

class Socks5Handler extends events.EventEmitter {
  private conn:net.Socket
  constructor(conn:net.Socket, pswdChecker:AuthChecker, dialer:Dialer) {
    super()
    this.conn = conn
    this.conn.on('data', buf => this.eatBuf(buf))
    let destroy = () => {
      this.conn.destroy()
      this.removeAllListeners()
      this.conn.removeAllListeners()
    }
    this.on('request', () => {
      this.conn.removeAllListeners('data') // 到了request阶段后，不再eatBuf
    })
    this.on('error-handshake', err => {
      this.conn.write(Buffer.from([rfc1928.version, rfc1928.methodNoAccept]))
      destroy()
    })
    this.on('error-auth', err => {
      this.conn.write(Buffer.from([rfc1929.version, rfc1929.failure]))
      destroy()
    })
    this.on('error-cmd', err => {
      this.conn.write(Buffer.from([
        rfc1928.version, rfc1928.repGeneralErr, 0x00,
        rfc1928.addrV4, 0,0,0,0,
        0,0]))
      destroy()
    })
    this.on('error-dial', err => {
      this.conn.write(Buffer.from([
        rfc1928.version, rfc1928.repConnectionRefused, 0x00,
        rfc1928.addrV4, 0,0,0,0,
        0,0]))
      destroy()
    })
  }

  public version:number
  public methodsLen:number
  public methods:Buffer
  public selectMethod:number
  public pswdVersion:number
  public usernameLen:number
  public username:string
  public passwordLen:number
  public password:string
  public reqVersion:number
  public reqCommand:number
  public reqAddrType:number
  public reqAddrBufLen:number
  public reqAddrBuf:Buffer
  public reqPort:number

  private buf:Buffer
  private wantSize:number
  private state:number
  private eatErr:{event:string,err:string}
  static  ST_HANDSHAKE_header = 0
  static  ST_HANDSHAKE_methods = 1
  static  ST_AUTHPSWD_header = 2
  static  ST_AUTHPSWD_username = 3
  static  ST_AUTHPSWD_password = 4
  static  ST_CMD_header = 5
  static  ST_CMD_addr = 6
  static  ST_TRANSFER = 7
  static  ST_ERR = 100
  private changeState(st:number, want:number, eat:boolean=true) {
    if (eat) {
      this.buf = this.buf.slice(this.wantSize)
      this.wantSize = want
    } else {
      this.wantSize += want
    }
    this.state = st
  }
  private checkPassword():boolean {
    return false
  }
  private eatBuf(newBuf:Buffer) {
    this.buf = Buffer.concat([this.buf, newBuf])

    while (this.buf.length >= this.wantSize) {
      switch (this.state) {
        
        case Socks5Handler.ST_HANDSHAKE_header:
          this.version = this.buf.readUInt8(0)
          if (this.version != rfc1928.version) {
            this.changeState(Socks5Handler.ST_ERR, 0)
            this.eatErr = { event: 'error-handshake', err:'protocol version invalid' }
            continue
          }
          this.methodsLen = this.buf.readUInt8(1) // todo：判断长度是否为空
          if (this.methodsLen <= 0) {
            this.changeState(Socks5Handler.ST_ERR, 0)
            this.eatErr = { event: 'error-handshake', err:'length of methods invalid' }
            continue
          }
          this.changeState(Socks5Handler.ST_HANDSHAKE_methods, this.methodsLen)
          continue
       
        case Socks5Handler.ST_HANDSHAKE_methods:
          this.methods = this.buf.slice(2, 2 + this.methodsLen)
          for (let i = 0; i < this.methods.length; i++) {
            if (this.selectMethod == this.methods[i]) {
              this.changeState(Socks5Handler.ST_CMD_header, 4)
              continue
            }
          }
          this.changeState(Socks5Handler.ST_ERR, 0)
          this.eatErr = { event: 'error-handshake', err: 'method not found' }
          continue
        
        case Socks5Handler.ST_AUTHPSWD_header:
          this.pswdVersion = this.buf.readUInt8(0)
          this.usernameLen = this.buf.readUInt8(1)
          this.changeState(Socks5Handler.ST_AUTHPSWD_username,
            this.usernameLen + 1)
          continue
        
        case Socks5Handler.ST_AUTHPSWD_username:
          this.username = this.buf.slice(2, 2 + this.usernameLen).toString('utf-8')
          this.passwordLen = this.buf.readUInt8(this.wantSize - 1)
          this.changeState(Socks5Handler.ST_AUTHPSWD_password,
            this.passwordLen)
          continue
        
        case Socks5Handler.ST_AUTHPSWD_password:
          this.password = this.buf.toString('utf-8')
          if (this.checkPassword()) {
            this.changeState(Socks5Handler.ST_CMD_header, 4+2) // 4代表header，2代表port
          } else {
            this.changeState(Socks5Handler.ST_ERR, 0)
            this.eatErr = { event: 'error-auth', err: 'check password failed' }
          }
          continue
        
        case Socks5Handler.ST_CMD_header:
          this.reqVersion = this.buf.readUInt8(0)
          this.reqCommand = this.buf.readUInt8(1)
          this.reqAddrType = this.buf.readUInt8(3)
          if (this.reqAddrType == rfc1928.addrV4) {
            this.reqAddrBufLen = 4
            this.changeState(Socks5Handler.ST_CMD_addr, 4, false) // 不吃掉buf，因为还有2个byte没读
          } else if (this.reqAddrType == rfc1928.addrV6) {
            this.reqAddrBufLen = 16
            this.changeState(Socks5Handler.ST_CMD_addr, 16, false)
          } else if (this.reqAddrType == rfc1928.addrDomain) {
            this.reqAddrBufLen = this.buf.readUInt8(4)
            this.changeState(Socks5Handler.ST_CMD_addr,
              this.reqAddrBufLen + 1, false) // 1代表len
          } else {
            this.changeState(Socks5Handler.ST_ERR, 0)
            this.eatErr = { event: 'error-cmd', err: `unknown address type ${this.reqAddrType}` }
          }
          continue

        case Socks5Handler.ST_CMD_addr:
          let addrPos = this.reqAddrType == rfc1928.addrDomain ? 5 : 4
          let portPos = addrPos + this.reqAddrBufLen
            
          this.reqAddrBuf = this.buf.slice(addrPos, portPos)
          this.reqPort = this.buf.readUInt16BE(portPos)

          this.emit('request')
          this.buf = null
          this.wantSize = 0
          return
          // done
        
        case Socks5Handler.ST_ERR:
          this.emit(this.eatErr.event, this.eatErr.err)
          return
          // done
      }
    }
  }
}