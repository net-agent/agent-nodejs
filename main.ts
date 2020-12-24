import { VNet } from './src/vnet'
import { Cluster } from './src/cluster'
import { runService } from './src/services'
import * as utils from './src/utils'
import { Config } from './src/config'

main()

async function main() {
  let config:Config
  try {
    config = await utils.loadJSONFile('./dist/config.json')
  } catch (ex) {
    console.warn('load config failed:', ex)
    return
  }
  let {tunnel, services} = config

  let addr = tunnel.address
  let secret = tunnel.password
  let vhost = tunnel.vhost
  let vnet:VNet
  try {
    vnet = await VNet.connect(addr, secret)
  } catch (ex) {
    console.log(`connect ${addr} failed: ${ex}`)
    return
  }
  let cluster = new Cluster(vnet)

  try {
    let resp = await cluster.login(vhost)
    vhost = resp.vhost
    console.log('login success', resp)
    cluster.startHeartbeat()
  } catch (ex) {
    console.log('login failed', ex)
  }

  if (!services || services.length <= 0) {
    console.warn('no services')
    return
  }
  services.forEach((svcInfo, index) => {
    if (!svcInfo.enable) {
      console.warn(`[${index}] ${svcInfo.type} disabled`)
      return
    }
    let svc = runService(vnet, cluster, svcInfo)
    svc.on('ready', (info) => {
      console.warn(`[${index}] ${svcInfo.type} ready. ${info}`)
    })
    svc.on('error', err => {
      console.log(`[${index}] ${svcInfo.type} has error: `, err)
    })
  })
}
