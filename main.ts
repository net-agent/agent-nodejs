import { VNet } from './src/vnet'
import { Cluster } from './src/cluster'
import { runService } from './src/services'
import * as utils from './src/utils'
import { Config, TunnelInfo } from './src/config'

export async function openVNet(tunnel:TunnelInfo):Promise<{vnet:VNet, cluster:Cluster}> {
  let addr = tunnel.address
  let secret = tunnel.password
  let vhost = tunnel.vhost
  let vnet:VNet = await VNet.connect(addr, secret)
  console.log(`vnet connect success, addr=${addr}`)
  let cluster = new Cluster(vnet)
  let resp = await cluster.login(vhost)
  vhost = resp.vhost
  console.log(`login cluster success, vhost=${resp.vhost} tid=${resp.tid}`)
  cluster.startHeartbeat()

  return {vnet, cluster}
}

export async function main() {
  let config:Config
  try {
    config = await utils.loadJSONFile('./dist/config.json')
  } catch (ex) {
    console.warn('load config failed:', ex)
    return
  }
  let {tunnel, services} = config

  let vnet:VNet, cluster:Cluster
  try {
    let resp = await openVNet(tunnel)
    vnet = resp.vnet
    cluster = resp.cluster
  } catch (ex) {
    console.warn('openVNet failed', ex)
    return
  }

  if (!services || services.length <= 0) {
    console.warn('no services')
    return
  }
  services.forEach((svcInfo, index) => {
    let prefix = `[${index}][${svcInfo.type.padEnd(9, ' ')}] "${svcInfo.description}"`
    if (!svcInfo.enable) {
      console.warn(`${prefix} disabled`)
      return
    }
    let svc = runService(vnet, cluster, svcInfo)
    svc.on('ready', info => {
      console.log(`${prefix} ready. ${info}`)
    })
    svc.on('error', err => {
      console.log(`${prefix} has error: `, err)
    })
    svc.on('warn', info => {
      console.log((`${prefix} warn: ${info}`))
    })
  })
}
