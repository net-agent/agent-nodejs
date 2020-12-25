import {Frame, FrameConn} from './frame_conn'
import * as events from 'events'

export interface StreamLike {
  on(event:'data'|'end'|'close'|'error', cb:(...args:any) => void):this
  write(buf:Buffer):boolean
  destroy(error?:Error):void
  end(...args:any):void
  removeListener(...args:any):void
}

export class Stream extends events.EventEmitter {
  private fconn:FrameConn
  private writeSID:number
  private readSID:number
  private writable:boolean = false
  private dataCache:Buffer = Buffer.alloc(0)
  private dataListenerFound:boolean = false

  constructor(fconn:FrameConn) {
    super()
    this.fconn = fconn
    this.readSID = Frame.uid()
    
    this.fconn.on(`data/${this.readSID}`, (frame:Frame) => {
      if (!frame.data || frame.data.length == 0) {
        this.emit('end')  // todo: end事件因该也要像data一样进行缓存
      } else {
        if (!this.dataListenerFound) {
          this.dataCache = Buffer.concat([this.dataCache, frame.data])
          this.dataListenerFound = this.emit('data', this.dataCache)
          if (this.dataListenerFound) {
            this.dataCache = null
          }
        } else {
          this.emit('data', frame.data)
        }
      }
    })
  }

  on(event:'data'|'end'|'close'|'error', cb:(...args:any) => void):this {
    if (event == 'data' && !this.dataListenerFound) {
      setTimeout(() => {
        if (!this.dataListenerFound && this.dataCache && this.dataCache.length > 0) {
          this.dataListenerFound = this.emit('data', this.dataCache)
          if (this.dataListenerFound) {
            this.dataCache = null
          }
        }
      }, 10)
    }
    super.on(event, cb)
    return this
  }

  bindWriteSID(sid:number) {
    this.writeSID = sid
    this.writable = true
  }

  getReadSID():number {
    return this.readSID
  }

  write(buf:Buffer):boolean {
    if (!this.writable) {
      this.emit('error', 'stream is not writable')
      return
    }
    if (!buf || buf.length == 0) {
      this.writable = false
    }
    return this.fconn.send(Frame.newStreamData(this.writeSID, buf))
  }

  destroy(error?:Error) {
    if (this.writable) {
      this.end()
    }
    super.removeAllListeners()
    this.fconn.removeAllListeners(`data/${this.readSID}`)
    this.fconn = null
    this.readSID = 0
    this.emit('close')
  }

  end(data?:Buffer, cb?:() =>void ):this {
    if (data) {
      this.write(data)
    }
    this.write(null) // 发送一帧空数据代表EOF
    return this
  }
}