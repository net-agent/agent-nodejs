import { VNet } from "./vnet"
import { Stream } from './stream'
import { sleep } from './utils'

export class Cluster {
  static heartbeatInterval:number = 1000 * 4
  static prefix:string = 'cluster'

  static cmd(cmd:string):string {
    return `${Cluster.prefix}/${cmd}`
  }

  private vnet:VNet

  constructor(vnet:VNet) {
    this.vnet = vnet
  }

  // login 向集群注册，获取vhost和tid
  public login(vhost:string):Promise<{tid:number, vhost:string}> {
    let cmd = Cluster.cmd('Login')
    return this.vnet.request(cmd, {vhost})
  }
  // heartbeat 发送一次心跳包
  public heartbeat():Promise<void> {
    let cmd = Cluster.cmd('Heartbeat')
    return this.vnet.request(cmd, null)
  }
  // startHeartbeat 连续发送心跳包，直至失败
  public async startHeartbeat() {
    let cmd = Cluster.cmd('Heartbeat')
    try {
      do {
        await sleep(Cluster.heartbeatInterval)
        await this.vnet.request(cmd, {})
      } while(true)
    } catch (ex) {
      console.log('heartbeat stopped', ex)
    }
  }
  // 基于vnet创建链接
  public async dial(vhost:string, vport:number):Promise<Stream> {
    let stream = new Stream(this.vnet.fconn)
    let writeSID = stream.getReadSID()
    let cmd = Cluster.cmd('Dial')

    try {
      let {readSID} = await this.vnet.request(cmd, { writeSID, vhost, vport })
      stream.bindWriteSID(readSID)
    } catch (ex) {
      stream.destroy()
      throw ex
    }

    return stream
  }
}