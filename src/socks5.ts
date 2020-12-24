import * as events from 'events'
import { StreamLike } from './stream';
import * as net from 'net'
import { linkStream } from './utils';
import { VNet } from './vnet';
import { Cluster } from './cluster';

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

export type AuthChecker = (username:string, password:string) => boolean
export type Dialer = (username:string, password:string, host:string, port:number) => Promise<StreamLike>

class ConnHandler extends events.EventEmitter {
  private conn:StreamLike
  private pswdChecker:AuthChecker
  private dialer:Dialer
  private ondatacb:any
  private ondataerrcb:any
  constructor(conn:StreamLike, pswdChecker:AuthChecker, dialer:Dialer) {
    super()
    this.selectMethod = rfc1928.methodPassword
    this.pswdChecker = pswdChecker
    if (!pswdChecker) {
      this.selectMethod = rfc1928.methodNoAuth
    }
    this.dialer = dialer
    this.conn = conn
    
    // init eatBuf state
    this.buf = Buffer.alloc(0)
    this.wantSize = 2
    this.state = ConnHandler.ST_HANDSHAKE_header
    this.ondatacb = (buf:Buffer) => this.eatBuf(buf)
    this.ondataerrcb = (err:any) => this.emit('error', `handshake failed: ${err}`)
    this.conn.on('data', this.ondatacb)
    this.conn.on('error', this.ondataerrcb)

    this.on('request', async () => {
      if (!this.dialer) {
        this.emit('error-cmd', 'dialer is null')
        return
      }

      let host:string = this.getHost()
      if (host == '') {
        this.emit('error-dial', 'ipv6 addr not supported')
        return
      }
      let s:StreamLike
      try {
        s = await this.dialer(this.username, this.password, host, this.reqPort)
      } catch (ex) {
        this.emit('error-dial', ex)
      }
      this.conn.write(Buffer.from([
        rfc1928.version, rfc1928.repSuccess, 0x00,
        rfc1928.addrV4, 0,0,0,0,
        0,0]))
      this.emit('stream', s)
    })
    this.on('error-handshake', err => {
      this.conn.write(Buffer.from([rfc1928.version, rfc1928.methodNoAccept]))
      this.emit('error', 'error-handshake')
    })
    this.on('done-handshake', method => {
      this.conn.write(Buffer.from([rfc1928.version, method]))
    })
    this.on('error-auth', err => {
      this.conn.write(Buffer.from([rfc1929.version, rfc1929.failure]))
      this.emit('error', 'error-auth')
    })
    this.on('error-cmd', err => {
      this.conn.write(Buffer.from([
        rfc1928.version, rfc1928.repGeneralErr, 0x00,
        rfc1928.addrV4, 0,0,0,0,
        0,0]))
      this.emit('error', 'error-cmd')
    })
    this.on('error-dial', err => {
      console.log(`error-dial: ${err}`)
      this.conn.write(Buffer.from([
        rfc1928.version, rfc1928.repConnectionRefused, 0x00,
        rfc1928.addrV4, 0,0,0,0,
        0,0]))
      this.emit('error', 'error-dial')
    })
  }

  getHost():string {
    switch (this.reqAddrType) {
    case rfc1928.addrV4:
      return [
        this.reqAddrBuf.readUInt8(0),
        this.reqAddrBuf.readUInt8(1),
        this.reqAddrBuf.readUInt8(2),
        this.reqAddrBuf.readUInt8(3),
      ].join('.')
    case rfc1928.addrV6:
      // todo
      return ''
    case rfc1928.addrDomain:
      return this.reqAddrBuf.toString('utf-8')
    }
  }
  getPort():number {
    return this.reqPort
  }
  getAddr():string {
    return `${this.getHost()}:${this.reqPort}`
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
  static  ST_DATA = 8
  static  ST_DATA_PIPE = 99
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
    return this.pswdChecker && this.pswdChecker(this.username, this.password)
  }
  private eatBuf(newBuf:Buffer) {
    if (this.state == ConnHandler.ST_DATA_PIPE) return
    if (!this.buf) {
      this.buf = newBuf
    } else {
      this.buf = Buffer.concat([this.buf, newBuf])
    }

    while (this.buf.length >= this.wantSize) {
      switch (this.state) {
        
        case ConnHandler.ST_HANDSHAKE_header:
          this.version = this.buf.readUInt8(0)
          if (this.version != rfc1928.version) {
            this.changeState(ConnHandler.ST_ERR, 0)
            this.eatErr = { event: 'error-handshake', err:'protocol version invalid' }
            continue
          }
          this.methodsLen = this.buf.readUInt8(1) // todo：判断长度是否为空
          if (this.methodsLen <= 0) {
            this.changeState(ConnHandler.ST_ERR, 0)
            this.eatErr = { event: 'error-handshake', err:'length of methods invalid' }
            continue
          }
          this.changeState(ConnHandler.ST_HANDSHAKE_methods, this.methodsLen)
          continue
       
        case ConnHandler.ST_HANDSHAKE_methods:
          this.methods = this.buf.slice(0, this.methodsLen)
          let found = false
          for (let i = 0; i < this.methods.length; i++) {
            if (this.selectMethod == this.methods[i]) {
              this.emit('done-handshake', this.selectMethod)
              this.changeState(ConnHandler.ST_CMD_header, 4+2) // 4代表header，2代表port
              found = true
              break
            }
          }
          if (!found) {
            this.changeState(ConnHandler.ST_ERR, 0)
            this.eatErr = { event: 'error-handshake', err: 'method not found' }
          }
          continue
        
        case ConnHandler.ST_AUTHPSWD_header:
          this.pswdVersion = this.buf.readUInt8(0)
          this.usernameLen = this.buf.readUInt8(1)
          this.changeState(ConnHandler.ST_AUTHPSWD_username,
            this.usernameLen + 1)
          continue
        
        case ConnHandler.ST_AUTHPSWD_username:
          this.username = this.buf.slice(2, 2 + this.usernameLen).toString('utf-8')
          this.passwordLen = this.buf.readUInt8(this.wantSize - 1)
          this.changeState(ConnHandler.ST_AUTHPSWD_password,
            this.passwordLen)
          continue
        
        case ConnHandler.ST_AUTHPSWD_password:
          this.password = this.buf.toString('utf-8')
          if (this.checkPassword()) {
            this.changeState(ConnHandler.ST_CMD_header, 4+2) // 4代表header，2代表port
          } else {
            this.changeState(ConnHandler.ST_ERR, 0)
            this.eatErr = { event: 'error-auth', err: 'check password failed' }
          }
          continue
        
        case ConnHandler.ST_CMD_header:
          this.reqVersion = this.buf.readUInt8(0)
          this.reqCommand = this.buf.readUInt8(1)
          this.reqAddrType = this.buf.readUInt8(3)
          if (this.reqAddrType == rfc1928.addrV4) {
            this.reqAddrBufLen = 4
            this.changeState(ConnHandler.ST_CMD_addr, 4, false) // 不吃掉buf，因为还有2个byte没读
          } else if (this.reqAddrType == rfc1928.addrV6) {
            this.reqAddrBufLen = 16
            this.changeState(ConnHandler.ST_CMD_addr, 16, false)
          } else if (this.reqAddrType == rfc1928.addrDomain) {
            this.reqAddrBufLen = this.buf.readUInt8(4)
            this.changeState(ConnHandler.ST_CMD_addr, this.reqAddrBufLen + 1, false) // 1代表len
          } else {
            this.changeState(ConnHandler.ST_ERR, 0)
            this.eatErr = { event: 'error-cmd', err: `unknown address type ${this.reqAddrType}` }
          }
          continue

        case ConnHandler.ST_CMD_addr:
          let addrPos = this.reqAddrType == rfc1928.addrDomain ? 5 : 4
          let portPos = addrPos + this.reqAddrBufLen
            
          this.reqAddrBuf = this.buf.slice(addrPos, portPos)
          this.reqPort = this.buf.readUInt16BE(portPos)

          this.changeState(ConnHandler.ST_DATA, 0)
          continue
          // done
        
        case ConnHandler.ST_DATA:
          this.conn.removeListener('data', this.ondatacb)
          this.conn.removeListener('error', this.ondataerrcb)
          this.emit('request')
          if (this.buf && this.buf.length > 0) {
            this.emit('data', this.buf)
            // console.log('tail data:', this.buf)
          }
          this.state = ConnHandler.ST_DATA_PIPE
          return

        case ConnHandler.ST_ERR:
          this.emit(this.eatErr.event, this.eatErr.err)
          this.conn.removeListener('data', this.ondatacb)
          this.conn.removeListener('error', this.ondataerrcb)
          return
          // done
      }
    }
  }
}

function makeConnCb(auth:AuthChecker, dial:Dialer) {
  return function (conn:StreamLike) {
    let handler = new ConnHandler(conn, auth, dial)
    handler.on('error', err => {
      conn.destroy()
      handler.removeAllListeners()
      handler = null
    })
    handler.once('stream', (target:StreamLike) => {
      linkStream(conn, target, handler.getAddr())
  })
}
}


export function createServer(auth:AuthChecker, dial:Dialer):net.Server {
  return net.createServer(makeConnCb(auth, dial))
}

export function listenOnVNet(vnet:VNet, port:number, auth:AuthChecker, dial:Dialer) {
  vnet.listen(port, makeConnCb(auth, dial))
}